import type { Prisma } from '@prisma/client';
import { unassignOpenTickets } from '../tickets/tickets.workflow.js';

/**
 * Removing someone from ONE team (README 8.4, last line).
 * Runs inside the caller's transaction.
 *
 * 1. Delete the TeamMember row.
 * 2. Unassign their open tickets of THAT team (system activity) - unless they
 *    are a Manager/Admin, who stay eligible for every team (README 7.5).
 */
export const removeFromTeam = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  teamId: string,
  membershipId: string
) => {
  const { count } = await tx.teamMember.deleteMany({ where: { organizationId, teamId, membershipId } });
  if (count === 0) return false;
  const membership = await tx.membership.findFirst({ where: { id: membershipId, organizationId } });
  if (membership?.role === 'STAFF') {
    await unassignOpenTickets(tx, organizationId, membershipId, 'Removed from the team', teamId);
  }
  return true;
};
