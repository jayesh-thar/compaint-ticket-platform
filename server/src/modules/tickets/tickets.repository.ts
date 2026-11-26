import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import type { Actor } from '../../shared/permissions.js';
import { buildTicketVisibilityWhere } from '../../shared/visibility.js';

/**
 * Prisma queries for tickets. Every function is scoped by organization (through
 * the visibility rule or an explicit organizationId). No business rules here.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const personSelect = {
  id: true,
  status: true,
  role: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export const ticketListInclude = {
  category: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, archivedAt: true } },
  assignee: { select: personSelect },
  parent: { select: { id: true, number: true } },
  _count: { select: { subtickets: true } },
} satisfies Prisma.TicketInclude;

export const ticketDetailInclude = {
  category: { select: { id: true, name: true, archivedAt: true } },
  team: { select: { id: true, name: true, archivedAt: true } },
  assignee: { select: personSelect },
  createdBy: { select: personSelect },
  requester: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, number: true, subject: true, status: true, teamId: true } },
  subtickets: {
    select: { id: true, number: true, subject: true, status: true, priority: true, assignee: { select: personSelect } },
    orderBy: { number: 'asc' },
  },
} satisfies Prisma.TicketInclude;

export type TicketListRow = Prisma.TicketGetPayload<{ include: typeof ticketListInclude }>;
export type TicketDetailRow = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Ticket not found.');

/**
 * Loads a ticket by number ONLY if the actor may see it. "Does not exist",
 * "other organization" and "not visible to you" are all the same 404.
 */
export const findVisibleTicket = async (actor: Actor, number: number, db: Db = prisma) => {
  const ticket = await db.ticket.findFirst({
    where: { AND: [buildTicketVisibilityWhere(actor), { number }] },
    include: ticketDetailInclude,
  });
  if (!ticket) throw notFound();
  return ticket;
};

/** Plain row (no relations), still visibility-scoped. Used inside mutations. */
export const findVisibleTicketRow = async (actor: Actor, number: number, db: Db = prisma) => {
  const ticket = await db.ticket.findFirst({ where: { AND: [buildTicketVisibilityWhere(actor), { number }] } });
  if (!ticket) throw notFound();
  return ticket;
};

/** Active (not archived) team of this organization, or null. */
export const findActiveTeam = (orgId: string, teamId: string, db: Db = prisma) =>
  db.team.findFirst({ where: { id: teamId, organizationId: orgId, archivedAt: null } });

/** Active (not archived) category of this organization, or null. */
export const findActiveCategory = (orgId: string, categoryId: string, db: Db = prisma) =>
  db.category.findFirst({ where: { id: categoryId, organizationId: orgId, archivedAt: null } });

/**
 * Loads a would-be assignee and answers README 7.5:
 * ACTIVE member of the same organization and, when the ticket has a team,
 * a member of that team OR a Manager/Admin.
 */
export const loadAssigneeCandidate = async (
  orgId: string,
  teamId: string | null,
  membershipId: string,
  db: Db = prisma
) => {
  const membership = await db.membership.findFirst({
    where: { id: membershipId, organizationId: orgId, status: 'ACTIVE' },
    include: { teamMemberships: { select: { teamId: true } }, user: { select: { name: true, email: true } } },
  });
  if (!membership) return null;
  const inTicketTeam = !!teamId && membership.teamMemberships.some((t) => t.teamId === teamId);
  const eligible = !teamId || inTicketTeam || membership.role !== 'STAFF';
  return { membership, inTicketTeam, eligible };
};

/** Reserves the next reference number. Must run inside the creation transaction. */
export const nextTicketNumber = async (tx: Prisma.TransactionClient, orgId: string) => {
  // UPDATE ... SET counter = counter + 1 RETURNING counter: atomic, and the row
  // stays locked until commit, so two creations can never get the same number.
  const org = await tx.organization.update({
    where: { id: orgId },
    data: { ticketCounter: { increment: 1 } },
    select: { ticketCounter: true },
  });
  return org.ticketCounter;
};

export const recordActivity = (
  tx: Prisma.TransactionClient,
  data: {
    organizationId: string;
    ticketId: string;
    actorUserId: string | null;
    type: Prisma.TicketActivityCreateManyInput['type'];
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
  }
) => tx.ticketActivity.create({ data });
