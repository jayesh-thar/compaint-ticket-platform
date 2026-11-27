import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { cleanDatabase } from './helpers/db.js';
import { createMember, createSession, createUser } from './helpers/factories.js';
import { buildWorld, as, type World } from './helpers/world.js';

const app = createApp();
let w: World;
let sent: { to: string; link?: { url: string } }[];
const api = (who: { cookie: string }) => as(app, w.org.slug, who.cookie);
const lastToken = () => sent[sent.length - 1].link!.url.split('#token=')[1];
const accept = (cookie: string, token: string) =>
  request(app).post('/api/v1/invitations/accept').set('Cookie', cookie).send({ token });

describe('Organization structure (README 0.2, 0.3, 0.8)', () => {
  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
    sent = [];
    vi.spyOn(emailTransport, 'send').mockImplementation(async (o) => {
      sent.push(o);
    });
    w = await buildWorld();
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('categories group teams; a team can be in several categories; all show on the complaint form', async () => {
    const created = await api(w.admin).post('/categories', {
      name: 'Network issue',
      teamIds: [w.net.id, w.team2.id], // team2 stays in "Server issue" too (D-31)
      leadMembershipId: w.netLead.membership.id,
    });
    expect(created.status).toBe(201);
    const cats = (await api(w.m1).get('/categories')).body.categories;
    const byName = Object.fromEntries(cats.map((c: { name: string }) => [c.name, c]));
    expect(byName['Network issue'].teams.map((t: { name: string }) => t.name)).toEqual(['Network', 'Server team 02']);
    expect(byName['Network issue'].lead.label).toBe('Network issue - Lead');
    expect(byName['Server issue'].teams.map((t: { name: string }) => t.name)).toEqual([
      'Server team 01',
      'Server team 02',
    ]);
    const team2 = (await api(w.admin).get('/teams')).body.teams.find((t: { id: string }) => t.id === w.team2.id);
    expect(team2.categories.map((c: { name: string }) => c.name)).toEqual(['Network issue', 'Server issue']);

    // A new team with two categories at once; editing replaces the list.
    const t = await api(w.admin).post('/teams', {
      name: 'Web team',
      categoryIds: [w.category.id, created.body.category.id],
    });
    expect(t.status).toBe(201);
    const portal = (await request(app).get(`/api/v1/public/portals/${w.org.slug}`)).body.portal;
    expect(portal.categories.map((c: { name: string }) => c.name)).toEqual(['Network issue', 'Server issue']);
    await api(w.admin).patch(`/teams/${t.body.team.id}`, { categoryIds: [w.category.id] });
    expect(
      (await api(w.admin).get(`/teams/${t.body.team.id}`)).body.team.categories.map((c: { name: string }) => c.name)
    ).toEqual(['Server issue']);

    expect((await api(w.lead1).post('/categories', { name: 'Nope' })).status).toBe(403);
    expect((await api(w.admin).post('/categories', { name: 'network ISSUE' })).status).toBe(409);
    // Archiving a category releases its teams (they stay in their other categories).
    await api(w.admin).patch(`/categories/${created.body.category.id}`, { archived: true });
    const after = await prisma.team.findUniqueOrThrow({ where: { id: w.team2.id }, include: { categories: true } });
    expect(after.categories.map((c) => c.name)).toEqual(['Server issue']);
  });

  it('a team in two categories can be chosen by both Category Leads', async () => {
    const lead = await createMember(w.org.id, 'STAFF', { name: 'Web Lead' });
    const web = (
      await api(w.admin).post('/categories', {
        name: 'Website issue',
        teamIds: [w.team1.id],
        leadMembershipId: lead.membership.id,
      })
    ).body.category;
    await request(app)
      .post(`/api/v1/public/portals/${w.org.slug}/complaints`)
      .send({
        name: 'Cust',
        email: 'c@x.test',
        phoneCode: '+1',
        phone: '5551234',
        subject: 'Site slow',
        description: 'The site is very slow today.',
        categoryId: web.id,
      });
    await api(w.admin).post('/tickets/1/actions/approve', { categoryId: web.id });
    expect((await api(w.catLead).get('/tickets/1')).status).toBe(404); // other category's Lead
    const routed = await api(lead).post('/tickets/1/actions/route', { teamId: w.team1.id });
    expect(routed.body.ticket).toMatchObject({
      stage: 'AT_TEAM',
      category: { name: 'Website issue' },
      team: { id: w.team1.id },
    });
    expect((await api(lead).post('/tickets/1/actions/route', { teamId: w.team2.id })).status).toBe(409);
  });

  it('one leader per team: Admin replaces the leader; leaders cannot change leaders', async () => {
    const r = await api(w.admin).put(`/teams/${w.team1.id}/members/${w.m1.membership.id}`, {
      teamRole: 'LEADER',
      leaderTitle: 'MANAGER',
    });
    expect(r.status).toBe(200);
    const team = (await api(w.admin).get(`/teams/${w.team1.id}`)).body.team;
    expect(team.leader).toMatchObject({ membershipId: w.m1.membership.id, title: 'MANAGER' });
    expect(team.members.filter((m: { teamRole: string }) => m.teamRole === 'LEADER')).toHaveLength(1);
    expect(
      (await api(w.admin).put(`/teams/${w.team1.id}/members/${w.m2.membership.id}`, { teamRole: 'LEADER' })).status
    ).toBe(400);

    // The new leader may add an existing member to their team, not make leaders, not touch other teams.
    expect((await api(w.m1).put(`/teams/${w.team1.id}/members/${w.outsider.membership.id}`, {})).status).toBe(200);
    expect(
      (
        await api(w.m1).put(`/teams/${w.team1.id}/members/${w.m2.membership.id}`, {
          teamRole: 'LEADER',
          leaderTitle: 'HEAD',
        })
      ).status
    ).toBe(403);
    expect((await api(w.m1).put(`/teams/${w.net.id}/members/${w.outsider.membership.id}`, {})).status).toBe(403);
    expect((await api(w.m1).del(`/teams/${w.team1.id}/members/${w.outsider.membership.id}`)).status).toBe(200);
  });

  it('team page: members, Admin, Category Lead see it; emails only for managers; others get 404', async () => {
    expect((await api(w.m1).get(`/teams/${w.team1.id}`)).body.team.members[0].email).toBeNull();
    expect((await api(w.lead1).get(`/teams/${w.team1.id}`)).body.permissions.canManageMembers).toBe(true);
    expect((await api(w.catLead).get(`/teams/${w.team1.id}`)).status).toBe(200);
    expect((await api(w.m3).get(`/teams/${w.team1.id}`)).status).toBe(404);
    expect((await api(w.outsider).get(`/teams/${w.team1.id}`)).status).toBe(404);
  });

  it('Admin invites a team leader; the link joins the team once; a second use fails', async () => {
    const team = (await api(w.admin).post('/teams', { name: 'Database' })).body.team;
    const inv = await api(w.admin).post('/invitations', {
      email: 'dba@example.com',
      jobTitle: 'Database engineer',
      teamId: team.id,
      teamRole: 'LEADER',
      leaderTitle: 'HEAD',
    });
    expect(inv.status).toBe(201);
    expect(sent.at(-1)?.link?.url).toMatch(/\/invite#token=/);
    const token = lastToken();

    const user = await createUser({ email: 'dba@example.com' });
    const { cookie } = await createSession(user.id);
    expect((await accept(cookie, token)).status).toBe(200);
    expect((await accept(cookie, token)).status).toBe(400); // link expires on use
    const tm = await prisma.teamMember.findFirstOrThrow({ where: { teamId: team.id } });
    expect(tm).toMatchObject({ role: 'LEADER', leaderTitle: 'HEAD' });
    expect((await api(w.admin).get('/members/job-titles')).body.jobTitles).toContain('Database engineer');

    // A team that has a leader cannot get a second leader invitation.
    expect(
      (
        await api(w.admin).post('/invitations', {
          email: 'x@example.com',
          teamId: team.id,
          teamRole: 'LEADER',
          leaderTitle: 'LEAD',
        })
      ).status
    ).toBe(409);
  });

  it('leaders invite members to their own team only; existing staff are added to the team', async () => {
    expect(
      (await api(w.lead1).post('/invitations', { email: 'n@example.com', teamId: w.team1.id, teamRole: 'MEMBER' }))
        .status
    ).toBe(201);
    for (const body of [
      { email: 'a@example.com', teamId: w.team2.id, teamRole: 'MEMBER' },
      { email: 'b@example.com', role: 'ADMIN', teamId: w.team1.id, teamRole: 'MEMBER' },
      { email: 'c@example.com', teamId: w.team1.id, teamRole: 'LEADER', leaderTitle: 'LEAD' },
      { email: 'd@example.com' },
    ]) {
      expect((await api(w.lead1).post('/invitations', body)).status, JSON.stringify(body)).toBe(403);
    }
    expect(
      (await api(w.m1).post('/invitations', { email: 'e@example.com', teamId: w.team1.id, teamRole: 'MEMBER' })).status
    ).toBe(403);
    expect((await api(w.lead1).get('/invitations')).body.invitations).toHaveLength(1);
    expect((await api(w.m1).get('/invitations')).status).toBe(403);

    // The outsider (already staff) is invited into team 1 and joins it on accept.
    const outsiderEmail = w.outsider.user.email;
    expect(
      (await api(w.lead1).post('/invitations', { email: outsiderEmail, teamId: w.team1.id, teamRole: 'MEMBER' })).status
    ).toBe(201);
    expect((await accept(w.outsider.cookie, lastToken())).status).toBe(200);
    expect(
      await prisma.teamMember.count({ where: { teamId: w.team1.id, membershipId: w.outsider.membership.id } })
    ).toBe(1);
  });

  it('wrong account and a leader taken meanwhile are refused cleanly', async () => {
    const team = (await api(w.admin).post('/teams', { name: 'Security' })).body.team;
    await api(w.admin).post('/invitations', {
      email: 'sec@example.com',
      teamId: team.id,
      teamRole: 'LEADER',
      leaderTitle: 'LEAD',
    });
    const token = lastToken();
    expect((await accept(w.m1.cookie, token)).status).toBe(403);

    await api(w.admin).put(`/teams/${team.id}/members/${w.m2.membership.id}`, {
      teamRole: 'LEADER',
      leaderTitle: 'HEAD',
    });
    const user = await createUser({ email: 'sec@example.com' });
    const { cookie } = await createSession(user.id);
    expect((await accept(cookie, token)).status).toBe(409);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0); // rolled back
  });

  it("job titles: Admin or the person's leader edits; others cannot", async () => {
    expect(
      (
        await api(w.lead1).patch(`/members/${w.m1.membership.id}/job-title`, {
          jobTitle: 'Network layer security eng.',
        })
      ).status
    ).toBe(200);
    expect((await api(w.lead1).patch(`/members/${w.m3.membership.id}/job-title`, { jobTitle: 'X' })).status).toBe(403);
    expect((await api(w.m1).patch(`/members/${w.m2.membership.id}/job-title`, { jobTitle: 'X' })).status).toBe(403);
    expect((await api(w.m1).get('/members/job-titles')).body.jobTitles).toEqual(['Network layer security eng.']);
  });

  it('removing someone from the organization clears their team and Category Lead roles', async () => {
    expect((await api(w.admin).del(`/members/${w.catLead.membership.id}`)).status).toBe(200);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: w.category.id } })).leadMembershipId).toBeNull();
    expect((await api(w.admin).del(`/members/${w.lead1.membership.id}`)).status).toBe(200);
    expect(await prisma.teamMember.count({ where: { membershipId: w.lead1.membership.id } })).toBe(0);
    expect((await api(w.lead1).get('/teams')).status).toBe(404);
  });

  it('me block tells the client what the caller is', async () => {
    const extra = await createMember(w.org.id, 'STAFF', { teams: [{ teamId: w.team2.id }] });
    const me = (await api(extra).get('')).body.me;
    expect(me).toMatchObject({ role: 'STAFF', leadTeamIds: [], leadCategoryIds: [] });
    expect((await api(w.catLead).get('')).body.me.ledCategories).toEqual([{ id: w.category.id, name: 'Server issue' }]);
    expect((await api(w.lead1).get('')).body.me.teams[0]).toMatchObject({ teamRole: 'LEADER', leaderTitle: 'HEAD' });
  });
});
