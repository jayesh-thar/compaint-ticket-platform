import { Router } from 'express';
import * as portalService from './portal.service.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { complaintLimiter } from '../../middleware/rate-limiter.js';
import { handle } from '../../shared/params.js';

// Mounted at /api/v1/public/portals  (no login)
export const publicPortalRouter = Router();
publicPortalRouter.get(
  '/:slug',
  handle(200, (req) => portalService.getPortal(String(req.params.slug)))
);

// Mounted at /api/v1/portals  (login + verified email; rate limited per user)
export const portalRouter = Router();
portalRouter.post(
  '/:slug/complaints',
  requireAuth,
  requireVerified,
  complaintLimiter,
  handle(201, (req) =>
    portalService.submitComplaint(
      req.user!,
      String(req.params.slug),
      portalService.submitComplaintSchema.parse(req.body)
    )
  )
);
