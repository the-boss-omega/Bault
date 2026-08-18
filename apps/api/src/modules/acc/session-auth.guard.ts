import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parse as parseCookie } from 'cookie';
import type { Request } from 'express';
import { loadEnv } from '@bault/config';
import { AppError } from '../../shared/errors/app-error';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_SUSPENDED_KEY } from './allow-suspended.decorator';
import { SessionService } from './session.service';

/**
 * Global authentication + account-status guard (T031 + T034).
 *
 * Steps for every request:
 *   1. Read the session cookie; if present, resolve it to an AuthUser.
 *   2. If the account is not `active` (suspended/closed), BLOCK it — even on
 *      public routes, that account is barred from signing in and every action
 *      (Principle: suspended/closed blocked from all actions).
 *   3. Attach the user to the request.
 *   4. Public routes (@Public) pass regardless; all others require a user (401).
 *
 * ONE EXCEPTION, at step 2. A route marked `@AllowSuspended()` is reachable by a
 * SUSPENDED account. It exists for the helpdesk and nothing else: suspension is
 * now imposed automatically for debt, and a holder who cannot sign in cannot
 * cash in, so without a way to ask for help the lock has no key on the inside.
 * `closed` is never let through — that state is terminal.
 *
 * Runs before RolesGuard, which then checks @Roles.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly cookieName = loadEnv().SESSION_COOKIE_NAME;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = this.readSessionCookie(req);

    if (raw) {
      const user = await this.sessions.resolve(raw);
      if (user) {
        // `suspended` may pass on an explicitly-marked route; `closed` never does.
        const permitted =
          user.status === 'active' || (allowSuspended === true && user.status === 'suspended');
        if (!permitted) throw AppError.accountSuspended();
        req.user = user;
      }
    }

    if (isPublic) return true;
    if (!req.user) throw AppError.unauthenticated();
    return true;
  }

  private readSessionCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    return parseCookie(header)[this.cookieName];
  }
}
