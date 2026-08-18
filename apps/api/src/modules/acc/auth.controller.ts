import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parse as parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import { loadEnv } from '@bault/config';
import { Public } from './public.decorator';
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
  @Post('verify-email/resend')
  @HttpCode(202)
  async resend(@Body() dto: EmailDto) {
    await this.verification.resend(dto.email.trim().toLowerCase());
    return { status: 'sent_if_pending' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, rawToken, expiresAt } = await this.auth.login(dto.identifier, dto.password);
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
  @Post('password/reset-request')
  @HttpCode(202)
  async resetRequest(@Body() dto: EmailDto) {
    await this.passwords.requestReset(dto.email);
    return { status: 'sent_if_exists' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.passwords.reset(dto.token, dto.newPassword);
    return { status: 'password_changed' };
  }

  @Post('password/change')
  @HttpCode(200)
  async change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.passwords.change(user.id, dto.currentPassword, dto.newPassword);
    return { status: 'password_changed' };
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
