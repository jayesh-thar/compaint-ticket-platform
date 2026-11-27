import type { TicketKind, TicketStage } from '@prisma/client';
import type { Actor } from '../../shared/permissions.js';

/**
 * README 0.5 / 0.6 as data. Every stage change in the app goes through this
 * table, and `allowedActions` for the UI is computed from it, so buttons never
 * offer a move the server would refuse.
 */

export const LIVE_STAGES: TicketStage[] = [
  'PENDING_APPROVAL',
  'AT_CATEGORY',
  'AT_TEAM',
  'ASSIGNED',
  'IN_PROGRESS',
  'TEAM_REVIEW',
  'ADMIN_REVIEW',
];
export const FINAL_STAGES: TicketStage[] = ['DONE', 'REJECTED'];
export const ALL_STAGES: TicketStage[] = [...LIVE_STAGES, ...FINAL_STAGES];
export const isLive = (s: TicketStage) => LIVE_STAGES.includes(s);

/** What the caller is FOR this ticket (one person can be several). */
export type ActorKind = 'ADMIN' | 'CATEGORY_LEAD' | 'TEAM_LEADER' | 'ASSIGNEE' | 'CREATOR';

export type ActionName =
  | 'approve'
  | 'route'
  | 'assign'
  | 'unassign'
  | 'accept'
  | 'decline'
  | 'submit'
  | 'team_approve'
  | 'team_send_back'
  | 'final_approve'
  | 'admin_send_back'
  | 'reroute'
  | 'reject';

export interface Rule {
  from: TicketStage[];
  /** Possible results (decline keeps ASSIGNED while other group members remain). */
  to: TicketStage[];
  actors: ActorKind[];
  noteRequired?: boolean;
}

const NOT_PENDING_LIVE = LIVE_STAGES.filter((s) => s !== 'PENDING_APPROVAL');

export const RULES: Record<ActionName, Rule> = {
  approve: { from: ['PENDING_APPROVAL'], to: ['AT_CATEGORY', 'AT_TEAM'], actors: ['ADMIN'] },
  route: { from: ['AT_CATEGORY'], to: ['AT_TEAM'], actors: ['ADMIN', 'CATEGORY_LEAD'] },
  assign: { from: ['AT_TEAM'], to: ['ASSIGNED'], actors: ['ADMIN', 'TEAM_LEADER'] },
  unassign: { from: ['ASSIGNED', 'IN_PROGRESS'], to: ['AT_TEAM'], actors: ['ADMIN', 'TEAM_LEADER'] },
  accept: { from: ['ASSIGNED'], to: ['IN_PROGRESS'], actors: ['ASSIGNEE'] },
  decline: { from: ['ASSIGNED'], to: ['ASSIGNED', 'AT_TEAM'], actors: ['ASSIGNEE'], noteRequired: true },
  submit: { from: ['IN_PROGRESS'], to: ['TEAM_REVIEW'], actors: ['ASSIGNEE'] },
  team_approve: { from: ['TEAM_REVIEW'], to: ['ADMIN_REVIEW'], actors: ['ADMIN', 'TEAM_LEADER'] },
  team_send_back: { from: ['TEAM_REVIEW'], to: ['IN_PROGRESS'], actors: ['ADMIN', 'TEAM_LEADER'], noteRequired: true },
  final_approve: { from: ['ADMIN_REVIEW'], to: ['DONE'], actors: ['ADMIN'] },
  admin_send_back: { from: ['ADMIN_REVIEW'], to: ['IN_PROGRESS'], actors: ['ADMIN'], noteRequired: true },
  reroute: { from: NOT_PENDING_LIVE, to: ['AT_TEAM'], actors: ['ADMIN'] },
  reject: { from: LIVE_STAGES, to: ['REJECTED'], actors: ['ADMIN', 'CREATOR'], noteRequired: true },
};

export const ACTION_NAMES = Object.keys(RULES) as ActionName[];

export interface TicketForKinds {
  kind: TicketKind;
  teamId: string | null;
  categoryId: string | null;
  createdByMembershipId: string | null;
  assignees: { membershipId: string; active: boolean }[];
}

export const actorKindsFor = (actor: Actor, t: TicketForKinds): ActorKind[] => {
  const kinds: ActorKind[] = [];
  if (actor.role === 'ADMIN') kinds.push('ADMIN');
  if (t.categoryId && actor.leadCategoryIds.includes(t.categoryId)) kinds.push('CATEGORY_LEAD');
  if (t.teamId && actor.leadTeamIds.includes(t.teamId)) kinds.push('TEAM_LEADER');
  if (t.assignees.some((a) => a.active && a.membershipId === actor.membershipId)) kinds.push('ASSIGNEE');
  // Only tasks have a creator with powers; complaints come from customers.
  if (t.kind === 'TASK' && t.createdByMembershipId === actor.membershipId) kinds.push('CREATOR');
  return kinds;
};

/** 'ok' | 'wrong-stage' (409) | 'not-allowed' (403). */
export const checkAction = (action: ActionName, stage: TicketStage, kinds: ActorKind[]) => {
  const rule = RULES[action];
  if (!rule.from.includes(stage)) return 'wrong-stage' as const;
  if (!rule.actors.some((k) => kinds.includes(k))) return 'not-allowed' as const;
  return 'ok' as const;
};

export const allowedActionsFor = (stage: TicketStage, kinds: ActorKind[]) =>
  ACTION_NAMES.filter((a) => checkAction(a, stage, kinds) === 'ok');

/** Who may change fields / checklist / progress (README 0.4), only while live. */
export const fieldPowers = (stage: TicketStage, kinds: ActorKind[]) => {
  const live = isLive(stage);
  const has = (...k: ActorKind[]) => live && k.some((x) => kinds.includes(x));
  return {
    canEditText: has('ADMIN', 'CREATOR'),
    canEditPriorityDeadline: has('ADMIN', 'TEAM_LEADER', 'CREATOR'),
    canEditChecklist: has('ADMIN', 'TEAM_LEADER', 'CREATOR'),
    canTickChecklist: has('ADMIN', 'TEAM_LEADER', 'ASSIGNEE'),
    canUpdateProgress: (stage === 'IN_PROGRESS' || stage === 'ASSIGNED') && has('ASSIGNEE', 'TEAM_LEADER', 'ADMIN'),
  };
};

/** Plain words for every stage (tracking page, timeline, cards). */
export const STAGE_LABEL: Record<TicketStage, string> = {
  PENDING_APPROVAL: 'Waiting for Admin approval',
  AT_CATEGORY: 'Waiting for the Category Lead',
  AT_TEAM: 'Waiting for the team leader to assign',
  ASSIGNED: 'Assigned - waiting for accept',
  IN_PROGRESS: 'In progress',
  TEAM_REVIEW: 'Waiting for team leader review',
  ADMIN_REVIEW: 'Waiting for Admin final approval',
  DONE: 'Done',
  REJECTED: 'Rejected',
};
