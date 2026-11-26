import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const rateLimitHandler = (req: any, res: any) => {
  const requestId = req.id || req.headers['x-request-id'] || 'unknown';
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      requestId,
    },
  });
};

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 1000 : 20, // generous in tests, strict in prod
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
