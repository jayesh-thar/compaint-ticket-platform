import type { Prisma } from '@prisma/client';
import { unassignOpenTickets } from '../tickets/tickets.workflow.js';

/**
 * Everything that must happen when a member leaves an organization (README 8.4).
 * Runs inside the caller's transaction so it is all-or-nothing.
 *
 * 1. Soft-remove the membership (row kept, so history keeps their name).
 * 2. Remove them from every team of this organization.
 * 3. Unassign their open tickets with a system activity entry (team kept).
 */
export const offboardMembership = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string
) => {
  await tx.membership.update({
    where: { id: membershipId, organizationId },
    data: { status: 'REMOVED', removedAt: new Date() },
  });
  await tx.teamMember.deleteMany({ where: { organizationId, membershipId } });
  await unassignOpenTickets(tx, organizationId, membershipId, 'Member removed');
};
