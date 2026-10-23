import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EasyPostError, PaymentProviderError } from '@bault/adapters';
import { pgErrorCode } from './pg-error';
import { ErrorCode } from './error-codes';
import {
  reportException,
  type ExceptionReporter,
  type ReportedRequest,
} from '../observability/error-reporting';
import { currentRequestId } from '../observability/logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly report: ExceptionReporter = reportException) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        const req = requestOf(host);
        if (!READINESS_PROBE.test(pathOf(req))) this.report(exception, describeRequest(req));
      }
      const body = exception.getResponse();
      const error =
        typeof body === 'object' && body !== null && 'code' in body
          ? body
          : {
              code: this.mapStatus(status),
              message:
                status === HttpStatus.TOO_MANY_REQUESTS
                  ? 'Too many requests. Wait a moment and try again.'
                  : exception.message,
              details: {},
            };
      res.status(status).json({ error });
      return;
    }

    if (isInvalidTextRepresentation(exception)) {
      this.logger.warn(`Malformed identifier rejected: ${describe(withoutQueryValues(exception))}`);
      res.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'That identifier is not in a valid format.',
          details: {},
        },
      });
      return;
    }

    const provider = providerFailure(exception);
    if (provider) {
      if (provider.rejectedInput) {
        this.logger.warn(`Provider rejected the request (${provider.kind}): ${describe(exception)}`);
        res.status(HttpStatus.BAD_REQUEST).json({
          error: {
            code: ErrorCode.PROVIDER_REJECTED,
            message: `The carrier could not accept this shipment as entered: ${provider.reason}. Check the address and the parcel details, then try again.`,
            details: { provider: provider.kind },
          },
        });
        return;
      }
      this.logger.error(`Provider failure (${provider.kind}): ${exception instanceof Error ? exception.stack : describe(exception)}`);
      this.report(exception, describeRequest(requestOf(host)));
      res.status(HttpStatus.BAD_GATEWAY).json({
        error: {
          code: ErrorCode.PROVIDER_UNAVAILABLE,
          message: `The ${provider.kind === 'shipping' ? 'shipping' : 'payment'} provider could not handle this just now. Try again shortly.`,
          details: { provider: provider.kind },
        },
      });
      return;
    }

    const middlewareStatus = statusOf(exception);
    if (middlewareStatus && middlewareStatus >= 400 && middlewareStatus < 500) {
      this.logger.warn(`Request rejected by middleware (${middlewareStatus}): ${describe(exception)}`);
      res.status(middlewareStatus).json({
        error: {
          code: this.mapStatus(middlewareStatus),
          message:
            middlewareStatus === HttpStatus.PAYLOAD_TOO_LARGE
              ? 'That request is too large.'
              : 'Bad request.',
          details: {},
        },
      });
      return;
    }

    const safe = withoutQueryValues(exception);
    this.logger.error(safe instanceof Error ? safe.stack : String(safe));
    this.report(safe, describeRequest(requestOf(host)));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: ErrorCode.INTERNAL, message: 'Internal server error', details: {} },
    });
  }

  private mapStatus(status: number): ErrorCode {
    if (status === HttpStatus.UNAUTHORIZED) return ErrorCode.UNAUTHENTICATED;
    if (status === HttpStatus.FORBIDDEN) return ErrorCode.FORBIDDEN;
    if (status === HttpStatus.NOT_FOUND) return ErrorCode.NOT_FOUND;
    if (status === HttpStatus.CONFLICT) return ErrorCode.CONFLICT;
    if (status === HttpStatus.BAD_REQUEST) return ErrorCode.VALIDATION_FAILED;
    if (status === HttpStatus.TOO_MANY_REQUESTS) return ErrorCode.RATE_LIMITED;
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return ErrorCode.VALIDATION_FAILED;
    return ErrorCode.INTERNAL;
  }
}

const PG_INVALID_TEXT_REPRESENTATION = '22P02';

function isInvalidTextRepresentation(exception: unknown): boolean {
  return pgErrorCode(exception) === PG_INVALID_TEXT_REPRESENTATION;
}

function providerFailure(
  exception: unknown,
): { kind: 'shipping' | 'payment'; rejectedInput: boolean; reason: string } | null {
  if (!(exception instanceof Error)) return null;
  if (exception instanceof EasyPostError || exception.name === 'EasyPostError') {
    const e = exception as EasyPostError;
    const reason = (e.detail ?? e.message).replace(/[.\s]+$/, '').slice(0, 300);
    return { kind: 'shipping', rejectedInput: e.status === 400 || e.status === 422, reason };
  }
  if (exception instanceof PaymentProviderError || exception.name === 'PaymentProviderError') {
    return { kind: 'payment', rejectedInput: false, reason: exception.message };
  }
  return null;
}

function withoutQueryValues(exception: unknown): unknown {
  const query = queryErrorOf(exception);
  if (!query) return exception;
  const db = databaseErrorOf(exception);
  const named = [
    db?.constraint ? `constraint ${db.constraint}` : null,
    db?.table ? `table ${db.table}` : null,
    db?.column ? `column ${db.column}` : null,
  ].filter(Boolean);
  const sqlText = query.query.replace(/'(?:[^']|'')*'/g, "'…'").slice(0, 500);
  const safe = new Error(
    `Query failed, SQLSTATE ${pgErrorCode(exception) ?? 'unknown'}${named.length > 0 ? ` (${named.join(', ')})` : ''}: ${sqlText}`,
  );
  safe.name = 'DatabaseQueryError';
  const frames = (query.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  safe.stack = [`${safe.name}: ${safe.message}`, ...frames].join('\n');
  return safe;
}

function queryErrorOf(exception: unknown): { query: string; stack?: string } | null {
  if (!(exception instanceof Error)) return null;
  const e = exception as Error & { query?: unknown; params?: unknown };
  return typeof e.query === 'string' && Array.isArray(e.params) ? { query: e.query, stack: e.stack } : null;
}

function databaseErrorOf(exception: unknown): { constraint?: string; table?: string; column?: string } | null {
  let current = (exception as { cause?: unknown })?.cause;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      return { constraint: text(e.constraint), table: text(e.table), column: text(e.column) };
    }
    current = e.cause;
  }
  return null;
}

function statusOf(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const e = exception as { status?: unknown; statusCode?: unknown };
  const raw = typeof e.status === 'number' ? e.status : e.statusCode;
  return typeof raw === 'number' ? raw : null;
}

function describe(exception: unknown): string {
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
  return String(exception);
}

const READINESS_PROBE = /\/(healthz|readyz)(\/|$)/;

function requestOf(host: ArgumentsHost): Request | undefined {
  try {
    return host.switchToHttp().getRequest<Request>();
  } catch {
    return undefined;
  }
}

function pathOf(req: Request | undefined): string {
  return (req?.originalUrl || req?.url || '').split('?')[0] ?? '';
}

function describeRequest(req: Request | undefined): ReportedRequest | undefined {
  if (!req) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return {
    method: req.method,
    url: req.originalUrl || req.url,
    headers,
    data: req.body,
    requestId: currentRequestId(),
  };
}
