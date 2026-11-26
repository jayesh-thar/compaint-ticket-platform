import type { Prisma, TicketStatus } from '@prisma/client';
import type { Actor } from './permissions.js';

/** Statuses that count as "open workload" (README 7.1). */
export const OPEN_WORKLOAD: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'];

/**
 * README 5.2, written once: which tickets a MEMBER may see.
 * Used by the list, detail, search, comments and dashboard so counts always
 * equal lists. (Requesters never use this; they are filtered by requesterId.)
 *
 * Mirrors `canViewTicket` in permissions.ts; a unit test keeps them in sync.
 */
export const buildTicketVisibilityWhere = (actor: Actor): Prisma.TicketWhereInput => {
  const base: Prisma.TicketWhereInput = { organizationId: actor.organizationId };
  if (actor.role !== 'STAFF') return base; // ADMIN, MANAGER see everything in the org

  return {
    ...base,
    OR: [
      { assigneeId: actor.membershipId },
      { createdByMembershipId: actor.membershipId },
      ...(actor.teamIds.length > 0 ? [{ teamId: { in: actor.teamIds } }] : []),
    ],
  };
};

/** Midnight UTC today: a ticket is overdue when its due date is before this. */
export const startOfTodayUtc = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const isOverdue = (ticket: { status: TicketStatus; dueDate: Date | null }, now = new Date()) =>
  !!ticket.dueDate && OPEN_WORKLOAD.includes(ticket.status) && ticket.dueDate < startOfTodayUtc(now);
