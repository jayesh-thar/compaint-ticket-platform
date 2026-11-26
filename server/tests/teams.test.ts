import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { createOrgWithAdmin, createMember, createTeam, createCategory } from './helpers/factories.js';

const app = createApp();

describe('Teams and categories (Phase 4)', () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('teams', () => {
    it('Admin creates, renames, archives a team; duplicate names are case-insensitive', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const base = `/api/v1/orgs/${org.slug}/teams`;

      const created = await request(app).post(base).set('Cookie', admin.cookie).send({ name: 'IT Support' });
      expect(created.status).toBe(201);
      expect(created.body.team).toMatchObject({ name: 'IT Support', archived: false, members: [] });

      const dup = await request(app).post(base).set('Cookie', admin.cookie).send({ name: '  it support ' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.fields.name).toBeDefined();

      const tooShort = await request(app).post(base).set('Cookie', admin.cookie).send({ name: 'x' });
      expect(tooShort.status).toBe(400);

      const id = created.body.team.id;
      const renamed = await request(app).patch(`${base}/${id}`).set('Cookie', admin.cookie).send({ name: 'IT' });
      expect(renamed.body.team.name).toBe('IT');

      const archived = await request(app).patch(`${base}/${id}`).set('Cookie', admin.cookie).send({ archived: true });
      expect(archived.body.team.archived).toBe(true);

      // Selection list hides archived teams; the management view still shows them.
      const visible = await request(app).get(base).set('Cookie', admin.cookie);
      expect(visible.body.teams).toHaveLength(0);
      const all = await request(app).get(`${base}?includeArchived=true`).set('Cookie', admin.cookie);
      expect(all.body.teams).toHaveLength(1);
    });

    it('Admin adds members, toggles Lead, removes them; the actor picks up team ids', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const team = await createTeam(org.id, 'IT');
      const staff = await createMember(org.id, 'STAFF');
      const url = `/api/v1/orgs/${org.slug}/teams/${team.id}/members/${staff.membership.id}`;

      const added = await request(app).put(url).set('Cookie', admin.cookie).send({});
      expect(added.status).toBe(200);
      expect(added.body.team.members).toEqual([
        expect.objectContaining({ membershipId: staff.membership.id, isLead: false }),
      ]);

      const lead = await request(app).put(url).set('Cookie', admin.cookie).send({ isLead: true });
      expect(lead.body.team.members[0].isLead).toBe(true);

      // The members list shows each person's teams (used by assignee pickers).
      const members = await request(app).get(`/api/v1/orgs/${org.slug}/members`).set('Cookie', staff.cookie);
      const me = members.body.members.find((m: { membershipId: string }) => m.membershipId === staff.membership.id);
      expect(me.teams).toEqual([expect.objectContaining({ id: team.id, isLead: true })]);

      const removed = await request(app).delete(url).set('Cookie', admin.cookie);
      expect(removed.status).toBe(200);
      expect(removed.body.team.members).toHaveLength(0);
      expect((await request(app).delete(url).set('Cookie', admin.cookie)).status).toBe(404);
    });

    it('cannot add a non-member, a removed member, or anyone to an archived team', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const other = await createOrgWithAdmin();
      const team = await createTeam(org.id, 'IT');
      const archivedTeam = await createTeam(org.id, 'Old', { archived: true });
      const foreignStaff = await createMember(other.org.id, 'STAFF');
      const removed = await createMember(org.id, 'STAFF');
      await prisma.membership.update({ where: { id: removed.membership.id }, data: { status: 'REMOVED' } });
      const staff = await createMember(org.id, 'STAFF');
      const base = `/api/v1/orgs/${org.slug}/teams`;

      const foreign = await request(app)
        .put(`${base}/${team.id}/members/${foreignStaff.membership.id}`)
        .set('Cookie', admin.cookie)
        .send({});
      expect(foreign.status).toBe(404);

      const gone = await request(app)
        .put(`${base}/${team.id}/members/${removed.membership.id}`)
        .set('Cookie', admin.cookie)
        .send({});
      expect(gone.status).toBe(404);

      const toArchived = await request(app)
        .put(`${base}/${archivedTeam.id}/members/${staff.membership.id}`)
        .set('Cookie', admin.cookie)
        .send({});
      expect(toArchived.status).toBe(422);

      expect(await prisma.teamMember.count()).toBe(0);
    });

    it('removing a member from the organization removes them from its teams', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const team = await createTeam(org.id, 'IT');
      const staff = await createMember(org.id, 'STAFF', { teams: [{ teamId: team.id, isLead: true }] });

      const res = await request(app)
        .delete(`/api/v1/orgs/${org.slug}/members/${staff.membership.id}`)
        .set('Cookie', admin.cookie);
      expect(res.status).toBe(200);
      expect(await prisma.teamMember.count({ where: { membershipId: staff.membership.id } })).toBe(0);
    });
  });

  describe('categories', () => {
    it('Admin creates and edits categories with a default team; duplicates rejected', async () => {
      const { org, admin } = await createOrgWithAdmin();
      const team = await createTeam(org.id, 'IT');
      const base = `/api/v1/orgs/${org.slug}/categories`;

      const created = await request(app)
        .post(base)
        .set('Cookie', admin.cookie)
        .send({ name: 'Wi-Fi', isPublic: true, defaultTeamId: team.id });
      expect(created.status).toBe(201);
      expect(created.body.category).toMatchObject({
        name: 'Wi-Fi',
        isPublic: true,
        defaultTeam: { id: team.id, name: 'IT' },
      });

      const dup = await request(app).post(base).set('Cookie', admin.cookie).send({ name: 'WI-FI' });
      expect(dup.status).toBe(409);

      const id = created.body.category.id;
      const edited = await request(app)
        .patch(`${base}/${id}`)
        .set('Cookie', admin.cookie)
        .send({ isPublic: false, defaultTeamId: null });
      expect(edited.body.category).toMatchObject({ isPublic: false, defaultTeam: null });

      await request(app).patch(`${base}/${id}`).set('Cookie', admin.cookie).send({ archived: true });
      expect((await request(app).get(base).set('Cookie', admin.cookie)).body.categories).toHaveLength(0);
      expect(
        (await request(app).get(`${base}?includeArchived=true`).set('Cookie', admin.cookie)).body.categories
      ).toHaveLength(1);
    });

    it("rejects another organization's team or an archived team as default", async () => {
      const { org, admin } = await createOrgWithAdmin();
      const other = await createOrgWithAdmin();
      const foreignTeam = await createTeam(other.org.id, 'Their IT');
      const archived = await createTeam(org.id, 'Old', { archived: true });
      const base = `/api/v1/orgs/${org.slug}/categories`;

      const foreign = await request(app)
        .post(base)
        .set('Cookie', admin.cookie)
        .send({ name: 'Wi-Fi', defaultTeamId: foreignTeam.id });
      expect(foreign.status).toBe(422);
      expect(foreign.body.error.fields.defaultTeamId).toBeDefined();

      const old = await request(app)
        .post(base)
        .set('Cookie', admin.cookie)
        .send({ name: 'Wi-Fi', defaultTeamId: archived.id });
      expect(old.status).toBe(422);
      expect(await prisma.category.count()).toBe(0);
    });
  });

  describe('permissions and isolation', () => {
    it('only Admin manages teams and categories; other members can read', async () => {
      const { org } = await createOrgWithAdmin();
      const team = await createTeam(org.id, 'IT');
      const category = await createCategory(org.id);
      const manager = await createMember(org.id, 'MANAGER');
      const lead = await createMember(org.id, 'STAFF', { teams: [{ teamId: team.id, isLead: true }] });

      for (const who of [manager, lead]) {
        const c = who.cookie;
        const base = `/api/v1/orgs/${org.slug}`;
        expect((await request(app).get(`${base}/teams`).set('Cookie', c)).status).toBe(200);
        expect((await request(app).get(`${base}/categories`).set('Cookie', c)).status).toBe(200);
        expect((await request(app).post(`${base}/teams`).set('Cookie', c).send({ name: 'New' })).status).toBe(403);
        expect(
          (await request(app).patch(`${base}/teams/${team.id}`).set('Cookie', c).send({ name: 'X1' })).status
        ).toBe(403);
        expect(
          (
            await request(app)
              .put(`${base}/teams/${team.id}/members/${who.membership.id}`)
              .set('Cookie', c)
              .send({ isLead: true })
          ).status
        ).toBe(403);
        expect((await request(app).post(`${base}/categories`).set('Cookie', c).send({ name: 'New' })).status).toBe(403);
        expect(
          (await request(app).patch(`${base}/categories/${category.id}`).set('Cookie', c).send({ isPublic: true }))
            .status
        ).toBe(403);
      }
    });

    it("an Admin of org A cannot read or change org B's teams/categories (404, nothing changes)", async () => {
      const a = await createOrgWithAdmin();
      const b = await createOrgWithAdmin();
      const bTeam = await createTeam(b.org.id, 'B IT');
      const bCategory = await createCategory(b.org.id, { name: 'B Wi-Fi' });
      const c = a.admin.cookie;

      // Through B's URL: not a member -> 404.
      expect((await request(app).get(`/api/v1/orgs/${b.org.slug}/teams`).set('Cookie', c)).status).toBe(404);
      expect(
        (await request(app).post(`/api/v1/orgs/${b.org.slug}/teams`).set('Cookie', c).send({ name: 'Hack' })).status
      ).toBe(404);

      // Through A's URL with B's ids: still 404.
      expect(
        (
          await request(app)
            .patch(`/api/v1/orgs/${a.org.slug}/teams/${bTeam.id}`)
            .set('Cookie', c)
            .send({ name: 'Hacked' })
        ).status
      ).toBe(404);
      expect(
        (
          await request(app)
            .patch(`/api/v1/orgs/${a.org.slug}/categories/${bCategory.id}`)
            .set('Cookie', c)
            .send({ name: 'Hacked' })
        ).status
      ).toBe(404);
      expect(
        (
          await request(app)
            .put(`/api/v1/orgs/${a.org.slug}/teams/${bTeam.id}/members/${a.admin.membership.id}`)
            .set('Cookie', c)
            .send({})
        ).status
      ).toBe(404);

      expect((await prisma.team.findUniqueOrThrow({ where: { id: bTeam.id } })).name).toBe('B IT');
      expect((await prisma.category.findUniqueOrThrow({ where: { id: bCategory.id } })).name).toBe('B Wi-Fi');
      expect(await prisma.team.count({ where: { organizationId: b.org.id } })).toBe(1);
    });
  });
});
