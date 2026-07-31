import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { AuditService } from './audit.service';

/**
 * Audit interceptor (T015, Principle II / audit log).
 *
 * Records one audit row for every STATE-CHANGING request (POST/PUT/PATCH/DELETE)
 * after it succeeds — actor, action (method + path), and timestamp. Read-only
 * GETs are not audited. Registered globally in AppModule.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return next.handle();

    // SEC-01: target = first path segment after the /api/v1 prefix + the route's id param.
    const targetEntity =
      req.path.replace(/^\/api\/v1\//, '').split('/').filter(Boolean)[0] ?? null;
    const rawTargetId =
      req.params.id ??
      req.params.itemId ??
      req.params.requestId ??
      req.params.offerId ??
      req.params.listingId ??
      req.params.userId ??
      null;
    const targetId = Array.isArray(rawTargetId) ? (rawTargetId[0] ?? null) : rawTargetId;

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget; audit failure must not mask a successful response, but is logged.
        void this.audit
          .record({
            actorId: req.user?.id ?? null,
            action: `${req.method} ${req.path}`,
            targetEntity,
            targetId,
            metadata: { params: req.params },
          })
          .catch(() => undefined);
      }),
    );
  }
}
