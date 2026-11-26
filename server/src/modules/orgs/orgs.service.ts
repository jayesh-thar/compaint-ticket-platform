import type { Organization, MembershipRole } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import type { CreateOrgInput, UpdateOrgInput } from './orgs.schemas.js';
import type { Actor } from '../../shared/permissions.js';

// DTO: explicit fields only (never spread a Prisma row into a response).
const toOrgDto = (org: Organization, myRole: MembershipRole) => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  portalEnabled: org.portalEnabled,
  portalIntro: org.portalIntro,
  createdAt: org.createdAt,
  myRole,
});

const slugTaken = () =>
  new AppError(409, 'CONFLICT', 'An organization with this slug already exists.', {
    slug: 'This slug is already taken.',
  });

export const createOrganization = async (userId: string, input: CreateOrgInput) => {
  try {
    // One transaction: the organization never exists without its first Admin.
    const { org, membership } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.name, slug: input.slug, portalEnabled: false },
      });
      const membership = await tx.membership.create({
        data: { organizationId: org.id, userId, role: 'ADMIN', status: 'ACTIVE' },
      });
      return { org, membership };
    });

    return {
      organization: toOrgDto(org, membership.role),
      membership: { id: membership.id, role: membership.role, status: membership.status },
    };
  } catch (error) {
    // No "check first, then insert": the UNIQUE(slug) constraint is the single
    // source of truth, so two simultaneous requests cannot both win.
    if (isUniqueViolation(error)) throw slugTaken();
    throw error;
  }
};

export const getMyOrganizations = async (userId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      membershipId: m.id,
      joinedAt: m.createdAt,
    })),
  };
};

// `org` and the actor were already loaded by requireOrgMember; no second query.
// `me` lets the UI build role-aware pickers; the server still checks every action.
export const getOrganization = (org: Organization, actor: Actor) => ({
  organization: toOrgDto(org, actor.role),
  me: {
    membershipId: actor.membershipId,
    role: actor.role,
    teamIds: actor.teamIds,
    leadTeamIds: actor.leadTeamIds,
  },
});

export const updateOrganization = async (orgId: string, myRole: MembershipRole, input: UpdateOrgInput) => {
  if (input.portalEnabled) {
    // README 8.2: the portal can only open once there is something to complain about.
    const publicCategories = await prisma.category.count({
      where: { organizationId: orgId, isPublic: true, archivedAt: null },
    });
    if (publicCategories === 0) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Create at least one active public category before enabling the complaint portal.',
        { portalEnabled: 'Needs at least one active public category.' }
      );
    }
  }
  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: input.name,
      // Empty intro is stored as null so the portal can show its default text.
      portalIntro: input.portalIntro === '' ? null : input.portalIntro,
      portalEnabled: input.portalEnabled,
    },
  });
  return { organization: toOrgDto(updated, myRole) };
};
