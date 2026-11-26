import { Router } from 'express';
import * as authController from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  forgotEmailLimiter,
  forgotIpLimiter,
  loginFailureLimiter,
  loginLimiter,
  registerLimiter,
  resendLimiter,
} from '../../middleware/rate-limiter.js';

export const authRouter = Router();

// Public auth endpoints (rate limited where appropriate)
authRouter.post('/register', registerLimiter, authController.register);
authRouter.post('/verify-email', authController.verifyEmail);
authRouter.post('/resend-verification', resendLimiter, authController.resendVerification);
authRouter.post('/login', loginLimiter, loginFailureLimiter, authController.login);
authRouter.post('/logout', authController.logout);
authRouter.post('/forgot-password', forgotIpLimiter, forgotEmailLimiter, authController.forgotPassword);
authRouter.post('/reset-password', authController.resetPassword);

// Authenticated session check
authRouter.get('/me', requireAuth, authController.getMe);
