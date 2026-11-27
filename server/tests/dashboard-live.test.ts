import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { cleanDatabase } from './helpers/db.js';
import { buildWorld, as, complaint, type World } from './helpers/world.js';

const app = createApp();
let w: World;
const api = (who: { cookie: string }) => as(app, w.org.slug, who.cookie);
const act = (who: { cookie: string }, n: number, action: string, body: object = {}) =>
  api(who).post(`/tickets/${n}/actions/${action}`, body);

describe('Dashboards, flow graph, live events (README 0.9, 0.10)', () => {
  beforeAll(async () => {
    await cleanDatabase();
    vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
    w = await buildWorld();
    // A spread of tickets over many stages.
    await complaint(app, w.org.slug); // T-1 pending approval
    await complaint(app, w.org.slug, { categoryId: w.category.id }); // T-2 -> at category
    await act(w.admin, 2, 'approve', { categoryId: w.category.id });
    for (let i = 0; i < 4; i++) {
      await api(w.admin).post('/tickets', {
        subject: `Task ${i}`,
        description: 'Some work to do',
        teamId: w.team1.id,
        dueDate: '2020-01-01',
      });
    }
    await act(w.lead1, 4, 'assign', { membershipIds: [w.m1.membership.id] }); // T-4 assigned
    await act(w.lead1, 5, 'assign', { membershipIds: [w.m1.membership.id] });
    await act(w.m1, 5, 'accept'); // T-5 in progress
    await act(w.lead1, 6, 'assign', { membershipIds: [w.m1.membership.id] });
    await act(w.m1, 6, 'accept');
    await act(w.m1, 6, 'submit');
    await act(w.lead1, 6, 'team_approve');
    await act(w.admin, 6, 'final_approve'); // T-6 done
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('every card equals the total of the list it links to, for every role', async () => {
    for (const who of [w.admin, w.catLead, w.lead1, w.m1, w.m3, w.outsider]) {
      const dash = (await api(who).get('/dashboard')).body;
      for (const section of dash.sections) {
        for (const card of section.cards) {
          const list = await api(who).get(`/tickets?view=${card.view}&pageSize=100`);
          expect(list.body.total, `${section.key}/${card.view}`).toBe(card.count);
        }
      }
    }
  });

  it('sections follow what you are, with the expected numbers', async () => {
    const counts = async (who: { cookie: string }) => {
      const d = (await api(who).get('/dashboard')).body;
      return Object.fromEntries(
        d.sections.flatMap((s: { key: string; cards: { view: string; count: number }[] }) =>
          s.cards.map((c) => [`${s.key}.${c.view}`, c.count])
        )
      );
    };
    expect(await counts(w.admin)).toMatchObject({
      'admin.pending_approval': 1,
      'admin.at_category': 1,
      'admin.unassigned': 1,
      'admin.live': 5,
      'admin.overdue': 3,
      'admin.done_30d': 1,
    });
    expect(await counts(w.catLead)).toMatchObject({ 'category.category_waiting': 1 });
    expect(await counts(w.lead1)).toMatchObject({
      'leader.team_new': 1,
      'leader.team_waiting_accept': 1,
      'leader.team_in_progress': 1,
      'leader.team_done_30d': 1,
    });
    const m1 = await counts(w.m1);
    expect(m1).toMatchObject({
      'member.my_requests': 1,
      'member.my_in_progress': 1,
      'member.my_done': 1,
      'member.my_overdue': 2,
    });
    expect(Object.keys(m1).some((k) => k.startsWith('admin') || k.startsWith('leader'))).toBe(false);
    const memberDash = (await api(w.m1).get('/dashboard')).body;
    expect(memberDash.myTeams[0]).toMatchObject({
      name: 'Server team 01',
      categories: [{ name: 'Server issue', teamCount: 2 }],
    });
    expect(memberDash.canSeeGraph).toBe(false);
  });

  it('flow graph: counts for Admin and leaders, 403 for plain members', async () => {
    expect((await api(w.m1).get('/graph')).status).toBe(403);
    const g = (await api(w.lead2).get('/graph')).body.graph;
    expect(g).toMatchObject({
      approval: { waiting: 1 },
      complaints: { live: 2 },
      tasks: { live: 3 },
      done: { total: 1 },
    });
    expect(g.categories[0]).toMatchObject({
      name: 'Server issue',
      waiting: 1,
      leadLabel: 'Server issue - Lead: Cat Lead',
    });
    expect(g.teams.find((t: { id: string }) => t.id === w.team1.id)).toMatchObject({ waiting: 1, working: 2, live: 3 });
    expect(JSON.stringify(g)).not.toContain('Task 0'); // counts only, no ticket content
  });

  it('SSE: members receive a change event when a ticket moves; non-members get 404', async () => {
    const server: Server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/api/v1/orgs/${w.org.slug}/events`;
    try {
      const other = await buildWorld('other-org');
      expect((await fetch(url, { headers: { Cookie: other.admin.cookie } })).status).toBe(404);

      const ctrl = new AbortController();
      const res = await fetch(url, { headers: { Cookie: w.m1.cookie }, signal: ctrl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      await reader.read(); // "retry:" line
      await act(w.lead1, 3, 'assign', { membershipIds: [w.m2.membership.id] });
      let text = '';
      while (!text.includes('event: change')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain('"kind":"tickets"');
      ctrl.abort();
    } finally {
      server.close();
    }
  });
});
