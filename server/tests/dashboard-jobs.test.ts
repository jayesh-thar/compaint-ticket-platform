import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { autoCloseResolvedTickets } from '../src/jobs/auto-close.js';
import { runCleanup } from '../src/jobs/cleanup.js';
import { cleanDatabase } from './helpers/db.js';
import {
  createOrgWithAdmin,
  createMember,
  createTeam,
  createTicket,
  createUser,
  createSession,
} from './helpers/factories.js';

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

/** A realistic mix: two teams, all statuses, overdue, unassigned, resolved recently and long ago. */
const setup = async () => {
  const { org, admin } = await createOrgWithAdmin();
  const it = await createTeam(org.id, 'IT');
  const hostel = await createTeam(org.id, 'Hostel');
  const manager = await createMember(org.id, 'MANAGER');
  const lead = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id, isLead: true }] });
  const staff = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }] });
  const hostelStaff = await createMember(org.id, 'STAFF', { teams: [{ teamId: hostel.id }] });
  const requester = await createUser();
  const past = new Date(Date.UTC(2020, 0, 1));
  const mk = (data: Parameters<typeof createTicket>[1]) => createTicket(org.id, data);

  await mk({ teamId: it.id }); // open, unassigned
  await mk({ teamId: it.id, status: 'IN_PROGRESS', assigneeId: staff.membership.id, priority: 'URGENT' });
  await mk({ teamId: it.id, dueDate: past, priority: 'HIGH' }); // overdue
  await mk({ teamId: hostel.id, status: 'IN_PROGRESS', assigneeId: hostelStaff.membership.id });
  await mk({
    teamId: hostel.id,
    status: 'WAITING_ON_REQUESTER',
    source: 'PORTAL',
    requesterId: requester.id,
    assigneeId: hostelStaff.membership.id,
  });
  await mk({}); // no team
  await mk({ teamId: hostel.id, assigneeId: staff.membership.id }); // staff sees it as assignee
  await mk({ createdByMembershipId: hostelStaff.membership.id }); // hostel staff sees it as creator
  await mk({ teamId: it.id, status: 'RESOLVED', resolvedAt: new Date(Date.now() - 2 * DAY) });
  await mk({ teamId: it.id, status: 'RESOLVED', resolvedAt: new Date(Date.now() - 40 * DAY) }); // outside 30 days
  await mk({ teamId: it.id, status: 'CLOSED', resolvedAt: new Date(Date.now() - 5 * DAY) });
  await mk({ teamId: hostel.id, status: 'CLOSED', dueDate: past }); // closed: never overdue

  return { org, admin, it, hostel, manager, lead, staff, hostelStaff, requester };
};

describe('Dashboard and auto-close (Phase 9)', () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('for every role, each number equals the total of the list it links to', async () => {
    const s = await setup();
    for (const who of [s.admin, s.manager, s.lead, s.staff, s.hostelStaff]) {
      const dash = await request(app).get(`/api/v1/orgs/${s.org.slug}/dashboard`).set('Cookie', who.cookie);
      expect(dash.status).toBe(200);
      const cards = [
        ...Object.values(dash.body.metrics as Record<string, { count: number; query: string }>),
        ...dash.body.byStatus,
        ...dash.body.byPriority,
        ...dash.body.byTeam,
      ] as { count: number; query: string }[];
      for (const card of cards) {
        const list = await request(app)
          .get(`/api/v1/orgs/${s.org.slug}/tickets?${card.query}`)
          .set('Cookie', who.cookie);
        expect({ query: card.query, total: list.body.total }).toEqual({ query: card.query, total: card.count });
      }
    }
  });

  it('numbers match the metric definitions (Manager view)', async () => {
    const s = await setup();
    const { body } = await request(app).get(`/api/v1/orgs/${s.org.slug}/dashboard`).set('Cookie', s.manager.cookie);
    expect(body.metrics.openWorkload.count).toBe(8);
    expect(body.metrics.unassigned.count).toBe(4);
    expect(body.metrics.overdue.count).toBe(1);
    expect(body.metrics.waitingOnRequester.count).toBe(1);
    expect(body.metrics.resolvedLast30Days.count).toBe(2); // the recent RESOLVED + the CLOSED one resolved 5 days ago
    expect(body.metrics.myWork.count).toBe(0);
    expect(body.byTeam).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'IT', count: 3 }),
        expect.objectContaining({ name: 'Hostel', count: 3 }),
        expect.objectContaining({ name: 'No team', count: 2, query: 'open=true&teamId=none' }),
      ])
    );
    // Staff only count what they can see.
    const staff = await request(app).get(`/api/v1/orgs/${s.org.slug}/dashboard`).set('Cookie', s.staff.cookie);
    expect(staff.body.metrics.openWorkload.count).toBe(4); // 3 IT + 1 assigned in Hostel
    expect(staff.body.metrics.myWork.count).toBe(2);
  });

  it('no cross-organization leakage', async () => {
    const s = await setup();
    const other = await createOrgWithAdmin();
    const empty = await request(app).get(`/api/v1/orgs/${other.org.slug}/dashboard`).set('Cookie', other.admin.cookie);
    expect(empty.body.metrics.openWorkload.count).toBe(0);
    expect(empty.body.byTeam).toEqual([]);
    expect(
      (await request(app).get(`/api/v1/orgs/${s.org.slug}/dashboard`).set('Cookie', other.admin.cookie)).status
    ).toBe(404);
  });

  describe('auto-close', () => {
    it('closes only tickets resolved more than 7 days ago (internal, portal and sub-tickets) and emails requesters', async () => {
      const { org } = await createOrgWithAdmin();
      const requester = await createUser({ email: 'req@example.com' });
      const old = new Date(Date.now() - 8 * DAY);
      const parent = await createTicket(org.id, { status: 'RESOLVED', resolvedAt: old });
      const sub = await createTicket(org.id, { status: 'RESOLVED', resolvedAt: old, parentId: parent.id });
      const portal = await createTicket(org.id, {
        status: 'RESOLVED',
        resolvedAt: old,
        source: 'PORTAL',
        requesterId: requester.id,
      });
      const recent = await createTicket(org.id, { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 6 * DAY) });

      const result = await autoCloseResolvedTickets();
      expect(result.closed).toBe(3);
      const status = async (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
      for (const t of [parent, sub, portal])
        expect(await status(t.id)).toMatchObject({ status: 'CLOSED', closeReason: 'COMPLETED' });
      expect((await status(recent.id)).status).toBe('RESOLVED');

      const act = await prisma.ticketActivity.findFirstOrThrow({ where: { ticketId: portal.id } });
      expect(act).toMatchObject({ type: 'STATUS_CHANGED', actorUserId: null, toValue: 'CLOSED:COMPLETED' });
      expect(await prisma.notification.findMany({ where: { type: 'CLOSED' } })).toEqual([
        expect.objectContaining({ toEmail: 'req@example.com' }),
      ]);

      // Running again changes nothing.
      expect((await autoCloseResolvedTickets()).closed).toBe(0);
    });

    it('skips a resolved parent whose sub-ticket was reopened', async () => {
      const { org } = await createOrgWithAdmin();
      const parent = await createTicket(org.id, { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 8 * DAY) });
      await createTicket(org.id, { status: 'IN_PROGRESS', parentId: parent.id });
      expect((await autoCloseResolvedTickets()).closed).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe('RESOLVED');
    });

    it('race with a requester reply resolves cleanly: exactly one of them wins', async () => {
      const s = await setup();
      const { cookie } = await createSession(s.requester.id);
      for (let i = 0; i < 5; i++) {
        const t = await createTicket(s.org.id, {
          source: 'PORTAL',
          requesterId: s.requester.id,
          status: 'RESOLVED',
          resolvedAt: new Date(Date.now() - 8 * DAY),
          assigneeId: s.staff.membership.id,
          teamId: s.it.id,
        });
        const [reply] = await Promise.all([
          request(app)
            .post(`/api/v1/me/tickets/${s.org.slug}/${t.number}/comments`)
            .set('Cookie', cookie)
            .send({ body: 'Not fixed!' }),
          autoCloseResolvedTickets(),
        ]);
        const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
        if (reply.status === 201) expect(after.status).toBe('IN_PROGRESS');
        else {
          expect(reply.status).toBe(409);
          expect(after.status).toBe('CLOSED');
        }
        // Never both: one STATUS_CHANGED entry from RESOLVED.
        expect(await prisma.ticketActivity.count({ where: { ticketId: t.id, fromValue: 'RESOLVED' } })).toBe(1);
      }
    });
  });

  it('cleanup removes expired sessions and tokens and old sent notifications only', async () => {
    const { org, admin } = await createOrgWithAdmin();
    const now = new Date();
    await prisma.session.create({
      data: { userId: admin.user.id, tokenHash: 'expired', expiresAt: new Date(now.getTime() - DAY) },
    });
    await prisma.emailToken.create({
      data: {
        userId: admin.user.id,
        type: 'VERIFY_EMAIL',
        tokenHash: 'old',
        expiresAt: new Date(now.getTime() - 3 * DAY),
      },
    });
    await prisma.notification.createMany({
      data: [
        {
          organizationId: org.id,
          toEmail: 'a@x.com',
          type: 'CLOSED',
          payload: {},
          status: 'SENT',
          sentAt: new Date(now.getTime() - 91 * DAY),
        },
        {
          organizationId: org.id,
          toEmail: 'b@x.com',
          type: 'CLOSED',
          payload: {},
          status: 'SENT',
          sentAt: new Date(now.getTime() - 10 * DAY),
        },
        { organizationId: org.id, toEmail: 'c@x.com', type: 'CLOSED', payload: {}, status: 'FAILED' },
      ],
    });
    const result = await runCleanup(now);
    expect(result).toEqual({ sessions: 1, emailTokens: 1, notifications: 1 });
    expect(await prisma.session.count()).toBe(1); // the admin's live session stays
    expect(await prisma.notification.count()).toBe(2);
  });
});
