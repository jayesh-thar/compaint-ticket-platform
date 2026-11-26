import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { createOrgWithAdmin, createMember, createTeam, createTicket, createUser } from './helpers/factories.js';
import { applyTransition } from '../src/modules/tickets/status-machine.js';

const app = createApp();

const setup = async () => {
  const { org, admin } = await createOrgWithAdmin();
  const it = await createTeam(org.id, 'IT');
  const hostel = await createTeam(org.id, 'Hostel');
  const manager = await createMember(org.id, 'MANAGER', { name: 'Maya Manager' });
  const lead = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id, isLead: true }], name: 'Lee Lead' });
  const staff = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }], name: 'Sam Staff' });
  const staff2 = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }], name: 'Sue Staff' });
  const hostelStaff = await createMember(org.id, 'STAFF', { teams: [{ teamId: hostel.id }], name: 'Hal Hostel' });
  const base = `/api/v1/orgs/${org.slug}/tickets`;
  const status = (cookie: string, n: number, body: Record<string, unknown>) =>
    request(app).post(`${base}/${n}/status`).set('Cookie', cookie).send(body);
  const assign = (cookie: string, n: number, assigneeId: string | null) =>
    request(app).post(`${base}/${n}/assignment`).set('Cookie', cookie).send({ assigneeId });
  return { org, admin, it, hostel, manager, lead, staff, staff2, hostelStaff, base, status, assign };
};

describe('Workflow: status, assignment, sub-tickets (Phase 6)', () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('status changes', () => {
    it('assignee works the ticket OPEN -> IN_PROGRESS -> RESOLVED; Lead closes; activity records each step', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.staff.membership.id });

      expect((await s.status(s.staff.cookie, t.number, { status: 'IN_PROGRESS' })).status).toBe(200);
      const resolved = await s.status(s.staff.cookie, t.number, { status: 'RESOLVED' });
      expect(resolved.body.ticket).toMatchObject({ status: 'RESOLVED' });
      expect(resolved.body.ticket.resolvedAt).not.toBeNull();

      // Staff (even the assignee) cannot close; the Lead can.
      expect((await s.status(s.staff.cookie, t.number, { status: 'CLOSED' })).status).toBe(403);
      const closed = await s.status(s.lead.cookie, t.number, { status: 'CLOSED' });
      expect(closed.body.ticket).toMatchObject({ status: 'CLOSED', closeReason: 'COMPLETED' });

      const activity = await request(app).get(`${s.base}/${t.number}/activity`).set('Cookie', s.manager.cookie);
      const changes = activity.body.activity.filter((a: { type: string }) => a.type === 'STATUS_CHANGED');
      expect(
        changes.map((a: { fromValue: string; toValue: string; actorName: string }) => [
          a.fromValue,
          a.toValue,
          a.actorName,
        ])
      ).toEqual([
        ['OPEN', 'IN_PROGRESS', 'Sam Staff'],
        ['IN_PROGRESS', 'RESOLVED', 'Sam Staff'],
        ['RESOLVED', 'CLOSED:COMPLETED', 'Lee Lead'],
      ]);
    });

    it('rejects invalid and unauthorized transitions and leaves the ticket unchanged', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      const check = async () => (await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status;

      // No such move at all.
      const r1 = await s.status(s.manager.cookie, t.number, { status: 'OPEN' });
      expect(r1.status).toBe(409);
      expect(r1.body.error.code).toBe('INVALID_TRANSITION');
      // Needs an assignee.
      expect((await s.status(s.manager.cookie, t.number, { status: 'IN_PROGRESS' })).status).toBe(422);
      // Internal ticket: no requester to wait on.
      expect((await s.status(s.manager.cookie, t.number, { status: 'WAITING_ON_REQUESTER' })).status).toBe(422);
      // Staff who is not the assignee.
      expect((await s.status(s.staff.cookie, t.number, { status: 'RESOLVED' })).status).toBe(403);
      // Reject without a note.
      const reject = await s.status(s.lead.cookie, t.number, { status: 'CLOSED', closeReason: 'REJECTED' });
      expect(reject.status).toBe(422);
      expect(reject.body.error.fields.note).toBeDefined();
      // Close without a reason when several are possible.
      expect((await s.status(s.lead.cookie, t.number, { status: 'CLOSED' })).status).toBe(422);
      // Unknown status value.
      expect((await s.status(s.lead.cookie, t.number, { status: 'NEW' })).status).toBe(400);
      expect(await check()).toBe('OPEN');
      expect(await prisma.ticketActivity.count({ where: { ticketId: t.id } })).toBe(0);
    });

    it('reject with a note; reopen CLOSED -> OPEN needs Admin/Manager and a reason', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      const rejected = await s.status(s.lead.cookie, t.number, {
        status: 'CLOSED',
        closeReason: 'REJECTED',
        note: 'Duplicate of T-1',
      });
      expect(rejected.body.ticket).toMatchObject({
        status: 'CLOSED',
        closeReason: 'REJECTED',
        closeNote: 'Duplicate of T-1',
      });

      expect((await s.status(s.lead.cookie, t.number, { status: 'OPEN', note: 'oops' })).status).toBe(403);
      expect((await s.status(s.manager.cookie, t.number, { status: 'OPEN' })).status).toBe(422);
      const reopened = await s.status(s.manager.cookie, t.number, {
        status: 'OPEN',
        note: 'Not a duplicate after all',
      });
      expect(reopened.body.ticket).toMatchObject({
        status: 'OPEN',
        closeReason: null,
        closeNote: null,
        closedAt: null,
      });
    });

    it('two people making the same change at once: one wins, the other gets 409', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.staff.membership.id });
      const [a, b] = await Promise.all([
        s.status(s.manager.cookie, t.number, { status: 'IN_PROGRESS' }),
        s.status(s.lead.cookie, t.number, { status: 'IN_PROGRESS' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await prisma.ticketActivity.count({ where: { ticketId: t.id, type: 'STATUS_CHANGED' } })).toBe(1);
    });

    it('a change based on a stale status is refused by the conditional update (409, nothing written)', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.staff.membership.id });
      const stale = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }); // status OPEN
      // Someone else moves it first.
      await prisma.ticket.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });

      await expect(
        prisma.$transaction((tx) =>
          applyTransition(tx, {
            ticket: stale,
            to: 'RESOLVED',
            kinds: ['MANAGER_PLUS'],
            actorUserId: s.manager.user.id,
          })
        )
      ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('IN_PROGRESS');
      expect(await prisma.ticketActivity.count({ where: { ticketId: t.id } })).toBe(0);
    });

    it('reopen from RESOLVED goes to IN_PROGRESS when assigned, OPEN when not', async () => {
      const s = await setup();
      const assigned = await createTicket(s.org.id, {
        teamId: s.it.id,
        status: 'RESOLVED',
        assigneeId: s.staff.membership.id,
      });
      const unassigned = await createTicket(s.org.id, { teamId: s.it.id, status: 'RESOLVED' });
      expect((await s.status(s.lead.cookie, assigned.number, { status: 'OPEN' })).status).toBe(422);
      expect(
        (await s.status(s.lead.cookie, assigned.number, { status: 'IN_PROGRESS' })).body.ticket.resolvedAt
      ).toBeNull();
      expect((await s.status(s.lead.cookie, unassigned.number, { status: 'OPEN' })).status).toBe(200);
    });

    it('detail exposes status moves from the machine', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.staff.membership.id });
      const actions = async (cookie: string) =>
        (await request(app).get(`${s.base}/${t.number}`).set('Cookie', cookie)).body.ticket.allowedActions;
      expect(await actions(s.staff.cookie)).toMatchObject({
        statusTargets: ['IN_PROGRESS', 'RESOLVED'],
        canClose: false,
      });
      expect(await actions(s.lead.cookie)).toMatchObject({
        canClose: true,
        closeReasons: expect.arrayContaining(['REJECTED']),
      });
      expect(await actions(s.staff2.cookie)).toMatchObject({ statusTargets: [], canClose: false });
    });
  });

  describe('assignment', () => {
    it('Lead assigns within the team; Staff can only take an unassigned ticket; Manager can assign anyone eligible', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });

      // Staff takes it.
      const took = await s.assign(s.staff.cookie, t.number, s.staff.membership.id);
      expect(took.body.ticket.assignee).toMatchObject({ membershipId: s.staff.membership.id });
      // Staff2 cannot steal it or hand it to someone.
      expect((await s.assign(s.staff2.cookie, t.number, s.staff2.membership.id)).status).toBe(403);
      expect((await s.assign(s.staff.cookie, t.number, null)).status).toBe(403);
      // Lead reassigns within the team; not to the Manager or another team's staff.
      expect((await s.assign(s.lead.cookie, t.number, s.staff2.membership.id)).status).toBe(200);
      expect((await s.assign(s.lead.cookie, t.number, s.manager.membership.id)).status).toBe(403);
      const outsider = await s.assign(s.manager.cookie, t.number, s.hostelStaff.membership.id);
      expect(outsider.status).toBe(422);
      expect(outsider.body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
      // Manager can assign a Manager (eligible for any team) and unassign.
      expect((await s.assign(s.manager.cookie, t.number, s.manager.membership.id)).status).toBe(200);
      expect((await s.assign(s.manager.cookie, t.number, null)).body.ticket.assignee).toBeNull();

      const types = (
        await prisma.ticketActivity.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'asc' } })
      ).map((a) => a.type);
      expect(types).toEqual(['ASSIGNED', 'ASSIGNED', 'ASSIGNED', 'UNASSIGNED']);
    });

    it("assignment does not change status; another org's member is not eligible", async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      await s.assign(s.lead.cookie, t.number, s.staff.membership.id);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN');
      expect((await s.assign(s.admin.cookie, t.number, other.admin.membership.id)).body.error.code).toBe(
        'ASSIGNEE_NOT_ELIGIBLE'
      );
    });
  });

  describe('field edits', () => {
    it('permitted roles edit fields, each change is in the activity log', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      const patch = (cookie: string, body: Record<string, unknown>) =>
        request(app).patch(`${s.base}/${t.number}`).set('Cookie', cookie).send(body);

      expect((await patch(s.lead.cookie, { priority: 'URGENT', dueDate: '2031-05-01' })).status).toBe(200);
      expect((await patch(s.lead.cookie, { subject: 'Lead renames it' })).status).toBe(403);
      expect((await patch(s.lead.cookie, { teamId: s.hostel.id })).status).toBe(403);
      expect((await patch(s.staff.cookie, { priority: 'LOW' })).status).toBe(403);
      const m = await patch(s.manager.cookie, {
        subject: 'Better subject',
        description: 'A clearer description of the problem.',
      });
      expect(m.body.ticket).toMatchObject({ subject: 'Better subject', priority: 'URGENT', dueDate: '2031-05-01' });

      const types = (await prisma.ticketActivity.findMany({ where: { ticketId: t.id } })).map((a) => a.type).sort();
      expect(types).toEqual(['DUE_DATE_CHANGED', 'EDITED', 'EDITED', 'PRIORITY_CHANGED']);
    });

    it('changing team clears an assignee who is not eligible for the new team', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, {
        teamId: s.it.id,
        status: 'IN_PROGRESS',
        assigneeId: s.staff.membership.id,
      });
      const res = await request(app)
        .patch(`${s.base}/${t.number}`)
        .set('Cookie', s.manager.cookie)
        .send({ teamId: s.hostel.id });
      expect(res.status).toBe(200);
      expect(res.body.ticket).toMatchObject({ team: { id: s.hostel.id }, assignee: null, status: 'OPEN' });
      const types = (
        await prisma.ticketActivity.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'asc' } })
      ).map((a) => a.type);
      expect(types).toEqual(['TEAM_CHANGED', 'UNASSIGNED', 'STATUS_CHANGED']);

      // A Manager assignee stays: they are eligible for every team.
      const t2 = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.manager.membership.id });
      const res2 = await request(app)
        .patch(`${s.base}/${t2.number}`)
        .set('Cookie', s.manager.cookie)
        .send({ teamId: s.hostel.id });
      expect(res2.body.ticket.assignee).toMatchObject({ membershipId: s.manager.membership.id });
    });
  });

  describe('sub-tickets', () => {
    it('Lead splits a ticket; parent waits for sub-tickets before resolving or closing', async () => {
      const s = await setup();
      const parent = await createTicket(s.org.id, {
        teamId: s.it.id,
        assigneeId: s.lead.membership.id,
        priority: 'HIGH',
      });
      const add = (cookie: string, body: Record<string, unknown>) =>
        request(app).post(`${s.base}/${parent.number}/subtickets`).set('Cookie', cookie).send(body);

      const a = await add(s.lead.cookie, {
        subject: 'Check router',
        description: 'Check the Block C router logs.',
        assigneeId: s.staff.membership.id,
      });
      expect(a.status).toBe(201);
      expect(a.body.ticket).toMatchObject({
        parent: { number: parent.number },
        team: { id: s.it.id },
        priority: 'HIGH',
        source: 'INTERNAL',
        requester: null,
      });
      const b = await add(s.lead.cookie, {
        subject: 'Replace switch',
        description: 'Replace the broken switch.',
        assigneeId: s.staff2.membership.id,
      });

      const detail = await request(app).get(`${s.base}/${parent.number}`).set('Cookie', s.lead.cookie);
      expect(detail.body.ticket.progress).toEqual({ done: 0, total: 2 });
      expect((await prisma.ticketActivity.findMany({ where: { ticketId: parent.id } })).map((x) => x.type)).toEqual([
        'SUBTICKET_ADDED',
        'SUBTICKET_ADDED',
      ]);

      const blocked = await s.status(s.lead.cookie, parent.number, { status: 'RESOLVED' });
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('OPEN_SUBTICKETS');
      expect(blocked.body.error.message).toContain(a.body.ticket.reference);
      expect(
        (await s.status(s.lead.cookie, parent.number, { status: 'CLOSED', closeReason: 'COMPLETED' })).body.error.code
      ).toBe('OPEN_SUBTICKETS');

      // Staff finish their parts.
      for (const [sub, who] of [
        [a, s.staff],
        [b, s.staff2],
      ] as const) {
        await s.status(who.cookie, sub.body.ticket.number, { status: 'IN_PROGRESS' });
        expect((await s.status(who.cookie, sub.body.ticket.number, { status: 'RESOLVED' })).status).toBe(200);
      }
      expect(
        (await request(app).get(`${s.base}/${parent.number}`).set('Cookie', s.lead.cookie)).body.ticket.progress
      ).toEqual({ done: 2, total: 2 });
      expect((await s.status(s.lead.cookie, parent.number, { status: 'RESOLVED' })).status).toBe(200);
      expect((await s.status(s.lead.cookie, parent.number, { status: 'CLOSED' })).body.ticket.status).toBe('CLOSED');
    });

    it('no sub-ticket of a sub-ticket; Staff and other teams cannot split; Lead keeps the parent team', async () => {
      const s = await setup();
      const parent = await createTicket(s.org.id, { teamId: s.it.id });
      const child = await createTicket(s.org.id, { teamId: s.it.id, parentId: parent.id });
      const body = { subject: 'Part', description: 'A part of the work.' };
      const add = (cookie: string, n: number, extra: Record<string, unknown> = {}) =>
        request(app)
          .post(`${s.base}/${n}/subtickets`)
          .set('Cookie', cookie)
          .send({ ...body, ...extra });

      expect((await add(s.manager.cookie, child.number)).status).toBe(422);
      expect((await add(s.staff.cookie, parent.number)).status).toBe(403);
      expect((await add(s.lead.cookie, parent.number, { teamId: s.hostel.id })).status).toBe(403);
      const hostelParent = await createTicket(s.org.id, { teamId: s.hostel.id, assigneeId: s.lead.membership.id });
      expect((await add(s.lead.cookie, hostelParent.number)).status).toBe(403); // assigned, but not Lead of Hostel
      // Manager may route a part to another team.
      expect((await add(s.manager.cookie, parent.number, { teamId: s.hostel.id })).body.ticket.team.id).toBe(
        s.hostel.id
      );
    });
  });

  describe('offboarding', () => {
    it('removing a member unassigns their open tickets with a system activity; closed tickets keep them', async () => {
      const s = await setup();
      const working = await createTicket(s.org.id, {
        teamId: s.it.id,
        status: 'IN_PROGRESS',
        assigneeId: s.staff.membership.id,
      });
      const waiting = await createTicket(s.org.id, {
        teamId: s.it.id,
        status: 'WAITING_ON_REQUESTER',
        assigneeId: s.staff.membership.id,
        requesterId: (await createUser()).id,
        source: 'PORTAL',
      });
      const done = await createTicket(s.org.id, {
        teamId: s.it.id,
        status: 'CLOSED',
        assigneeId: s.staff.membership.id,
      });

      const res = await request(app)
        .delete(`/api/v1/orgs/${s.org.slug}/members/${s.staff.membership.id}`)
        .set('Cookie', s.admin.cookie);
      expect(res.status).toBe(200);

      const after = async (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
      expect(await after(working.id)).toMatchObject({ assigneeId: null, status: 'OPEN', teamId: s.it.id });
      expect(await after(waiting.id)).toMatchObject({ assigneeId: null, status: 'WAITING_ON_REQUESTER' });
      expect((await after(done.id)).assigneeId).toBe(s.staff.membership.id);

      const unassigned = await prisma.ticketActivity.findFirstOrThrow({
        where: { ticketId: working.id, type: 'UNASSIGNED' },
      });
      expect(unassigned).toMatchObject({ actorUserId: null, note: 'Member removed', fromValue: 'Sam Staff' });

      // History keeps the name with "(removed)".
      const detail = await request(app).get(`${s.base}/${done.number}`).set('Cookie', s.admin.cookie);
      expect(detail.body.ticket.assignee.name).toBe('Sam Staff (removed)');
    });

    it("removing someone from one team unassigns only that team's tickets", async () => {
      const s = await setup();
      await prisma.teamMember.create({
        data: { organizationId: s.org.id, teamId: s.hostel.id, membershipId: s.staff.membership.id },
      });
      const itTicket = await createTicket(s.org.id, { teamId: s.it.id, assigneeId: s.staff.membership.id });
      const hostelTicket = await createTicket(s.org.id, { teamId: s.hostel.id, assigneeId: s.staff.membership.id });

      await request(app)
        .delete(`/api/v1/orgs/${s.org.slug}/teams/${s.it.id}/members/${s.staff.membership.id}`)
        .set('Cookie', s.admin.cookie);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: itTicket.id } })).assigneeId).toBeNull();
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: hostelTicket.id } })).assigneeId).toBe(
        s.staff.membership.id
      );
    });
  });

  it('cross-organization: every workflow endpoint returns 404 and changes nothing', async () => {
    const s = await setup();
    const other = await createOrgWithAdmin();
    const theirs = await createTicket(other.org.id);
    const c = s.admin.cookie;
    const mine = `/api/v1/orgs/${s.org.slug}/tickets/${theirs.number}`;
    const theirsUrl = `/api/v1/orgs/${other.org.slug}/tickets/${theirs.number}`;
    for (const url of [mine, theirsUrl]) {
      expect((await request(app).post(`${url}/status`).set('Cookie', c).send({ status: 'RESOLVED' })).status).toBe(404);
      expect(
        (await request(app).post(`${url}/assignment`).set('Cookie', c).send({ assigneeId: s.admin.membership.id }))
          .status
      ).toBe(404);
      expect((await request(app).patch(url).set('Cookie', c).send({ priority: 'URGENT' })).status).toBe(404);
      expect(
        (
          await request(app)
            .post(`${url}/subtickets`)
            .set('Cookie', c)
            .send({ subject: 'Hack', description: 'Should not exist.' })
        ).status
      ).toBe(404);
      expect((await request(app).get(`${url}/activity`).set('Cookie', c)).status).toBe(404);
    }
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({
      status: 'OPEN',
      priority: 'MEDIUM',
      assigneeId: null,
    });
    expect(await prisma.ticket.count()).toBe(1);
  });
});
