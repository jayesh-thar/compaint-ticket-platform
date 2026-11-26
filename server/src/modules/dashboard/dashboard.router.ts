import { Router } from 'express';
import { getDashboard } from './dashboard.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle } from '../../shared/params.js';

// Mounted at /api/v1/orgs/:slug/dashboard. Scoped by the visibility rule (every role).
export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.get(
  '/',
  requireAuth,
  requireOrgMember,
  handle(200, (req) => getDashboard(req.actor!))
);
