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
  opts: { teams?: { teamId: string; leader?: boolean }[]; name?: string; email?: string; jobTitle?: string } = {}
) => {
  const user = await createUser({ name: opts.name, email: opts.email });
  const membership = await prisma.membership.create({
    data: { organizationId, userId: user.id, role, status: 'ACTIVE', jobTitle: opts.jobTitle ?? null },
  });
  for (const t of opts.teams ?? []) {
    await prisma.teamMember.create({
      data: {
        organizationId,
        teamId: t.teamId,
        membershipId: membership.id,
        role: t.leader ? 'LEADER' : 'MEMBER',
        leaderTitle: t.leader ? 'HEAD' : null,
      },
    });
  }
  const { cookie } = await createSession(user.id);
  return { user, membership, cookie };
};

export const createTeam = async (
  organizationId: string,
  name = `Team ${crypto.randomBytes(3).toString('hex')}`,
  opts: { archived?: boolean; categoryIds?: string[] } = {}
) =>
  prisma.team.create({
    data: {
      organizationId,
      name,
      nameKey: name.trim().toLowerCase(),
      categories: { connect: (opts.categoryIds ?? []).map((id) => ({ id })) },
      archivedAt: opts.archived ? new Date() : null,
    },
  });

export const createCategory = async (
  organizationId: string,
  opts: { name?: string; leadMembershipId?: string | null; archived?: boolean } = {}
) => {
  const name = opts.name ?? `Category ${crypto.randomBytes(3).toString('hex')}`;
  return prisma.category.create({
    data: {
      organizationId,
      name,
      nameKey: name.trim().toLowerCase(),
      leadMembershipId: opts.leadMembershipId ?? null,
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
