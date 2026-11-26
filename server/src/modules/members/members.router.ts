import { Router } from 'express';
import * as membersController from './members.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';

// Mounted at /api/v1/orgs/:slug/members
export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth, requireOrgMember);

// Any active member can see who is in the organization (needed for assignment later).
membersRouter.get('/', membersController.getMembers);
// Only Admins change roles or remove people.
membersRouter.patch('/:membershipId', requireAdmin, membersController.updateRole);
membersRouter.delete('/:membershipId', requireAdmin, membersController.deleteMember);
