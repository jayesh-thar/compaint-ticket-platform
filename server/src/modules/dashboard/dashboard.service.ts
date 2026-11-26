import { prisma } from '../../config/prisma.js';
import type { Actor } from '../../shared/permissions.js';
import { buildTicketWhere, ticketFilterSchema, type TicketFilters } from '../../shared/ticket-filters.js';
import { OPEN_WORKLOAD } from '../../shared/visibility.js';

/**
 * Dashboard (planning Phase 9). Every number is computed from a QUERY STRING,
 * parsed by the same schema and built by the same `buildTicketWhere` as the
 * ticket list. The response carries that query string, so a card links to
 * exactly the list it counted - they cannot disagree.
 */

const RESOLVED_WINDOW_DAYS = 30;

/** Parse a list query string with the list's own schema (single source of truth). */
const filtersOf = (qs: string): TicketFilters => ticketFilterSchema.parse(Object.fromEntries(new URLSearchParams(qs)));

const metric = async (actor: Actor, qs: string, now: Date) => ({
  count: await prisma.ticket.count({ where: buildTicketWhere(actor, filtersOf(qs), now) }),
  query: qs,
});

export const getDashboard = async (actor: Actor, now = new Date()) => {
  const openWhere = buildTicketWhere(actor, filtersOf('open=true'), now);

  const [openWorkload, unassigned, overdue, waiting, resolved, myWork, byStatus, byPriority, byTeam, teams] =
    await Promise.all([
      metric(actor, 'open=true', now),
      metric(actor, 'open=true&unassigned=true', now),
      metric(actor, 'overdue=true', now),
      metric(actor, 'status=WAITING_ON_REQUESTER', now),
      metric(actor, `resolvedDays=${RESOLVED_WINDOW_DAYS}`, now),
      metric(actor, 'open=true&mine=true', now),
      prisma.ticket.groupBy({ by: ['status'], where: openWhere, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ['priority'], where: openWhere, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ['teamId'], where: openWhere, _count: { _all: true } }),
      prisma.team.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true } }),
    ]);

  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  return {
    metrics: { openWorkload, unassigned, overdue, waitingOnRequester: waiting, resolvedLast30Days: resolved, myWork },
    byStatus: OPEN_WORKLOAD.map((status) => ({
      status,
      count: byStatus.find((r) => r.status === status)?._count._all ?? 0,
      query: `status=${status}`,
    })),
    byPriority: (['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => ({
      priority,
      count: byPriority.find((r) => r.priority === priority)?._count._all ?? 0,
      query: `open=true&priority=${priority}`,
    })),
    byTeam: byTeam
      .map((r) => ({
        teamId: r.teamId,
        name: r.teamId ? (teamName.get(r.teamId) ?? 'Unknown team') : 'No team',
        count: r._count._all,
        query: `open=true&teamId=${r.teamId ?? 'none'}`,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
};
