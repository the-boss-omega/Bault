import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/app-error';
import type { AuthUser } from './auth-context';

/**
 * Param decorator: injects the authenticated user into a handler.
 * `handler(@CurrentUser() user: AuthUser)`. Throws 401 if unauthenticated.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw AppError.unauthenticated();
  return user;
});
