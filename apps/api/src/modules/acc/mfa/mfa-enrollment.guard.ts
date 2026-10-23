import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCode } from '../../../shared/errors/error-codes';
import { IS_PUBLIC_KEY } from '../public.decorator';
import { ALLOW_WITHOUT_MFA_KEY } from './allow-without-mfa.decorator';
import { MFA_POLICY, type MfaPolicy } from './mfa-policy';

@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MFA_POLICY) private readonly policy: MfaPolicy,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) return true;
    if (!this.policy.requiredRoles.includes(user.role)) return true;
    if (user.mfaEnabled === true) return true;

    throw new AppError(
      ErrorCode.MFA_ENROLLMENT_REQUIRED,
      'Your role requires two-factor sign-in. Set up an authenticator app before doing anything else.',
      HttpStatus.FORBIDDEN,
    );
  }
}
