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

const TITLE_WORD = { HEAD: 'Head', LEAD: 'Lead', MANAGER: 'Manager' } as const;

/** "Admin", "Head of Server team", "Member of Network +1 more", "Staff (no team yet)". */
const roleLabel = (
  role: MembershipRole,
  teams: { role: 'LEADER' | 'MEMBER'; leaderTitle: keyof typeof TITLE_WORD | null; team: { name: string } }[]
) => {
  if (role === 'ADMIN') return 'Admin';
  const led = teams.find((t) => t.role === 'LEADER');
  const main = led ?? teams[0];
  if (!main) return 'Staff (no team yet)';
  const word = led ? TITLE_WORD[led.leaderTitle ?? 'LEAD'] : 'Member';
  const more = teams.length > 1 ? ` +${teams.length - 1} more` : '';
  return `${word} of ${main.team.name}${more}`;
};

export const getMyOrganizations = async (userId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      organization: true,
      teamMemberships: {
        where: { team: { archivedAt: null } },
        select: { role: true, leaderTitle: true, team: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      roleLabel: roleLabel(m.role, m.teamMemberships),
      membershipId: m.id,
      joinedAt: m.createdAt,
    })),
  };
};

// `me` lets the UI build role-aware screens; the server still checks every action.
export const getOrganization = async (org: Organization, actor: Actor) => {
  const [teams, categories, membership] = await Promise.all([
    prisma.teamMember.findMany({
      where: { membershipId: actor.membershipId },
      include: {
        team: { select: { id: true, name: true, archivedAt: true, categories: { select: { id: true } } } },
      },
    }),
    prisma.category.findMany({
      where: { id: { in: actor.leadCategoryIds } },
      select: { id: true, name: true },
    }),
    prisma.membership.findUnique({ where: { id: actor.membershipId }, select: { jobTitle: true } }),
  ]);
  return {
    organization: toOrgDto(org, actor.role),
    me: {
      membershipId: actor.membershipId,
      role: actor.role,
      jobTitle: membership?.jobTitle ?? null,
      teamIds: actor.teamIds,
      leadTeamIds: actor.leadTeamIds,
      leadCategoryIds: actor.leadCategoryIds,
      teams: teams.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        categoryIds: t.team.categories.map((c) => c.id),
        archived: t.team.archivedAt !== null,
        teamRole: t.role,
        leaderTitle: t.leaderTitle,
      })),
      ledCategories: categories,
    },
  };
};

export const updateOrganization = async (orgId: string, myRole: MembershipRole, input: UpdateOrgInput) => {
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
