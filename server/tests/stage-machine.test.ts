import { describe, it, expect } from 'vitest';
import type { TicketStage } from '@prisma/client';
import {
  ACTION_NAMES,
  ALL_STAGES,
  actorKindsFor,
  checkAction,
  fieldPowers,
  type ActionName,
  type ActorKind,
} from '../src/modules/tickets/stage-machine.js';
import type { Actor } from '../src/shared/permissions.js';

/**
 * README 0.6 typed again BY HAND, independently of the module, and compared for
 * every (action, stage, actor kind) combination: 13 x 9 x 5 = 585 checks.
 */
const LIVE: TicketStage[] = [
  'PENDING_APPROVAL',
  'AT_CATEGORY',
  'AT_TEAM',
  'ASSIGNED',
  'IN_PROGRESS',
  'TEAM_REVIEW',
  'ADMIN_REVIEW',
];
const EXPECTED: Record<ActionName, { from: TicketStage[]; who: ActorKind[] }> = {
  approve: { from: ['PENDING_APPROVAL'], who: ['ADMIN'] },
  route: { from: ['AT_CATEGORY'], who: ['ADMIN', 'CATEGORY_LEAD'] },
  assign: { from: ['AT_TEAM'], who: ['ADMIN', 'TEAM_LEADER'] },
  unassign: { from: ['ASSIGNED', 'IN_PROGRESS'], who: ['ADMIN', 'TEAM_LEADER'] },
  accept: { from: ['ASSIGNED'], who: ['ASSIGNEE'] },
  decline: { from: ['ASSIGNED'], who: ['ASSIGNEE'] },
  submit: { from: ['IN_PROGRESS'], who: ['ASSIGNEE'] },
  team_approve: { from: ['TEAM_REVIEW'], who: ['ADMIN', 'TEAM_LEADER'] },
  team_send_back: { from: ['TEAM_REVIEW'], who: ['ADMIN', 'TEAM_LEADER'] },
  final_approve: { from: ['ADMIN_REVIEW'], who: ['ADMIN'] },
  admin_send_back: { from: ['ADMIN_REVIEW'], who: ['ADMIN'] },
  reroute: { from: LIVE.filter((s) => s !== 'PENDING_APPROVAL'), who: ['ADMIN'] },
  reject: { from: LIVE, who: ['ADMIN', 'CREATOR'] },
};
const KINDS: ActorKind[] = ['ADMIN', 'CATEGORY_LEAD', 'TEAM_LEADER', 'ASSIGNEE', 'CREATOR'];

describe('Stage machine (README 0.6)', () => {
  it('matches the hand-written table for every action, stage and actor', () => {
    expect(ACTION_NAMES.sort()).toEqual((Object.keys(EXPECTED) as ActionName[]).sort());
    let checked = 0;
    for (const action of ACTION_NAMES) {
      for (const stage of ALL_STAGES) {
        for (const kind of KINDS) {
          const e = EXPECTED[action];
          const want = !e.from.includes(stage) ? 'wrong-stage' : e.who.includes(kind) ? 'ok' : 'not-allowed';
          expect(checkAction(action, stage, [kind]), `${action} / ${stage} / ${kind}`).toBe(want);
          checked++;
        }
      }
    }
    expect(checked).toBe(585);
  });

  it('DONE and REJECTED are final: no action and no field edits', () => {
    for (const stage of ['DONE', 'REJECTED'] as TicketStage[]) {
      for (const action of ACTION_NAMES) expect(checkAction(action, stage, KINDS)).toBe('wrong-stage');
      expect(Object.values(fieldPowers(stage, KINDS)).some(Boolean)).toBe(false);
    }
  });

  it('works out what someone is for a ticket; creator powers only on tasks', () => {
    const actor: Actor = {
      userId: 'u',
      organizationId: 'o',
      membershipId: 'm1',
      role: 'STAFF',
      teamIds: ['t1'],
      leadTeamIds: ['t1'],
      leadCategoryIds: ['c1'],
    };
    const base = {
      teamId: 't1',
      categoryId: 'c1',
      createdByMembershipId: 'm1',
      assignees: [{ membershipId: 'm1', active: true }],
    };
    expect(actorKindsFor(actor, { ...base, kind: 'TASK' })).toEqual([
      'CATEGORY_LEAD',
      'TEAM_LEADER',
      'ASSIGNEE',
      'CREATOR',
    ]);
    expect(actorKindsFor(actor, { ...base, kind: 'COMPLAINT' })).not.toContain('CREATOR');
    expect(
      actorKindsFor(actor, { ...base, kind: 'TASK', assignees: [{ membershipId: 'm1', active: false }] })
    ).not.toContain('ASSIGNEE');
    expect(
      actorKindsFor(
        { ...actor, role: 'ADMIN', leadTeamIds: [], leadCategoryIds: [] },
        { ...base, kind: 'TASK', createdByMembershipId: null, assignees: [] }
      )
    ).toEqual(['ADMIN']);
  });
});
