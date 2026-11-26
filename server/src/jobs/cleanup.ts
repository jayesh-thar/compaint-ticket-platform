import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

/**
 * Daily housekeeping (architecture 11): expired / revoked sessions, expired or
 * used email tokens, and SENT notifications older than 90 days.
 * Nothing here is business data, and running it twice is harmless.
 */

const DAY = 24 * 60 * 60 * 1000;
export const KEEP_SENT_NOTIFICATIONS_DAYS = 90;
/** Keep used/revoked rows a little while so a recent "link already used" can still be explained. */
const GRACE_DAYS = 1;

export const runCleanup = async (now = new Date()) => {
  const grace = new Date(now.getTime() - GRACE_DAYS * DAY);
  const [sessions, tokens, notifications] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: grace } }] } }),
    prisma.emailToken.deleteMany({ where: { OR: [{ expiresAt: { lt: grace } }, { usedAt: { lt: grace } }] } }),
    prisma.notification.deleteMany({
      where: { status: 'SENT', sentAt: { lt: new Date(now.getTime() - KEEP_SENT_NOTIFICATIONS_DAYS * DAY) } },
    }),
  ]);
  const result = { sessions: sessions.count, emailTokens: tokens.count, notifications: notifications.count };
  logger.info(result, 'Cleanup finished');
  return result;
};
