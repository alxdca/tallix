import type { NextFunction, Request, Response } from 'express';
import logger from '../logger.js';

export type ErrorParams = Record<string, string | number | boolean | null | string[] | number[]>;

export interface AppErrorOptions {
  code?: string;
  params?: ErrorParams;
  isOperational?: boolean;
}

function buildErrorCode(message: string): string {
  const normalized = message
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'ERROR';
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly params?: ErrorParams;
  public readonly isOperational: boolean;

  constructor(statusCode: number, message: string, options: AppErrorOptions | boolean = {}) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);

    const resolvedOptions = typeof options === 'boolean' ? { isOperational: options } : options;

    this.statusCode = statusCode;
    this.code = resolvedOptions.code || buildErrorCode(message);
    this.params = resolvedOptions.params;
    this.isOperational = resolvedOptions.isOperational ?? true;
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn(
      {
        statusCode: err.statusCode,
        code: err.code,
        params: err.params,
        message: err.message,
        path: req.path,
        method: req.method,
      },
      'Operational error'
    );

    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      params: err.params,
    });
  }

  // Unexpected errors - log only metadata, not full body (may contain sensitive financial data)
  const safeMetadata: Record<string, unknown> = {
    err,
    path: req.path,
    method: req.method,
    contentType: req.headers['content-type'],
    bodyKeys: req.body ? Object.keys(req.body) : [],
  };

  // Only log full body in development with explicit flag
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_LOG_BODY === 'true') {
    safeMetadata.body = req.body;
  }

  logger.error(safeMetadata, 'Unexpected error');

  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
  });
}

export function notFoundHandler(req: Request, res: Response) {
  logger.warn({ path: req.path, method: req.method }, 'Route not found');
  res.status(404).json({
    error: 'Not found',
    code: 'ROUTE_NOT_FOUND',
  });
}
