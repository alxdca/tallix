import type { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    logger.warn({ 
      statusCode: err.statusCode, 
      message: err.message,
      path: req.path,
      method: req.method 
    }, 'Operational error');
    
    return res.status(err.statusCode).json({ error: err.message });
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

  return res.status(500).json({ error: 'Internal server error' });
}

export function notFoundHandler(req: Request, res: Response) {
  logger.warn({ path: req.path, method: req.method }, 'Route not found');
  res.status(404).json({ error: 'Not found' });
}
