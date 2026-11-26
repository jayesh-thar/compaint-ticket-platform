import crypto from 'node:crypto';
import type { MembershipRole } from '@prisma/client';
import { prisma } from '../../src/config/prisma.js';
import { generateToken, hashToken } from '../../src/shared/crypto.js';

interface CreateUserOverrides {
  email?: string;
  name?: string;
  passwordHash?: string;
  emailVerifiedAt?: Date | null;
}

export const createUser = async (overrides: CreateUserOverrides = {}) => {
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user_${randomSuffix}@example.com`,
      name: overrides.name ?? `Test User ${randomSuffix}`,
      passwordHash: overrides.passwordHash ?? 'hashed_test_password',
      emailVerifiedAt: overrides.emailVerifiedAt !== undefined ? overrides.emailVerifiedAt : new Date(),
    },
  });
};

export const createSession = async (userId: string) => {
  const sid = generateToken();
  const tokenHash = hashToken(sid);
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return { sid, cookie: `sid=${sid}` };
};

export const createTestOrg = async (
  ownerUserId: string,
  overrides: { name?: string; slug?: string; role?: MembershipRole } = {}
) => {
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  const org = await prisma.organization.create({
    data: {
      name: overrides.name ?? `Acme Corp ${randomSuffix}`,
      slug: overrides.slug ?? `acme-${randomSuffix}`,
    },
  });

  const membership = await prisma.membership.create({
    data: {
      organizationId: org.id,
      userId: ownerUserId,
      role: overrides.role ?? 'ADMIN',
      status: 'ACTIVE',
    },
  });

  return { org, membership };
};

/** A verified user with a live session, holding `role` in the org (optionally in teams). */
export const createMember = async (
  organizationId: string,
  role: MembershipRole,
  opts: { teams?: { teamId: string; isLead?: boolean }[]; name?: string; email?: string } = {}
) => {
  const user = await createUser({ name: opts.name, email: opts.email });
  const membership = await prisma.membership.create({
    data: { organizationId, userId: user.id, role, status: 'ACTIVE' },
  });
  for (const t of opts.teams ?? []) {
    await prisma.teamMember.create({
      data: { organizationId, teamId: t.teamId, membershipId: membership.id, isLead: t.isLead ?? false },
    });
  }
  const { cookie } = await createSession(user.id);
  return { user, membership, cookie };
};

export const createTeam = async (
  organizationId: string,
  name = `Team ${crypto.randomBytes(3).toString('hex')}`,
  opts: { archived?: boolean } = {}
) =>
  prisma.team.create({
    data: {
      organizationId,
      name,
      nameKey: name.trim().toLowerCase(),
      archivedAt: opts.archived ? new Date() : null,
    },
  });

export const createCategory = async (
  organizationId: string,
  opts: { name?: string; isPublic?: boolean; defaultTeamId?: string | null; archived?: boolean } = {}
) => {
  const name = opts.name ?? `Category ${crypto.randomBytes(3).toString('hex')}`;
  return prisma.category.create({
    data: {
      organizationId,
      name,
      nameKey: name.trim().toLowerCase(),
      isPublic: opts.isPublic ?? false,
      defaultTeamId: opts.defaultTeamId ?? null,
      archivedAt: opts.archived ? new Date() : null,
    },
  });
};

/** An organization with an Admin (and their cookie), ready for workspace tests. */
export const createOrgWithAdmin = async (slug?: string) => {
  const admin = await createUser();
  const { cookie } = await createSession(admin.id);
  const { org, membership } = await createTestOrg(admin.id, { slug });
  return { org, admin: { user: admin, membership, cookie } };
};

/** Inserts a ticket directly (bypassing the API), taking the next org number. */
export const createTicket = async (
  organizationId: string,
  data: Partial<{
    subject: string;
    source: 'INTERNAL' | 'PORTAL';
    status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_REQUESTER' | 'RESOLVED' | 'CLOSED';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    closeReason: 'COMPLETED' | 'REJECTED' | 'CANCELLED' | null;
    teamId: string | null;
    categoryId: string | null;
    assigneeId: string | null;
    requesterId: string | null;
    createdByMembershipId: string | null;
    parentId: string | null;
    dueDate: Date | null;
    resolvedAt: Date | null;
  }> = {}
) => {
  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { ticketCounter: { increment: 1 } },
  });
  const status = data.status ?? 'OPEN';
  return prisma.ticket.create({
    data: {
      organizationId,
      number: org.ticketCounter,
      source: data.source ?? 'INTERNAL',
      subject: data.subject ?? `Ticket ${org.ticketCounter}`,
      description: 'A description that is long enough.',
      status,
      priority: data.priority ?? 'MEDIUM',
      closeReason: data.closeReason !== undefined ? data.closeReason : status === 'CLOSED' ? 'COMPLETED' : null,
      teamId: data.teamId ?? null,
      categoryId: data.categoryId ?? null,
      assigneeId: data.assigneeId ?? null,
      requesterId: data.requesterId ?? null,
      createdByMembershipId: data.createdByMembershipId ?? null,
      parentId: data.parentId ?? null,
      dueDate: data.dueDate ?? null,
      resolvedAt: data.resolvedAt ?? (status === 'RESOLVED' ? new Date() : null),
      closedAt: status === 'CLOSED' ? new Date() : null,
    },
  });
};
