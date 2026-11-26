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
import { orgsRouter, meRouter } from './modules/orgs/orgs.router.js';
import { membersRouter } from './modules/members/members.router.js';
import { orgInvitationsRouter, invitationsAcceptRouter } from './modules/invitations/invitations.router.js';
import { teamsRouter } from './modules/teams/teams.router.js';
import { categoriesRouter } from './modules/categories/categories.router.js';
import { ticketsRouter } from './modules/tickets/tickets.router.js';
import { commentsRouter } from './modules/comments/comments.router.js';
import { publicPortalRouter, portalRouter } from './modules/portal/portal.router.js';
import { requesterRouter } from './modules/requester/requester.router.js';
import { dashboardRouter } from './modules/dashboard/dashboard.router.js';
import { serveClient, defaultClientDist } from './shared/serve-client.js';

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

  // API v1 routes. Everything lives under /api/v1 so it can never collide
  // with SPA routes (e.g. /orgs/new, /invite) when Express serves the client build.
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/me/tickets', requesterRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/public/portals', publicPortalRouter);
  app.use('/api/v1/portals', portalRouter);
  app.use('/api/v1/orgs/:slug/members', membersRouter);
  app.use('/api/v1/orgs/:slug/invitations', orgInvitationsRouter);
  app.use('/api/v1/orgs/:slug/teams', teamsRouter);
  app.use('/api/v1/orgs/:slug/categories', categoriesRouter);
  app.use('/api/v1/orgs/:slug/tickets/:number/comments', commentsRouter);
  app.use('/api/v1/orgs/:slug/tickets', ticketsRouter);
  app.use('/api/v1/orgs/:slug/dashboard', dashboardRouter);
  app.use('/api/v1/orgs', orgsRouter);
  app.use('/api/v1/invitations', invitationsAcceptRouter);

  // Production: the same server also serves the React build (one origin).
  if (env.NODE_ENV === 'production') serveClient(app, defaultClientDist());

  // 404 & Central Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
