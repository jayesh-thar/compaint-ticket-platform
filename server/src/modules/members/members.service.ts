import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { offboardMembership } from './members.offboarding.js';
import type { UpdateMemberRoleInput } from './members.schemas.js';

export const listMembers = async (orgId: string) => {
  const members = await prisma.membership.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    include: {
      user: { select: { id: true, email: true, name: true } },
      teamMemberships: { include: { team: { select: { id: true, name: true, archivedAt: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    members: members.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt,
      teams: m.teamMemberships.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        isLead: t.isLead,
        archived: t.team.archivedAt !== null,
      })),
    })),
  };
};

/**
 * Locks every active Admin row of the organization until the transaction ends
 * and returns how many there are. Two Admins demoting each other at the same
 * moment are therefore processed one after the other, and the second one sees
 * the updated count, so the organization can never end up with zero Admins.
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
  // Always scoped by organizationId: an id from another organization is "not found".
  const target = await tx.membership.findFirst({
    where: { id: membershipId, organizationId: orgId, status: 'ACTIVE' },
  });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  return target;
};

export const updateMemberRole = async (orgId: string, membershipId: string, input: UpdateMemberRoleInput) => {
  return prisma.$transaction(async (tx) => {
    const adminCount = await lockActiveAdminCount(tx, orgId);
    const target = await findActiveMember(tx, orgId, membershipId);

    if (target.role === 'ADMIN' && input.role !== 'ADMIN' && adminCount <= 1) {
      throw new AppError(422, 'LAST_ADMIN', 'The last Admin cannot be demoted. Make someone else an Admin first.');
    }

    const updated = await tx.membership.update({
      where: { id: target.id },
      data: { role: input.role },
    });

    return {
      membership: { membershipId: updated.id, role: updated.role },
      message: 'Member role updated.',
    };
  });
};

export const removeMember = async (orgId: string, membershipId: string) => {
  return prisma.$transaction(async (tx) => {
    const adminCount = await lockActiveAdminCount(tx, orgId);
    const target = await findActiveMember(tx, orgId, membershipId);

    if (target.role === 'ADMIN' && adminCount <= 1) {
      throw new AppError(422, 'LAST_ADMIN', 'The last Admin cannot be removed. Make someone else an Admin first.');
    }

    await offboardMembership(tx, orgId, target.id);

    return { membershipId: target.id, message: 'Member removed.' };
  });
};
