import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { toNameKey } from '../../shared/params.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schemas.js';

const categoryInclude = {
  defaultTeam: { select: { id: true, name: true, archivedAt: true } },
} satisfies Prisma.CategoryInclude;

type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>;

const toCategoryDto = (c: CategoryRow) => ({
  id: c.id,
  name: c.name,
  isPublic: c.isPublic,
  archived: c.archivedAt !== null,
  archivedAt: c.archivedAt,
  defaultTeam: c.defaultTeam
    ? { id: c.defaultTeam.id, name: c.defaultTeam.name, archived: c.defaultTeam.archivedAt !== null }
    : null,
  createdAt: c.createdAt,
});

const nameTaken = () =>
  new AppError(409, 'CONFLICT', 'A category with this name already exists.', {
    name: 'A category with this name already exists.',
  });

/**
 * Reference check: a default team must be an ACTIVE (not archived) team of the
 * same organization. A foreign or archived id is rejected; nothing is saved.
 */
const assertUsableTeam = async (orgId: string, teamId: string) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId: orgId, archivedAt: null } });
  if (!team) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Choose an active team of this organization.', {
      defaultTeamId: 'Choose an active team of this organization.',
    });
  }
};

export const listCategories = async (orgId: string, includeArchived: boolean) => {
  const categories = await prisma.category.findMany({
    where: { organizationId: orgId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: categoryInclude,
    orderBy: { name: 'asc' },
  });
  return { categories: categories.map(toCategoryDto) };
};

export const createCategory = async (orgId: string, input: CreateCategoryInput) => {
  if (input.defaultTeamId) await assertUsableTeam(orgId, input.defaultTeamId);
  try {
    const category = await prisma.category.create({
      data: {
        organizationId: orgId,
        name: input.name,
        nameKey: toNameKey(input.name),
        isPublic: input.isPublic,
        defaultTeamId: input.defaultTeamId ?? null,
      },
      include: categoryInclude,
    });
    return { category: toCategoryDto(category) };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
};

export const updateCategory = async (orgId: string, categoryId: string, input: UpdateCategoryInput) => {
  const existing = await prisma.category.findFirst({ where: { id: categoryId, organizationId: orgId } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Category not found.');
  if (input.defaultTeamId) await assertUsableTeam(orgId, input.defaultTeamId);

  try {
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined && { name: input.name, nameKey: toNameKey(input.name) }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
        ...(input.defaultTeamId !== undefined && { defaultTeamId: input.defaultTeamId }),
        ...(input.archived !== undefined && {
          archivedAt: input.archived ? (existing.archivedAt ?? new Date()) : null,
        }),
      },
      include: categoryInclude,
    });
    return { category: toCategoryDto(category) };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
};
