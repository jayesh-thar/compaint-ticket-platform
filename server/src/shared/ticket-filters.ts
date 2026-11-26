import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Actor } from './permissions.js';
import { buildTicketVisibilityWhere, OPEN_WORKLOAD, startOfTodayUtc } from './visibility.js';

/**
 * ONE filter builder for the ticket list and the dashboard (planning Phase 5/9),
 * so a dashboard card and the list it links to can never disagree.
 */

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/** "a,b" or ["a","b"] -> ["a","b"] (query strings can carry either). */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)));

const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

/** A UUID, or "none" meaning "no team / no category". */
const idOrNone = z.union([z.literal('none'), z.string().uuid()]).optional();

export const SORT_FIELDS = ['updatedAt', 'createdAt', 'priority', 'dueDate', 'number', 'status'] as const;

export const ticketFilterSchema = z.object({
  status: csv(STATUSES).optional(),
  /** Shortcut: status in open workload. */
  open: flag,
  priority: csv(PRIORITIES).optional(),
  categoryId: idOrNone,
  teamId: idOrNone,
  assigneeId: z.string().uuid().optional(),
  source: z.enum(['INTERNAL', 'PORTAL']).optional(),
  unassigned: flag,
  overdue: flag,
  mine: flag,
  /** Resolved within the last N days (dashboard "Resolved (30 days)"). */
  resolvedDays: z.coerce.number().int().min(1).max(365).optional(),
  q: z.string().trim().max(200).optional(),
});

export const ticketListQuerySchema = ticketFilterSchema.extend({
  sort: z.enum(SORT_FIELDS).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type TicketFilters = z.infer<typeof ticketFilterSchema>;
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** Visibility AND every requested filter. */
export const buildTicketWhere = (actor: Actor, f: TicketFilters, now = new Date()): Prisma.TicketWhereInput => {
  const and: Prisma.TicketWhereInput[] = [buildTicketVisibilityWhere(actor)];

  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.open) and.push({ status: { in: OPEN_WORKLOAD } });
  if (f.priority?.length) and.push({ priority: { in: f.priority } });
  if (f.categoryId) and.push({ categoryId: f.categoryId === 'none' ? null : f.categoryId });
  if (f.teamId) and.push({ teamId: f.teamId === 'none' ? null : f.teamId });
  if (f.assigneeId) and.push({ assigneeId: f.assigneeId });
  if (f.source) and.push({ source: f.source });
  if (f.unassigned) and.push({ assigneeId: null });
  if (f.mine) and.push({ assigneeId: actor.membershipId });
  if (f.overdue) {
    and.push({ status: { in: OPEN_WORKLOAD }, dueDate: { lt: startOfTodayUtc(now) } });
  }
  if (f.resolvedDays) {
    and.push({ resolvedAt: { gte: new Date(now.getTime() - f.resolvedDays * 24 * 60 * 60 * 1000) } });
  }
  if (f.q) {
    // "T-42", "t42" or "42" also match the reference number.
    const ref = /^t?-?(\d{1,9})$/i.exec(f.q);
    const subject: Prisma.TicketWhereInput = { subject: { contains: f.q, mode: 'insensitive' } };
    and.push(ref ? { OR: [{ number: Number(ref[1]) }, subject] } : subject);
  }

  return { AND: and };
};

export const buildTicketOrderBy = (
  q: Pick<TicketListQuery, 'sort' | 'order'>
): Prisma.TicketOrderByWithRelationInput[] => [
  // Tickets without a due date go last whichever way we sort.
  q.sort === 'dueDate' ? { dueDate: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order },
  { number: 'desc' }, // stable tie-breaker so pages never overlap
];
