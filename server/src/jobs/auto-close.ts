import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../shared/errors.js';
import { applyTransition } from '../modules/tickets/status-machine.js';
import { notifyStatusChange } from '../modules/notifications/outbox.js';

/**
 * README 7.8: tickets RESOLVED for 7 days without requester activity close
 * themselves (CLOSED / COMPLETED, actor = system, requester emailed).
 * Applies to internal tickets and sub-tickets too.
 *
 * One transaction PER ticket, through the normal status machine:
 * - the conditional update (WHERE status = 'RESOLVED') means a requester reply
 *   that reopens the ticket at the same moment simply wins; we skip it;
 * - a parent whose sub-tickets were reopened is skipped (OPEN_SUBTICKETS).
 * Safe to run twice: closed tickets no longer match.
 */

export const AUTO_CLOSE_AFTER_DAYS = 7;

export const autoCloseResolvedTickets = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.ticket.findMany({
    where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } },
    orderBy: { resolvedAt: 'asc' },
    take: 200,
  });

  let closed = 0;
  for (const ticket of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await applyTransition(tx, {
          ticket,
          to: 'CLOSED',
          kinds: ['SYSTEM'],
          actorUserId: null,
          closeReason: 'COMPLETED',
          note: `Closed automatically ${AUTO_CLOSE_AFTER_DAYS} days after being resolved`,
        });
        await notifyStatusChange(tx, ticket, 'CLOSED', null);
      });
      closed++;
    } catch (err) {
      // Lost a race (409) or waiting for sub-tickets (422): leave it for a person.
      if (err instanceof AppError) continue;
      logger.error({ err, ticketId: ticket.id }, 'Auto-close failed for a ticket');
    }
  }
  if (closed > 0) logger.info({ closed }, 'Auto-closed resolved tickets');
  return { checked: due.length, closed };
};
