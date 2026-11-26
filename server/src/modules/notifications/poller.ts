import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { emailTransport } from '../../shared/email.js';
import { renderNotification } from './templates.js';

/**
 * Email poller (architecture 11), run every 15 s by the job scheduler.
 *
 * 1. Rows stuck in SENDING for 10+ minutes (server died mid-send) go back to PENDING.
 * 2. Take up to 20 due PENDING rows; CLAIM each with a conditional update
 *    PENDING -> SENDING (if another run claimed it first, skip it).
 * 3. Render from current data, send, then SENT - or schedule a retry.
 *    3 failed attempts -> FAILED (logged). Delivery is "at least once".
 */

export const MAX_ATTEMPTS = 3;
/** Wait after the 1st and 2nd failure; the 3rd failure is final. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
export const STUCK_AFTER_MS = 10 * 60_000;
const BATCH = 20;

export const processOutboxOnce = async (now = new Date()) => {
  await prisma.notification.updateMany({
    where: { status: 'SENDING', claimedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { status: 'PENDING', claimedAt: null },
  });

  const due = await prisma.notification.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const claim = await prisma.notification.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'SENDING', claimedAt: now },
    });
    if (claim.count === 0) continue; // someone else has it

    try {
      const email = await renderNotification(row);
      if (!email) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: 'FAILED', lastError: 'Nothing to send (ticket or comment no longer applies).' },
        });
        continue;
      }
      await emailTransport.send({ to: row.toEmail, ...email });
      await prisma.notification.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await prisma.notification.update({
        where: { id: row.id },
        data: final
          ? { status: 'FAILED', attempts, lastError }
          : {
              status: 'PENDING',
              attempts,
              lastError,
              claimedAt: null,
              nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]),
            },
      });
      if (final) {
        failed++;
        // Ids only: never the address or content.
        logger.error({ notificationId: row.id, type: row.type }, 'Email notification failed permanently');
      }
    }
  }
  return { processed: due.length, sent, failed };
};
