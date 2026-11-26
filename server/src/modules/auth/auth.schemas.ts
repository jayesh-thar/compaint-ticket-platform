import { z } from 'zod';
import { normalizeEmail } from '../../shared/crypto.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name cannot exceed 100 characters'),
  email: z.string().trim().email('Invalid email address').transform(normalizeEmail),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password cannot exceed 128 characters'),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').transform(normalizeEmail),
  password: z.string().min(1, 'Password is required'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email('Invalid email address').transform(normalizeEmail).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address').transform(normalizeEmail),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128, 'Password cannot exceed 128 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
