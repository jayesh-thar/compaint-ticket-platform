import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import * as authService from './auth.service.js';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

const COOKIE_NAME = 'sid';

const setSessionCookie = (res: Response, sid: string) => {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const clearSessionCookie = (res: Response) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  });
};

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = registerSchema.parse(req.body);
    const result = await authService.registerUser(input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyUserEmail(input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = resendVerificationSchema.parse(req.body);
    const result = await authService.resendVerificationEmail(input.email, req.user?.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = loginSchema.parse(req.body);
    const userAgent = req.headers['user-agent'];
    const { sid, user } = await authService.loginUser(input, userAgent);

    setSessionCookie(res, sid);

    res.status(200).json({
      user,
      message: 'Logged in successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sid = req.cookies?.sid;
    await authService.logoutUser(sid);
    clearSessionCookie(res);
    res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
};

export const getMe = (req: Request, res: Response): void => {
  const user = req.user!;
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: authService.isEmailVerified(user.emailVerifiedAt),
      createdAt: user.createdAt,
    },
  });
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const result = await authService.resetUserPassword(input);
    clearSessionCookie(res);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
