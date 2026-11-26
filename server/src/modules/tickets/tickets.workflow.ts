import type { Prisma, Ticket } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import {
  type Actor,
  canAssign,
  canChangeTeam,
  canCreateSubticket,
  canEditText,
  canEditTriageFields,
  isManagerPlus,
} from '../../shared/permissions.js';
import { OPEN_WORKLOAD } from '../../shared/visibility.js';
import * as repo from './tickets.repository.js';
import { applyTransition, actorKindsFor } from './status-machine.js';
import { formatDueDate, ticketRef } from './tickets.mapper.js';
import { getTicket, notEligible } from './tickets.service.js';
import { notifyAssigned, notifyNeedsAssignment, notifyRouting, notifyStatusChange } from '../notifications/outbox.js';
import type { AssignmentInput, ChangeStatusInput, CreateSubticketInput, UpdateTicketInput } from './tickets.schemas.js';

/**
 * Phase 6: everything that changes an existing ticket. Each operation is one
 * transaction that writes the change and its activity entries together.
 */

const closedError = () => new AppError(422, 'VALIDATION_ERROR', 'This ticket is closed. Reopen it before changing it.');

const memberName = async (tx: Prisma.TransactionClient, membershipId: string | null) => {
  if (!membershipId) return null;
  const m = await tx.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { name: true } } },
  });
  return m?.user.name ?? null;
};

// ---------- status ----------

export const changeStatus = async (actor: Actor, number: number, input: ChangeStatusInput) => {
  await prisma.$transaction(async (tx) => {
    const ticket = await repo.findVisibleTicketRow(actor, number, tx);
    // The status machine is the single authority on who may move what where.
    const kinds = actorKindsFor(actor, ticket);
    await applyTransition(tx, {
      ticket,
      to: input.status,
      kinds,
      actorUserId: actor.userId,
      closeReason: input.closeReason ?? null,
      note: input.note ?? null,
    });
    // Requester emails (waiting on you / resolved / closed); none for internal tickets.
    await notifyStatusChange(tx, ticket, input.status, actor.userId);
  });
  return getTicket(actor, number);
};

// ---------- assignment ----------

export const changeAssignment = async (actor: Actor, number: number, input: AssignmentInput) => {
  await prisma.$transaction(async (tx) => {
    const ticket = await repo.findVisibleTicketRow(actor, number, tx);
    if (ticket.status === 'CLOSED') throw closedError();
    if (ticket.assigneeId === input.assigneeId) return; // nothing to do

    let inTicketTeam = false;
    if (input.assigneeId) {
      const candidate = await repo.loadAssigneeCandidate(actor.organizationId, ticket.teamId, input.assigneeId, tx);
      if (!candidate || !candidate.eligible) throw notEligible();
      inTicketTeam = candidate.inTicketTeam;
    }
    if (!canAssign(actor, ticket, { membershipId: input.assigneeId, inTicketTeam })) {
      throw new AppError(403, 'FORBIDDEN', 'You are not allowed to change who works on this ticket.');
    }

    await setAssignee(tx, ticket, input.assigneeId, actor.userId);
  });
  return getTicket(actor, number);
};

/**
 * Writes an assignee change + its activity. Conditional on the previous
 * assignee, so two people re-assigning at once cannot silently overwrite each
 * other (the loser gets 409 and reloads).
 */
const setAssignee = async (
  tx: Prisma.TransactionClient,
  ticket: Ticket,
  assigneeId: string | null,
  actorUserId: string | null,
  note?: string
) => {
  const { count } = await tx.ticket.updateMany({
    where: { id: ticket.id, organizationId: ticket.organizationId, assigneeId: ticket.assigneeId },
    data: { assigneeId },
  });
  if (count === 0)
    throw new AppError(409, 'CONFLICT', 'The assignee was changed by someone else. Reload and try again.');

  await repo.recordActivity(tx, {
    organizationId: ticket.organizationId,
    ticketId: ticket.id,
    actorUserId,
    type: assigneeId ? 'ASSIGNED' : 'UNASSIGNED',
    fromValue: await memberName(tx, ticket.assigneeId),
    toValue: await memberName(tx, assigneeId),
    note: note ?? null,
  });
  const updated = { ...ticket, assigneeId };
  if (assigneeId) await notifyAssigned(tx, updated, actorUserId);
  // A ticket that lost its person because of removal / team change needs a new one.
  else if (note) await notifyNeedsAssignment(tx, updated, actorUserId);
};

// ---------- field edits ----------

export const updateTicket = async (actor: Actor, number: number, input: UpdateTicketInput) => {
  await prisma.$transaction(async (tx) => {
    const ticket = await repo.findVisibleTicketRow(actor, number, tx);
    if (ticket.status === 'CLOSED') throw closedError();

    const wantsText = input.subject !== undefined || input.description !== undefined;
    const wantsTriage = input.priority !== undefined || input.dueDate !== undefined || input.categoryId !== undefined;
    if (wantsText && !canEditText(actor))
      throw new AppError(403, 'FORBIDDEN', 'Only Admins and Managers can edit the subject or description.');
    if (wantsTriage && !canEditTriageFields(actor, ticket))
      throw new AppError(403, 'FORBIDDEN', 'You cannot change priority, due date or category of this ticket.');
    if (input.teamId !== undefined && !canChangeTeam(actor))
      throw new AppError(403, 'FORBIDDEN', 'Only Admins and Managers can move a ticket to another team.');

    const activity: Omit<Prisma.TicketActivityCreateManyInput, 'organizationId' | 'ticketId' | 'actorUserId'>[] = [];
    const data: Prisma.TicketUpdateInput = {};

    if (input.subject !== undefined && input.subject !== ticket.subject) {
      data.subject = input.subject;
      activity.push({ type: 'EDITED', fromValue: 'subject', toValue: input.subject });
    }
    if (input.description !== undefined && input.description !== ticket.description) {
      data.description = input.description;
      activity.push({ type: 'EDITED', fromValue: 'description', toValue: null });
    }
    if (input.priority !== undefined && input.priority !== ticket.priority) {
      data.priority = input.priority;
      activity.push({ type: 'PRIORITY_CHANGED', fromValue: ticket.priority, toValue: input.priority });
    }
    if (input.dueDate !== undefined && formatDueDate(input.dueDate) !== formatDueDate(ticket.dueDate)) {
      data.dueDate = input.dueDate;
      activity.push({
        type: 'DUE_DATE_CHANGED',
        fromValue: formatDueDate(ticket.dueDate),
        toValue: formatDueDate(input.dueDate),
      });
    }
    if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
      const next = input.categoryId ? await repo.findActiveCategory(actor.organizationId, input.categoryId, tx) : null;
      if (input.categoryId && !next) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Choose an active category.', {
          categoryId: 'Choose an active category.',
        });
      }
      const prev = ticket.categoryId ? await tx.category.findUnique({ where: { id: ticket.categoryId } }) : null;
      data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
      activity.push({ type: 'CATEGORY_CHANGED', fromValue: prev?.name ?? null, toValue: next?.name ?? null });
    }

    let clearAssignee = false;
    if (input.teamId !== undefined && input.teamId !== ticket.teamId) {
      const next = input.teamId ? await repo.findActiveTeam(actor.organizationId, input.teamId, tx) : null;
      if (input.teamId && !next) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Choose an active team.', { teamId: 'Choose an active team.' });
      }
      const prev = ticket.teamId ? await tx.team.findUnique({ where: { id: ticket.teamId } }) : null;
      data.team = input.teamId ? { connect: { id: input.teamId } } : { disconnect: true };
      activity.push({ type: 'TEAM_CHANGED', fromValue: prev?.name ?? null, toValue: next?.name ?? null });

      // README 7.5: an assignee who is not eligible for the new team is cleared.
      if (ticket.assigneeId) {
        const candidate = await repo.loadAssigneeCandidate(actor.organizationId, input.teamId, ticket.assigneeId, tx);
        clearAssignee = !candidate?.eligible;
      }
    }

    if (Object.keys(data).length > 0) {
      await tx.ticket.update({ where: { id: ticket.id }, data });
      await tx.ticketActivity.createMany({
        data: activity.map((a) => ({
          ...a,
          organizationId: ticket.organizationId,
          ticketId: ticket.id,
          actorUserId: actor.userId,
        })),
      });
    }
    if (clearAssignee) {
      const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      await setAssignee(tx, fresh, null, actor.userId, 'Not a member of the new team');
      await demoteIfUnassignedInProgress(tx, fresh.id, null);
    } else if (input.teamId !== undefined && input.teamId !== ticket.teamId && !ticket.assigneeId) {
      // "Moved without an assignee": the new team's Leads (or Managers) are told.
      await notifyNeedsAssignment(tx, { ...ticket, teamId: input.teamId }, actor.userId);
    }
  });
  return getTicket(actor, number);
};

/** IN_PROGRESS needs an assignee; when it loses one the ticket goes back to the queue. */
const demoteIfUnassignedInProgress = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  actorUserId: string | null
) => {
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (t.status === 'IN_PROGRESS' && !t.assigneeId) {
    await tx.ticket.update({ where: { id: t.id }, data: { status: 'OPEN' } });
    await repo.recordActivity(tx, {
      organizationId: t.organizationId,
      ticketId: t.id,
      actorUserId,
      type: 'STATUS_CHANGED',
      fromValue: 'IN_PROGRESS',
      toValue: 'OPEN',
      note: 'No assignee',
    });
  }
};

// ---------- sub-tickets ----------

export const createSubticket = async (actor: Actor, parentNumber: number, input: CreateSubticketInput) => {
  const parent = await repo.findVisibleTicketRow(actor, parentNumber);
  if (parent.parentId) {
    throw new AppError(422, 'VALIDATION_ERROR', 'A sub-ticket cannot have its own sub-tickets (one level only).');
  }
  if (parent.status === 'RESOLVED' || parent.status === 'CLOSED') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Reopen the ticket before adding sub-tickets.');
  }
  if (!canCreateSubticket(actor, parent)) {
    throw new AppError(403, 'FORBIDDEN', 'Only Admins, Managers and the team Lead can split this ticket.');
  }

  // Defaults come from the parent. Only Managers/Admins may route a part elsewhere.
  const teamId = input.teamId !== undefined ? input.teamId : parent.teamId;
  if (teamId !== parent.teamId && !isManagerPlus(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Sub-tickets stay in the parent ticket’s team.');
  }
  if (teamId && !(await repo.findActiveTeam(actor.organizationId, teamId))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Choose an active team.', { teamId: 'Choose an active team.' });
  }

  const assigneeId = input.assigneeId ?? null;
  if (assigneeId) {
    const candidate = await repo.loadAssigneeCandidate(actor.organizationId, teamId, assigneeId);
    if (!candidate || !candidate.eligible) throw notEligible();
    const draft = { teamId, assigneeId: null, createdByMembershipId: actor.membershipId };
    if (!canAssign(actor, draft, { membershipId: assigneeId, inTicketTeam: candidate.inTicketTeam })) {
      throw new AppError(403, 'FORBIDDEN', 'You can only assign members of the team.');
    }
  }

  const child = await prisma.$transaction(async (tx) => {
    const number = await repo.nextTicketNumber(tx, actor.organizationId);
    const created = await tx.ticket.create({
      data: {
        organizationId: actor.organizationId,
        number,
        source: 'INTERNAL', // sub-tickets are always internal work items...
        requesterId: null, // ...without a requester (also a CHECK constraint)
        parentId: parent.id,
        status: 'OPEN',
        subject: input.subject,
        description: input.description,
        priority: input.priority ?? parent.priority,
        dueDate: input.dueDate !== undefined ? input.dueDate : parent.dueDate,
        categoryId: parent.categoryId,
        teamId,
        assigneeId,
        createdByMembershipId: actor.membershipId,
      },
    });
    await tx.ticketActivity.createMany({
      data: [
        {
          organizationId: actor.organizationId,
          ticketId: created.id,
          actorUserId: actor.userId,
          type: 'CREATED',
          toValue: ticketRef(number),
          note: `Sub-ticket of ${ticketRef(parent.number)}`,
        },
        {
          organizationId: actor.organizationId,
          ticketId: parent.id,
          actorUserId: actor.userId,
          type: 'SUBTICKET_ADDED',
          toValue: ticketRef(number),
        },
      ],
    });
    await notifyRouting(tx, created, actor.userId);
    return created;
  });

  return getTicket(actor, child.number);
};

// ---------- activity timeline ----------

export const listActivity = async (actor: Actor, number: number) => {
  const ticket = await repo.findVisibleTicketRow(actor, number);
  const rows = await prisma.ticketActivity.findMany({
    where: { organizationId: actor.organizationId, ticketId: ticket.id },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    activity: rows.map((a) => ({
      id: a.id,
      type: a.type,
      actorName: a.actor?.name ?? 'System',
      fromValue: a.fromValue,
      toValue: a.toValue,
      note: a.note,
      createdAt: a.createdAt,
    })),
  };
};

// ---------- offboarding (members.offboarding.ts, teams.offboarding.ts) ----------

/**
 * README 8.4: when someone leaves (the org, or one team), their open tickets
 * become unassigned with a SYSTEM activity entry; the team is kept.
 * An IN_PROGRESS ticket goes back to OPEN because it no longer has a worker.
 */
export const unassignOpenTickets = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
  note: string,
  teamId?: string
) => {
  const tickets = await tx.ticket.findMany({
    where: { organizationId, assigneeId: membershipId, status: { in: OPEN_WORKLOAD }, ...(teamId ? { teamId } : {}) },
  });
  for (const t of tickets) {
    await setAssignee(tx, t, null, null, note);
    await demoteIfUnassignedInProgress(tx, t.id, null);
  }
  return tickets.length;
};
