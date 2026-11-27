import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle } from '../../shared/params.js';
import { subscribe } from '../../shared/events.js';
import { getDashboard, getGraph } from './dashboard.service.js';

// Mounted at /api/v1/orgs/:slug/dashboard
export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.use(requireAuth, requireOrgMember);
dashboardRouter.get(
  '/',
  handle(200, (req) => getDashboard(req.actor!))
);

// Mounted at /api/v1/orgs/:slug/graph
export const graphRouter = Router({ mergeParams: true });
graphRouter.use(requireAuth, requireOrgMember);
graphRouter.get(
  '/',
  handle(200, (req) => getGraph(req.actor!))
);

/**
 * Mounted at /api/v1/orgs/:slug/events - Server-Sent Events (D-27).
 * Only members of the organization can listen; events say WHAT changed
 * ("tickets" / "structure"), never content, so each page refetches through
 * the normal, permission-checked endpoints.
 */
export const eventsRouter = Router({ mergeParams: true });
eventsRouter.use(requireAuth, requireOrgMember);
eventsRouter.get('/', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const unsubscribe = subscribe(req.org!.id, (e) => {
    res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
  });
  // Comment lines keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
