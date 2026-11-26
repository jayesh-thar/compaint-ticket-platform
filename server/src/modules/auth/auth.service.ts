import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { generateToken, hashToken, hashPassword, verifyPassword } from '../../shared/crypto.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendAccountExistsNoticeEmail } from '../../shared/email.js';
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schemas.js';

export const registerUser = async (input: RegisterInput) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    // Generic response: notify existing user without revealing account presence to caller
    await sendAccountExistsNoticeEmail(existingUser.email);
    return {
      message: 'If an account does not exist with that email, a verification link has been sent.',
    };
  }

  const passwordHash = await hashPassword(input.password);
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
      },
    });

    await tx.emailToken.create({
      data: {
        userId: user.id,
        type: 'VERIFY_EMAIL',
        tokenHash,
        expiresAt,
      },
    });
  });

  await sendVerificationEmail(input.email, rawToken);

  return {
    message: 'If an account does not exist with that email, a verification link has been sent.',
  };
};

export const verifyUserEmail = async (input: VerifyEmailInput) => {
  const tokenHash = hashToken(input.token);

  const tokenRecord = await prisma.emailToken.findFirst({
    where: {
      type: 'VERIFY_EMAIL',
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!tokenRecord) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Verification link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.emailToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);

  return { message: 'Email successfully verified.' };
};

export const resendVerificationEmail = async (email?: string, currentUserId?: string) => {
  let targetUser = null;

  if (email) {
    targetUser = await prisma.user.findUnique({ where: { email } });
  } else if (currentUserId) {
    targetUser = await prisma.user.findUnique({ where: { id: currentUserId } });
  }

  if (!targetUser || targetUser.emailVerifiedAt) {
    return {
      message: 'If an unverified account exists, a new verification link has been sent.',
    };
  }

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    // Expire/mark used any existing unused verify tokens for this user
    prisma.emailToken.updateMany({
      where: {
        userId: targetUser.id,
        type: 'VERIFY_EMAIL',
        usedAt: null,
      },
      data: { usedAt: new Date() },
    }),
    prisma.emailToken.create({
      data: {
        userId: targetUser.id,
        type: 'VERIFY_EMAIL',
        tokenHash,
        expiresAt,
      },
    }),
  ]);

  await sendVerificationEmail(targetUser.email, rawToken);

  return {
    message: 'If an unverified account exists, a new verification link has been sent.',
  };
};

export const loginUser = async (input: LoginInput, userAgent?: string) => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password.');
  }

  const sid = generateToken();
  const tokenHash = hashToken(sid);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent,
    },
  });

  return {
    sid,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: !!user.emailVerifiedAt,
    },
  };
};

export const logoutUser = async (sid?: string) => {
  if (sid) {
    const tokenHash = hashToken(sid);
    await prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return { message: 'Logged out successfully.' };
};

export const requestPasswordReset = async (input: ForgotPasswordInput) => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (user) {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.$transaction([
      prisma.emailToken.updateMany({
        where: {
          userId: user.id,
          type: 'RESET_PASSWORD',
          usedAt: null,
        },
        data: { usedAt: new Date() },
      }),
      prisma.emailToken.create({
        data: {
          userId: user.id,
          type: 'RESET_PASSWORD',
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    await sendPasswordResetEmail(user.email, rawToken);
  }

  return {
    message: 'If an account exists with that email, a password reset link has been sent.',
  };
};

export const resetUserPassword = async (input: ResetPasswordInput) => {
  const tokenHash = hashToken(input.token);

  const tokenRecord = await prisma.emailToken.findFirst({
    where: {
      type: 'RESET_PASSWORD',
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!tokenRecord) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash },
    }),
    prisma.emailToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    }),
    // Revoke all active sessions on password reset
    prisma.session.updateMany({
      where: { userId: tokenRecord.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: 'Password has been reset successfully. Please log in with your new password.' };
};
