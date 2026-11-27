import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';
import { handle, parseIdParam, wantsArchived } from '../../shared/params.js';
import * as teams from './teams.service.js';

// Mounted at /api/v1/orgs/:slug/teams
export const teamsRouter = Router({ mergeParams: true });
teamsRouter.use(requireAuth, requireOrgMember);

teamsRouter.get(
  '/',
  handle(200, (req) => teams.listTeams(req.org!.id, wantsArchived(req.query)))
);
teamsRouter.post(
  '/',
  requireAdmin,
  handle(201, (req) => teams.createTeam(req.org!.id, teams.createTeamSchema.parse(req.body)))
);
teamsRouter.get(
  '/:teamId',
  handle(200, (req) => teams.getTeam(req.actor!, parseIdParam(req.params.teamId, 'Team')))
);
teamsRouter.patch(
  '/:teamId',
  requireAdmin,
  handle(200, (req) =>
    teams.updateTeam(req.org!.id, parseIdParam(req.params.teamId, 'Team'), teams.updateTeamSchema.parse(req.body))
  )
);
teamsRouter.put(
  '/:teamId/members/:membershipId',
  handle(200, (req) =>
    teams.setTeamMember(
      req.actor!,
      parseIdParam(req.params.teamId, 'Team'),
      parseIdParam(req.params.membershipId, 'Member'),
      teams.setMemberSchema.parse(req.body ?? {})
    )
  )
);
teamsRouter.delete(
  '/:teamId/members/:membershipId',
  handle(200, (req) =>
    teams.removeTeamMember(
      req.actor!,
      parseIdParam(req.params.teamId, 'Team'),
      parseIdParam(req.params.membershipId, 'Member')
    )
  )
);
