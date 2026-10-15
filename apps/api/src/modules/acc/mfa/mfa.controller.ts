import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parse as parseCookie } from 'cookie';
import type { Request } from 'express';
import { loadEnv } from '@bault/config';
import { AuthBucket } from '../../../shared/throttle/auth-bucket';
import { CurrentUser } from '../../sec/current-user.decorator';
import type { AuthUser } from '../../sec/auth-context';
import { CREDENTIAL_ROUTE } from '../auth.controller';
import { ConfirmMfaDto, DisableMfaDto, MfaCodeDto } from '../acc.dto';
import { AllowWithoutMfa } from './allow-without-mfa.decorator';
import { MfaService } from './mfa.service';

/**
 * The signed-in half of two-factor sign-in: see where it stands, enrol, replace
 * the recovery codes, turn it off. (The signed-out half — the second sign-in
 * step — is `POST /auth/login/mfa` on `AuthController`.)
 *
 * Under `/auth` on purpose: the error reporter drops request bodies on `/auth`
 * routes before anything leaves for a third party, and these bodies carry codes
 * and a password. Responses that carry a secret or recovery codes are
 * `no-store`, so no cache between here and the browser keeps a copy.
 *
 * Status, setup and confirm are `@AllowWithoutMfa()`: an administrator who must
 * enrol and has not is refused everywhere else, and these are how they enrol.
 * The code-checking routes count against the credential bucket like sign-in.
 */
@ApiTags('ACC')
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @AllowWithoutMfa()
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  @AllowWithoutMfa()
  @Post('setup')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  setup(@CurrentUser() user: AuthUser) {
    return this.mfa.beginSetup(user.id);
  }

  /**
   * The recovery codes are in this response and nowhere else, ever.
   *
   * Asks for the password as well as a code, and ends the account's other
   * sessions. A session is not proof of who is holding it: without the
   * password, whoever had lifted a cookie could enrol a phone of their own and
   * keep the owner out of their own account from then on.
   */
  @AllowWithoutMfa()
  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmMfaDto, @Req() req: Request) {
    const { recoveryCodes, otherSessionsEnded } = await this.mfa.confirmSetup(
      user,
      dto.password,
      dto.code,
      this.rawSessionToken(req),
      this.origin(req),
    );
    return { status: 'enabled', recoveryCodes, otherSessionsEnded };
  }

  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('recovery-codes')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  regenerate(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    return this.mfa.regenerateRecoveryCodes(user, dto.code, this.origin(req));
  }

  @AuthBucket(CREDENTIAL_ROUTE)
  @Post('disable')
  @HttpCode(200)
  async disable(@CurrentUser() user: AuthUser, @Body() dto: DisableMfaDto, @Req() req: Request) {
    await this.mfa.disable(user, dto.password, dto.code, this.origin(req));
    return { status: 'disabled' };
  }

  /** The session this request came in on, which enabling leaves open. */
  private rawSessionToken(req: Request): string | undefined {
    if (!req.headers.cookie) return undefined;
    return parseCookie(req.headers.cookie)[loadEnv().SESSION_COOKIE_NAME];
  }

  private origin(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }
}
