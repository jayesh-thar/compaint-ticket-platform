import type { Notification } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import type { SendEmailOptions } from '../../shared/email.js';
import type { NotificationPayload } from './outbox.js';

/**
 * Builds the email for an outbox row from CURRENT database state.
 * Rules (README 9): never internal notes, never other tickets, links use
 * APP_ORIGIN, and every email says replies are not monitored.
 * Returns null when there is nothing sensible to send any more.
 */

const FOOTER = '\n\n--\nThis is an automatic message. Replies to this email are not monitored.';

const CLOSE_WORDS: Record<string, string> = {
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

export const renderNotification = async (n: Notification): Promise<Omit<SendEmailOptions, 'to'> | null> => {
  const payload = n.payload as unknown as NotificationPayload;
  const ticket = await prisma.ticket.findFirst({
    where: { id: payload.ticketId, organizationId: n.organizationId },
    include: { organization: { select: { name: true, slug: true } }, team: { select: { name: true } } },
  });
  if (!ticket) return null;

  const ref = `T-${ticket.number}`;
  const org = ticket.organization.name;
  const memberLink = `${env.APP_ORIGIN}/w/${ticket.organization.slug}/tickets/${ticket.number}`;
  const requesterLink = `${env.APP_ORIGIN}/my/complaints/${ticket.organization.slug}/${ticket.number}`;
  const team = ticket.team?.name ?? 'no team';

  switch (n.type) {
    case 'NEEDS_ASSIGNMENT':
      return {
        subject: `[${org}] ${ref} needs assignment: ${ticket.subject}`,
        text: `${ref} "${ticket.subject}" (${team}) has no assignee yet.\n\nOpen it to assign someone:\n${memberLink}${FOOTER}`,
      };
    case 'ASSIGNED_TO_YOU':
      return {
        subject: `[${org}] ${ref} was assigned to you: ${ticket.subject}`,
        text: `You are now the assignee of ${ref} "${ticket.subject}" (${team}).\n\n${memberLink}${FOOTER}`,
      };
    case 'REQUESTER_REPLIED':
      // No content on purpose: complaint text stays inside the app.
      return {
        subject: `[${org}] The requester replied on ${ref}`,
        text: `The requester added a reply to ${ref} "${ticket.subject}".\n\nRead it here:\n${memberLink}${FOOTER}`,
      };
    case 'COMPLAINT_RECEIVED':
      return {
        subject: `[${org}] We received your complaint ${ref}`,
        text: `Thank you. Your complaint "${ticket.subject}" was received by ${org}.\nYour reference is ${ref}.\n\nFollow it here:\n${requesterLink}${FOOTER}`,
      };
    case 'STAFF_REPLIED': {
      // Only a PUBLIC comment of THIS ticket can ever be quoted (filtered in the query).
      const comment = payload.commentId
        ? await prisma.comment.findFirst({
            where: {
              id: payload.commentId,
              ticketId: ticket.id,
              organizationId: n.organizationId,
              visibility: 'PUBLIC',
            },
          })
        : null;
      if (!comment) return null;
      return {
        subject: `[${org}] New reply on your complaint ${ref}`,
        text: `${org} replied to your complaint "${ticket.subject}":\n\n${comment.body}\n\nReply or follow it here:\n${requesterLink}${FOOTER}`,
      };
    }
    case 'WAITING_ON_YOU':
      return {
        subject: `[${org}] We need more information about ${ref}`,
        text: `${org} needs more information to continue with your complaint "${ticket.subject}".\n\nPlease reply here:\n${requesterLink}${FOOTER}`,
      };
    case 'RESOLVED':
      return {
        subject: `[${org}] Your complaint ${ref} was resolved`,
        text: `${org} marked your complaint "${ticket.subject}" as resolved.\n\nIf it is fixed, confirm it. If not, reply within 7 days and it will be reopened; otherwise it closes automatically.\n${requesterLink}${FOOTER}`,
      };
    case 'CLOSED':
      return {
        subject: `[${org}] Your complaint ${ref} was closed`,
        text: `Your complaint "${ticket.subject}" was closed (${CLOSE_WORDS[ticket.closeReason ?? 'COMPLETED']}).${
          ticket.closeReason === 'REJECTED' && ticket.closeNote ? `\nReason: ${ticket.closeNote}` : ''
        }\n\nIf you still need help, you can submit a new complaint.\n${requesterLink}${FOOTER}`,
      };
    default:
      return null;
  }
};
