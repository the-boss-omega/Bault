import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isJson(contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'));
}

export function jsonBodiesOnly() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const declared = req.headers['content-type'];
    if (STATE_CHANGING.has(req.method) && declared && !isJson(declared)) {
      next(
        new AppError(
          ErrorCode.VALIDATION_FAILED,
          'This API accepts JSON only. Send the request with Content-Type: application/json.',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ),
      );
      return;
    }
    next();
  };
}

const DEVELOPMENT_ORIGINS = ['http://localhost:4173', 'http://127.0.0.1:4173'];

export function writeOrigins(
  appBaseUrl: string,
  corsOrigins: string,
  nodeEnv: string,
): Set<string> {
  const out = new Set<string>();
  const extra = nodeEnv === 'development' ? DEVELOPMENT_ORIGINS : [];
  for (const raw of [appBaseUrl, ...corsOrigins.split(','), ...extra]) {
    const value = raw.trim();
    if (!value) continue;
    try {
      out.add(new URL(value).origin);
    } catch {
    }
  }
  return out;
}

export function sameOriginWrites(allowed: ReadonlySet<string>, exemptPaths: readonly string[]) {
  const exempt = new Set(exemptPaths.map(normalisePath));
  return (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (
      origin === undefined ||
      !STATE_CHANGING.has(req.method) ||
      allowed.has(origin) ||
      exempt.has(normalisePath(req.path))
    ) {
      next();
      return;
    }
    next(AppError.forbidden('This request came from a page outside Bault, so it was refused.'));
  };
}

function normalisePath(path: string): string {
  return path.toLowerCase().replace(/\/+$/, '');
}
