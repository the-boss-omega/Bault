import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCode } from '../../../shared/errors/error-codes';
import { IS_PUBLIC_KEY } from '../public.decorator';
import { ALLOW_WITHOUT_MFA_KEY } from './allow-without-mfa.decorator';
import { MFA_POLICY, type MfaPolicy } from './mfa-policy';

/**
 * A role that requires a second factor gets nothing until it has one.
 *
 * Runs after `SessionAuthGuard`, which puts the user — with `mfaEnabled`, read
 * from the database on every request — on the request. An account whose role
 * is in `MFA_REQUIRED_ROLES` and that has not enrolled is refused on every
 * route except those marked `@AllowWithoutMfa()`: enrolment, sign-out and the
 * profile probe.
 *
 * Sign-in itself is not refused, and that is deliberate. An administrator who
 * could not sign in until enrolled could never enrol; one who can sign in and
 * then do nothing else is pointed at the one thing left to do. The refusal is
 * its own error code so the app can send them there rather than render a
 * console where every panel says "forbidden".
 *
 * Fails closed: a user object without the flag is treated as not enrolled.
 */
@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MFA_POLICY) private readonly policy: MfaPolicy,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, targets)) return true;
    // Public routes are public to everybody; anonymous requests on private
    // routes have already been refused by the session guard.
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
