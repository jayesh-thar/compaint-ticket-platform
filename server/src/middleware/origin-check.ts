import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../shared/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const originCheck = (req: Request, _res: Response, next: NextFunction): void => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const originHeader = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : undefined);

  // If Origin or Referer is supplied, it MUST match APP_ORIGIN
  if (originHeader) {
    if (originHeader !== env.APP_ORIGIN) {
      throw new AppError(403, 'FORBIDDEN', 'Cross-origin request rejected.');
    }
    return next();
  }

  // In production, browsers always send Origin on POST/PUT/DELETE.
  // In development/test mode, allow API clients (cURL, Supertest) if origin header is omitted.
  if (env.NODE_ENV === 'production') {
    throw new AppError(403, 'FORBIDDEN', 'Origin header missing.');
  }

  next();
};
