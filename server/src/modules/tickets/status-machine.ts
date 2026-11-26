import type { CloseReason, Prisma, Ticket, TicketStatus } from '@prisma/client';
import { AppError } from '../../shared/errors.js';
import { type Actor, isLeadOf, isManagerPlus } from '../../shared/permissions.js';

/**
 * README section 7.3 as DATA. Anything not listed here is rejected with
 * 409 INVALID_TRANSITION and nothing changes. Unit-tested exhaustively.
 *
 * Actors: ASSIGNEE, LEAD (of the ticket's team), MANAGER_PLUS (Manager/Admin),
 *         REQUESTER, SYSTEM (jobs and requester-reply side effects).
 */

export type ActorKind = 'ASSIGNEE' | 'LEAD' | 'MANAGER_PLUS' | 'REQUESTER' | 'SYSTEM';

export type Requirement =
  | 'HAS_ASSIGNEE' // e.g. IN_PROGRESS needs someone working on it
  | 'NO_ASSIGNEE' // reopen goes to OPEN only when nobody is assigned
  | 'HAS_REQUESTER' // WAITING_ON_REQUESTER only makes sense with a requester
  | 'SUBTICKETS_DONE' // parent waits for its sub-tickets
  | 'REASON_TEXT'; // CLOSED -> OPEN needs a reason

export interface Transition {
  from: TicketStatus[];
  to: TicketStatus;
  actors: ActorKind[];
  requires?: Requirement[];
  /** Only for `to: CLOSED`: which close reasons this path allows. */
  closeReasons?: CloseReason[];
}

const WORKING: ActorKind[] = ['ASSIGNEE', 'LEAD', 'MANAGER_PLUS'];

export const TRANSITIONS: Transition[] = [
  { from: ['OPEN'], to: 'IN_PROGRESS', actors: WORKING, requires: ['HAS_ASSIGNEE'] },
  { from: ['OPEN', 'IN_PROGRESS'], to: 'WAITING_ON_REQUESTER', actors: WORKING, requires: ['HAS_REQUESTER'] },
  { from: ['IN_PROGRESS'], to: 'OPEN', actors: WORKING },
  // Requester replies while waiting and nobody is assigned: the system puts it back in the queue.
  { from: ['WAITING_ON_REQUESTER'], to: 'OPEN', actors: [...WORKING, 'SYSTEM'] },
  { from: ['WAITING_ON_REQUESTER'], to: 'IN_PROGRESS', actors: [...WORKING, 'SYSTEM'], requires: ['HAS_ASSIGNEE'] },
  {
    from: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'],
    to: 'RESOLVED',
    actors: WORKING,
    requires: ['SUBTICKETS_DONE'],
  },
  // Reopen from RESOLVED: IN_PROGRESS if assigned, otherwise OPEN.
  { from: ['RESOLVED'], to: 'IN_PROGRESS', actors: [...WORKING, 'SYSTEM'], requires: ['HAS_ASSIGNEE'] },
  { from: ['RESOLVED'], to: 'OPEN', actors: [...WORKING, 'SYSTEM'], requires: ['NO_ASSIGNEE'] },
  {
    from: ['RESOLVED'],
    to: 'CLOSED',
    actors: ['LEAD', 'MANAGER_PLUS', 'REQUESTER', 'SYSTEM'],
    requires: ['SUBTICKETS_DONE'],
    closeReasons: ['COMPLETED'],
  },
  {
    from: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'],
    to: 'CLOSED',
    actors: ['LEAD', 'MANAGER_PLUS'],
    requires: ['SUBTICKETS_DONE'],
    closeReasons: ['COMPLETED', 'REJECTED', 'CANCELLED'],
  },
  // Requester withdraws: only while nobody has started (OPEN).
  { from: ['OPEN'], to: 'CLOSED', actors: ['REQUESTER'], requires: ['SUBTICKETS_DONE'], closeReasons: ['CANCELLED'] },
  { from: ['CLOSED'], to: 'OPEN', actors: ['MANAGER_PLUS'], requires: ['REASON_TEXT'] },
];

/** Paths from -> to (ignoring who). Empty = the move does not exist at all. */
export const pathsBetween = (from: TicketStatus, to: TicketStatus) =>
  TRANSITIONS.filter((t) => t.to === to && t.from.includes(from));

/** The path a given set of actor kinds may use, or undefined. */
export const findTransition = (from: TicketStatus, to: TicketStatus, kinds: ActorKind[], closeReason?: CloseReason) =>
  pathsBetween(from, to).find(
    (t) =>
      t.actors.some((a) => kinds.includes(a)) &&
      (!t.closeReasons || !closeReason || t.closeReasons.includes(closeReason))
  );

/** Which roles the member plays for THIS ticket. */
export const actorKindsFor = (actor: Actor, ticket: Pick<Ticket, 'teamId' | 'assigneeId'>): ActorKind[] => {
  const kinds: ActorKind[] = [];
  if (isManagerPlus(actor)) kinds.push('MANAGER_PLUS');
  if (isLeadOf(actor, ticket.teamId)) kinds.push('LEAD');
  if (ticket.assigneeId && ticket.assigneeId === actor.membershipId) kinds.push('ASSIGNEE');
  return kinds;
};

export interface TransitionFacts {
  assigneeId: string | null;
  requesterId: string | null;
  /** References of sub-tickets that are not RESOLVED/CLOSED. */
  openSubtickets: string[];
}

/** Requirements that are not met (cheap checks; no database). */
export const unmetRequirements = (t: Transition, facts: TransitionFacts, reasonText?: string | null): Requirement[] =>
  (t.requires ?? []).filter((r) => {
    switch (r) {
      case 'HAS_ASSIGNEE':
        return !facts.assigneeId;
      case 'NO_ASSIGNEE':
        return !!facts.assigneeId;
      case 'HAS_REQUESTER':
        return !facts.requesterId;
      case 'SUBTICKETS_DONE':
        return facts.openSubtickets.length > 0;
      case 'REASON_TEXT':
        return !reasonText?.trim();
    }
  });

/**
 * Status targets offered to a member in the UI (CLOSED is a separate "Close" dialog).
 * Sub-ticket completion is NOT pre-checked here, so "Resolve" stays visible and the
 * server answers with a clear OPEN_SUBTICKETS list.
 */
export const statusTargetsFor = (kinds: ActorKind[], current: TicketStatus, facts: TransitionFacts) => {
  const targets: TicketStatus[] = [];
  for (const to of ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED'] as TicketStatus[]) {
    const t = findTransition(current, to, kinds);
    if (!t) continue;
    const unmet = unmetRequirements(t, { ...facts, openSubtickets: [] }, 'x');
    if (unmet.length === 0) targets.push(to);
  }
  return targets;
};

export const closeReasonsFor = (kinds: ActorKind[], current: TicketStatus): CloseReason[] => {
  const reasons = new Set<CloseReason>();
  for (const t of pathsBetween(current, 'CLOSED')) {
    if (t.actors.some((a) => kinds.includes(a))) t.closeReasons?.forEach((r) => reasons.add(r));
  }
  return [...reasons];
};

const REQUIREMENT_ERRORS: Record<Requirement, (facts: TransitionFacts) => AppError> = {
  HAS_ASSIGNEE: () => new AppError(422, 'VALIDATION_ERROR', 'Assign someone before moving this ticket to In progress.'),
  NO_ASSIGNEE: () => new AppError(422, 'VALIDATION_ERROR', 'This ticket is assigned, so it reopens to In progress.'),
  HAS_REQUESTER: () =>
    new AppError(422, 'VALIDATION_ERROR', 'Only tickets with a requester can wait on the requester.'),
  SUBTICKETS_DONE: (f) =>
    new AppError(
      422,
      'OPEN_SUBTICKETS',
      `Finish the sub-tickets first: ${f.openSubtickets.join(', ')} ${f.openSubtickets.length === 1 ? 'is' : 'are'} still open.`,
      { subtickets: f.openSubtickets.join(', ') }
    ),
  REASON_TEXT: () =>
    new AppError(422, 'VALIDATION_ERROR', 'Give a reason for reopening.', { note: 'A reason is required.' }),
};

export interface ApplyTransitionInput {
  ticket: Ticket;
  to: TicketStatus;
  kinds: ActorKind[];
  /** null = system. Recorded as the activity actor. */
  actorUserId: string | null;
  closeReason?: CloseReason | null;
  note?: string | null;
}

/**
 * The ONE function that changes a ticket's status. Checks the table, the
 * actor, the preconditions, then updates with `WHERE status = <from>` so two
 * conflicting changes cannot both succeed (the loser gets 409). Must run
 * inside the caller's transaction (activity + outbox rows commit together).
 */
export const applyTransition = async (tx: Prisma.TransactionClient, input: ApplyTransitionInput) => {
  const { ticket, to, kinds } = input;
  const from = ticket.status;

  const paths = pathsBetween(from, to);
  if (paths.length === 0) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ticket cannot move from ${from} to ${to}.`);
  }
  const path = findTransition(from, to, kinds, input.closeReason ?? undefined);
  if (!path) {
    // The move exists, but not for this person (or not with this close reason).
    const wrongReason =
      to === 'CLOSED' && input.closeReason && paths.some((p) => p.actors.some((a) => kinds.includes(a)));
    if (wrongReason) {
      throw new AppError(422, 'VALIDATION_ERROR', `This ticket cannot be closed as ${input.closeReason} right now.`);
    }
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to make this status change.');
  }

  let closeReason: CloseReason | null = null;
  if (to === 'CLOSED') {
    closeReason = input.closeReason ?? (path.closeReasons?.length === 1 ? path.closeReasons[0] : null);
    if (!closeReason) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Choose a close reason.', { closeReason: 'Choose a close reason.' });
    }
    if (closeReason === 'REJECTED' && !input.note?.trim()) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Rejecting needs a note (spam, invalid, duplicate...).', {
        note: 'A note is required when rejecting.',
      });
    }
  }

  const openSubtickets = (path.requires ?? []).includes('SUBTICKETS_DONE')
    ? (
        await tx.ticket.findMany({
          where: {
            organizationId: ticket.organizationId,
            parentId: ticket.id,
            status: { notIn: ['RESOLVED', 'CLOSED'] },
          },
          select: { number: true },
          orderBy: { number: 'asc' },
        })
      ).map((s) => `T-${s.number}`)
    : [];
  const facts: TransitionFacts = { assigneeId: ticket.assigneeId, requesterId: ticket.requesterId, openSubtickets };
  const unmet = unmetRequirements(path, facts, input.note);
  if (unmet.length > 0) throw REQUIREMENT_ERRORS[unmet[0]](facts);

  const now = new Date();
  const data: Prisma.TicketUpdateManyMutationInput = { status: to };
  if (to === 'RESOLVED') data.resolvedAt = now;
  if (to === 'CLOSED') Object.assign(data, { closedAt: now, closeReason, closeNote: input.note?.trim() || null });
  if (from === 'RESOLVED' && to !== 'CLOSED') data.resolvedAt = null; // reopened
  if (from === 'CLOSED') Object.assign(data, { closedAt: null, closeReason: null, closeNote: null, resolvedAt: null });

  // Conditional update: only applies if nobody changed the status meanwhile.
  const { count } = await tx.ticket.updateMany({
    where: { id: ticket.id, organizationId: ticket.organizationId, status: from },
    data,
  });
  if (count === 0) {
    throw new AppError(409, 'INVALID_TRANSITION', 'This ticket was changed by someone else. Reload and try again.');
  }

  await tx.ticketActivity.create({
    data: {
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      actorUserId: input.actorUserId,
      type: 'STATUS_CHANGED',
      fromValue: from,
      toValue: closeReason ? `${to}:${closeReason}` : to,
      note: input.note?.trim() || null,
    },
  });

  return { from, to, closeReason };
};
