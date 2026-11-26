import { Router } from 'express';
import * as invitationsController from './invitations.controller.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';
import { invitationLimiter } from '../../middleware/rate-limiter.js';

// Workspace-scoped: mounted at /api/v1/orgs/:slug/invitations (Admin only)
export const orgInvitationsRouter = Router({ mergeParams: true });
orgInvitationsRouter.use(requireAuth, requireOrgMember, requireAdmin);
orgInvitationsRouter.get('/', invitationsController.list);
orgInvitationsRouter.post('/', invitationLimiter, invitationsController.create);
orgInvitationsRouter.post('/:id/resend', invitationLimiter, invitationsController.resend);
orgInvitationsRouter.delete('/:id', invitationsController.revoke);

// Global: mounted at /api/v1/invitations  ->  POST /api/v1/invitations/accept
export const invitationsAcceptRouter = Router();
invitationsAcceptRouter.post('/accept', requireAuth, requireVerified, invitationsController.accept);
