import * as teamsService from './teams.service.js';
import { createTeamSchema, updateTeamSchema, setTeamMemberSchema } from './teams.schemas.js';
import { handle, parseIdParam, wantsArchived } from '../../shared/params.js';

export const list = handle(200, (req) => teamsService.listTeams(req.org!.id, wantsArchived(req.query)));

export const create = handle(201, (req) => teamsService.createTeam(req.org!.id, createTeamSchema.parse(req.body)));

export const update = handle(200, (req) =>
  teamsService.updateTeam(req.org!.id, parseIdParam(req.params.id, 'Team'), updateTeamSchema.parse(req.body))
);

export const putMember = handle(200, (req) =>
  teamsService.setTeamMember(
    req.org!.id,
    parseIdParam(req.params.id, 'Team'),
    parseIdParam(req.params.membershipId, 'Member'),
    setTeamMemberSchema.parse(req.body ?? {})
  )
);

export const deleteMember = handle(200, (req) =>
  teamsService.deleteTeamMember(
    req.org!.id,
    parseIdParam(req.params.id, 'Team'),
    parseIdParam(req.params.membershipId, 'Member')
  )
);
