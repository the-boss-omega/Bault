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
          : { code: this.mapStatus(status), message: exception.message, details: {} };
      res.status(status).json({ error });
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
    return ErrorCode.INTERNAL;
  }
}
