import type { Notification } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import type { SendEmailOptions } from '../../shared/email.js';
import type { NotificationPayload } from './outbox.js';

/**
 * Builds the email for an outbox row from CURRENT database state.
 * Staff emails link to the ticket; customer emails never contain staff names,
 * comments or links that grant access (the tracking link is only in the
 * confirmation email). Returns null when there is nothing sensible to send.
 */

const FOOTER = '\n\n--\nThis is an automatic message. Replies to this email are not monitored.';

export const renderNotification = async (n: Notification): Promise<Omit<SendEmailOptions, 'to'> | null> => {
  const payload = n.payload as unknown as NotificationPayload;
  const ticket = await prisma.ticket.findFirst({
    where: { id: payload.ticketId, organizationId: n.organizationId },
    include: { organization: { select: { name: true, slug: true } }, team: { select: { name: true } } },
  });
  if (!ticket) return null;

  const ref = `T-${ticket.number}`;
  const org = ticket.organization.name;
  const link = `${env.APP_ORIGIN}/w/${ticket.organization.slug}/tickets/${ticket.number}`;
  const team = ticket.team?.name ?? 'no team';
  const staff = (subject: string, line: string) => ({
    subject: `[${org}] ${ref} ${subject}: ${ticket.subject}`,
    text: `${line}\n\n${ref} "${ticket.subject}" (${team})\n${link}${FOOTER}`,
  });

  switch (n.type) {
    case 'NEEDS_APPROVAL':
      return staff('needs your approval', 'A new customer complaint is waiting for Admin approval.');
    case 'AT_CATEGORY':
      return staff('needs a team', 'Please choose which team of your category handles this ticket.');
    case 'AT_TEAM':
      return staff('needs assignment', 'This ticket arrived in your team. Please assign a member or a group.');
    case 'ASSIGNED_TO_YOU':
      return staff('was assigned to you', 'You were assigned to this ticket. Please accept it to start.');
    case 'NEEDS_TEAM_REVIEW':
      return staff('is ready for your review', 'The work was submitted. Please approve it or send it back.');
    case 'NEEDS_ADMIN_REVIEW':
      return staff('needs final approval', 'The team leader approved this work. It needs your final approval.');
    case 'SENT_BACK':
      return staff('was sent back', 'Your work was sent back with a note. Please open the ticket.');
    case 'TICKET_DONE':
      return staff('is done', 'The Admin gave final approval. The ticket moved to history.');
    case 'CUSTOMER_DONE':
      return {
        subject: `[${org}] Your complaint ${ref} is resolved`,
        text: `${org} has resolved your complaint "${ticket.subject}".\nYou can see the final status with the tracking link from your confirmation email.${FOOTER}`,
      };
    case 'CUSTOMER_REJECTED':
      return {
        subject: `[${org}] Your complaint ${ref} was not accepted`,
        text: `${org} could not accept your complaint "${ticket.subject}".${
          ticket.closeNote ? `\nReason: ${ticket.closeNote}` : ''
        }\n\nIf you still need help, you can submit a new complaint.${FOOTER}`,
      };
    default:
      return null;
  }
};
