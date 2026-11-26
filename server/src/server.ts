import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  if (env.JOBS_ENABLED) startJobs();
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
