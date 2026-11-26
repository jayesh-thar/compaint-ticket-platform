import crypto from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';

interface CreateUserOverrides {
  email?: string;
  name?: string;
  passwordHash?: string;
  emailVerifiedAt?: Date | null;
}

export const createUser = async (overrides: CreateUserOverrides = {}) => {
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user_${randomSuffix}@example.com`,
      name: overrides.name ?? `Test User ${randomSuffix}`,
      passwordHash: overrides.passwordHash ?? 'hashed_test_password',
      emailVerifiedAt: overrides.emailVerifiedAt ?? new Date(),
    },
  });
};
