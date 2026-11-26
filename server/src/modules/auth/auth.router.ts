import { Router } from 'express';
import * as authController from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rate-limiter.js';

export const authRouter = Router();

// Public auth endpoints (rate limited where appropriate)
authRouter.post('/register', authRateLimiter, authController.register);
authRouter.post('/verify-email', authController.verifyEmail);
authRouter.post('/resend-verification', authRateLimiter, authController.resendVerification);
authRouter.post('/login', authRateLimiter, authController.login);
authRouter.post('/logout', authController.logout);
authRouter.post('/forgot-password', authRateLimiter, authController.forgotPassword);
authRouter.post('/reset-password', authController.resetPassword);

// Authenticated session check
authRouter.get('/me', requireAuth, authController.getMe);
