import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from './error-codes';

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

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const error =
        typeof body === 'object' && body !== null && 'code' in body
          ? body
          : {
              code: this.mapStatus(status),
              // A throttled caller was being handed the raw
              // `ThrottlerException: Too Many Requests` under an `internal`
              // code, which reads as a server fault and tells a client nothing
              // about what to do. Say what happened and what to do about it.
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
    // Every primary key here is a `uuid` column, and Postgres does not merely
    // fail to match a non-UUID against one — it aborts the statement with
    // `22P02 invalid_text_representation`. That error reached this filter as an
    // unknown exception, so `GET /vault/items/not-a-uuid` answered 500. Every
    // route taking an id from the URL had the same hole: a typo, a stale
    // bookmark or a crawler produced an unhandled server error and an alert.
    //
    // It is caught HERE rather than by putting a `ParseUUIDPipe` on each route,
    // and that is deliberate. Several of these ids are legitimately not UUIDs —
    // `/custody/items/:itemId/relocate` takes the barcode printed on the item,
    // and the bin routes take a shelf serial — so a blanket UUID pipe would
    // break scanning, which is the one thing the warehouse console is driven by.
    //
    // The trade-off is worth stating: this also converts a 22P02 caused by OUR
    // OWN code passing a bad value into a 400, where it would previously have
    // been a loud 500. The log line below still records every one of them, so
    // the evidence survives; what changes is that a caller's typo stops paging
    // anybody.
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
    // their own HTTP status rather than a Nest HttpException. The one that
    // actually fires is `PayloadTooLargeError` — a 200 KB request body answered
    // 500 instead of 413, which tells a client nothing about what to do next.
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

    // Unknown/unexpected error: log server-side, return an opaque 500.
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
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
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    (exception as { code?: unknown }).code === PG_INVALID_TEXT_REPRESENTATION
  );
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
