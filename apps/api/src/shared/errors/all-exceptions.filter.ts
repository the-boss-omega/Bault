import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pgErrorCode } from './pg-error';
import { ErrorCode } from './error-codes';
import {
  reportException,
  type ExceptionReporter,
  type ReportedRequest,
} from '../observability/error-reporting';
import { currentRequestId } from '../observability/logger';

/**
 * Global exception filter (T013). Renders EVERY error into the single problem
 * shape documented in contracts/README.md:
 *   { "error": { "code", "message", "details" } }
 *
 * - AppError / HttpException carrying our `{code,message,details}` payload pass through.
 * - Any other thrown error becomes a safe 500 `internal` (no stack leaked to clients).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  /**
   * Where a server-side failure is reported. The reporter is a no-op unless
   * `SENTRY_DSN` is set; it is a parameter so the filter can be tested without
   * one.
   */
  constructor(private readonly report: ExceptionReporter = reportException) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // A 5xx raised on purpose is still the server failing, except from the
      // readiness probes, whose 503 is the answer they exist to give and which
      // the uptime monitor alerts on by itself.
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
              // Tell a throttled caller what happened and what to do, rather
              // than the raw `ThrottlerException: Too Many Requests` text.
              message:
                status === HttpStatus.TOO_MANY_REQUESTS
                  ? 'Too many requests. Wait a moment and try again.'
                  : exception.message,
              details: {},
            };
      res.status(status).json({ error });
      return;
    }

    // A malformed identifier is the caller's mistake, not ours.
    //
    // Every primary key here is a `uuid` column, and Postgres aborts a statement
    // that compares a non-UUID against one with `22P02 invalid_text_representation`.
    // It is caught HERE rather than with a `ParseUUIDPipe` on each route, because
    // several ids are legitimately not UUIDs: `/custody/items/:itemId/relocate`
    // takes the barcode printed on the item, and the bin routes take a shelf
    // serial, so a blanket UUID pipe would break scanning.
    //
    // This also turns a 22P02 caused by our own code into a 400; the log line
    // below still records every one of them.
    if (isInvalidTextRepresentation(exception)) {
      this.logger.warn(`Malformed identifier rejected: ${describe(exception)}`);
      res.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'That identifier is not in a valid format.',
          details: {},
        },
      });
      return;
    }

    // Body-parser and other connect-style middleware throw plain errors carrying
    // their own HTTP status rather than a Nest HttpException (for example
    // `PayloadTooLargeError`, 413). Answer with that status, not a 500.
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

    // Unknown/unexpected error: log server-side, report it, return an opaque 500.
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    this.report(exception, describeRequest(requestOf(host)));
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

/**
 * Postgres `22P02 invalid_text_representation` — the class of error raised when
 * a value cannot be parsed as the column's type. For this schema that is almost
 * always a non-UUID compared against a uuid primary key.
 */
const PG_INVALID_TEXT_REPRESENTATION = '22P02';

function isInvalidTextRepresentation(exception: unknown): boolean {
  return pgErrorCode(exception) === PG_INVALID_TEXT_REPRESENTATION;
}

/** The HTTP status a connect-style middleware error carries, if it carries one. */
function statusOf(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const e = exception as { status?: unknown; statusCode?: unknown };
  const raw = typeof e.status === 'number' ? e.status : e.statusCode;
  return typeof raw === 'number' ? raw : null;
}

/** A one-line description for the log — never sent to the client. */
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

/**
 * What a report says about the request. Everything is passed — headers and body
 * included, because a body is often the whole explanation — and the error
 * reporter's scrubber removes cookies, credential headers and the bodies of the
 * credential routes before anything leaves the process.
 */
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
