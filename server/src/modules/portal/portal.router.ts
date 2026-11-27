import { Router } from 'express';
import { complaintLimiter, trackLimiter } from '../../middleware/rate-limiter.js';
import { handle } from '../../shared/params.js';
import * as portal from './portal.service.js';

// Mounted at /api/v1/public (no login: customers are guests, D-22)
export const publicRouter = Router();

publicRouter.get(
  '/portals/:slug',
  handle(200, (req) => portal.getPublicPortal(String(req.params.slug)))
);
publicRouter.post(
  '/portals/:slug/complaints',
  complaintLimiter,
  handle(201, (req) => portal.submitComplaint(String(req.params.slug), portal.complaintSchema.parse(req.body)))
);
// POST so the token never appears in a URL or access log.
publicRouter.post(
  '/track',
  trackLimiter,
  handle(200, (req) => portal.trackComplaint(portal.trackSchema.parse(req.body).token))
);
