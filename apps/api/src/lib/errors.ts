import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
  static badRequest(message: string, fields?: Record<string, string>) {
    return new ApiError(400, 'bad_request', message, fields);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'Not allowed') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message: string) {
    return new ApiError(409, 'conflict', message);
  }
  static unprocessable(message: string, fields?: Record<string, string>) {
    return new ApiError(422, 'unprocessable', message, fields);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'rate_limited', message);
  }
}

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
  return fields;
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({ error: { code: 'validation', message: 'Invalid input', fields: zodFields(err) } });
    return;
  }
  logger.error({ err, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}

/** Express 5 propagates async rejections, but keep a wrapper for explicitness in route tables. */
export const asyncRoute =
  <T extends Request>(fn: (req: T, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as T, res).catch(next);
