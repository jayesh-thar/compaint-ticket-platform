import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import {
  createOrgWithAdmin,
  createMember,
  createTeam,
  createCategory,
  createTicket,
  createUser,
} from './helpers/factories.js';

const app = createApp();

const body = (over: Record<string, unknown> = {}) => ({
  subject: 'Projector broken',
  description: 'The projector in room 101 does not turn on.',
  ...over,
});

/** IT and Hostel teams; a Manager, an IT Lead, two IT staff, one Hostel staff. */
const setup = async () => {
  const { org, admin } = await createOrgWithAdmin();
  const it = await createTeam(org.id, 'IT');
  const hostel = await createTeam(org.id, 'Hostel');
  const manager = await createMember(org.id, 'MANAGER');
  const itLead = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id, isLead: true }] });
  const itStaff = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }] });
  const itStaff2 = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }] });
  const hostelStaff = await createMember(org.id, 'STAFF', { teams: [{ teamId: hostel.id }] });
  const url = `/api/v1/orgs/${org.slug}/tickets`;
  return { org, admin, it, hostel, manager, itLead, itStaff, itStaff2, hostelStaff, url };
};

describe('Tickets core (Phase 5)', () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('create (internal)', () => {
    it('Manager creates with any team; server sets source, status, creator, number and CREATED activity', async () => {
      const s = await setup();
      const res = await request(app)
        .post(s.url)
        .set('Cookie', s.manager.cookie)
        .send(body({ teamId: s.hostel.id, priority: 'HIGH', dueDate: '2030-01-15' }));
      expect(res.status).toBe(201);
      expect(res.body.ticket).toMatchObject({
        number: 1,
        reference: 'T-1',
        status: 'OPEN',
        source: 'INTERNAL',
        priority: 'HIGH',
        dueDate: '2030-01-15',
        team: { id: s.hostel.id },
        assignee: null,
      });
      const activity = await prisma.ticketActivity.findMany();
      expect(activity).toEqual([expect.objectContaining({ type: 'CREATED', actorUserId: s.manager.user.id })]);
    });

    it('Staff: own team only, unassigned or self-assigned; team required', async () => {
      const s = await setup();
      const c = s.itStaff.cookie;
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ teamId: s.it.id }))
        ).status
      ).toBe(201);
      const self = await request(app)
        .post(s.url)
        .set('Cookie', c)
        .send(body({ teamId: s.it.id, assigneeId: s.itStaff.membership.id }));
      expect(self.status).toBe(201);
      expect(self.body.ticket.assignee.membershipId).toBe(s.itStaff.membership.id);

      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ teamId: s.hostel.id }))
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ teamId: s.it.id, assigneeId: s.itStaff2.membership.id }))
        ).status
      ).toBe(403);
      expect((await request(app).post(s.url).set('Cookie', c).send(body())).status).toBe(403);
      expect(await prisma.ticket.count()).toBe(2);
    });

    it('Lead: own team, may assign team members; not other teams or outsiders', async () => {
      const s = await setup();
      const c = s.itLead.cookie;
      const ok = await request(app)
        .post(s.url)
        .set('Cookie', c)
        .send(body({ teamId: s.it.id, assigneeId: s.itStaff.membership.id }));
      expect(ok.status).toBe(201);
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ teamId: s.hostel.id }))
        ).status
      ).toBe(403);
      // The Manager is eligible for any team, but a Lead may only assign members of their team.
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ teamId: s.it.id, assigneeId: s.manager.membership.id }))
        ).status
      ).toBe(403);
    });

    it('rejects invalid input and archived, foreign or ineligible references; nothing is created', async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const foreignTeam = await createTeam(other.org.id, 'Foreign');
      const foreignCat = await createCategory(other.org.id);
      const archivedTeam = await createTeam(s.org.id, 'Old', { archived: true });
      const archivedCat = await createCategory(s.org.id, { archived: true });
      const foreignMember = await createMember(other.org.id, 'STAFF');
      const removed = await createMember(s.org.id, 'MANAGER');
      await prisma.membership.update({ where: { id: removed.membership.id }, data: { status: 'REMOVED' } });
      const c = s.admin.cookie;

      const short = await request(app).post(s.url).set('Cookie', c).send({ subject: 'x', description: 'short' });
      expect(short.status).toBe(400);
      expect(Object.keys(short.body.error.fields)).toEqual(expect.arrayContaining(['subject', 'description']));
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ dueDate: '2030-02-30' }))
        ).status
      ).toBe(400);
      expect(
        (
          await request(app)
            .post(s.url)
            .set('Cookie', c)
            .send(body({ priority: 'SUPER' }))
        ).status
      ).toBe(400);

      for (const teamId of [foreignTeam.id, archivedTeam.id]) {
        const r = await request(app).post(s.url).set('Cookie', c).send(body({ teamId }));
        expect(r.status).toBe(422);
        expect(r.body.error.fields.teamId).toBeDefined();
      }
      for (const categoryId of [foreignCat.id, archivedCat.id]) {
        const r = await request(app).post(s.url).set('Cookie', c).send(body({ categoryId }));
        expect(r.status).toBe(422);
      }
      for (const assigneeId of [foreignMember.membership.id, removed.membership.id]) {
        const r = await request(app).post(s.url).set('Cookie', c).send(body({ assigneeId }));
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
      }
      // Staff outside the team is not eligible for an IT ticket.
      const outside = await request(app)
        .post(s.url)
        .set('Cookie', c)
        .send(body({ teamId: s.it.id, assigneeId: s.hostelStaff.membership.id }));
      expect(outside.body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');

      expect(await prisma.ticket.count()).toBe(0);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: s.org.id } })).ticketCounter).toBe(0);
    });

    it('ignores client-sent source, status, organizationId, createdBy and requesterId', async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const stranger = await createUser();
      const res = await request(app)
        .post(s.url)
        .set('Cookie', s.admin.cookie)
        .send(
          body({
            source: 'PORTAL',
            status: 'CLOSED',
            organizationId: other.org.id,
            createdByMembershipId: s.manager.membership.id,
            requesterId: stranger.id,
            number: 999,
          })
        );
      expect(res.status).toBe(201);
      const row = await prisma.ticket.findFirstOrThrow();
      expect(row).toMatchObject({
        organizationId: s.org.id,
        source: 'INTERNAL',
        status: 'OPEN',
        number: 1,
        createdByMembershipId: s.admin.membership.id,
        requesterId: null,
      });
    });

    it('concurrent creations get unique, gap-free numbers', async () => {
      const s = await setup();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(app)
            .post(s.url)
            .set('Cookie', s.admin.cookie)
            .send(body({ subject: `Parallel ${i}` }))
        )
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => r.body.ticket.number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('a failure inside the transaction leaves no ticket, no counter change, no activity', async () => {
      const s = await setup();
      // Make the activity insert fail at the database level, half way through the transaction.
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_fail_activity() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_fail_activity BEFORE INSERT ON ticket_activities FOR EACH ROW EXECUTE FUNCTION test_fail_activity();`
      );
      try {
        const res = await request(app).post(s.url).set('Cookie', s.admin.cookie).send(body());
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(res.body)).not.toContain('forced failure'); // no SQL details leak
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_activity ON ticket_activities;');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_activity();');
      }
      expect(await prisma.ticket.count()).toBe(0);
      expect(await prisma.ticketActivity.count()).toBe(0);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: s.org.id } })).ticketCounter).toBe(0);
    });
  });

  describe('visibility, list and detail', () => {
    it('each role sees exactly the expected tickets in list and detail', async () => {
      const s = await setup();
      const itTicket = await createTicket(s.org.id, { teamId: s.it.id });
      const hostelTicket = await createTicket(s.org.id, { teamId: s.hostel.id });
      const assignedToItStaff = await createTicket(s.org.id, {
        teamId: s.hostel.id,
        assigneeId: s.itStaff.membership.id,
      });
      const createdByHostel = await createTicket(s.org.id, { createdByMembershipId: s.hostelStaff.membership.id });
      const unrouted = await createTicket(s.org.id);

      const numbersFor = async (cookie: string) =>
        (await request(app).get(s.url).set('Cookie', cookie)).body.tickets
          .map((t: { number: number }) => t.number)
          .sort();

      const all = [itTicket, hostelTicket, assignedToItStaff, createdByHostel, unrouted].map((t) => t.number).sort();
      expect(await numbersFor(s.admin.cookie)).toEqual(all);
      expect(await numbersFor(s.manager.cookie)).toEqual(all);
      expect(await numbersFor(s.itStaff.cookie)).toEqual([itTicket.number, assignedToItStaff.number].sort());
      expect(await numbersFor(s.itStaff2.cookie)).toEqual([itTicket.number]);
      expect(await numbersFor(s.hostelStaff.cookie)).toEqual(
        [hostelTicket.number, assignedToItStaff.number, createdByHostel.number].sort()
      );

      // Detail follows the same rule: not visible = 404.
      expect((await request(app).get(`${s.url}/${itTicket.number}`).set('Cookie', s.itStaff2.cookie)).status).toBe(200);
      expect((await request(app).get(`${s.url}/${hostelTicket.number}`).set('Cookie', s.itStaff2.cookie)).status).toBe(
        404
      );
      expect((await request(app).get(`${s.url}/${unrouted.number}`).set('Cookie', s.itLead.cookie)).status).toBe(404);
      expect((await request(app).get(`${s.url}/abc`).set('Cookie', s.admin.cookie)).status).toBe(404);
    });

    it('cross-organization list, detail and search return nothing / 404', async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const theirs = await createTicket(other.org.id, { subject: 'Secret payroll issue' });

      // Through my org URL: their ticket number does not exist here.
      expect((await request(app).get(`${s.url}/${theirs.number}`).set('Cookie', s.admin.cookie)).status).toBe(404);
      const search = await request(app).get(`${s.url}?q=payroll`).set('Cookie', s.admin.cookie);
      expect(search.body).toMatchObject({ tickets: [], total: 0 });
      // Through their URL: not a member.
      expect(
        (await request(app).get(`/api/v1/orgs/${other.org.slug}/tickets`).set('Cookie', s.admin.cookie)).status
      ).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/v1/orgs/${other.org.slug}/tickets/${theirs.number}`)
            .set('Cookie', s.admin.cookie)
        ).status
      ).toBe(404);
    });

    it('filters, search, sort and pagination', async () => {
      const s = await setup();
      const past = new Date(Date.UTC(2020, 0, 1));
      await createTicket(s.org.id, {
        subject: 'Wi-Fi down in Block C',
        teamId: s.it.id,
        priority: 'URGENT',
        dueDate: past,
      });
      await createTicket(s.org.id, {
        subject: 'Leaking tap',
        teamId: s.hostel.id,
        assigneeId: s.hostelStaff.membership.id,
      });
      await createTicket(s.org.id, { subject: 'Old printer', status: 'RESOLVED', dueDate: past });
      await createTicket(s.org.id, {
        subject: 'Done thing',
        status: 'CLOSED',
        source: 'PORTAL',
        requesterId: s.admin.user.id,
      });
      const get = async (qs: string) => (await request(app).get(`${s.url}?${qs}`).set('Cookie', s.admin.cookie)).body;

      expect((await get('status=OPEN')).total).toBe(2);
      expect((await get('status=RESOLVED,CLOSED')).total).toBe(2);
      expect((await get('open=true')).total).toBe(2);
      expect((await get('priority=URGENT')).total).toBe(1);
      expect((await get(`teamId=${s.it.id}`)).total).toBe(1);
      expect((await get('teamId=none')).total).toBe(2);
      expect((await get('unassigned=true')).total).toBe(3);
      expect((await get(`assigneeId=${s.hostelStaff.membership.id}`)).total).toBe(1);
      expect((await get('source=PORTAL')).total).toBe(1);
      // Overdue = open workload with a past due date (the resolved one does not count).
      const overdue = await get('overdue=true');
      expect(overdue.total).toBe(1);
      expect(overdue.tickets[0]).toMatchObject({ subject: 'Wi-Fi down in Block C', overdue: true });
      expect((await get('q=wi-fi')).total).toBe(1);
      expect((await get('q=T-2')).tickets[0].subject).toBe('Leaking tap');

      const sorted = await get('sort=priority&order=desc');
      expect(sorted.tickets[0].priority).toBe('URGENT');
      const page2 = await get('pageSize=3&page=2&sort=number&order=asc');
      expect(page2).toMatchObject({ total: 4, page: 2, pageSize: 3 });
      expect(page2.tickets.map((t: { number: number }) => t.number)).toEqual([4]);

      expect((await request(app).get(`${s.url}?sort=password`).set('Cookie', s.admin.cookie)).status).toBe(400);
      expect((await request(app).get(`${s.url}?pageSize=1000`).set('Cookie', s.admin.cookie)).status).toBe(400);

      // "mine" = assigned to me
      const mine = await request(app).get(`${s.url}?mine=true`).set('Cookie', s.hostelStaff.cookie);
      expect(mine.body.total).toBe(1);
    });

    it('detail includes allowedActions that match the role', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      const detail = async (cookie: string) =>
        (await request(app).get(`${s.url}/${t.number}`).set('Cookie', cookie)).body.ticket.allowedActions;

      expect(await detail(s.manager.cookie)).toMatchObject({
        canEditText: true,
        canChangeTeam: true,
        canAssignOthers: true,
        canAddSubticket: true,
      });
      expect(await detail(s.itLead.cookie)).toMatchObject({
        canEditText: false,
        canChangeTeam: false,
        canAssignOthers: true,
        canAddSubticket: true,
        canEditTriage: true,
      });
      expect(await detail(s.itStaff.cookie)).toMatchObject({
        canAssignOthers: false,
        canAddSubticket: false,
        canTake: true,
        canEditTriage: false,
        canPublicReply: false,
      });
    });
  });
});
