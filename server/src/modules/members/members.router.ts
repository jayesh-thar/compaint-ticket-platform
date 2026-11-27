import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';
import { handle, parseIdParam } from '../../shared/params.js';
import * as members from './members.service.js';

// Mounted at /api/v1/orgs/:slug/members
export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth, requireOrgMember);

membersRouter.get(
  '/',
  handle(200, (req) => members.listMembers(req.actor!))
);
membersRouter.get(
  '/job-titles',
  handle(200, (req) => members.listJobTitles(req.org!.id))
);
membersRouter.patch(
  '/:membershipId',
  requireAdmin,
  handle(200, (req) =>
    members.updateMemberRole(
      req.org!.id,
      parseIdParam(req.params.membershipId, 'Member'),
      members.updateRoleSchema.parse(req.body)
    )
  )
);
membersRouter.patch(
  '/:membershipId/job-title',
  handle(200, (req) =>
    members.updateJobTitle(
      req.actor!,
      parseIdParam(req.params.membershipId, 'Member'),
      members.updateJobTitleSchema.parse(req.body)
    )
  )
);
membersRouter.delete(
  '/:membershipId',
  requireAdmin,
  handle(200, (req) => members.removeMember(req.actor!, parseIdParam(req.params.membershipId, 'Member')))
);
