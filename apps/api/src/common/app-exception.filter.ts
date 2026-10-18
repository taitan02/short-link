import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

interface ExposedHttpError {
  status: number;
  message: string;
  expose: true;
}

// Express middleware (body-parser) throws http-errors objects. Nest would treat those as
// unknown and log a stack trace at ERROR level for every oversized or malformed body a client
// sends. Errors flagged `expose` are client errors whose message is safe to return.
function isExposedHttpError(error: unknown): error is ExposedHttpError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'expose' in error &&
    error.expose === true &&
    'status' in error &&
    typeof error.status === 'number' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

// Everything else keeps Nest's behaviour: HttpExceptions pass through as-is, unknown errors are
// logged with their stack and answered with a generic 500 that leaks no internals.
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (isExposedHttpError(exception)) {
      super.catch(new HttpException(exception.message, exception.status), host);
      return;
    }
    super.catch(exception, host);
  }
}
