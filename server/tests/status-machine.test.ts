import { describe, it, expect } from 'vitest';
import type { TicketStatus } from '@prisma/client';
import {
  type ActorKind,
  findTransition,
  pathsBetween,
  statusTargetsFor,
  closeReasonsFor,
  unmetRequirements,
} from '../src/modules/tickets/status-machine.js';

const S: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'];
const A: ActorKind[] = ['ASSIGNEE', 'LEAD', 'MANAGER_PLUS', 'REQUESTER', 'SYSTEM'];

/**
 * README 7.3 written out independently, one line per allowed (from, to, actor).
 * The test compares the module against this for EVERY combination, so a typo
 * in either place fails loudly.
 */
const W = 'ASSIGNEE LEAD MANAGER_PLUS';
const EXPECTED = `
OPEN IN_PROGRESS ${W}
OPEN WAITING_ON_REQUESTER ${W}
IN_PROGRESS WAITING_ON_REQUESTER ${W}
IN_PROGRESS OPEN ${W}
WAITING_ON_REQUESTER OPEN ${W} SYSTEM
WAITING_ON_REQUESTER IN_PROGRESS ${W} SYSTEM
OPEN RESOLVED ${W}
IN_PROGRESS RESOLVED ${W}
WAITING_ON_REQUESTER RESOLVED ${W}
RESOLVED IN_PROGRESS ${W} SYSTEM
RESOLVED OPEN ${W} SYSTEM
RESOLVED CLOSED LEAD MANAGER_PLUS REQUESTER SYSTEM
OPEN CLOSED LEAD MANAGER_PLUS REQUESTER
IN_PROGRESS CLOSED LEAD MANAGER_PLUS
WAITING_ON_REQUESTER CLOSED LEAD MANAGER_PLUS
CLOSED OPEN MANAGER_PLUS
`;

const allowed = new Set<string>();
for (const line of EXPECTED.trim().split('\n')) {
  const [from, to, ...actors] = line.trim().split(/\s+/);
  for (const a of actors) allowed.add(`${from}>${to}>${a}`);
}

describe('status machine (README 7.3)', () => {
  it('matches the expected table for every from / to / actor combination', () => {
    const mismatches: string[] = [];
    for (const from of S)
      for (const to of S)
        for (const a of A) {
          const got = !!findTransition(from, to, [a]);
          const want = allowed.has(`${from}>${to}>${a}`);
          if (got !== want) mismatches.push(`${from} -> ${to} by ${a}: expected ${want}, got ${got}`);
        }
    expect(mismatches).toEqual([]);
  });

  it('no transition from a status to itself', () => {
    for (const s of S) expect(pathsBetween(s, s)).toEqual([]);
  });

  it('close reasons: RESOLVED -> CLOSED is COMPLETED only; requester withdraw is CANCELLED only', () => {
    expect(findTransition('RESOLVED', 'CLOSED', ['MANAGER_PLUS'], 'REJECTED')).toBeUndefined();
    expect(findTransition('RESOLVED', 'CLOSED', ['MANAGER_PLUS'], 'COMPLETED')).toBeDefined();
    expect(findTransition('OPEN', 'CLOSED', ['REQUESTER'], 'COMPLETED')).toBeUndefined();
    expect(findTransition('OPEN', 'CLOSED', ['REQUESTER'], 'CANCELLED')).toBeDefined();
    expect(findTransition('IN_PROGRESS', 'CLOSED', ['LEAD'], 'REJECTED')).toBeDefined();
    expect(closeReasonsFor(['LEAD'], 'OPEN').sort()).toEqual(['CANCELLED', 'COMPLETED', 'REJECTED']);
    expect(closeReasonsFor(['ASSIGNEE'], 'OPEN')).toEqual([]);
    expect(closeReasonsFor(['MANAGER_PLUS'], 'RESOLVED')).toEqual(['COMPLETED']);
  });

  it('preconditions: assignee, requester, sub-tickets, reopen reason', () => {
    const none = { assigneeId: null, requesterId: null, openSubtickets: [] };
    expect(unmetRequirements(findTransition('OPEN', 'IN_PROGRESS', ['LEAD'])!, none)).toEqual(['HAS_ASSIGNEE']);
    expect(unmetRequirements(findTransition('OPEN', 'WAITING_ON_REQUESTER', ['LEAD'])!, none)).toEqual([
      'HAS_REQUESTER',
    ]);
    expect(
      unmetRequirements(findTransition('OPEN', 'RESOLVED', ['LEAD'])!, { ...none, openSubtickets: ['T-2'] })
    ).toEqual(['SUBTICKETS_DONE']);
    expect(unmetRequirements(findTransition('CLOSED', 'OPEN', ['MANAGER_PLUS'])!, none, '  ')).toEqual(['REASON_TEXT']);
    // Reopen from RESOLVED: OPEN only when unassigned, IN_PROGRESS only when assigned.
    expect(unmetRequirements(findTransition('RESOLVED', 'OPEN', ['LEAD'])!, { ...none, assigneeId: 'm1' })).toEqual([
      'NO_ASSIGNEE',
    ]);
    expect(unmetRequirements(findTransition('RESOLVED', 'IN_PROGRESS', ['LEAD'])!, none)).toEqual(['HAS_ASSIGNEE']);
  });

  it('statusTargetsFor offers only moves the actor can make now', () => {
    const assigned = { assigneeId: 'm1', requesterId: null, openSubtickets: [] };
    expect(statusTargetsFor(['ASSIGNEE'], 'OPEN', assigned)).toEqual(['IN_PROGRESS', 'RESOLVED']);
    expect(statusTargetsFor(['ASSIGNEE'], 'OPEN', { ...assigned, requesterId: 'u1' })).toEqual([
      'IN_PROGRESS',
      'WAITING_ON_REQUESTER',
      'RESOLVED',
    ]);
    expect(statusTargetsFor(['LEAD'], 'RESOLVED', assigned)).toEqual(['IN_PROGRESS']);
    expect(statusTargetsFor(['LEAD'], 'RESOLVED', { ...assigned, assigneeId: null })).toEqual(['OPEN']);
    expect(statusTargetsFor([], 'OPEN', assigned)).toEqual([]);
  });
});
