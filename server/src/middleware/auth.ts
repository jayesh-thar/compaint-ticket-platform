import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  next();
};

export const requireVerified = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  if (!req.user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address to continue.');
  }

  next();
};
