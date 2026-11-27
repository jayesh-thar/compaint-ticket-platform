import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma, prisma } from './config/prisma.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

// Log anything that escapes a handler instead of crashing silently.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, shutting down');
  process.exit(1);
});

// Make sure PostgreSQL answers before taking requests (retries for a slow DB start).
const waitForDatabase = async (attempts = 5, delayMs = 2000) => {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database connected');
      return;
    } catch (err) {
      logger.warn({ attempt: i, of: attempts }, 'Database not reachable yet');
      if (i === attempts) {
        logger.fatal({ err }, 'Could not connect to PostgreSQL. Is it running? Check DATABASE_URL.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

await waitForDatabase();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  if (env.JOBS_ENABLED) startJobs();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(`Port ${env.PORT} is already in use. Stop the other server (or change PORT in .env).`);
  } else {
    logger.fatal({ err }, 'HTTP server error');
  }
  process.exit(1);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  // 1. stop accepting requests, 2. stop jobs, 3. close the database connection.
  server.close(async () => {
    logger.info('HTTP server closed.');
    await stopJobs();
    await disconnectPrisma();
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
