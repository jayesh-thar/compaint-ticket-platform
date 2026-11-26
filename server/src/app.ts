import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { httpLogger } from './config/logger.js';
import { notFoundHandler } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.router.js';

export const createApp = () => {
  const app = express();

  // Trust proxy if configured
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  // Security headers & body limit (100 kB)
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  // Logging
  app.use(httpLogger);

  // API v1 routes
  app.use('/api/v1/health', healthRouter);
  app.use('/health', healthRouter); // alias

  // 404 & Central Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
