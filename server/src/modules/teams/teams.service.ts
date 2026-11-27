import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { toNameKey } from '../../shared/params.js';
import { canManageTeamMembers, isAdmin, type Actor } from '../../shared/permissions.js';
import { publish } from '../../shared/events.js';
import { LIVE_STAGES } from '../tickets/stage-machine.js';
import { releaseAssignments } from '../tickets/tickets.assignments.js';

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
const description = z.string().trim().max(500).nullable().optional();

export const createTeamSchema = z.object({
  name,
  description,
  categoryIds: z.array(z.string().uuid()).max(50).default([]),
});
export const updateTeamSchema = z.object({
  name: name.optional(),
  description,
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
  archived: z.boolean().optional(),
});
export const setMemberSchema = z
  .object({
    teamRole: z.enum(['LEADER', 'MEMBER']).default('MEMBER'),
    leaderTitle: z.enum(['HEAD', 'LEAD', 'MANAGER']).optional(),
  })
  .refine((v) => v.teamRole !== 'LEADER' || !!v.leaderTitle, {
    message: 'Choose Head, Lead or Manager.',
    path: ['leaderTitle'],
  });

const nameTaken = () =>
  new AppError(409, 'CONFLICT', 'A team with this name already exists.', { name: 'Name already used.' });

const notFound = () => new AppError(404, 'NOT_FOUND', 'Team not found.');

/** Category must be an active one of the same organization (never trust an id). */
const checkCategories = async (orgId: string, ids: string[] | undefined) => {
  if (!ids || ids.length === 0) return;
  const n = await prisma.category.count({ where: { id: { in: ids }, organizationId: orgId, archivedAt: null } });
  if (n !== new Set(ids).size) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Category not found.', { categoryIds: 'Unknown category.' });
  }
};

export const findTeam = async (orgId: string, teamId: string) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId: orgId } });
  if (!team) throw notFound();
  return team;
};

const leaderOf = (members: { role: string; leaderTitle: string | null; membership: MemberRow }[]) => {
  const l = members.find((m) => m.role === 'LEADER');
  return l ? { membershipId: l.membership.id, name: l.membership.user.name, title: l.leaderTitle } : null;
};

type MemberRow = { id: string; user: { name: string } };

export const listTeams = async (orgId: string, includeArchived: boolean) => {
  const teams = await prisma.team.findMany({
    where: { organizationId: orgId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: {
      categories: { where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } },
      members: { include: { membership: { select: { id: true, user: { select: { name: true } } } } } },
      invitations: {
        where: { teamRole: 'LEADER', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { leaderTitle: true },
        take: 1,
      },
      _count: { select: { tickets: { where: { stage: { in: LIVE_STAGES } } } } },
    },
    orderBy: { name: 'asc' },
  });
  return {
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      archived: t.archivedAt !== null,
      categories: t.categories,
      leader: leaderOf(t.members),
      /** A Head / Lead / Manager invitation is waiting (no email here: every member sees this list). */
      leaderInvited: t.invitations[0] ? { title: t.invitations[0].leaderTitle } : null,
      memberCount: t.members.length,
      liveTicketCount: t._count.tickets,
    })),
  };
};

/** Team page: Admin, the team's members, and the Category Leads of its categories. */
export const getTeam = async (actor: Actor, teamId: string) => {
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId: actor.organizationId },
    include: {
      categories: {
        where: { archivedAt: null },
        select: { id: true, name: true, _count: { select: { teams: { where: { archivedAt: null } } } } },
        orderBy: { name: 'asc' },
      },
      members: {
        include: {
          membership: {
            select: { id: true, status: true, jobTitle: true, user: { select: { name: true, email: true } } },
          },
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
      invitations: {
        where: { acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  const allowed =
    team &&
    (isAdmin(actor) ||
      actor.teamIds.includes(team.id) ||
      team.categories.some((c) => actor.leadCategoryIds.includes(c.id)));
  if (!team || !allowed) throw notFound();

  const canManage = canManageTeamMembers(actor, team.id);
  return {
    team: {
      id: team.id,
      name: team.name,
      description: team.description,
      archived: team.archivedAt !== null,
      categories: team.categories.map((c) => ({ id: c.id, name: c.name, teamCount: c._count.teams })),
      leader: leaderOf(team.members),
      members: team.members.map((m) => ({
        membershipId: m.membership.id,
        name: m.membership.user.name,
        // Emails only for people who manage the team.
        email: canManage ? m.membership.user.email : null,
        jobTitle: m.membership.jobTitle,
        teamRole: m.role,
        leaderTitle: m.leaderTitle,
        status: m.membership.status,
      })),
      pendingInvitations: canManage
        ? team.invitations.map((i) => ({
            id: i.id,
            email: i.email,
            teamRole: i.teamRole,
            leaderTitle: i.leaderTitle,
            jobTitle: i.jobTitle,
            expiresAt: i.expiresAt,
            expired: i.expiresAt <= new Date(),
          }))
        : [],
    },
    permissions: { canManageMembers: canManage, canSetLeader: isAdmin(actor), canEditTeam: isAdmin(actor) },
  };
};

export const createTeam = async (orgId: string, input: z.infer<typeof createTeamSchema>) => {
  await checkCategories(orgId, input.categoryIds);
  try {
    const team = await prisma.team.create({
      data: {
        organizationId: orgId,
        name: input.name,
        nameKey: toNameKey(input.name),
        description: input.description ?? null,
        categories: { connect: input.categoryIds.map((id) => ({ id })) },
      },
    });
    publish(orgId, 'structure');
    return { team: { id: team.id, name: team.name }, message: 'Team created.' };
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
};

export const updateTeam = async (orgId: string, teamId: string, input: z.infer<typeof updateTeamSchema>) => {
  await findTeam(orgId, teamId);
  await checkCategories(orgId, input.categoryIds);
  try {
    await prisma.team.update({
      where: { id: teamId },
      data: {
        name: input.name,
        nameKey: input.name ? toNameKey(input.name) : undefined,
        description: input.description,
        categories: input.categoryIds ? { set: input.categoryIds.map((id) => ({ id })) } : undefined,
        archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
  publish(orgId, 'structure');
  return { message: 'Team updated.' };
};

/**
 * Add a member to a team or change their team role. Only an Admin makes someone
 * Leader; the previous Leader becomes a Member in the same transaction. A Leader
 * may add existing organization members to their own team as Members.
 */
export const setTeamMember = async (
  actor: Actor,
  teamId: string,
  membershipId: string,
  input: z.infer<typeof setMemberSchema>
) => {
  const team = await findTeam(actor.organizationId, teamId);
  if (!canManageTeamMembers(actor, team.id))
    throw new AppError(403, 'FORBIDDEN', "Only the Admin or this team's leader can do this.");
  if (input.teamRole === 'LEADER' && !isAdmin(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Only an Admin can choose the team leader.');
  }
  if (team.archivedAt) throw new AppError(422, 'VALIDATION_ERROR', 'This team is archived.');
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: actor.organizationId, status: 'ACTIVE' },
  });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');

  const existing = await prisma.teamMember.findUnique({ where: { teamId_membershipId: { teamId, membershipId } } });
  if (!isAdmin(actor) && existing?.role === 'LEADER') {
    throw new AppError(403, 'FORBIDDEN', 'Only an Admin can change the team leader.');
  }

  await prisma.$transaction(async (tx) => {
    if (input.teamRole === 'LEADER') {
      await tx.teamMember.updateMany({
        where: { teamId, role: 'LEADER', NOT: { membershipId } },
        data: { role: 'MEMBER', leaderTitle: null },
      });
    }
    const data = {
      role: input.teamRole,
      leaderTitle: input.teamRole === 'LEADER' ? input.leaderTitle! : null,
    };
    await tx.teamMember.upsert({
      where: { teamId_membershipId: { teamId, membershipId } },
      create: { organizationId: actor.organizationId, teamId, membershipId, ...data },
      update: data,
    });
  });
  publish(actor.organizationId, 'structure');
  return { message: input.teamRole === 'LEADER' ? 'Team leader set.' : 'Member saved.' };
};

/** Removes someone from one team; their live work in that team goes back to the leader. */
export const removeTeamMember = async (actor: Actor, teamId: string, membershipId: string) => {
  const team = await findTeam(actor.organizationId, teamId);
  if (!canManageTeamMembers(actor, team.id))
    throw new AppError(403, 'FORBIDDEN', "Only the Admin or this team's leader can do this.");
  const row = await prisma.teamMember.findUnique({ where: { teamId_membershipId: { teamId, membershipId } } });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Member not found in this team.');
  if (row.role === 'LEADER' && !isAdmin(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Only an Admin can remove the team leader.');
  }
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.teamMember.delete({ where: { id: row.id } });
    await releaseAssignments(tx, actor.organizationId, membershipId, actor.userId, teamId, 'Removed from the team');
  });
  publish(actor.organizationId, 'structure');
  publish(actor.organizationId, 'tickets');
  return { message: 'Removed from the team.' };
};
