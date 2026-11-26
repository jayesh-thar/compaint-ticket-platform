import { z } from 'zod';
import { AppError } from '../../shared/errors.js';

export const subjectSchema = z
  .string()
  .trim()
  .min(3, 'Subject must be at least 3 characters')
  .max(200, 'Subject cannot exceed 200 characters');

export const descriptionSchema = z
  .string()
  .trim()
  .min(10, 'Description must be at least 10 characters')
  .max(10000, 'Description cannot exceed 10,000 characters');

export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/** A calendar date "YYYY-MM-DD" (no time, no time zone) -> Date at midnight UTC. */
export const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((v, ctx) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a real date' });
      return z.NEVER;
    }
    return d;
  });

const optionalId = (message: string) => z.string().uuid(message).nullable().optional();

/**
 * Internal ticket. Note what is NOT here: source, status, organizationId,
 * createdBy, requesterId - the server decides those. Zod drops unknown keys,
 * so a client sending them is simply ignored.
 */
export const createTicketSchema = z.object({
  subject: subjectSchema,
  description: descriptionSchema,
  priority: prioritySchema.default('MEDIUM'),
  dueDate: dueDateSchema.nullable().optional(),
  categoryId: optionalId('Choose a valid category.'),
  teamId: optionalId('Choose a valid team.'),
  assigneeId: optionalId('Choose a valid person.'),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** Tickets are addressed by their per-organization number; anything else is "not found". */
export const parseTicketNumber = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2_000_000_000 || String(raw) !== String(n)) {
    throw new AppError(404, 'NOT_FOUND', 'Ticket not found.');
  }
  return n;
};

export const changeStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED']),
  closeReason: z.enum(['COMPLETED', 'REJECTED', 'CANCELLED']).optional(),
  note: z.string().trim().max(2000, 'Note cannot exceed 2,000 characters').optional(),
});

export const assignmentSchema = z.object({
  // null = unassign
  assigneeId: z.string().uuid('Choose a valid person.').nullable(),
});

export const updateTicketSchema = z
  .object({
    subject: subjectSchema.optional(),
    description: descriptionSchema.optional(),
    priority: prioritySchema.optional(),
    dueDate: dueDateSchema.nullable().optional(),
    categoryId: z.string().uuid('Choose a valid category.').nullable().optional(),
    teamId: z.string().uuid('Choose a valid team.').nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });

export const createSubticketSchema = z.object({
  subject: subjectSchema,
  description: descriptionSchema,
  priority: prioritySchema.optional(),
  dueDate: dueDateSchema.nullable().optional(),
  teamId: z.string().uuid('Choose a valid team.').nullable().optional(),
  assigneeId: z.string().uuid('Choose a valid person.').nullable().optional(),
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateSubticketInput = z.infer<typeof createSubticketSchema>;
