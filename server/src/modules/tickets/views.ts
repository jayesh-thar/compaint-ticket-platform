import type { Prisma } from '@prisma/client';
import type { Actor } from '../../shared/permissions.js';
import { LIVE_STAGES } from './stage-machine.js';

/**
 * Visibility (README 0.7) and named views. The list, the dashboard and the
 * graph all use these two builders, so a dashboard count always equals the
 * number of rows in the list it links to.
 */

export const visibilityWhere = (actor: Actor): Prisma.TicketWhereInput => {
  if (actor.role === 'ADMIN') return { organizationId: actor.organizationId };
  return {
    organizationId: actor.organizationId,
    OR: [
      { teamId: { in: actor.leadTeamIds } },
      { categoryId: { in: actor.leadCategoryIds }, stage: { not: 'PENDING_APPROVAL' } },
      { assignees: { some: { membershipId: actor.membershipId } } },
      { createdByMembershipId: actor.membershipId },
    ],
  };
};

/** Today at UTC midnight: due dates are calendar dates (@db.Date). */
export const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export const isOverdue = (t: { stage: string; dueDate: Date | null }) =>
  !!t.dueDate && LIVE_STAGES.includes(t.stage as never) && t.dueDate < todayUtc();

const live = { stage: { in: LIVE_STAGES } };
const overdue = () => ({ ...live, dueDate: { lt: todayUtc() } });
const inMyTeams = (a: Actor) => ({ teamId: { in: a.leadTeamIds } });
const mineActive = (a: Actor) => ({ assignees: { some: { membershipId: a.membershipId, active: true } } });

export const VIEWS = {
  all: () => ({}),
  live: () => live,
  history: () => ({ stage: { in: ['DONE', 'REJECTED'] } }),
  pending_approval: () => ({ stage: 'PENDING_APPROVAL' }),
  at_category: () => ({ stage: 'AT_CATEGORY' }),
  unassigned: () => ({ stage: 'AT_TEAM' }),
  overdue,
  admin_review: () => ({ stage: 'ADMIN_REVIEW' }),
  done_30d: () => ({ stage: 'DONE', finishedAt: { gte: daysAgo(30) } }),

  category_waiting: (a: Actor) => ({ stage: 'AT_CATEGORY', categoryId: { in: a.leadCategoryIds } }),

  team_new: (a: Actor) => ({ stage: 'AT_TEAM', ...inMyTeams(a) }),
  team_waiting_accept: (a: Actor) => ({ stage: 'ASSIGNED', ...inMyTeams(a) }),
  team_in_progress: (a: Actor) => ({ stage: 'IN_PROGRESS', ...inMyTeams(a) }),
  team_review: (a: Actor) => ({ stage: 'TEAM_REVIEW', ...inMyTeams(a) }),
  team_overdue: (a: Actor) => ({ ...overdue(), ...inMyTeams(a) }),
  team_done_30d: (a: Actor) => ({ stage: 'DONE', finishedAt: { gte: daysAgo(30) }, ...inMyTeams(a) }),

  my_requests: (a: Actor) => ({
    stage: 'ASSIGNED',
    assignees: { some: { membershipId: a.membershipId, active: true, acceptedAt: null } },
  }),
  my_in_progress: (a: Actor) => ({ stage: 'IN_PROGRESS', ...mineActive(a) }),
  my_review: (a: Actor) => ({ stage: { in: ['TEAM_REVIEW', 'ADMIN_REVIEW'] }, ...mineActive(a) }),
  my_overdue: (a: Actor) => ({ ...overdue(), ...mineActive(a) }),
  my_done: (a: Actor) => ({ stage: 'DONE', assignees: { some: { membershipId: a.membershipId } } }),
} satisfies Record<string, (a: Actor) => Prisma.TicketWhereInput>;

export type ViewName = keyof typeof VIEWS;
export const VIEW_NAMES = Object.keys(VIEWS) as ViewName[];

export const viewWhere = (actor: Actor, view: ViewName): Prisma.TicketWhereInput => ({
  AND: [visibilityWhere(actor), VIEWS[view](actor) as Prisma.TicketWhereInput],
});
