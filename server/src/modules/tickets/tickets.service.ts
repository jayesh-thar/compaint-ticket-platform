import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { type Actor, canAssign, checkCreateTicket } from '../../shared/permissions.js';
import { buildTicketOrderBy, buildTicketWhere, type TicketListQuery } from '../../shared/ticket-filters.js';
import type { CreateTicketInput } from './tickets.schemas.js';
import * as repo from './tickets.repository.js';
import { toTicketDetail, toTicketListItem, ticketRef } from './tickets.mapper.js';
import { notifyRouting } from '../notifications/outbox.js';

const CREATE_DENIED: Record<string, string> = {
  TEAM_REQUIRED: 'Choose one of your teams for this ticket.',
  NOT_OWN_TEAM: 'You can only create tickets for your own team.',
  SELF_ASSIGN_ONLY: 'You can only leave the ticket unassigned or assign it to yourself.',
};

const fieldError = (field: string, message: string) =>
  new AppError(422, 'VALIDATION_ERROR', message, { [field]: message });

export const notEligible = (message = 'This person cannot be assigned to this ticket.') =>
  new AppError(422, 'ASSIGNEE_NOT_ELIGIBLE', message, { assigneeId: message });

export const listTickets = async (actor: Actor, query: TicketListQuery) => {
  const where = buildTicketWhere(actor, query);
  const [total, rows] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: repo.ticketListInclude,
      orderBy: buildTicketOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { tickets: rows.map(toTicketListItem), total, page: query.page, pageSize: query.pageSize };
};

export const getTicket = async (actor: Actor, number: number) => {
  const ticket = await repo.findVisibleTicket(actor, number);
  return { ticket: toTicketDetail(actor, ticket) };
};

/**
 * Top-down flow, step 2 (README 6.1). The server decides source, status,
 * creator and number; the client only proposes content and routing.
 */
export const createInternalTicket = async (actor: Actor, input: CreateTicketInput) => {
  const teamId = input.teamId ?? null;
  const assigneeId = input.assigneeId ?? null;

  // 1. Role rules from the permission matrix.
  const check = checkCreateTicket(actor, { teamId, assigneeId });
  if (!check.ok) throw new AppError(403, 'FORBIDDEN', CREATE_DENIED[check.reason]);

  // 2. Reference checks: every id from the client is re-loaded with this organization.
  if (input.categoryId && !(await repo.findActiveCategory(actor.organizationId, input.categoryId))) {
    throw fieldError('categoryId', 'Choose an active category of this organization.');
  }
  if (teamId && !(await repo.findActiveTeam(actor.organizationId, teamId))) {
    throw fieldError('teamId', 'Choose an active team of this organization.');
  }
  if (assigneeId) {
    const candidate = await repo.loadAssigneeCandidate(actor.organizationId, teamId, assigneeId);
    if (!candidate || !candidate.eligible) throw notEligible();
    const draft = { teamId, assigneeId: null, createdByMembershipId: actor.membershipId };
    if (!canAssign(actor, draft, { membershipId: assigneeId, inTicketTeam: candidate.inTicketTeam })) {
      throw new AppError(403, 'FORBIDDEN', 'You can only assign this ticket to members of its team.');
    }
  }

  // 3. One transaction: number + ticket + CREATED activity + email outbox rows.
  //    If anything throws, nothing is saved - not even the counter increment.
  const ticket = await prisma.$transaction(async (tx) => {
    const number = await repo.nextTicketNumber(tx, actor.organizationId);
    const created = await tx.ticket.create({
      data: {
        organizationId: actor.organizationId,
        number,
        source: 'INTERNAL',
        status: 'OPEN',
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        categoryId: input.categoryId ?? null,
        teamId,
        assigneeId,
        createdByMembershipId: actor.membershipId,
      },
    });
    await repo.recordActivity(tx, {
      organizationId: actor.organizationId,
      ticketId: created.id,
      actorUserId: actor.userId,
      type: 'CREATED',
      toValue: ticketRef(number),
    });
    // Email rows in the same transaction: "Assigned to you" or "Needs assignment".
    await notifyRouting(tx, created, actor.userId);
    return created;
  });

  return getTicket(actor, ticket.number);
};
