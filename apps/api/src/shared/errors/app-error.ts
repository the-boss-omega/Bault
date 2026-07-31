import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Domain error (T013). Carries a stable machine `code` plus HTTP status and
 * optional details. Thrown by services; rendered into the uniform problem body
 * by AllExceptionsFilter. Factory helpers keep call sites terse and consistent.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }

  static validation(message: string, details: Record<string, unknown> = {}): AppError {
    return new AppError(ErrorCode.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'Not permitted'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static accountSuspended(): AppError {
    return new AppError(
      ErrorCode.ACCOUNT_SUSPENDED,
      'This account is suspended or closed.',
      HttpStatus.FORBIDDEN,
    );
  }
  static tokenExpired(message = 'Token is expired or already used'): AppError {
    return new AppError(ErrorCode.TOKEN_EXPIRED, message, HttpStatus.GONE);
  }
  static conflict(code: ErrorCode, message: string, details: Record<string, unknown> = {}): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
  static notFound(message = 'Not found'): AppError {
    return new AppError(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }
}
