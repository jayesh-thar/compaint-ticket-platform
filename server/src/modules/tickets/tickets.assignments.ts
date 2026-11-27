import type { Prisma } from '@prisma/client';
import { notify } from '../notifications/outbox.js';

/**
 * A person leaves a team or the organization: their live assignments end.
 * Tickets left with nobody go back to the team leader (AT_TEAM) with an
 * activity entry, so work is never stuck with someone who cannot open it.
 * Runs inside the caller's transaction.
 */
export const releaseAssignments = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
  actorUserId: string | null,
  teamId: string | null,
  reason: string
) => {
  const rows = await tx.ticketAssignee.findMany({
    where: {
      organizationId,
      membershipId,
      active: true,
      ticket: { stage: { in: ['ASSIGNED', 'IN_PROGRESS', 'TEAM_REVIEW'] }, ...(teamId ? { teamId } : {}) },
    },
    include: { ticket: true },
  });
  for (const row of rows) {
    await tx.ticketAssignee.update({ where: { id: row.id }, data: { active: false, removedAt: new Date() } });
    const left = await tx.ticketAssignee.count({ where: { ticketId: row.ticketId, active: true } });
    if (left === 0) {
      await tx.ticket.update({ where: { id: row.ticketId }, data: { stage: 'AT_TEAM', groupName: null } });
      await notify(tx, row.ticket, 'AT_TEAM', actorUserId);
    }
    await tx.ticketActivity.create({
      data: {
        organizationId,
        ticketId: row.ticketId,
        actorUserId,
        action: 'UNASSIGNED',
        fromValue: row.ticket.stage,
        toValue: left === 0 ? 'AT_TEAM' : row.ticket.stage,
        note: reason,
      },
    });
  }
  return rows.length;
};
