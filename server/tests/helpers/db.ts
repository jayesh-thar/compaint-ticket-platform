import { prisma } from '../../src/config/prisma.js';

export const cleanDatabase = async () => {
  // Truncate tables in reverse dependency order
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "email_tokens", "sessions", "users" CASCADE;`
  );
};
