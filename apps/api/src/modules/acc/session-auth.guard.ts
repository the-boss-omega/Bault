import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parse as parseCookie } from 'cookie';
import type { Request } from 'express';
import { loadEnv } from '@bault/config';
import { AppError } from '../../shared/errors/app-error';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_SUSPENDED_KEY } from './allow-suspended.decorator';
import { ALLOW_ANY_STATUS_KEY } from './allow-any-status.decorator';
import { SessionService } from './session.service';

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

    const allowAnyStatus = this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_STATUS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = this.readSessionCookie(req);

    if (raw) {
      const user = await this.sessions.resolve(raw);
      if (user) {
        const permitted =
          user.status === 'active' ||
          allowAnyStatus === true ||
          (allowSuspended === true && user.status === 'suspended');
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
