import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { AppError } from '../../shared/errors/app-error';
import type { Role } from './auth-context';

/**
 * RBAC guard (T014, Principle X). Enforces `@Roles(...)` at the API layer.
 * A route with no @Roles is open to any authenticated user; the session guard
 * (ACC) handles authentication and account-status blocking upstream.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw AppError.unauthenticated();
    if (!required.includes(user.role)) {
      throw AppError.forbidden(`Requires role: ${required.join(' | ')}`);
    }
    return true;
  }
}
