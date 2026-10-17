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

    // A provider's error carries the PROVIDER's HTTP status, which describes
    // Bault's call to it, not the customer's call to Bault: answered as it
    // stands, EasyPost refusing Bault's API key reached the SPA as a 401 and
    // read as a signed-out session, and a refused address as "Bad request.".
    // So it is answered in Bault's terms, and the original goes to the log.
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
    // A failed query is logged and reported without the values it was run with.
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

/**
 * Postgres `22P02 invalid_text_representation` — the class of error raised when
 * a value cannot be parsed as the column's type. For this schema that is almost
 * always a non-UUID compared against a uuid primary key.
 */
const PG_INVALID_TEXT_REPRESENTATION = '22P02';

function isInvalidTextRepresentation(exception: unknown): boolean {
  return pgErrorCode(exception) === PG_INVALID_TEXT_REPRESENTATION;
}

/**
 * A provider adapter's HTTP error, and whether it is the customer's to fix.
 *
 * Only a carrier's 400 or 422 is: it is the answer to what the customer
 * entered (an address, a parcel). Every other status (a refused key, a
 * forbidden account, a missing provider object, a throttle, an outage) is the
 * provider or Bault's arrangement with it failing. Matched by name as well, as
 * `LabelNotPurchasedError.is` does, in case two copies of the adapters package
 * are loaded.
 */
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

/**
 * A failed query, in a form that may leave the process.
 *
 * drizzle-orm 0.45 wraps every failed query in a `DrizzleQueryError` whose
 * message is the SQL followed by its PARAMETERS, and the parameters are
 * whatever the query was about: an email, a name, an address, a token hash.
 * Logged or reported as it stands, that is personal data in the log and in a
 * third party's error tracker. This keeps what diagnoses the failure: the
 * SQLSTATE, the constraint, table and column the database names, and the SQL
 * text, which carries placeholders rather than values (a quoted literal in it
 * is blanked too), on an error of its own with the original stack frames. The
 * pg error is not kept as its cause, because its own message can quote the
 * value (`invalid input syntax for type uuid: "…"`).
 *
 * Anything else is returned as it is. Recognised by shape rather than by
 * class: the error's name is a plain `Error`, and the test suites load drizzle
 * from more than one copy.
 */
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

/** The pg error behind a failed query: what it names, never what it quotes. */
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
