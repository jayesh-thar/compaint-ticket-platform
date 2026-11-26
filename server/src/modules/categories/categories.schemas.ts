import { z } from 'zod';

const categoryName = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(60, 'Name cannot exceed 60 characters');

const teamId = z.string().uuid('Choose a valid team.').nullable().optional();

export const createCategorySchema = z.object({
  name: categoryName,
  isPublic: z.boolean().default(false),
  defaultTeamId: teamId,
});

export const updateCategorySchema = z
  .object({
    name: categoryName.optional(),
    isPublic: z.boolean().optional(),
    defaultTeamId: teamId,
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
