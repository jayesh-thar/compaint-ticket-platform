import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { cleanDatabase } from './helpers/db.js';
import { buildWorld, as, complaint } from './helpers/world.js';

describe('Public complaint form and tracking (README 0.4, D-22)', () => {
  const app = createApp();
  let sent: { link?: { kind: string; url: string } }[];

  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
    sent = [];
    vi.spyOn(emailTransport, 'send').mockImplementation(async (o) => {
      sent.push(o);
    });
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('shows the form with categories; a guest submits; the email carries the private tracking link', async () => {
    const w = await buildWorld('acme');
    const page = (await request(app).get('/api/v1/public/portals/acme')).body.portal;
    expect(page).toMatchObject({ name: w.org.name, accepting: true, categories: [{ name: 'Server issue' }] });

    const res = await complaint(app, 'acme', { categoryId: w.category.id });
    expect(res.status).toBe(201);
    expect(sent[0].link).toMatchObject({ kind: 'COMPLAINT_TRACKING' });
    expect(sent[0].link!.url).toContain(`#token=${res.body.trackingToken}`);

    const t = await prisma.ticket.findFirstOrThrow();
    expect(t).toMatchObject({
      kind: 'COMPLAINT',
      stage: 'PENDING_APPROVAL',
      customerPhoneCode: '+91',
      categoryId: w.category.id,
    });
    expect(t.trackingTokenHash).not.toBe(res.body.trackingToken); // only the hash is stored

    const track = await request(app).post('/api/v1/public/track').send({ token: res.body.trackingToken });
    expect(track.body.complaint).toMatchObject({
      reference: 'T-1',
      status: 'Received - waiting for review',
      category: 'Server issue',
    });
    expect(JSON.stringify(track.body)).not.toMatch(/asha@|Lead|Member/);
    expect(
      (
        await request(app)
          .post('/api/v1/public/track')
          .send({ token: 'x'.repeat(43) })
      ).status
    ).toBe(404);
  });

  it('accepts very long text: no length limit on the complaint form', async () => {
    await buildWorld('acme');
    const long = 'x'.repeat(50_000);
    const res = await complaint(app, 'acme', { subject: 's'.repeat(1000), description: long });
    expect(res.status).toBe(201);
    expect((await prisma.ticket.findFirstOrThrow()).description).toHaveLength(50_000);
    expect((await complaint(app, 'acme', { description: '   ' })).body.error.fields.description).toBeDefined();
  });

  it('refuses a closed portal, unknown category, bad phone; a bot filling the honeypot stores nothing', async () => {
    const w = await buildWorld('acme');
    const other = await buildWorld('other');
    expect((await complaint(app, 'acme', { categoryId: other.category.id })).status).toBe(422);
    expect((await complaint(app, 'acme', { phone: 'call me' })).body.error.fields.phone).toBeDefined();
    expect((await complaint(app, 'acme', { website: 'http://spam.example' })).status).toBe(201);
    expect(await prisma.ticket.count()).toBe(0);

    await prisma.organization.update({ where: { id: w.org.id }, data: { portalEnabled: false } });
    expect((await complaint(app, 'acme')).status).toBe(422);
    expect((await request(app).get('/api/v1/public/portals/acme')).body.portal).toMatchObject({
      accepting: false,
      categories: [],
    });
    expect((await request(app).get('/api/v1/public/portals/nope')).status).toBe(404);
  });

  it('rate limit: 10 complaint requests per hour per IP, then 429', async () => {
    await buildWorld('acme');
    // The limiter counts per process, so earlier tests in this file already used
    // some of the 10. Exactly 11 requests in total are needed to see a 429.
    const earlier = 7; // 1 + 2 + 4 requests sent by the three tests above
    let accepted = 0;
    let blocked = await complaint(app, 'acme');
    while (blocked.status === 201 && accepted < 20) {
      accepted++;
      blocked = await complaint(app, 'acme');
    }
    expect(earlier + accepted).toBe(10);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('Tenant isolation (D-12)', () => {
  const app = createApp();
  beforeEach(async () => {
    await cleanDatabase();
    vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it("an Admin of org A gets 404 for B's ids through A's URL and for B's URL; B stays unchanged", async () => {
    const a = await buildWorld('org-a');
    const b = await buildWorld('org-b');
    await as(app, 'org-b', b.admin.cookie).post('/tickets', {
      subject: 'B secret',
      description: 'Only for B',
      teamId: b.team1.id,
    });
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all([
          prisma.ticket.findMany({ where: { organizationId: b.org.id }, orderBy: { number: 'asc' } }),
          prisma.teamMember.findMany({ where: { organizationId: b.org.id }, orderBy: { id: 'asc' } }),
          prisma.category.findMany({ where: { organizationId: b.org.id } }),
          prisma.membership.findMany({ where: { organizationId: b.org.id }, orderBy: { id: 'asc' } }),
        ])
      );
    const before = await snapshot();

    const viaA = as(app, 'org-a', a.admin.cookie);
    const calls = [
      viaA.get(`/teams/${b.team1.id}`),
      viaA.patch(`/teams/${b.team1.id}`, { name: 'hacked' }),
      viaA.put(`/teams/${b.team1.id}/members/${b.m1.membership.id}`, {}),
      viaA.del(`/teams/${b.team1.id}/members/${b.m1.membership.id}`),
      viaA.patch(`/categories/${b.category.id}`, { name: 'hacked' }),
      viaA.patch(`/members/${b.m1.membership.id}`, { role: 'ADMIN' }),
      viaA.patch(`/members/${b.m1.membership.id}/job-title`, { jobTitle: 'x' }),
      viaA.del(`/members/${b.m1.membership.id}`),
    ];
    for (const res of await Promise.all(calls)) expect([404, 422]).toContain(res.status);
    // Ticket T-1 of A does not exist; B's T-1 is never reachable through A.
    expect((await viaA.get('/tickets/1')).status).toBe(404);
    expect((await viaA.post('/categories', { name: 'Mixed', teamIds: [b.team1.id] })).status).toBe(422);
    expect(
      (await viaA.post('/tickets', { subject: 'Cross', description: 'Cross org team', teamId: b.team1.id })).status
    ).toBe(422);

    const viaB = as(app, 'org-b', a.admin.cookie);
    for (const p of ['', '/tickets', '/tickets/1', '/teams', '/dashboard', '/graph', '/members', '/events']) {
      expect((await viaB.get(p)).status, p).toBe(404);
    }
    expect(await snapshot()).toBe(before);
  });
});
