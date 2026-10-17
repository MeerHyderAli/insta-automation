import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import type { LoggerLike } from '../lib/logger.js';

interface BodyParserError extends Error {
  status?: number;
  type?: string;
}

export function errorHandler(logger: LoggerLike) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) return;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong.';
    let details: unknown;

    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.expose ? error.message : 'Something went wrong.';
      details = error.details;
    } else if (error instanceof Error) {
      const parserError = error as BodyParserError;
      if (parserError.type === 'entity.parse.failed') {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'Request body must be valid JSON.';
      } else if (parserError.type === 'entity.too.large') {
        status = 413;
        code = 'VALIDATION_ERROR';
        message = 'Request body is too large.';
      }
    }

    if (status >= 500) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error('Unknown error'),
          requestId: req.requestId,
          method: req.method,
          path: req.path,
        },
        'Unhandled request error',
      );
    }

    res.status(status).json({
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      requestId: req.requestId,
    });
  };
}
