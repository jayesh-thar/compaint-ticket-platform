import { z } from 'zod';
import { normalizeEmail } from '../../shared/crypto.js';
import { membershipRoleSchema } from '../members/members.schemas.js';

export const invitationIdParamSchema = z.string().uuid();

export const createInvitationSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(254).transform(normalizeEmail),
  role: membershipRoleSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required').max(200),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
