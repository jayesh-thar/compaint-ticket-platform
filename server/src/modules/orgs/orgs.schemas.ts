import { z } from 'zod';
import { slugSchema } from '../../shared/slug.js';

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name cannot exceed 100 characters');

export const createOrgSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
});

// Slug is immutable (D-11): unknown keys such as `slug` are stripped by Zod
// and therefore ignored. Turning the portal on needs a public category (service).
export const updateOrgSchema = z.object({
  name: nameSchema.optional(),
  portalIntro: z.string().trim().max(2000, 'Portal intro cannot exceed 2000 characters').nullable().optional(),
  portalEnabled: z.boolean().optional(),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
