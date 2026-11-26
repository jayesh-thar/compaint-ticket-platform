import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { toNameKey } from '../../shared/params.js';
import { removeFromTeam } from './teams.offboarding.js';
import { OPEN_WORKLOAD } from '../../shared/visibility.js';
import type { CreateTeamInput, UpdateTeamInput, SetTeamMemberInput } from './teams.schemas.js';

const teamInclude = {
  members: {
    include: { membership: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TeamInclude;

type TeamWithMembers = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

const toTeamDto = (team: TeamWithMembers, openTicketCount = 0) => ({
  id: team.id,
  name: team.name,
  description: team.description,
  archived: team.archivedAt !== null,
  archivedAt: team.archivedAt,
  createdAt: team.createdAt,
  openTicketCount,
  members: team.members.map((m) => ({
    membershipId: m.membershipId,
    name: m.membership.user.name,
    email: m.membership.user.email,
    role: m.membership.role,
    isLead: m.isLead,
  })),
});

const nameTaken = () =>
  new AppError(409, 'CONFLICT', 'A team with this name already exists.', {
    name: 'A team with this name already exists.',
  });

const notFound = () => new AppError(404, 'NOT_FOUND', 'Team not found.');

/** Always scoped by organizationId: another organization's team id is simply "not found". */
const findTeam = async (orgId: string, teamId: string) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId: orgId } });
  if (!team) throw notFound();
  return team;
};

/** Open workload per team, so Admins see what archiving would leave behind. */
const openCounts = async (orgId: string, teamIds: string[]) => {
  if (teamIds.length === 0) return new Map<string, number>();
  const rows = await prisma.ticket.groupBy({
    by: ['teamId'],
    where: { organizationId: orgId, teamId: { in: teamIds }, status: { in: OPEN_WORKLOAD } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.teamId as string, r._count._all]));
};

const loadTeamDto = async (orgId: string, teamId: string) => {
  const team = await prisma.team.findFirstOrThrow({
    where: { id: teamId, organizationId: orgId },
    include: teamInclude,
  });
  const counts = await openCounts(orgId, [team.id]);
  return toTeamDto(team, counts.get(team.id) ?? 0);
};

export const listTeams = async (orgId: string, includeArchived: boolean) => {
  const teams = await prisma.team.findMany({
    where: { organizationId: orgId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: teamInclude,
    orderBy: { name: 'asc' },
  });
  const counts = await openCounts(
    orgId,
    teams.map((t) => t.id)
  );
  return { teams: teams.map((t) => toTeamDto(t, counts.get(t.id) ?? 0)) };
};

export const createTeam = async (orgId: string, input: CreateTeamInput) => {
  try {
    const team = await prisma.team.create({
      data: {
        organizationId: orgId,
        name: input.name,
        nameKey: toNameKey(input.name),
        description: input.description || null,
      },
    });
    return { team: await loadTeamDto(orgId, team.id) };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
};

export const updateTeam = async (orgId: string, teamId: string, input: UpdateTeamInput) => {
  const team = await findTeam(orgId, teamId);
  try {
    await prisma.team.update({
      where: { id: team.id },
      data: {
        ...(input.name !== undefined && { name: input.name, nameKey: toNameKey(input.name) }),
        ...(input.description !== undefined && { description: input.description || null }),
        // Archiving keeps the team readable and its tickets workable; it only
        // disappears from selection lists.
        ...(input.archived !== undefined && {
          archivedAt: input.archived ? (team.archivedAt ?? new Date()) : null,
        }),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  return { team: await loadTeamDto(orgId, team.id) };
};

/** Add a member to a team, or change their Lead flag (PUT = idempotent). */
export const setTeamMember = async (orgId: string, teamId: string, membershipId: string, input: SetTeamMemberInput) => {
  const team = await findTeam(orgId, teamId);
  if (team.archivedAt) {
    throw new AppError(422, 'VALIDATION_ERROR', 'This team is archived. Unarchive it before changing its members.');
  }

  // Reference check: the person must be an ACTIVE member of THIS organization.
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: orgId, status: 'ACTIVE' },
  });
  if (!membership) throw new AppError(404, 'NOT_FOUND', 'Member not found.');

  await prisma.teamMember.upsert({
    where: { teamId_membershipId: { teamId: team.id, membershipId: membership.id } },
    create: { organizationId: orgId, teamId: team.id, membershipId: membership.id, isLead: input.isLead },
    update: { isLead: input.isLead },
  });

  return { team: await loadTeamDto(orgId, team.id) };
};

export const deleteTeamMember = async (orgId: string, teamId: string, membershipId: string) => {
  const team = await findTeam(orgId, teamId);
  const removed = await prisma.$transaction((tx) => removeFromTeam(tx, orgId, team.id, membershipId));
  if (!removed) throw new AppError(404, 'NOT_FOUND', 'This person is not in the team.');
  return { team: await loadTeamDto(orgId, team.id) };
};
