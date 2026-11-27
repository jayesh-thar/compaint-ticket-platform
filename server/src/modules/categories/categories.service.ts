import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { toNameKey } from '../../shared/params.js';
import { publish } from '../../shared/events.js';
import { LIVE_STAGES } from '../tickets/stage-machine.js';

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);

export const createCategorySchema = z.object({
  name,
  description: z.string().trim().max(500).nullable().optional(),
  teamIds: z.array(z.string().uuid()).max(50).default([]),
  leadMembershipId: z.string().uuid().nullable().optional(),
});
export const updateCategorySchema = z.object({
  name: name.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  teamIds: z.array(z.string().uuid()).max(50).optional(),
  leadMembershipId: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional(),
});

const nameTaken = () =>
  new AppError(409, 'CONFLICT', 'A category with this name already exists.', { name: 'Name already used.' });

/** Every referenced id must belong to this organization (never trust ids from the body). */
const checkRefs = async (orgId: string, teamIds: string[] | undefined, leadId: string | null | undefined) => {
  if (teamIds && teamIds.length > 0) {
    const n = await prisma.team.count({ where: { id: { in: teamIds }, organizationId: orgId, archivedAt: null } });
    if (n !== new Set(teamIds).size) {
      throw new AppError(422, 'VALIDATION_ERROR', 'One of the teams was not found.', { teamIds: 'Unknown team.' });
    }
  }
  if (leadId) {
    const m = await prisma.membership.findFirst({ where: { id: leadId, organizationId: orgId, status: 'ACTIVE' } });
    if (!m) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Category Lead not found.', { leadMembershipId: 'Unknown member.' });
    }
  }
};

export const listCategories = async (orgId: string, includeArchived: boolean) => {
  const categories = await prisma.category.findMany({
    where: { organizationId: orgId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: {
      lead: { select: { id: true, user: { select: { name: true } } } },
      teams: { where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } },
      _count: { select: { tickets: { where: { stage: { in: LIVE_STAGES } } } } },
    },
    orderBy: { name: 'asc' },
  });
  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      archived: c.archivedAt !== null,
      // Shown everywhere as "{Category} - Lead" (README 0.2).
      lead: c.lead ? { membershipId: c.lead.id, name: c.lead.user.name, label: `${c.name} - Lead` } : null,
      teams: c.teams,
      liveTicketCount: c._count.tickets,
    })),
  };
};

export const createCategory = async (orgId: string, input: z.infer<typeof createCategorySchema>) => {
  await checkRefs(orgId, input.teamIds, input.leadMembershipId);
  try {
    const category = await prisma.$transaction(async (tx) => {
      const c = await tx.category.create({
        data: {
          organizationId: orgId,
          name: input.name,
          nameKey: toNameKey(input.name),
          description: input.description ?? null,
          leadMembershipId: input.leadMembershipId ?? null,
        },
      });
      // A team can be in several categories (D-31): just link the chosen ones.
      if (input.teamIds.length > 0) {
        await tx.category.update({
          where: { id: c.id },
          data: { teams: { connect: input.teamIds.map((id) => ({ id })) } },
        });
      }
      return c;
    });
    publish(orgId, 'structure');
    return { category: { id: category.id, name: category.name }, message: 'Category created.' };
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
};

export const updateCategory = async (
  orgId: string,
  categoryId: string,
  input: z.infer<typeof updateCategorySchema>
) => {
  const existing = await prisma.category.findFirst({ where: { id: categoryId, organizationId: orgId } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Category not found.');
  await checkRefs(orgId, input.teamIds, input.leadMembershipId);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: categoryId },
        data: {
          name: input.name,
          nameKey: input.name ? toNameKey(input.name) : undefined,
          description: input.description,
          leadMembershipId: input.leadMembershipId,
          archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
        },
      });
      // Archiving releases the teams; a new team list replaces the old one.
      const teamIds = input.archived ? [] : input.teamIds;
      if (teamIds) {
        await tx.category.update({
          where: { id: categoryId },
          data: { teams: { set: teamIds.map((id) => ({ id })) } },
        });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
  publish(orgId, 'structure');
  return { message: 'Category updated.' };
};
