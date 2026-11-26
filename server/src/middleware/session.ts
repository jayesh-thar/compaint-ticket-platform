import type { Request, Response, NextFunction } from 'express';
import type { User, Session } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { hashToken } from '../shared/crypto.js';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export const sessionMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const sid = req.cookies?.sid;

  if (!sid || typeof sid !== 'string') {
    return next();
  }

  try {
    const tokenHash = hashToken(sid);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      // Clear invalid or expired cookie
      res.clearCookie('sid', { path: '/' });
      return next();
    }

    req.user = session.user;
    req.session = session;

    // Sliding expiration: update at most once an hour
    const oneHourMs = 60 * 60 * 1000;
    const now = new Date();
    if (now.getTime() - session.lastUsedAt.getTime() > oneHourMs) {
      const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await prisma.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: now,
          expiresAt: newExpiresAt,
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};
