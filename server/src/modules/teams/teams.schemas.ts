import { z } from 'zod';

const teamName = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(60, 'Name cannot exceed 60 characters');

const description = z.string().trim().max(500, 'Description cannot exceed 500 characters').nullable().optional();

export const createTeamSchema = z.object({
  name: teamName,
  description,
});

export const updateTeamSchema = z
  .object({
    name: teamName.optional(),
    description,
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });

export const setTeamMemberSchema = z.object({
  isLead: z.boolean().default(false),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type SetTeamMemberInput = z.infer<typeof setTeamMemberSchema>;
