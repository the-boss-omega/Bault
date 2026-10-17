import { Body, Controller, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parse as parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import { loadEnv } from '@bault/config';
import { AuthBucket } from '../../shared/throttle/auth-bucket';
import { AppError } from '../../shared/errors/app-error';
import { Public } from './public.decorator';
import { AllowAnyStatus } from './allow-any-status.decorator';
import { AllowWithoutMfa } from './mfa/allow-without-mfa.decorator';
import { MfaService } from './mfa/mfa.service';

/**
 * The bucket for routes that check a credential.
 *
 * Read from config rather than hard-coded: an inline `limit` OVERRIDES the
 * configured `auth` throttler and would leave `AUTH_RATE_LIMIT_PER_MINUTE`
 * doing nothing.
 *
 * The right number depends on the deployment. Collectors behind one office NAT
 * or one carrier's egress share an address, and a budget that locks them out
 * while barely inconveniencing a script that can rotate addresses is the worst
 * of both.
 */
export const CREDENTIAL_ROUTE = loadEnv().AUTH_RATE_LIMIT_PER_MINUTE;

/**
 * The routes that send mail to an address the CALLER chose.
 *
 * Password reset and verification resend are the two places where an
 * unauthenticated stranger can make Bault email somebody. Five a minute per IP
 * is far more than any human needs and destroys the value of pointing a script
 * at a mailbox. Deliberately NOT configurable: there is no deployment where a
 * higher number is the right answer, and the one place a low limit would hurt
 * (a shared office IP signing in) is the sign-in route, not this one.
 */
const MAIL_ROUTE = 5;
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
  LoginMfaDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
} from './acc.dto';

const env = loadEnv();

/** ACC auth endpoints: `/auth/*`. */
@ApiTags('ACC')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * The response names the account by its USERNAME: the permanent, unique,
   * customer-facing identifier. No intake ID is returned (none is allocated).
   */
  @Public()
  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { username, firstName, lastName, termsVersion, termsAcceptedAt } = await this.auth.register(
      dto.email,
      dto.username,
      dto.password,
      dto.firstName,
      dto.lastName,
      dto.acceptedTermsVersion,
    );
    // The acceptance is returned as STORED, so the page can show the person
    // exactly what was recorded against their account.
    return { status: 'pending_verification', username, firstName, lastName, termsVersion, termsAcceptedAt };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: TokenDto) {
    await this.verification.verifyEmail(dto.token);
    return { status: 'active' };
  }

  @Public()
  @AuthBucket(MAIL_ROUTE)
  @Post('verify-email/resend')
  @HttpCode(202)
  async resend(@Body() dto: EmailDto) {
    await this.verification.resend(dto.email.trim().toLowerCase());
    return { status: 'sent_if_pending' };
  }

  /**
   * The password step. For most accounts it opens a session. For an account
   * with two-factor sign-in it opens NOTHING: it answers
   * `{ status: 'mfa_required', challengeToken, expiresAt }` and the session
   * comes from `POST /auth/login/mfa`. `Cache-Control: no-store` because the
   * challenge is half a credential.
   *
   * `mfaEnrollmentRequired` tells the app, before it renders anything, that this
   * account's role needs a second factor it does not have yet: every route but
   * enrolment will refuse it, so the app goes straight to the enrolment screen.
   */
  @Public()
  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.identifier, dto.password, this.origin(req));
    if (result.kind === 'challenge') {
      return { status: 'mfa_required', challengeToken: result.challengeToken, expiresAt: result.expiresAt };
    }
    const { user, rawToken, expiresAt } = result;
    /**
     * Name the actor for the audit row. The audit interceptor records `req.user`
     * once the handler returns, and sign-in has no user until it finishes, so it
     * is set here for the interceptor to read.
     */
    req.user = user;
    this.setSessionCookie(res, rawToken, expiresAt);
    return { id: user.id, role: user.role, mfaEnrollmentRequired: this.mfa.requiredFor(user.role) };
  }

  /**
   * The second sign-in step: the challenge plus a code from the authenticator
   * app, or plus a recovery code. Public (there is no session yet) and metered
   * by the same credential bucket as the password, because it checks a
   * credential: without that, a stolen password would buy guesses at the code
   * as fast as the network allowed, held back only by the lockout.
   */
  @Public()
  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(@Body() dto: LoginMfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const hasCode = typeof dto.code === 'string' && dto.code.trim() !== '';
    const hasRecovery = typeof dto.recoveryCode === 'string' && dto.recoveryCode.trim() !== '';
    if (hasCode === hasRecovery) {
      throw AppError.validation('Send either the code from your authenticator app or a recovery code — one of them.');
    }
    const { user, rawToken, expiresAt } = await this.auth.completeSecondFactor(
      dto.challengeToken,
      hasCode ? { code: dto.code! } : { recoveryCode: dto.recoveryCode! },
      this.origin(req),
    );
    req.user = user; // the audit row's actor, as for the password step
    this.setSessionCookie(res, rawToken, expiresAt);
    return { id: user.id, role: user.role, mfaEnrollmentRequired: false };
  }

  /**
   * Reachable before a required second factor is enrolled, and by an account
   * of any status: a way out must always exist, and ending a session grants
   * nothing.
   */
  @AllowWithoutMfa()
  @AllowAnyStatus()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.headers.cookie ? parseCookie(req.headers.cookie)[env.SESSION_COOKIE_NAME] : undefined;
    if (raw) await this.sessions.revoke(raw);
    res.clearCookie(env.SESSION_COOKIE_NAME);
  }

  @Public()
  @AuthBucket(MAIL_ROUTE)
  @Post('password/reset-request')
  @HttpCode(202)
  async resetRequest(@Body() dto: EmailDto) {
    await this.passwords.requestReset(dto.email);
    return { status: 'sent_if_exists' };
  }

  @Public()
  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.passwords.reset(dto.token, dto.newPassword);
    return { status: 'password_changed' };
  }

  /**
   * The caller's own cookie is passed down so their current session survives and
   * every OTHER one they hold is ended. The count comes back so the page can say
   * "signed out 3 other devices".
   */
  @AuthBucket(CREDENTIAL_ROUTE)
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
   * Sign out everywhere else, without changing the password: "somebody may be
   * using my account" and "I want a new password" are separate worries.
   */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const ended = await this.sessions.revokeAllFor(user.id, this.rawSessionToken(req));
    return { status: 'sessions_revoked', otherSessionsEnded: ended };
  }

  /**
   * The real client: `main.ts` trusts only the configured proxy hops
   * (`TRUST_PROXY`, default loopback), so behind the tunnel this is the
   * visitor, not 127.0.0.1.
   */
  private origin(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
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
