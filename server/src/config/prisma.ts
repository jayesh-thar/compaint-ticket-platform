import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Tests trigger expected errors (duplicate keys etc.); keep their output clean.
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : env.NODE_ENV === 'test' ? [] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export const disconnectPrisma = async () => {
  try {
    await prisma.$disconnect();
    logger.info('Prisma disconnected successfully.');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Prisma');
  }
};
