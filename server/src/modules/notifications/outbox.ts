import type { NotificationType, Prisma, Ticket } from '@prisma/client';

/**
 * Outbox (architecture 11): ticket emails are saved as rows INSIDE the same
 * transaction as the change. If the change rolls back, so do its emails; if
 * the email provider is down, the change is still saved and the poller retries.
 *
 * Payload = ids only. The email is rendered later from current database state.
 */

type Tx = Prisma.TransactionClient;
type TicketLike = Pick<Ticket, 'id' | 'organizationId' | 'teamId' | 'assigneeId' | 'requesterId'>;

export interface NotificationPayload {
  ticketId: string;
  commentId?: string;
}

const enqueue = async (
  tx: Tx,
  organizationId: string,
  type: NotificationType,
  toEmails: string[],
  payload: NotificationPayload
) => {
  const unique = [...new Set(toEmails)];
  if (unique.length === 0) return 0;
  await tx.notification.createMany({
    data: unique.map((toEmail) => ({
      organizationId,
      toEmail,
      type,
      payload: payload as unknown as Prisma.InputJsonValue,
    })),
  });
  return unique.length;
};

/** Active members' emails, never including the person who caused the event. */
const emailsOf = (rows: { user: { id: string; email: string } }[], actorUserId: string | null) =>
  rows.filter((r) => r.user.id !== actorUserId).map((r) => r.user.email);

/**
 * README 9 "Needs assignment": the Leads of the ticket's team; if there is no
 * team, or the team has no Lead, the organization's Managers and Admins.
 */
export const triageRecipients = async (tx: Tx, ticket: TicketLike, actorUserId: string | null) => {
  if (ticket.teamId) {
    const leads = await tx.membership.findMany({
      where: {
        organizationId: ticket.organizationId,
        status: 'ACTIVE',
        teamMemberships: { some: { teamId: ticket.teamId, isLead: true } },
      },
      include: { user: { select: { id: true, email: true } } },
    });
    if (leads.length > 0) return emailsOf(leads, actorUserId);
  }
  const managers = await tx.membership.findMany({
    where: { organizationId: ticket.organizationId, status: 'ACTIVE', role: { in: ['ADMIN', 'MANAGER'] } },
    include: { user: { select: { id: true, email: true } } },
  });
  return emailsOf(managers, actorUserId);
};

const membershipEmail = async (tx: Tx, membershipId: string | null, actorUserId: string | null) => {
  if (!membershipId) return [];
  const m = await tx.membership.findFirst({
    where: { id: membershipId, status: 'ACTIVE' },
    include: { user: { select: { id: true, email: true } } },
  });
  return m ? emailsOf([m], actorUserId) : [];
};

const requesterEmail = async (tx: Tx, ticket: TicketLike, actorUserId: string | null) => {
  // Internal tickets (and sub-tickets) have no requester: never any requester email.
  if (!ticket.requesterId || ticket.requesterId === actorUserId) return [];
  const u = await tx.user.findUnique({ where: { id: ticket.requesterId }, select: { email: true } });
  return u ? [u.email] : [];
};

// ---------- events ----------

/** Created / moved without an assignee. */
export const notifyNeedsAssignment = async (tx: Tx, ticket: TicketLike, actorUserId: string | null) =>
  enqueue(tx, ticket.organizationId, 'NEEDS_ASSIGNMENT', await triageRecipients(tx, ticket, actorUserId), {
    ticketId: ticket.id,
  });

/** Assigned to someone other than the actor (including sub-tickets). */
export const notifyAssigned = async (tx: Tx, ticket: TicketLike, actorUserId: string | null) =>
  enqueue(tx, ticket.organizationId, 'ASSIGNED_TO_YOU', await membershipEmail(tx, ticket.assigneeId, actorUserId), {
    ticketId: ticket.id,
  });

/** Either "Assigned to you" or "Needs assignment", whichever applies now. */
export const notifyRouting = (tx: Tx, ticket: TicketLike, actorUserId: string | null) =>
  ticket.assigneeId ? notifyAssigned(tx, ticket, actorUserId) : notifyNeedsAssignment(tx, ticket, actorUserId);

export const notifyComplaintReceived = async (tx: Tx, ticket: TicketLike) =>
  enqueue(tx, ticket.organizationId, 'COMPLAINT_RECEIVED', await requesterEmail(tx, ticket, null), {
    ticketId: ticket.id,
  });

export const notifyStaffReplied = async (tx: Tx, ticket: TicketLike, commentId: string, actorUserId: string) =>
  enqueue(tx, ticket.organizationId, 'STAFF_REPLIED', await requesterEmail(tx, ticket, actorUserId), {
    ticketId: ticket.id,
    commentId,
  });

/** Requester wrote: the assignee; if unassigned, the team Leads / Managers. No content in the email. */
export const notifyRequesterReplied = async (tx: Tx, ticket: TicketLike, actorUserId: string) => {
  const to = ticket.assigneeId
    ? await membershipEmail(tx, ticket.assigneeId, actorUserId)
    : await triageRecipients(tx, ticket, actorUserId);
  return enqueue(tx, ticket.organizationId, 'REQUESTER_REPLIED', to, { ticketId: ticket.id });
};

/** Status emails to the requester: waiting on you, resolved, closed. */
export const notifyStatusChange = async (tx: Tx, ticket: TicketLike, to: string, actorUserId: string | null) => {
  const type: NotificationType | null =
    to === 'WAITING_ON_REQUESTER'
      ? 'WAITING_ON_YOU'
      : to === 'RESOLVED'
        ? 'RESOLVED'
        : to === 'CLOSED'
          ? 'CLOSED'
          : null;
  if (!type) return 0;
  return enqueue(tx, ticket.organizationId, type, await requesterEmail(tx, ticket, actorUserId), {
    ticketId: ticket.id,
  });
};
