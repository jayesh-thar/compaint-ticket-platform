import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { MembershipRole, MembershipStatus } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { createUser, createSession, createTestOrg } from './helpers/factories.js';
import { emailTransport } from '../src/shared/email.js';
import { hashToken } from '../src/shared/crypto.js';

const app = createApp();

// ---------- helpers ----------

const addMember = (organizationId: string, userId: string, role: MembershipRole, status: MembershipStatus = 'ACTIVE') =>
  prisma.membership.create({
    data: { organizationId, userId, role, status, removedAt: status === 'REMOVED' ? new Date() : null },
  });

/** A verified user with a live session cookie. */
const loggedInUser = async (overrides: Parameters<typeof createUser>[0] = {}) => {
  const user = await createUser(overrides);
  const { cookie } = await createSession(user.id);
  return { user, cookie };
};

const mockEmail = () => vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

/** Pulls the raw token out of the Nth email the spy captured. */
const tokenFromEmail = (spy: ReturnType<typeof mockEmail>, callIndex = 0): string => {
  const match = spy.mock.calls[callIndex][0].text.match(/#token=([A-Za-z0-9_-]+)/);
  expect(match).not.toBeNull();
  return match![1];
};

const invite = (slug: string, cookie: string, email: string, role: MembershipRole = 'STAFF') =>
  request(app).post(`/api/v1/orgs/${slug}/invitations`).set('Cookie', cookie).send({ email, role });

const accept = (cookie: string, token: string) =>
  request(app).post('/api/v1/invitations/accept').set('Cookie', cookie).send({ token });

// ---------- tests ----------

describe('Organizations, Members, Invitations (Phase 3)', () => {
  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('creating organizations', () => {
    it('verified user creates an org and becomes Admin; unverified gets 403; anonymous gets 401', async () => {
      const { cookie } = await loggedInUser();
      const res = await request(app)
        .post('/api/v1/orgs')
        .set('Cookie', cookie)
        .send({ name: 'Acme University', slug: 'acme-univ' });

      expect(res.status).toBe(201);
      expect(res.body.organization).toMatchObject({ slug: 'acme-univ', portalEnabled: false, myRole: 'ADMIN' });
      expect(res.body.membership.role).toBe('ADMIN');

      const { cookie: unverifiedCookie } = await loggedInUser({ emailVerifiedAt: null });
      const unverified = await request(app)
        .post('/api/v1/orgs')
        .set('Cookie', unverifiedCookie)
        .send({ name: 'Beta Corp', slug: 'beta-corp' });
      expect(unverified.status).toBe(403);
      expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      const anonymous = await request(app).post('/api/v1/orgs').send({ name: 'Gamma', slug: 'gamma' });
      expect(anonymous.status).toBe(401);

      expect(await prisma.organization.count()).toBe(1);
    });

    it('enforces slug rules: format, reserved words, lowercase, uniqueness', async () => {
      const { cookie } = await loggedInUser();
      const create = (slug: string) =>
        request(app).post('/api/v1/orgs').set('Cookie', cookie).send({ name: 'Some Org', slug });

      for (const bad of ['admin', '-bad-', 'ab', 'has_underscore', 'a'.repeat(41), 'ends-with-']) {
        const res = await create(bad);
        expect(res.status, `slug "${bad}" should be rejected`).toBe(400);
        expect(res.body.error.fields.slug).toBeDefined();
      }

      const ok = await create('Good-Org');
      expect(ok.status).toBe(201);
      expect(ok.body.organization.slug).toBe('good-org');

      const dup = await create('good-org');
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      expect(dup.body.error.fields.slug).toBeDefined();
    });

    it('concurrent creation with the same slug: exactly one wins, the rest get 409', async () => {
      const users = await Promise.all([1, 2, 3, 4, 5].map(() => loggedInUser()));
      const results = await Promise.all(
        users.map(({ cookie }) =>
          request(app).post('/api/v1/orgs').set('Cookie', cookie).send({ name: 'Race', slug: 'race-org' })
        )
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await prisma.organization.count({ where: { slug: 'race-org' } })).toBe(1);
      // The losers' transactions rolled back: only the winner has a membership.
      expect(await prisma.membership.count()).toBe(1);
    });
  });

  describe('my organizations and org settings', () => {
    it('same user can hold different roles in two orgs; removed memberships are hidden', async () => {
      const { user, cookie } = await loggedInUser();
      const ownerA = await createUser();
      const ownerB = await createUser();
      const ownerC = await createUser();
      const { org: orgA } = await createTestOrg(ownerA.id, { slug: 'org-a' });
      const { org: orgB } = await createTestOrg(ownerB.id, { slug: 'org-b' });
      const { org: orgC } = await createTestOrg(ownerC.id, { slug: 'org-c' });
      await addMember(orgA.id, user.id, 'ADMIN');
      await addMember(orgB.id, user.id, 'STAFF');
      await addMember(orgC.id, user.id, 'STAFF', 'REMOVED');

      const res = await request(app).get('/api/v1/me/orgs').set('Cookie', cookie);
      expect(res.status).toBe(200);
      const roles = Object.fromEntries(
        res.body.organizations.map((o: { slug: string; role: string }) => [o.slug, o.role])
      );
      expect(roles).toEqual({ 'org-a': 'ADMIN', 'org-b': 'STAFF' });

      const a = await request(app).get('/api/v1/orgs/org-a').set('Cookie', cookie);
      const b = await request(app).get('/api/v1/orgs/org-b').set('Cookie', cookie);
      expect(a.body.organization.myRole).toBe('ADMIN');
      expect(b.body.organization.myRole).toBe('STAFF');
    });

    it('Admin can rename and set portal intro; slug cannot be changed; others get 403', async () => {
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      const { org } = await createTestOrg(admin.id, { slug: 'settings-org', name: 'Old Name' });

      const res = await request(app)
        .patch('/api/v1/orgs/settings-org')
        .set('Cookie', adminCookie)
        .send({ name: 'New Name', portalIntro: 'Hello students', slug: 'hijack' });

      expect(res.status).toBe(200);
      expect(res.body.organization).toMatchObject({
        name: 'New Name',
        portalIntro: 'Hello students',
        slug: 'settings-org',
        portalEnabled: false,
      });

      for (const role of ['STAFF'] as const) {
        const { user, cookie } = await loggedInUser();
        await addMember(org.id, user.id, role);
        const denied = await request(app).patch('/api/v1/orgs/settings-org').set('Cookie', cookie).send({ name: 'X' });
        expect(denied.status).toBe(403);
      }

      const stored = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
      expect(stored.name).toBe('New Name');
      expect(stored.slug).toBe('settings-org');
    });
  });

  describe('tenant isolation', () => {
    it('non-members get 404 on every /orgs/:slug route and nothing changes', async () => {
      mockEmail();
      const owner = await createUser();
      const { org, membership } = await createTestOrg(owner.id, { slug: 'private-org', name: 'Private' });
      const inv = await prisma.invitation.create({
        data: {
          organizationId: org.id,
          email: 'pending@example.com',
          role: 'STAFF',
          tokenHash: hashToken('some-token'),
          invitedByMembershipId: membership.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const { cookie: outsider } = await loggedInUser();
      const base = '/api/v1/orgs/private-org';
      const calls = [
        request(app).get(base),
        request(app).patch(base).send({ name: 'Hacked' }),
        request(app).get(`${base}/members`),
        request(app).patch(`${base}/members/${membership.id}`).send({ role: 'STAFF' }),
        request(app).delete(`${base}/members/${membership.id}`),
        request(app).get(`${base}/invitations`),
        request(app).post(`${base}/invitations`).send({ email: 'x@example.com', role: 'ADMIN' }),
        request(app).post(`${base}/invitations/${inv.id}/resend`),
        request(app).delete(`${base}/invitations/${inv.id}`),
        request(app).get('/api/v1/orgs/does-not-exist'),
      ];

      for (const call of calls) {
        const res = await call.set('Cookie', outsider);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }

      const stored = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
      expect(stored.name).toBe('Private');
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).role).toBe('ADMIN');
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).revokedAt).toBeNull();
      expect(await prisma.invitation.count()).toBe(1);
    });

    it("an Admin of org A cannot touch org B's members through org A's URL", async () => {
      const { user: adminA, cookie: adminACookie } = await loggedInUser();
      const ownerB = await createUser();
      await createTestOrg(adminA.id, { slug: 'org-a' });
      const { membership: ownerBMembership } = await createTestOrg(ownerB.id, { slug: 'org-b' });

      const patch = await request(app)
        .patch(`/api/v1/orgs/org-a/members/${ownerBMembership.id}`)
        .set('Cookie', adminACookie)
        .send({ role: 'STAFF' });
      const del = await request(app)
        .delete(`/api/v1/orgs/org-a/members/${ownerBMembership.id}`)
        .set('Cookie', adminACookie);

      expect(patch.status).toBe(404);
      expect(del.status).toBe(404);
      const untouched = await prisma.membership.findUniqueOrThrow({ where: { id: ownerBMembership.id } });
      expect(untouched).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    });

    it('a removed member loses access on the next request; their other orgs are unaffected', async () => {
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      const { user: staff, cookie: staffCookie } = await loggedInUser();
      const otherOwner = await createUser();
      const { org: orgA } = await createTestOrg(admin.id, { slug: 'org-a' });
      const { org: orgB } = await createTestOrg(otherOwner.id, { slug: 'org-b' });
      const staffInA = await addMember(orgA.id, staff.id, 'STAFF');
      await addMember(orgB.id, staff.id, 'STAFF');

      expect((await request(app).get('/api/v1/orgs/org-a').set('Cookie', staffCookie)).status).toBe(200);

      const removed = await request(app).delete(`/api/v1/orgs/org-a/members/${staffInA.id}`).set('Cookie', adminCookie);
      expect(removed.status).toBe(200);

      // Same session cookie, very next request.
      expect((await request(app).get('/api/v1/orgs/org-a').set('Cookie', staffCookie)).status).toBe(404);
      expect((await request(app).get('/api/v1/orgs/org-b').set('Cookie', staffCookie)).status).toBe(200);

      const myOrgs = await request(app).get('/api/v1/me/orgs').set('Cookie', staffCookie);
      expect(myOrgs.body.organizations.map((o: { slug: string }) => o.slug)).toEqual(['org-b']);

      // Soft remove: the row is kept for history.
      const row = await prisma.membership.findUniqueOrThrow({ where: { id: staffInA.id } });
      expect(row.status).toBe('REMOVED');
      expect(row.removedAt).not.toBeNull();
    });
  });

  describe('managing members', () => {
    it('only Admins can change roles, remove members, or manage invitations', async () => {
      mockEmail();
      const admin = await createUser();
      const { org, membership: adminMembership } = await createTestOrg(admin.id, { slug: 'roles-org' });

      for (const role of ['STAFF'] as const) {
        const { user, cookie } = await loggedInUser();
        await addMember(org.id, user.id, role);
        const base = '/api/v1/orgs/roles-org';

        expect((await request(app).get(`${base}/members`).set('Cookie', cookie)).status).toBe(200);

        const denied = [
          request(app).patch(`${base}/members/${adminMembership.id}`).send({ role: 'STAFF' }),
          request(app).delete(`${base}/members/${adminMembership.id}`),
          request(app).get(`${base}/invitations`),
          request(app).post(`${base}/invitations`).send({ email: 'new@example.com', role: 'STAFF' }),
        ];
        for (const call of denied) {
          const res = await call.set('Cookie', cookie);
          expect(res.status, `${role} should be forbidden`).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }

      expect(await prisma.invitation.count()).toBe(0);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: adminMembership.id } })).role).toBe('ADMIN');
    });

    it('protects the last active Admin from demotion or removal', async () => {
      const { user: adminUser, cookie: adminCookie } = await loggedInUser();
      const { org, membership } = await createTestOrg(adminUser.id, { slug: 'last-admin-org' });
      const base = `/api/v1/orgs/${org.slug}/members/${membership.id}`;

      const demote = await request(app).patch(base).set('Cookie', adminCookie).send({ role: 'STAFF' });
      expect(demote.status).toBe(422);
      expect(demote.body.error.code).toBe('LAST_ADMIN');

      const remove = await request(app).delete(base).set('Cookie', adminCookie);
      expect(remove.status).toBe(422);
      expect(remove.body.error.code).toBe('LAST_ADMIN');

      // With a second Admin, the first one can step down...
      const { user: second, cookie: secondCookie } = await loggedInUser();
      const secondMembership = await addMember(org.id, second.id, 'ADMIN');
      const ok = await request(app).patch(base).set('Cookie', adminCookie).send({ role: 'STAFF' });
      expect(ok.status).toBe(200);

      // ...and now the second one is the last Admin.
      const removeSecond = await request(app)
        .delete(`/api/v1/orgs/${org.slug}/members/${secondMembership.id}`)
        .set('Cookie', secondCookie);
      expect(removeSecond.status).toBe(422);
      expect(removeSecond.body.error.code).toBe('LAST_ADMIN');
    });

    it('two Admins demoting each other at the same time still leaves one Admin', async () => {
      const { user: a, cookie: aCookie } = await loggedInUser();
      const { user: b, cookie: bCookie } = await loggedInUser();
      const { org, membership: aMembership } = await createTestOrg(a.id, { slug: 'race-admins' });
      const bMembership = await addMember(org.id, b.id, 'ADMIN');
      const base = `/api/v1/orgs/${org.slug}/members`;

      const [r1, r2] = await Promise.all([
        request(app).patch(`${base}/${bMembership.id}`).set('Cookie', aCookie).send({ role: 'STAFF' }),
        request(app).patch(`${base}/${aMembership.id}`).set('Cookie', bCookie).send({ role: 'STAFF' }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      // Either one demotion wins and the other hits LAST_ADMIN, or the loser was
      // already demoted (403) by the time its request was checked.
      expect(statuses[0]).toBe(200);
      expect([403, 422]).toContain(statuses[1]);
      expect(
        await prisma.membership.count({ where: { organizationId: org.id, role: 'ADMIN', status: 'ACTIVE' } })
      ).toBe(1);
    });

    it('rejects an invalid role and unknown or malformed member ids', async () => {
      const { user, cookie } = await loggedInUser();
      const { membership } = await createTestOrg(user.id, { slug: 'valid-org' });
      const base = '/api/v1/orgs/valid-org/members';

      const badRole = await request(app)
        .patch(`${base}/${membership.id}`)
        .set('Cookie', cookie)
        .send({ role: 'OWNER' });
      expect(badRole.status).toBe(400);

      const malformed = await request(app).patch(`${base}/not-a-uuid`).set('Cookie', cookie).send({ role: 'STAFF' });
      expect(malformed.status).toBe(404);

      const unknown = await request(app).delete(`${base}/00000000-0000-4000-8000-000000000000`).set('Cookie', cookie);
      expect(unknown.status).toBe(404);
    });
  });

  describe('invitations', () => {
    it('create -> email -> accept by the matching verified user creates the membership', async () => {
      const spy = mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      const { org } = await createTestOrg(admin.id, { slug: 'invite-org', name: 'Invite Org' });

      const res = await invite('invite-org', adminCookie, '  NewMember@Example.com ', 'STAFF');
      expect(res.status).toBe(201);
      expect(res.body.invitation.email).toBe('newmember@example.com');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].to).toBe('newmember@example.com');

      const token = tokenFromEmail(spy);
      const stored = await prisma.invitation.findFirstOrThrow({ where: { organizationId: org.id } });
      expect(stored.tokenHash).toBe(hashToken(token));
      expect(stored.tokenHash).not.toBe(token);

      const list = await request(app).get('/api/v1/orgs/invite-org/invitations').set('Cookie', adminCookie);
      expect(list.body.invitations).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(stored.tokenHash);

      // Wrong account -> rejected, invitation still usable.
      const { cookie: wrongCookie } = await loggedInUser({ email: 'wrong@example.com' });
      const wrong = await accept(wrongCookie, token);
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.message).toContain('another email');

      const { user: invitee, cookie: inviteeCookie } = await loggedInUser({ email: 'newmember@example.com' });
      const ok = await accept(inviteeCookie, token);
      expect(ok.status).toBe(200);
      expect(ok.body.organization).toEqual({ name: 'Invite Org', slug: 'invite-org' });
      expect(ok.body.role).toBe('STAFF');

      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId: org.id, userId: invitee.id },
      });
      expect(membership).toMatchObject({ role: 'STAFF', status: 'ACTIVE' });

      // Single use.
      const again = await accept(inviteeCookie, token);
      expect(again.status).toBe(400);
      // Accepted invitations leave the pending list.
      const after = await request(app).get('/api/v1/orgs/invite-org/invitations').set('Cookie', adminCookie);
      expect(after.body.invitations).toHaveLength(0);
    });

    it('rejects expired, revoked, and unknown tokens, and unverified accounts', async () => {
      const spy = mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      await createTestOrg(admin.id, { slug: 'reject-org' });
      const { cookie: inviteeCookie } = await loggedInUser({ email: 'invitee@example.com' });

      // Expired
      await invite('reject-org', adminCookie, 'invitee@example.com');
      const expiredToken = tokenFromEmail(spy, 0);
      await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await accept(inviteeCookie, expiredToken)).status).toBe(400);

      // Expired invitations stay listed (flagged) so the Admin can resend them.
      const list = await request(app).get('/api/v1/orgs/reject-org/invitations').set('Cookie', adminCookie);
      expect(list.body.invitations[0].expired).toBe(true);

      // Revoked
      const invId = list.body.invitations[0].id;
      const revoke = await request(app)
        .delete(`/api/v1/orgs/reject-org/invitations/${invId}`)
        .set('Cookie', adminCookie);
      expect(revoke.status).toBe(200);
      await invite('reject-org', adminCookie, 'invitee@example.com');
      const revokedToken = tokenFromEmail(spy, 1);
      const second = await prisma.invitation.findFirstOrThrow({ where: { revokedAt: null } });
      await request(app).delete(`/api/v1/orgs/reject-org/invitations/${second.id}`).set('Cookie', adminCookie);
      expect((await accept(inviteeCookie, revokedToken)).status).toBe(400);

      // Unknown token
      expect((await accept(inviteeCookie, 'totally-made-up-token')).status).toBe(400);

      // Unverified account (even with the right email) is blocked before anything else.
      const { cookie: unverifiedCookie } = await loggedInUser({ emailVerifiedAt: null });
      const unverified = await accept(unverifiedCookie, revokedToken);
      expect(unverified.status).toBe(403);
      expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      expect(await prisma.membership.count()).toBe(1); // only the admin
    });

    it('resend issues a new token and the old link stops working', async () => {
      const spy = mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      await createTestOrg(admin.id, { slug: 'resend-org' });

      const created = await invite('resend-org', adminCookie, 'late@example.com');
      const oldToken = tokenFromEmail(spy, 0);

      const resent = await request(app)
        .post(`/api/v1/orgs/resend-org/invitations/${created.body.invitation.id}/resend`)
        .set('Cookie', adminCookie);
      expect(resent.status).toBe(200);
      const newToken = tokenFromEmail(spy, 1);
      expect(newToken).not.toBe(oldToken);

      const { cookie } = await loggedInUser({ email: 'late@example.com' });
      expect((await accept(cookie, oldToken)).status).toBe(400);
      expect((await accept(cookie, newToken)).status).toBe(200);
    });

    it('rejects inviting an active member (ALREADY_MEMBER) and a duplicate pending invite (CONFLICT)', async () => {
      mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser({ email: 'boss@example.com' });
      const { org } = await createTestOrg(admin.id, { slug: 'dup-org' });
      const member = await createUser({ email: 'member@example.com' });
      await addMember(org.id, member.id, 'STAFF');

      const existing = await invite('dup-org', adminCookie, 'MEMBER@example.com');
      expect(existing.status).toBe(409);
      expect(existing.body.error.code).toBe('ALREADY_MEMBER');

      const self = await invite('dup-org', adminCookie, 'boss@example.com');
      expect(self.body.error.code).toBe('ALREADY_MEMBER');

      expect((await invite('dup-org', adminCookie, 'fresh@example.com')).status).toBe(201);
      const dup = await invite('dup-org', adminCookie, 'fresh@example.com');
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');

      expect(await prisma.invitation.count()).toBe(1);
    });

    it('accepting an invitation reactivates a previously removed member (same row, new role)', async () => {
      const spy = mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      const { org } = await createTestOrg(admin.id, { slug: 'reactivate-org' });
      const { user: former, cookie: formerCookie } = await loggedInUser({ email: 'former@example.com' });
      const oldRow = await addMember(org.id, former.id, 'STAFF', 'REMOVED');

      // A removed member is not "already a member", so they can be invited again.
      expect((await invite('reactivate-org', adminCookie, 'former@example.com', 'ADMIN')).status).toBe(201);

      const res = await accept(formerCookie, tokenFromEmail(spy));
      expect(res.status).toBe(200);
      expect(res.body.membershipId).toBe(oldRow.id);

      const row = await prisma.membership.findUniqueOrThrow({ where: { id: oldRow.id } });
      expect(row).toMatchObject({ status: 'ACTIVE', role: 'ADMIN', removedAt: null });
      expect(await prisma.membership.count({ where: { organizationId: org.id, userId: former.id } })).toBe(1);
    });

    it('two simultaneous accepts of the same link: one succeeds, one is rejected', async () => {
      const spy = mockEmail();
      const { user: admin, cookie: adminCookie } = await loggedInUser();
      const { org } = await createTestOrg(admin.id, { slug: 'double-accept' });
      await invite('double-accept', adminCookie, 'twice@example.com');
      const token = tokenFromEmail(spy);

      const { user, cookie } = await loggedInUser({ email: 'twice@example.com' });
      const results = await Promise.all([accept(cookie, token), accept(cookie, token)]);
      const statuses = results.map((r) => r.status).sort();

      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]);
      expect(await prisma.membership.count({ where: { organizationId: org.id, userId: user.id } })).toBe(1);
    });
  });
});
