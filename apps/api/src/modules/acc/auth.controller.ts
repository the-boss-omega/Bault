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

export const CREDENTIAL_ROUTE = loadEnv().AUTH_RATE_LIMIT_PER_MINUTE;

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
    req.user = user;
    this.setSessionCookie(res, rawToken, expiresAt);
    return { id: user.id, role: user.role, mfaEnrollmentRequired: this.mfa.requiredFor(user.role) };
  }

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
    req.user = user;
    this.setSessionCookie(res, rawToken, expiresAt);
    return { id: user.id, role: user.role, mfaEnrollmentRequired: false };
  }

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

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const ended = await this.sessions.revokeAllFor(user.id, this.rawSessionToken(req));
    return { status: 'sessions_revoked', otherSessionsEnded: ended };
  }

  private origin(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }

  private rawSessionToken(req: Request): string | undefined {
    if (!req.headers.cookie) return undefined;
    return parseCookie(req.headers.cookie)[env.SESSION_COOKIE_NAME];
  }

  private setSessionCookie(res: Response, rawToken: string, expiresAt: Date): void {
    res.cookie(env.SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
  }
}
