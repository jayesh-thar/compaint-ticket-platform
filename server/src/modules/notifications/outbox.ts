import type { NotificationType, Prisma, Ticket } from '@prisma/client';

/**
 * Outbox: ticket emails are saved as rows INSIDE the same transaction as the
 * change. If the change rolls back, so do its emails; if the email provider is
 * down, the change is still saved and the poller retries.
 * Payload = ids only. The email is rendered later from current database state.
 */

type Tx = Prisma.TransactionClient;
type TicketLike = Pick<
  Ticket,
  'id' | 'organizationId' | 'teamId' | 'categoryId' | 'createdByMembershipId' | 'customerEmail' | 'kind'
>;

export interface NotificationPayload {
  ticketId: string;
}

const active = { status: 'ACTIVE' as const };
const withUser = { user: { select: { id: true, email: true } } };

const admins = (tx: Tx, orgId: string) =>
  tx.membership.findMany({ where: { organizationId: orgId, role: 'ADMIN', ...active }, include: withUser });

const teamLeader = (tx: Tx, t: TicketLike) =>
  t.teamId
    ? tx.membership.findMany({
        where: { ...active, teamMemberships: { some: { teamId: t.teamId, role: 'LEADER' } } },
        include: withUser,
      })
    : Promise.resolve([]);

const assignees = (tx: Tx, t: TicketLike) =>
  tx.membership.findMany({
    where: { ...active, assignments: { some: { ticketId: t.id, active: true } } },
    include: withUser,
  });

/** Who hears about each event (README 0.6). Never the person who caused it. */
const recipients = async (
  tx: Tx,
  t: TicketLike,
  type: NotificationType
): Promise<{ user: { id: string; email: string } }[]> => {
  switch (type) {
    case 'NEEDS_APPROVAL':
    case 'NEEDS_ADMIN_REVIEW':
      return admins(tx, t.organizationId);
    case 'AT_CATEGORY': {
      const c = t.categoryId
        ? await tx.category.findUnique({ where: { id: t.categoryId }, include: { lead: { include: withUser } } })
        : null;
      return c?.lead && c.lead.status === 'ACTIVE' ? [c.lead] : admins(tx, t.organizationId);
    }
    case 'AT_TEAM':
    case 'NEEDS_TEAM_REVIEW': {
      const l = await teamLeader(tx, t);
      return l.length > 0 ? l : admins(tx, t.organizationId);
    }
    case 'ASSIGNED_TO_YOU':
    case 'SENT_BACK':
      return assignees(tx, t);
    case 'TICKET_DONE': {
      const creator = t.createdByMembershipId
        ? await tx.membership.findMany({ where: { id: t.createdByMembershipId, ...active }, include: withUser })
        : [];
      return [...(await assignees(tx, t)), ...(await teamLeader(tx, t)), ...creator];
    }
    default:
      return [];
  }
};

export const notify = async (tx: Tx, t: TicketLike, type: NotificationType, actorUserId: string | null) => {
  let emails: string[];
  if (type === 'CUSTOMER_DONE' || type === 'CUSTOMER_REJECTED') {
    emails = t.kind === 'COMPLAINT' && t.customerEmail ? [t.customerEmail] : [];
  } else {
    emails = (await recipients(tx, t, type)).filter((r) => r.user.id !== actorUserId).map((r) => r.user.email);
  }
  const unique = [...new Set(emails)];
  if (unique.length === 0) return 0;
  await tx.notification.createMany({
    data: unique.map((toEmail) => ({
      organizationId: t.organizationId,
      toEmail,
      type,
      payload: { ticketId: t.id } satisfies NotificationPayload as unknown as Prisma.InputJsonValue,
    })),
  });
  return unique.length;
};
