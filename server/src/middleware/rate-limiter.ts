import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { normalizeEmail } from '../shared/crypto.js';

/**
 * Rate limits from architecture section 10 (in-memory store: fine for one
 * server instance). The client IP is only correct when TRUST_PROXY matches the
 * number of proxies in front of the server (Render: 1).
 */

const rateLimitHandler = (req: Request, res: Response) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      requestId: (req.id as string) || 'unknown',
    },
  });
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const limiter = (windowMs: number, limit: number, key: Options['keyGenerator'], extra: Partial<Options> = {}) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: key,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    ...extra,
  });

/** IPv6-safe IP key (a whole /56 block counts as one client). */
const ip = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');
const bodyEmail = (req: Request) =>
  typeof req.body?.email === 'string' ? normalizeEmail(req.body.email).slice(0, 254) : 'no-email';

// Login: 10 / 15 min per IP, and 5 FAILED attempts / 15 min per IP + email.
export const loginLimiter = limiter(15 * MIN, 10, (req) => `login:${ip(req)}`);
export const loginFailureLimiter = limiter(15 * MIN, 5, (req) => `login-fail:${ip(req)}:${bodyEmail(req)}`, {
  skipSuccessfulRequests: true, // only wrong passwords count
});

// Register: 10 / hour per IP.
export const registerLimiter = limiter(HOUR, 10, (req) => `register:${ip(req)}`);

// Resend verification: 3 / hour per account (logged-in user, else the email asked for).
export const resendLimiter = limiter(HOUR, 3, (req) => `resend:${req.user?.id ?? bodyEmail(req)}`);

// Forgot password: 5 / hour per IP, and 3 / hour per email.
export const forgotIpLimiter = limiter(HOUR, 5, (req) => `forgot:${ip(req)}`);
export const forgotEmailLimiter = limiter(HOUR, 3, (req) => `forgot-email:${bodyEmail(req)}`);

// Invitation create/resend: 30 / day per organization. Runs after requireOrgMember
// (key = org id), so one busy organization cannot use up another one's allowance.
export const invitationLimiter = limiter(24 * HOUR, 30, (req) => `invite:${req.org?.id ?? 'unknown'}`);

// Portal complaint submit: 10 / hour per user. Runs after requireVerified (key = user id).
export const complaintLimiter = limiter(HOUR, 10, (req) => `complaint:${req.user?.id ?? 'unknown'}`);
