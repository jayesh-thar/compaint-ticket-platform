import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { processOutboxOnce } from '../src/modules/notifications/poller.js';
import { cleanDatabase } from './helpers/db.js';
import {
  createOrgWithAdmin,
  createMember,
  createTeam,
  createCategory,
  createUser,
  createSession,
  createTicket,
} from './helpers/factories.js';

const app = createApp();

/** An organization with an open portal: IT team with a Lead, public "Wi-Fi" routed to IT. */
const setup = async () => {
  const { org, admin } = await createOrgWithAdmin();
  const it = await createTeam(org.id, 'IT');
  const lead = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id, isLead: true }], name: 'Lee Lead' });
  const staff = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }], name: 'Sam Staff' });
  const wifi = await createCategory(org.id, { name: 'Wi-Fi', isPublic: true, defaultTeamId: it.id });
  const internalCat = await createCategory(org.id, { name: 'Payroll', isPublic: false });
  await prisma.organization.update({ where: { id: org.id }, data: { portalEnabled: true } });
  const student = await createUser({ name: 'Stu Dent', email: 'stu@example.com' });
  const { cookie } = await createSession(student.id);
  return { org, admin, it, lead, staff, wifi, internalCat, student: { user: student, cookie } };
};

const complaint = (categoryId: string, extra: Record<string, unknown> = {}) => ({
  categoryId,
  subject: 'Wi-Fi down in Block C',
  description: 'No connection in rooms 101 to 120 since yesterday.',
  ...extra,
});

describe('Portal and requester side (Phase 8)', () => {
  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('portal toggle and public page', () => {
    it('portal can only be enabled with an active public category', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const url = `/api/v1/orgs/${org.slug}`;
      const denied = await request(app).patch(url).set('Cookie', admin.cookie).send({ portalEnabled: true });
      expect(denied.status).toBe(422);
      expect(denied.body.error.fields.portalEnabled).toBeDefined();

      await createCategory(org.id, { isPublic: true, archived: true }); // archived does not count
      expect((await request(app).patch(url).set('Cookie', admin.cookie).send({ portalEnabled: true })).status).toBe(
        422
      );
      await createCategory(org.id, { isPublic: true });
      const ok = await request(app).patch(url).set('Cookie', admin.cookie).send({ portalEnabled: true });
      expect(ok.body.organization.portalEnabled).toBe(true);
    });

    it('public portal shows only safe fields; unknown or disabled is "unavailable"', async () => {
      const s = await setup();
      const res = await request(app).get(`/api/v1/public/portals/${s.org.slug}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        portal: {
          name: s.org.name,
          slug: s.org.slug,
          intro: null,
          acceptingComplaints: true,
          categories: [{ id: s.wifi.id, name: 'Wi-Fi' }],
        },
      });

      expect((await request(app).get('/api/v1/public/portals/nope-nope')).status).toBe(404);
      await prisma.organization.update({ where: { id: s.org.id }, data: { portalEnabled: false } });
      expect((await request(app).get(`/api/v1/public/portals/${s.org.slug}`)).status).toBe(404);
    });

    it('last public category archived while enabled: "not accepting complaints"', async () => {
      const s = await setup();
      await prisma.category.update({ where: { id: s.wifi.id }, data: { archivedAt: new Date() } });
      const res = await request(app).get(`/api/v1/public/portals/${s.org.slug}`);
      expect(res.body.portal).toMatchObject({ acceptingComplaints: false, categories: [] });
    });
  });

  describe('submitting a complaint', () => {
    it('lands in the org from the slug, routed by category; body organizationId/source/priority ignored; emails queued', async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const res = await request(app)
        .post(`/api/v1/portals/${s.org.slug}/complaints`)
        .set('Cookie', s.student.cookie)
        .send(
          complaint(s.wifi.id, {
            organizationId: other.org.id,
            source: 'INTERNAL',
            priority: 'URGENT',
            status: 'RESOLVED',
            teamId: null,
          })
        );
      expect(res.status).toBe(201);
      expect(res.body.complaint).toMatchObject({ reference: 'T-1', organization: { slug: s.org.slug } });

      const t = await prisma.ticket.findFirstOrThrow();
      expect(t).toMatchObject({
        organizationId: s.org.id,
        source: 'PORTAL',
        status: 'OPEN',
        priority: 'MEDIUM',
        teamId: s.it.id,
        requesterId: s.student.user.id,
        createdByMembershipId: null,
      });
      const rows = await prisma.notification.findMany();
      expect(rows.map((r) => `${r.type} ${r.toEmail}`).sort()).toEqual([
        'COMPLAINT_RECEIVED stu@example.com',
        `NEEDS_ASSIGNMENT ${s.lead.user.email}`,
      ]);
    });

    it('rejects disabled/unknown portals, internal or archived categories, unverified and anonymous users', async () => {
      const s = await setup();
      const url = `/api/v1/portals/${s.org.slug}/complaints`;
      expect((await request(app).post(url).send(complaint(s.wifi.id))).status).toBe(401);

      const unverified = await createUser({ emailVerifiedAt: null });
      const { cookie } = await createSession(unverified.id);
      const r = await request(app).post(url).set('Cookie', cookie).send(complaint(s.wifi.id));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      expect(
        (await request(app).post(url).set('Cookie', s.student.cookie).send(complaint(s.internalCat.id))).status
      ).toBe(422);
      const foreign = await createCategory((await createOrgWithAdmin()).org.id, { isPublic: true });
      expect((await request(app).post(url).set('Cookie', s.student.cookie).send(complaint(foreign.id))).status).toBe(
        422
      );
      expect(
        (
          await request(app)
            .post(url)
            .set('Cookie', s.student.cookie)
            .send({ categoryId: s.wifi.id, subject: 'x', description: 'y' })
        ).status
      ).toBe(400);
      expect(
        (
          await request(app)
            .post('/api/v1/portals/nope-nope/complaints')
            .set('Cookie', s.student.cookie)
            .send(complaint(s.wifi.id))
        ).status
      ).toBe(404);

      await prisma.category.update({ where: { id: s.wifi.id }, data: { archivedAt: new Date() } });
      expect((await request(app).post(url).set('Cookie', s.student.cookie).send(complaint(s.wifi.id))).status).toBe(
        422
      );
      await prisma.organization.update({ where: { id: s.org.id }, data: { portalEnabled: false } });
      expect((await request(app).post(url).set('Cookie', s.student.cookie).send(complaint(s.wifi.id))).status).toBe(
        404
      );
      expect(await prisma.ticket.count()).toBe(0);
    });

    it('an archived default team means unrouted: Managers and Admins are told', async () => {
      const s = await setup();
      await prisma.team.update({ where: { id: s.it.id }, data: { archivedAt: new Date() } });
      await request(app)
        .post(`/api/v1/portals/${s.org.slug}/complaints`)
        .set('Cookie', s.student.cookie)
        .send(complaint(s.wifi.id));
      expect((await prisma.ticket.findFirstOrThrow()).teamId).toBeNull();
      expect(
        (await prisma.notification.findMany({ where: { type: 'NEEDS_ASSIGNMENT' } })).map((n) => n.toEmail)
      ).toEqual([s.admin.user.email]);
    });

    it('the email provider being down does not undo the submission', async () => {
      const s = await setup();
      vi.spyOn(emailTransport, 'send').mockRejectedValue(new Error('provider down'));
      const res = await request(app)
        .post(`/api/v1/portals/${s.org.slug}/complaints`)
        .set('Cookie', s.student.cookie)
        .send(complaint(s.wifi.id));
      expect(res.status).toBe(201);
      await processOutboxOnce();
      expect(await prisma.ticket.count()).toBe(1);
      expect(await prisma.notification.count({ where: { status: 'PENDING', attempts: 1 } })).toBe(2);
    });
  });

  describe('My complaints', () => {
    const submit = async (s: Awaited<ReturnType<typeof setup>>) =>
      (
        await request(app)
          .post(`/api/v1/portals/${s.org.slug}/complaints`)
          .set('Cookie', s.student.cookie)
          .send(complaint(s.wifi.id))
      ).body.complaint.number as number;

    it('requester sees only public data: no internal notes, sub-tickets, activity or assignee email', async () => {
      const s = await setup();
      const n = await submit(s);
      const t = await prisma.ticket.findFirstOrThrow();
      const base = `/api/v1/orgs/${s.org.slug}/tickets/${n}`;
      await request(app)
        .post(`${base}/assignment`)
        .set('Cookie', s.lead.cookie)
        .send({ assigneeId: s.staff.membership.id });
      await request(app)
        .post(`${base}/comments`)
        .set('Cookie', s.staff.cookie)
        .send({ body: 'INTERNAL: router password is hunter2' });
      await request(app)
        .post(`${base}/comments`)
        .set('Cookie', s.staff.cookie)
        .send({ body: 'We are looking into it.', visibility: 'PUBLIC' });
      await request(app)
        .post(`${base}/subtickets`)
        .set('Cookie', s.lead.cookie)
        .send({ subject: 'Check router', description: 'Check the Block C router.' });

      const list = await request(app).get('/api/v1/me/tickets').set('Cookie', s.student.cookie);
      expect(list.body.complaints).toHaveLength(1); // the sub-ticket is not "mine"
      const detail = await request(app).get(`/api/v1/me/tickets/${s.org.slug}/${n}`).set('Cookie', s.student.cookie);
      expect(detail.status).toBe(200);
      const json = JSON.stringify(detail.body);
      expect(json).not.toContain('hunter2');
      expect(json).not.toContain(s.staff.user.email);
      expect(json).not.toContain('Check router');
      expect(json).not.toContain('assignee');
      expect(json).not.toContain('activity');
      expect(detail.body.complaint.comments).toEqual([
        expect.objectContaining({ body: 'We are looking into it.', author: `Sam (${s.org.name})`, fromYou: false }),
      ]);
      expect(t.id).toBeDefined();

      // ...and none of the emails sent to the requester contain the internal note.
      const send = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
      await processOutboxOnce();
      const toStudent = send.mock.calls.map((c) => c[0]).filter((e) => e.to === 'stu@example.com');
      expect(toStudent.length).toBeGreaterThanOrEqual(2); // received + staff replied
      for (const e of toStudent) {
        expect(e.text).not.toContain('hunter2');
        expect(e.text).not.toContain(s.staff.user.email);
        expect(e.text).toContain(`/my/complaints/${s.org.slug}/${n}`);
      }
    });

    it("cannot read or act on another user's complaint (404)", async () => {
      const s = await setup();
      const n = await submit(s);
      const other = await createUser();
      const { cookie } = await createSession(other.id);
      const base = `/api/v1/me/tickets/${s.org.slug}/${n}`;
      expect((await request(app).get(base).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).post(`${base}/comments`).set('Cookie', cookie).send({ body: 'hi' })).status).toBe(404);
      expect((await request(app).post(`${base}/withdraw`).set('Cookie', cookie)).status).toBe(404);
      // Members are not requesters either: even the Admin gets 404 on the requester API.
      expect((await request(app).get(base).set('Cookie', s.admin.cookie)).status).toBe(404);
      expect(
        (await request(app).get(`/api/v1/me/tickets/${s.org.slug}/999`).set('Cookie', s.student.cookie)).status
      ).toBe(404);
      expect((await prisma.ticket.findFirstOrThrow()).status).toBe('OPEN');
    });

    it('reply while waiting -> IN_PROGRESS (assigned) and the assignee is told; reply on RESOLVED reopens; CLOSED is blocked', async () => {
      const s = await setup();
      const n = await submit(s);
      const member = `/api/v1/orgs/${s.org.slug}/tickets/${n}`;
      const mine = `/api/v1/me/tickets/${s.org.slug}/${n}`;
      await request(app)
        .post(`${member}/assignment`)
        .set('Cookie', s.lead.cookie)
        .send({ assigneeId: s.staff.membership.id });
      await request(app)
        .post(`${member}/status`)
        .set('Cookie', s.staff.cookie)
        .send({ status: 'WAITING_ON_REQUESTER' });
      expect(await prisma.notification.count({ where: { type: 'WAITING_ON_YOU', toEmail: 'stu@example.com' } })).toBe(
        1
      );

      const r1 = await request(app)
        .post(`${mine}/comments`)
        .set('Cookie', s.student.cookie)
        .send({ body: 'It is room 104.' });
      expect(r1.status).toBe(201);
      expect(r1.body.complaint.status).toBe('IN_PROGRESS');
      expect(await prisma.notification.findMany({ where: { type: 'REQUESTER_REPLIED' } })).toEqual([
        expect.objectContaining({ toEmail: s.staff.user.email }),
      ]);
      const sys = await prisma.ticketActivity.findFirstOrThrow({
        where: { type: 'STATUS_CHANGED', toValue: 'IN_PROGRESS' },
      });
      expect(sys.actorUserId).toBeNull(); // the system made the move

      await request(app).post(`${member}/status`).set('Cookie', s.staff.cookie).send({ status: 'RESOLVED' });
      expect(await prisma.notification.count({ where: { type: 'RESOLVED' } })).toBe(1);
      const r2 = await request(app)
        .post(`${mine}/comments`)
        .set('Cookie', s.student.cookie)
        .send({ body: 'Still broken.' });
      expect(r2.body.complaint.status).toBe('IN_PROGRESS');

      await request(app)
        .post(`${member}/status`)
        .set('Cookie', s.lead.cookie)
        .send({ status: 'CLOSED', closeReason: 'COMPLETED' });
      const r3 = await request(app).post(`${mine}/comments`).set('Cookie', s.student.cookie).send({ body: 'Hello?' });
      expect(r3.status).toBe(409);
      expect(r3.body.error.message).toContain('new complaint');
    });

    it('reply while waiting on an unassigned ticket returns it to OPEN', async () => {
      const s = await setup();
      const requester = s.student.user;
      const t = await createTicket(s.org.id, {
        source: 'PORTAL',
        requesterId: requester.id,
        status: 'WAITING_ON_REQUESTER',
        teamId: s.it.id,
      });
      const res = await request(app)
        .post(`/api/v1/me/tickets/${s.org.slug}/${t.number}/comments`)
        .set('Cookie', s.student.cookie)
        .send({ body: 'Here you go.' });
      expect(res.body.complaint.status).toBe('OPEN');
    });

    it('confirm closes as COMPLETED; withdraw only from OPEN; requesters cannot do anything else', async () => {
      const s = await setup();
      const n = await submit(s);
      const mine = `/api/v1/me/tickets/${s.org.slug}/${n}`;
      const member = `/api/v1/orgs/${s.org.slug}/tickets/${n}`;

      expect((await request(app).post(`${mine}/confirm`).set('Cookie', s.student.cookie)).status).toBe(409); // not resolved
      await request(app)
        .post(`${member}/assignment`)
        .set('Cookie', s.lead.cookie)
        .send({ assigneeId: s.staff.membership.id });
      await request(app).post(`${member}/status`).set('Cookie', s.staff.cookie).send({ status: 'IN_PROGRESS' });
      const w = await request(app).post(`${mine}/withdraw`).set('Cookie', s.student.cookie);
      expect(w.status).toBe(409); // work started

      await request(app).post(`${member}/status`).set('Cookie', s.staff.cookie).send({ status: 'RESOLVED' });
      const c = await request(app).post(`${mine}/confirm`).set('Cookie', s.student.cookie);
      expect(c.body.complaint).toMatchObject({
        status: 'CLOSED',
        closeReason: 'COMPLETED',
        allowedActions: { canReply: false },
      });

      // A fresh complaint can be withdrawn while OPEN.
      const n2 = await submit(s);
      const w2 = await request(app)
        .post(`/api/v1/me/tickets/${s.org.slug}/${n2}/withdraw`)
        .set('Cookie', s.student.cookie);
      expect(w2.body.complaint).toMatchObject({ status: 'CLOSED', closeReason: 'CANCELLED' });

      // The requester is not a member: no member endpoint works for them.
      expect((await request(app).get(member).set('Cookie', s.student.cookie)).status).toBe(404);
      expect(
        (await request(app).post(`${member}/status`).set('Cookie', s.student.cookie).send({ status: 'RESOLVED' }))
          .status
      ).toBe(404);
    });

    it('portal disabled after submission: requester can still view and reply', async () => {
      const s = await setup();
      const n = await submit(s);
      await prisma.organization.update({ where: { id: s.org.id }, data: { portalEnabled: false } });
      expect(
        (await request(app).get(`/api/v1/me/tickets/${s.org.slug}/${n}`).set('Cookie', s.student.cookie)).status
      ).toBe(200);
      expect(
        (
          await request(app)
            .post(`/api/v1/me/tickets/${s.org.slug}/${n}/comments`)
            .set('Cookie', s.student.cookie)
            .send({ body: 'Any news?' })
        ).status
      ).toBe(201);
    });

    it('a requester who is also staff in the same org sees only public data in My complaints', async () => {
      const s = await setup();
      // Staff member submits a complaint through the portal like anyone else.
      const res = await request(app)
        .post(`/api/v1/portals/${s.org.slug}/complaints`)
        .set('Cookie', s.staff.cookie)
        .send(complaint(s.wifi.id));
      const n = res.body.complaint.number;
      await request(app)
        .post(`/api/v1/orgs/${s.org.slug}/tickets/${n}/comments`)
        .set('Cookie', s.lead.cookie)
        .send({ body: 'internal only' });
      const mine = await request(app).get(`/api/v1/me/tickets/${s.org.slug}/${n}`).set('Cookie', s.staff.cookie);
      expect(mine.body.complaint.comments).toEqual([]);
    });
  });
});
