import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { isAdmin, type Actor } from '../../shared/permissions.js';
import { publish } from '../../shared/events.js';
import { releaseAssignments } from '../tickets/tickets.assignments.js';

export const jobTitleSchema = z.string().trim().max(80, 'Job title cannot exceed 80 characters');
export const updateRoleSchema = z.object({ role: z.enum(['ADMIN', 'STAFF']) });
export const updateJobTitleSchema = z.object({ jobTitle: jobTitleSchema.nullable() });

export const listMembers = async (actor: Actor) => {
  const members = await prisma.membership.findMany({
    where: { organizationId: actor.organizationId, status: 'ACTIVE' },
    include: {
      user: { select: { id: true, email: true, name: true } },
      teamMemberships: { include: { team: { select: { id: true, name: true, archivedAt: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const seeEmails = isAdmin(actor) || actor.leadTeamIds.length > 0;
  return {
    members: members.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: seeEmails ? m.user.email : null,
      role: m.role,
      jobTitle: m.jobTitle,
      joinedAt: m.createdAt,
      teams: m.teamMemberships.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        teamRole: t.role,
        leaderTitle: t.leaderTitle,
        archived: t.team.archivedAt !== null,
      })),
    })),
  };
};

/** Titles already used in the organization, for the "type or pick" input (README 0.2). */
export const listJobTitles = async (orgId: string) => {
  const rows = await prisma.membership.findMany({
    where: { organizationId: orgId, status: 'ACTIVE', jobTitle: { not: null } },
    select: { jobTitle: true },
    distinct: ['jobTitle'],
    orderBy: { jobTitle: 'asc' },
  });
  return { jobTitles: rows.map((r) => r.jobTitle!).filter((t) => t.length > 0) };
};

/**
 * Locks every active Admin row of the organization until the transaction ends
 * and returns how many there are, so the organization can never end up with
 * zero Admins even when two Admins demote each other at the same moment.
 */
const lockActiveAdminCount = async (tx: Prisma.TransactionClient, orgId: string) => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memberships
    WHERE "organizationId" = ${orgId} AND role = 'ADMIN' AND status = 'ACTIVE'
    ORDER BY id
    FOR UPDATE`;
  return rows.length;
};

const findActiveMember = async (tx: Prisma.TransactionClient, orgId: string, membershipId: string) => {
  const target = await tx.membership.findFirst({
    where: { id: membershipId, organizationId: orgId, status: 'ACTIVE' },
  });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  return target;
};

export const updateMemberRole = async (orgId: string, membershipId: string, input: z.infer<typeof updateRoleSchema>) =>
  prisma.$transaction(async (tx) => {
    const adminCount = await lockActiveAdminCount(tx, orgId);
    const target = await findActiveMember(tx, orgId, membershipId);
    if (target.role === 'ADMIN' && input.role !== 'ADMIN' && adminCount <= 1) {
      throw new AppError(422, 'LAST_ADMIN', 'The last Admin cannot be demoted. Make someone else an Admin first.');
    }
    const updated = await tx.membership.update({ where: { id: target.id }, data: { role: input.role } });
    publish(orgId, 'structure');
    return { membership: { membershipId: updated.id, role: updated.role }, message: 'Member role updated.' };
  });

/** Admin, or the Leader of a team this person is in, edits the job title. */
export const updateJobTitle = async (
  actor: Actor,
  membershipId: string,
  input: z.infer<typeof updateJobTitleSchema>
) => {
  const target = await findActiveMember(prisma, actor.organizationId, membershipId);
  if (!isAdmin(actor)) {
    const shared = await prisma.teamMember.count({
      where: { membershipId: target.id, teamId: { in: actor.leadTeamIds } },
    });
    if (shared === 0) throw new AppError(403, 'FORBIDDEN', "Only the Admin or this person's team leader can edit it.");
  }
  await prisma.membership.update({
    where: { id: target.id },
    data: { jobTitle: input.jobTitle ? input.jobTitle : null },
  });
  publish(actor.organizationId, 'structure');
  return { message: 'Job title saved.' };
};

/**
 * Removal from the organization (Admin only): membership soft-removed, team rows
 * and Category Lead roles cleared, live work handed back to the team leaders.
 */
export const removeMember = async (actor: Actor, membershipId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const adminCount = await lockActiveAdminCount(tx, actor.organizationId);
    const target = await findActiveMember(tx, actor.organizationId, membershipId);
    if (target.role === 'ADMIN' && adminCount <= 1) {
      throw new AppError(422, 'LAST_ADMIN', 'The last Admin cannot be removed. Make someone else an Admin first.');
    }
    await tx.membership.update({ where: { id: target.id }, data: { status: 'REMOVED', removedAt: new Date() } });
    await tx.teamMember.deleteMany({ where: { organizationId: actor.organizationId, membershipId: target.id } });
    await tx.category.updateMany({
      where: { organizationId: actor.organizationId, leadMembershipId: target.id },
      data: { leadMembershipId: null },
    });
    await releaseAssignments(tx, actor.organizationId, target.id, actor.userId, null, 'Member removed');
    return { membershipId: target.id, message: 'Member removed.' };
  });
  publish(actor.organizationId, 'structure');
  publish(actor.organizationId, 'tickets');
  return result;
};
