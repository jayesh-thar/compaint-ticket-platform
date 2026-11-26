import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

/**
 * Isolation suite (planning Phase 10): two organizations with members in each.
 * An Admin of A (all permissions in A) calls EVERY workspace endpoint
 *   1. through B's URL          (/orgs/<b-slug>/...)       and
 *   2. through A's URL with B's ids (/orgs/<a-slug>/.../<b-id>)
 * Every call must answer 404, and nothing in B may change.
 */

const app = createApp();

type World = Awaited<ReturnType<typeof build>>;

const build = async () => {
  const a = await createOrgWithAdmin();
  const b = await createOrgWithAdmin();
  const bTeam = await createTeam(b.org.id, 'B Team');
  const bCategory = await createCategory(b.org.id, { name: 'B Category', isPublic: true, defaultTeamId: bTeam.id });
  const bStaff = await createMember(b.org.id, 'STAFF', { teams: [{ teamId: bTeam.id }] });
  const bRequester = await createUser();
  const bTicket = await createTicket(b.org.id, { teamId: bTeam.id, source: 'PORTAL', requesterId: bRequester.id });
  const bInvitation = await prisma.invitation.create({
    data: {
      organizationId: b.org.id,
      email: 'pending@example.com',
      role: 'STAFF',
      tokenHash: 'b-invite-hash',
      invitedByMembershipId: b.admin.membership.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  // A has its own ticket with the SAME number as B's, to make "number confusion" visible.
  await createTicket(a.org.id);
  return { a, b, bTeam, bCategory, bStaff, bTicket, bInvitation };
};

/** Every workspace endpoint, filled with B's ids, under a given slug. */
const endpoints = (w: World, slug: string) => {
  const t = `/api/v1/orgs/${slug}/tickets/${w.bTicket.number}`;
  return [
    ['GET', `/api/v1/orgs/${slug}`],
    ['PATCH', `/api/v1/orgs/${slug}`, { name: 'Hacked' }],
    ['GET', `/api/v1/orgs/${slug}/members`],
    ['PATCH', `/api/v1/orgs/${slug}/members/${w.bStaff.membership.id}`, { role: 'ADMIN' }],
    ['DELETE', `/api/v1/orgs/${slug}/members/${w.bStaff.membership.id}`],
    ['GET', `/api/v1/orgs/${slug}/invitations`],
    ['POST', `/api/v1/orgs/${slug}/invitations`, { email: 'evil@example.com', role: 'ADMIN' }],
    ['POST', `/api/v1/orgs/${slug}/invitations/${w.bInvitation.id}/resend`],
    ['DELETE', `/api/v1/orgs/${slug}/invitations/${w.bInvitation.id}`],
    ['GET', `/api/v1/orgs/${slug}/teams`],
    ['POST', `/api/v1/orgs/${slug}/teams`, { name: 'Evil team' }],
    ['PATCH', `/api/v1/orgs/${slug}/teams/${w.bTeam.id}`, { name: 'Hacked', archived: true }],
    ['PUT', `/api/v1/orgs/${slug}/teams/${w.bTeam.id}/members/${w.bStaff.membership.id}`, { isLead: true }],
    ['DELETE', `/api/v1/orgs/${slug}/teams/${w.bTeam.id}/members/${w.bStaff.membership.id}`],
    ['GET', `/api/v1/orgs/${slug}/categories`],
    ['POST', `/api/v1/orgs/${slug}/categories`, { name: 'Evil category' }],
    ['PATCH', `/api/v1/orgs/${slug}/categories/${w.bCategory.id}`, { name: 'Hacked', archived: true }],
    ['GET', `/api/v1/orgs/${slug}/tickets`],
    ['POST', `/api/v1/orgs/${slug}/tickets`, { subject: 'Evil ticket', description: 'Should never be created.' }],
    ['GET', t],
    ['PATCH', t, { priority: 'URGENT', subject: 'Hacked subject' }],
    ['POST', `${t}/status`, { status: 'CLOSED', closeReason: 'REJECTED', note: 'hacked' }],
    ['POST', `${t}/assignment`, { assigneeId: w.bStaff.membership.id }],
    ['POST', `${t}/subtickets`, { subject: 'Evil part', description: 'Should never be created.' }],
    ['GET', `${t}/activity`],
    ['GET', `${t}/comments`],
    ['POST', `${t}/comments`, { body: 'hacked', visibility: 'PUBLIC' }],
    ['GET', `/api/v1/orgs/${slug}/dashboard`],
  ] as [string, string, Record<string, unknown>?][];
};

/** Everything in B that an attack could change. */
const snapshotB = async (w: World) => ({
  org: await prisma.organization.findUniqueOrThrow({ where: { id: w.b.org.id } }),
  memberships: await prisma.membership.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  invitations: await prisma.invitation.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  teams: await prisma.team.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  teamMembers: await prisma.teamMember.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  categories: await prisma.category.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  tickets: await prisma.ticket.findMany({ where: { organizationId: w.b.org.id }, orderBy: { id: 'asc' } }),
  activity: await prisma.ticketActivity.count({ where: { organizationId: w.b.org.id } }),
  comments: await prisma.comment.count({ where: { organizationId: w.b.org.id } }),
  notifications: await prisma.notification.count({ where: { organizationId: w.b.org.id } }),
});

describe('Tenant isolation suite (Phase 10)', () => {
  let w: World;
  beforeAll(async () => {
    await cleanDatabase();
    w = await build();
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it("through B's URL: every workspace endpoint is 404 for A's Admin, and B is unchanged", async () => {
    const before = await snapshotB(w);
    const failures: string[] = [];
    for (const [method, url, body] of endpoints(w, w.b.org.slug)) {
      const req = request(app)[method.toLowerCase() as 'get'](url).set('Cookie', w.a.admin.cookie);
      const res = body ? await req.send(body) : await req;
      if (res.status !== 404) failures.push(`${method} ${url} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
    expect(await snapshotB(w)).toEqual(before);
  });

  it("through A's own URL with B's ids: every id-based endpoint is 404, and B is unchanged", async () => {
    const before = await snapshotB(w);
    const idBased = endpoints(w, w.a.org.slug).filter(([, url]) =>
      [w.bStaff.membership.id, w.bInvitation.id, w.bTeam.id, w.bCategory.id].some((id) => url.includes(id))
    );
    expect(idBased.length).toBeGreaterThanOrEqual(8);
    const failures: string[] = [];
    for (const [method, url, body] of idBased) {
      const req = request(app)[method.toLowerCase() as 'get'](url).set('Cookie', w.a.admin.cookie);
      const res = body ? await req.send(body) : await req;
      if (res.status !== 404) failures.push(`${method} ${url} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
    expect(await snapshotB(w)).toEqual(before);
  });

  it("ticket number 1 in A's URL is A's own ticket, never B's", async () => {
    const res = await request(app).get(`/api/v1/orgs/${w.a.org.slug}/tickets/1`).set('Cookie', w.a.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.ticket.source).toBe('INTERNAL'); // B's #1 is a PORTAL complaint
    const list = await request(app).get(`/api/v1/orgs/${w.a.org.slug}/tickets`).set('Cookie', w.a.admin.cookie);
    expect(list.body.total).toBe(1);
  });

  it("B's requester endpoints do not answer for A's Admin", async () => {
    const res = await request(app)
      .get(`/api/v1/me/tickets/${w.b.org.slug}/${w.bTicket.number}`)
      .set('Cookie', w.a.admin.cookie);
    expect(res.status).toBe(404);
    expect((await request(app).get('/api/v1/me/tickets').set('Cookie', w.a.admin.cookie)).body.total).toBe(0);
  });
});
