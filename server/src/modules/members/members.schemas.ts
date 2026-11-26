import { z } from 'zod';

export const membershipRoleSchema = z.enum(['ADMIN', 'MANAGER', 'STAFF']);

export const membershipIdParamSchema = z.string().uuid('Member not found.');

export const updateMemberRoleSchema = z.object({
  role: membershipRoleSchema,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
