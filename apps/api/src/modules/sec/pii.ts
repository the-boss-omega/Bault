import 'reflect-metadata';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

const PII_FIELDS = new Map<object, Set<string>>();

export function Pii(): PropertyDecorator {
  return (target, key) => {
    const ctor = target.constructor;
    const set = PII_FIELDS.get(ctor) ?? new Set<string>();
    set.add(String(key));
    PII_FIELDS.set(ctor, set);
  };
}

@Injectable()
export class PiiInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isAdmin = ctx.switchToHttp().getRequest<Request>().user?.role === 'admin';
    return next.handle().pipe(map((data) => (isAdmin ? data : redact(data))));
  }
}

function redact(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(redact);
  if (data && typeof data === 'object') {
    const fields = PII_FIELDS.get(data.constructor);
    if (fields) for (const f of fields) delete (data as Record<string, unknown>)[f];
    return data;
  }
  return data;
}
