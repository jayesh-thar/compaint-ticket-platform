import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { processOutboxOnce, STUCK_AFTER_MS } from '../src/modules/notifications/poller.js';
import { renderNotification } from '../src/modules/notifications/templates.js';
import { cleanDatabase } from './helpers/db.js';
import { createOrgWithAdmin, createMember, createTeam, createTicket, createUser } from './helpers/factories.js';

const app = createApp();

const setup = async () => {
  const { org, admin } = await createOrgWithAdmin();
  const it = await createTeam(org.id, 'IT');
  const empty = await createTeam(org.id, 'No Lead Team');
  const manager = await createMember(org.id, 'MANAGER');
  const lead = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id, isLead: true }] });
  const staff = await createMember(org.id, 'STAFF', { teams: [{ teamId: it.id }] });
  const outsider = await createMember(org.id, 'STAFF');
  const base = `/api/v1/orgs/${org.slug}/tickets`;
  return { org, admin, it, empty, manager, lead, staff, outsider, base };
};

const body = { subject: 'Printer jam', description: 'The printer on floor 2 keeps jamming.' };
const recipients = async (type: string) =>
  (await prisma.notification.findMany({ where: { type: type as never } })).map((n) => n.toEmail).sort();

describe('Comments and ticket emails (Phase 7)', () => {
  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('comments', () => {
    it('members who can see the ticket read and write internal notes; others get 404', async () => {
      const s = await setup();
      const t = await createTicket(s.org.id, { teamId: s.it.id });
      const url = `${s.base}/${t.number}/comments`;

      const note = await request(app).post(url).set('Cookie', s.staff.cookie).send({ body: 'Checked the cable.' });
      expect(note.status).toBe(201);
      expect(note.body.comment).toMatchObject({
        visibility: 'INTERNAL',
        authorType: 'STAFF',
        body: 'Checked the cable.',
      }); // default

      const list = await request(app).get(url).set('Cookie', s.lead.cookie);
      expect(list.body.comments).toHaveLength(1);

      expect((await request(app).get(url).set('Cookie', s.outsider.cookie)).status).toBe(404);
      expect((await request(app).post(url).set('Cookie', s.outsider.cookie).send({ body: 'Hi' })).status).toBe(404);
      expect((await request(app).post(url).set('Cookie', s.staff.cookie).send({ body: '   ' })).status).toBe(400);
      expect(
        (
          await request(app)
            .post(url)
            .set('Cookie', s.staff.cookie)
            .send({ body: 'x'.repeat(10001) })
        ).status
      ).toBe(400);
      expect(await prisma.comment.count()).toBe(1);
    });

    it('a public reply needs a requester; with one, the requester gets a "staff replied" email row', async () => {
      const s = await setup();
      const internal = await createTicket(s.org.id, { teamId: s.it.id });
      const r1 = await request(app)
        .post(`${s.base}/${internal.number}/comments`)
        .set('Cookie', s.staff.cookie)
        .send({ body: 'Hello', visibility: 'PUBLIC' });
      expect(r1.status).toBe(422);

      const requester = await createUser({ email: 'student@example.com' });
      const portal = await createTicket(s.org.id, { teamId: s.it.id, source: 'PORTAL', requesterId: requester.id });
      const r2 = await request(app)
        .post(`${s.base}/${portal.number}/comments`)
        .set('Cookie', s.staff.cookie)
        .send({ body: 'We are on it.', visibility: 'PUBLIC' });
      expect(r2.status).toBe(201);
      expect(await recipients('STAFF_REPLIED')).toEqual(['student@example.com']);
      // Internal notes never create requester emails.
      await request(app)
        .post(`${s.base}/${portal.number}/comments`)
        .set('Cookie', s.staff.cookie)
        .send({ body: 'Secret note' });
      expect(await prisma.notification.count({ where: { type: 'STAFF_REPLIED' } })).toBe(1);
    });

    it('cross-organization comments: 404 and nothing written', async () => {
      const s = await setup();
      const other = await createOrgWithAdmin();
      const theirs = await createTicket(other.org.id);
      expect((await request(app).get(`${s.base}/${theirs.number}/comments`).set('Cookie', s.admin.cookie)).status).toBe(
        404
      );
      expect(
        (
          await request(app)
            .post(`${s.base}/${theirs.number}/comments`)
            .set('Cookie', s.admin.cookie)
            .send({ body: 'hi' })
        ).status
      ).toBe(404);
      expect(await prisma.comment.count()).toBe(0);
    });
  });

  describe('outbox recipients', () => {
    it('created without assignee -> team Leads; team without Lead or no team -> Managers + Admins; never the actor', async () => {
      const s = await setup();
      await request(app)
        .post(s.base)
        .set('Cookie', s.manager.cookie)
        .send({ ...body, teamId: s.it.id });
      expect(await recipients('NEEDS_ASSIGNMENT')).toEqual([s.lead.user.email]);

      await prisma.notification.deleteMany();
      await request(app)
        .post(s.base)
        .set('Cookie', s.manager.cookie)
        .send({ ...body, teamId: s.empty.id });
      expect(await recipients('NEEDS_ASSIGNMENT')).toEqual([s.admin.user.email]); // manager is the actor

      await prisma.notification.deleteMany();
      await request(app).post(s.base).set('Cookie', s.admin.cookie).send(body);
      expect(await recipients('NEEDS_ASSIGNMENT')).toEqual([s.manager.user.email]);
    });

    it('"Assigned to you" goes to the assignee unless they assigned themselves (also for sub-tickets)', async () => {
      const s = await setup();
      const res = await request(app)
        .post(s.base)
        .set('Cookie', s.lead.cookie)
        .send({ ...body, teamId: s.it.id, assigneeId: s.staff.membership.id });
      expect(await recipients('ASSIGNED_TO_YOU')).toEqual([s.staff.user.email]);
      expect(await prisma.notification.count({ where: { type: 'NEEDS_ASSIGNMENT' } })).toBe(0);

      await prisma.notification.deleteMany();
      await request(app)
        .post(`${s.base}/${res.body.ticket.number}/assignment`)
        .set('Cookie', s.lead.cookie)
        .send({ assigneeId: s.lead.membership.id });
      expect(await prisma.notification.count()).toBe(0); // self-assign: no email to the actor

      await request(app)
        .post(`${s.base}/${res.body.ticket.number}/subtickets`)
        .set('Cookie', s.lead.cookie)
        .send({ subject: 'Part one', description: 'The first part of the work.', assigneeId: s.staff.membership.id });
      expect(await recipients('ASSIGNED_TO_YOU')).toEqual([s.staff.user.email]);
    });

    it('outbox rows are written in the same transaction: if the email row fails, the ticket is not created', async () => {
      const s = await setup();
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_fail_notification() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_fail_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION test_fail_notification();`
      );
      try {
        const res = await request(app)
          .post(s.base)
          .set('Cookie', s.manager.cookie)
          .send({ ...body, teamId: s.it.id });
        expect(res.status).toBe(500);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_notification ON notifications;');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_notification();');
      }
      expect(await prisma.ticket.count()).toBe(0);
      expect(await prisma.ticketActivity.count()).toBe(0);
    });
  });

  describe('poller', () => {
    it('sends due rows and marks them SENT', async () => {
      const s = await setup();
      const send = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
      await request(app)
        .post(s.base)
        .set('Cookie', s.manager.cookie)
        .send({ ...body, teamId: s.it.id });

      const result = await processOutboxOnce();
      expect(result).toMatchObject({ processed: 1, sent: 1 });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ to: s.lead.user.email, subject: expect.stringContaining('T-1 needs assignment') })
      );
      const email = send.mock.calls[0][0];
      expect(email.text).toContain(`/w/${s.org.slug}/tickets/1`);
      expect(email.text).toContain('not monitored');
      expect(await prisma.notification.findFirst()).toMatchObject({ status: 'SENT' });
      // Running again sends nothing (no double send).
      expect((await processOutboxOnce()).processed).toBe(0);
    });

    it('retries after 1 and 5 minutes, then FAILED after 3 attempts; the ticket stays created', async () => {
      const s = await setup();
      const send = vi.spyOn(emailTransport, 'send').mockRejectedValue(new Error('provider down'));
      const created = await request(app)
        .post(s.base)
        .set('Cookie', s.manager.cookie)
        .send({ ...body, teamId: s.it.id });
      expect(created.status).toBe(201);

      const t0 = new Date();
      await processOutboxOnce(t0);
      let row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'provider down' });
      expect(row.nextAttemptAt.getTime() - t0.getTime()).toBe(60_000);

      expect((await processOutboxOnce(new Date(t0.getTime() + 30_000))).processed).toBe(0); // not due yet

      const t1 = new Date(t0.getTime() + 60_000);
      await processOutboxOnce(t1);
      row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'PENDING', attempts: 2 });
      expect(row.nextAttemptAt.getTime() - t1.getTime()).toBe(5 * 60_000);

      await processOutboxOnce(new Date(t1.getTime() + 5 * 60_000));
      row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'FAILED', attempts: 3 });
      expect(send).toHaveBeenCalledTimes(3);
      expect(await prisma.ticket.count()).toBe(1);
    });

    it('rows stuck in SENDING for 10 minutes go back to PENDING and are sent', async () => {
      const s = await setup();
      const send = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
      await request(app)
        .post(s.base)
        .set('Cookie', s.manager.cookie)
        .send({ ...body, teamId: s.it.id });
      const now = new Date();
      await prisma.notification.updateMany({
        data: { status: 'SENDING', claimedAt: new Date(now.getTime() - STUCK_AFTER_MS - 1000) },
      });

      await processOutboxOnce(now);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.notification.findFirst()).toMatchObject({ status: 'SENT' });
    });

    it('a "staff replied" email can only ever quote a PUBLIC comment of that ticket', async () => {
      const s = await setup();
      const requester = await createUser();
      const t = await createTicket(s.org.id, { source: 'PORTAL', requesterId: requester.id });
      const internal = await prisma.comment.create({
        data: {
          organizationId: s.org.id,
          ticketId: t.id,
          authorUserId: s.staff.user.id,
          authorType: 'STAFF',
          visibility: 'INTERNAL',
          body: 'TOP SECRET',
        },
      });
      // Even a hand-made outbox row pointing at the internal note renders nothing.
      const row = await prisma.notification.create({
        data: {
          organizationId: s.org.id,
          toEmail: requester.email,
          type: 'STAFF_REPLIED',
          payload: { ticketId: t.id, commentId: internal.id },
        },
      });
      expect(await renderNotification(row)).toBeNull();
    });
  });
});
