import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parse as parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import { loadEnv } from '@bault/config';
import { Throttle } from '@nestjs/throttler';
import { Public } from './public.decorator';

/**
 * The bucket for routes that check a credential.
 *
 * Read from config rather than hard-coded, which was the bug in the first
 * version of this: an inline `limit: 10` OVERRIDES the configured `auth`
 * throttler, so `AUTH_RATE_LIMIT_PER_MINUTE` was silently doing nothing and
 * every deployment got ten regardless of what it asked for.
 *
 * The right number depends on the deployment. Collectors behind one office NAT
 * or one carrier's egress share an address, and a budget that locks them out
 * while barely inconveniencing a script that can rotate addresses is the worst
 * of both.
 */
const CREDENTIAL_ROUTE = { auth: { limit: loadEnv().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } };

/**
 * The routes that send mail to an address the CALLER chose.
 *
 * Password reset and verification resend are the two places where an
 * unauthenticated stranger can make Bault email somebody. Five a minute per IP
 * is far more than any human needs and destroys the value of pointing a script
 * at a mailbox. Deliberately NOT configurable: there is no deployment where a
 * higher number is the right answer, and the one place a low limit would hurt —
 * a shared office IP signing in — is the sign-in route, not this one.
 */
const MAIL_ROUTE = { auth: { limit: 5, ttl: 60_000 } };
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
} from './acc.dto';

const env = loadEnv();

/** ACC auth endpoints (T035). Maps 1:1 to contracts/openapi.yaml `/auth/*`. */
@ApiTags('ACC')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * The response names the account by its USERNAME — the permanent, unique,
   * customer-facing identifier. No intake ID is returned any more (none is
   * allocated); nothing downstream ever asks a person to quote one.
   */
  @Public()
  @Throttle(CREDENTIAL_ROUTE)
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { username, firstName, lastName } = await this.auth.register(
      dto.email,
      dto.username,
      dto.password,
      dto.firstName,
      dto.lastName,
    );
    return { status: 'pending_verification', username, firstName, lastName };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: TokenDto) {
    await this.verification.verifyEmail(dto.token);
    return { status: 'active' };
  }

  @Public()
  @Throttle(MAIL_ROUTE)
  @Post('verify-email/resend')
  @HttpCode(202)
  async resend(@Body() dto: EmailDto) {
    await this.verification.resend(dto.email.trim().toLowerCase());
    return { status: 'sent_if_pending' };
  }

  @Public()
  @Throttle(CREDENTIAL_ROUTE)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, rawToken, expiresAt } = await this.auth.login(dto.identifier, dto.password, {
      // The real client: `main.ts` trusts the loopback proxy and nothing else,
      // so behind the tunnel this is the visitor, not 127.0.0.1.
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    /**
     * Name the actor for the audit row.
     *
     * The audit interceptor records `req.user` once the handler returns, and
     * sign-in is the one request that has no user until it finishes — so every
     * sign-in was audited as `POST /api/v1/auth/login` by nobody. Setting it here
     * is what the interceptor reads a moment later.
     */
    req.user = user;
    this.setSessionCookie(res, rawToken, expiresAt);
    return { id: user.id, role: user.role };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.headers.cookie ? parseCookie(req.headers.cookie)[env.SESSION_COOKIE_NAME] : undefined;
    if (raw) await this.sessions.revoke(raw);
    res.clearCookie(env.SESSION_COOKIE_NAME);
  }

  @Public()
  @Throttle(MAIL_ROUTE)
  @Post('password/reset-request')
  @HttpCode(202)
  async resetRequest(@Body() dto: EmailDto) {
    await this.passwords.requestReset(dto.email);
    return { status: 'sent_if_exists' };
  }

  @Public()
  @Throttle(CREDENTIAL_ROUTE)
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.passwords.reset(dto.token, dto.newPassword);
    return { status: 'password_changed' };
  }

  /**
   * The caller's own cookie is passed down so their current session survives and
   * every OTHER one they hold is ended. The count comes back because "signed out
   * 3 other devices" and "signed out 0" are different facts, and the person who
   * just changed their password because they were worried deserves the first one
   * stated rather than implied.
   */
  @Throttle(CREDENTIAL_ROUTE)
  @Post('password/change')
  @HttpCode(200)
  async change(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const { otherSessionsEnded } = await this.passwords.change(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      this.rawSessionToken(req),
    );
    return { status: 'password_changed', otherSessionsEnded };
  }

  /**
   * Sign out everywhere else, without changing the password.
   *
   * The revocation existed only as a side effect of changing a password, which
   * made "I think somebody is using my account" a thing you could only act on by
   * also picking a new password. They are separate worries and this is the
   * separate answer.
   */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const ended = await this.sessions.revokeAllFor(user.id, this.rawSessionToken(req));
    return { status: 'sessions_revoked', otherSessionsEnded: ended };
  }

  /** The raw session cookie on this request, if there is one. */
  private rawSessionToken(req: Request): string | undefined {
    if (!req.headers.cookie) return undefined;
    return parseCookie(req.headers.cookie)[env.SESSION_COOKIE_NAME];
  }

  private setSessionCookie(res: Response, rawToken: string, expiresAt: Date): void {
    res.cookie(env.SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true, // not readable by JS → mitigates XSS token theft (Principle IX)
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
  }
}
