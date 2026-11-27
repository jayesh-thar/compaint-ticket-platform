import { Router } from 'express';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { invitationLimiter } from '../../middleware/rate-limiter.js';
import { handle, parseIdParam } from '../../shared/params.js';
import * as invitations from './invitations.service.js';

// Mounted at /api/v1/orgs/:slug/invitations (Admin: all; Team Leader: own team - checked in the service)
export const orgInvitationsRouter = Router({ mergeParams: true });
orgInvitationsRouter.use(requireAuth, requireOrgMember);
orgInvitationsRouter.get(
  '/',
  handle(200, (req) => invitations.listInvitations(req.actor!))
);
orgInvitationsRouter.post(
  '/',
  invitationLimiter,
  handle(201, (req) =>
    invitations.createInvitation(req.actor!, req.org!, invitations.createInvitationSchema.parse(req.body))
  )
);
orgInvitationsRouter.post(
  '/:id/resend',
  invitationLimiter,
  handle(200, (req) => invitations.resendInvitation(req.actor!, req.org!, parseIdParam(req.params.id, 'Invitation')))
);
orgInvitationsRouter.delete(
  '/:id',
  handle(200, (req) => invitations.revokeInvitation(req.actor!, parseIdParam(req.params.id, 'Invitation')))
);

// Global: mounted at /api/v1/invitations  ->  POST /api/v1/invitations/accept
export const invitationsAcceptRouter = Router();
invitationsAcceptRouter.post(
  '/accept',
  requireAuth,
  requireVerified,
  handle(200, (req) => invitations.acceptInvitation(req.user!, invitations.acceptInvitationSchema.parse(req.body)))
);
