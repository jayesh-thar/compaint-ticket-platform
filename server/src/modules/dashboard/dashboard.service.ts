import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { canSeeGraph, isAdmin, type Actor } from '../../shared/permissions.js';
import { LIVE_STAGES } from '../tickets/stage-machine.js';
import { viewWhere, type ViewName } from '../tickets/views.js';

/**
 * README 0.9: one page, a section for each thing the caller is. Every card is
 * `count(visibility AND view)` - the same `where` the list uses for `?view=`.
 */

type Card = { view: ViewName; label: string };

const ADMIN: Card[] = [
  { view: 'pending_approval', label: 'Pending approval' },
  { view: 'live', label: 'Live tickets' },
  { view: 'at_category', label: 'At categories' },
  { view: 'unassigned', label: 'Unassigned in teams' },
  { view: 'overdue', label: 'Overdue' },
  { view: 'admin_review', label: 'Awaiting final approval' },
  { view: 'done_30d', label: 'Done (30 days)' },
];
const CATEGORY_LEAD: Card[] = [{ view: 'category_waiting', label: 'Waiting for a team choice' }];
const LEADER: Card[] = [
  { view: 'team_new', label: 'New to my team (assign)' },
  { view: 'team_waiting_accept', label: 'Waiting for accept' },
  { view: 'team_in_progress', label: 'In progress' },
  { view: 'team_review', label: 'Needs my review' },
  { view: 'team_overdue', label: 'Overdue' },
  { view: 'team_done_30d', label: 'Done (30 days)' },
];
const MEMBER: Card[] = [
  { view: 'my_requests', label: 'Requests to accept' },
  { view: 'my_in_progress', label: 'In progress' },
  { view: 'my_review', label: 'Submitted, in review' },
  { view: 'my_overdue', label: 'Overdue' },
  { view: 'my_done', label: 'Done' },
];

const countCards = (actor: Actor, cards: Card[]) =>
  Promise.all(
    cards.map(async (c) => ({ ...c, count: await prisma.ticket.count({ where: viewWhere(actor, c.view) }) }))
  );

export const getDashboard = async (actor: Actor) => {
  const sections: { key: string; title: string; cards: (Card & { count: number })[] }[] = [];
  if (isAdmin(actor)) sections.push({ key: 'admin', title: 'Organization', cards: await countCards(actor, ADMIN) });
  if (actor.leadCategoryIds.length > 0) {
    sections.push({ key: 'category', title: 'My categories', cards: await countCards(actor, CATEGORY_LEAD) });
  }
  if (actor.leadTeamIds.length > 0)
    sections.push({ key: 'leader', title: 'My team', cards: await countCards(actor, LEADER) });
  sections.push({ key: 'member', title: 'My work', cards: await countCards(actor, MEMBER) });

  // Member info: my teams, their category and how many teams the category has.
  const teams = await prisma.teamMember.findMany({
    where: { membershipId: actor.membershipId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          categories: {
            where: { archivedAt: null },
            select: { name: true, _count: { select: { teams: { where: { archivedAt: null } } } } },
          },
        },
      },
    },
  });
  return {
    sections,
    myTeams: teams.map((t) => ({
      id: t.team.id,
      name: t.team.name,
      teamRole: t.role,
      leaderTitle: t.leaderTitle,
      categories: t.team.categories.map((c) => ({ name: c.name, teamCount: c._count.teams })),
    })),
    canSeeGraph: canSeeGraph(actor),
  };
};

/**
 * README 0.10. Organization-wide COUNTS only (D-29): no subjects, no people.
 * Plain members get 403.
 */
export const getGraph = async (actor: Actor) => {
  if (!canSeeGraph(actor)) throw new AppError(403, 'FORBIDDEN', 'The flow graph is for Admins and leaders.');
  const orgId = actor.organizationId;
  const [byStageKind, byTeamStage, byCategoryStage, categories, teams] = await Promise.all([
    prisma.ticket.groupBy({ by: ['stage', 'kind'], where: { organizationId: orgId }, _count: true }),
    prisma.ticket.groupBy({
      by: ['teamId', 'stage'],
      where: { organizationId: orgId, teamId: { not: null }, stage: { in: LIVE_STAGES } },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ['categoryId'],
      where: { organizationId: orgId, stage: 'AT_CATEGORY' },
      _count: true,
    }),
    prisma.category.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, lead: { select: { user: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, categories: { where: { archivedAt: null }, select: { id: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const count = (pred: (r: (typeof byStageKind)[number]) => boolean) =>
    byStageKind.filter(pred).reduce((n, r) => n + r._count, 0);
  const liveKind = (kind: 'COMPLAINT' | 'TASK') => count((r) => r.kind === kind && LIVE_STAGES.includes(r.stage));

  const teamCounts = (teamId: string) => {
    const rows = byTeamStage.filter((r) => r.teamId === teamId);
    const sum = (stages: string[]) => rows.filter((r) => stages.includes(r.stage)).reduce((n, r) => n + r._count, 0);
    return {
      waiting: sum(['AT_TEAM']),
      working: sum(['ASSIGNED', 'IN_PROGRESS', 'TEAM_REVIEW']),
      live: sum(['AT_TEAM', 'ASSIGNED', 'IN_PROGRESS', 'TEAM_REVIEW']),
    };
  };

  return {
    graph: {
      complaints: { live: liveKind('COMPLAINT') },
      tasks: { live: liveKind('TASK') },
      approval: { waiting: count((r) => r.stage === 'PENDING_APPROVAL') },
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        leadLabel: c.lead ? `${c.name} - Lead: ${c.lead.user.name}` : `${c.name} - Lead: not set`,
        waiting: byCategoryStage.find((r) => r.categoryId === c.id)?._count ?? 0,
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        categoryIds: t.categories.map((c) => c.id),
        ...teamCounts(t.id),
      })),
      finalApproval: { waiting: count((r) => r.stage === 'ADMIN_REVIEW') },
      done: { total: count((r) => r.stage === 'DONE') },
      rejected: { total: count((r) => r.stage === 'REJECTED') },
      generatedAt: new Date().toISOString(),
    },
  };
};
