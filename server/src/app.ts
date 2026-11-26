import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { httpLogger } from './config/logger.js';
import { originCheck } from './middleware/origin-check.js';
import { sessionMiddleware } from './middleware/session.js';
import { notFoundHandler } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.router.js';
import { authRouter } from './modules/auth/auth.router.js';

export const createApp = () => {
  const app = express();

  // Trust proxy if configured
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  // Security headers & body limit (100 kB)
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Logging
  app.use(httpLogger);

  // CSRF Origin verification for mutating requests
  app.use(originCheck);

  // Session hydration
  app.use(sessionMiddleware);

  // API v1 routes
  app.use('/api/v1/health', healthRouter);
  app.use('/health', healthRouter); // alias
  app.use('/api/v1/auth', authRouter);
  app.use('/auth', authRouter); // alias

  // 404 & Central Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
