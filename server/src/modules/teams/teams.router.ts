import { Router } from 'express';
import * as teamsController from './teams.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';

// Mounted at /api/v1/orgs/:slug/teams
export const teamsRouter = Router({ mergeParams: true });
teamsRouter.use(requireAuth, requireOrgMember);

// Any member can read teams (ticket forms need them); only Admins change them.
teamsRouter.get('/', teamsController.list);
teamsRouter.post('/', requireAdmin, teamsController.create);
teamsRouter.patch('/:id', requireAdmin, teamsController.update);
teamsRouter.put('/:id/members/:membershipId', requireAdmin, teamsController.putMember);
teamsRouter.delete('/:id/members/:membershipId', requireAdmin, teamsController.deleteMember);
