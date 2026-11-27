import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/config/prisma.js';
import { createCategory, createMember, createOrgWithAdmin, createTeam } from './factories.js';

/**
 * A small organization shaped like README section 0:
 *   Category "Server issue" (Lead: catLead) = Server team 01 (lead1; m1, m2) + Server team 02 (lead2; m3)
 *   Team "Network" (no category; netLead; netMember)
 *   outsider = staff with no team
 */
export const buildWorld = async (slug?: string) => {
  const { org, admin } = await createOrgWithAdmin(slug);
  const catLead = await createMember(org.id, 'STAFF', { name: 'Cat Lead' });
  const category = await createCategory(org.id, { name: 'Server issue', leadMembershipId: catLead.membership.id });
  const team1 = await createTeam(org.id, 'Server team 01', { categoryIds: [category.id] });
  const team2 = await createTeam(org.id, 'Server team 02', { categoryIds: [category.id] });
  const net = await createTeam(org.id, 'Network');
  const lead1 = await createMember(org.id, 'STAFF', { name: 'Lead One', teams: [{ teamId: team1.id, leader: true }] });
  const m1 = await createMember(org.id, 'STAFF', { name: 'Member One', teams: [{ teamId: team1.id }] });
  const m2 = await createMember(org.id, 'STAFF', { name: 'Member Two', teams: [{ teamId: team1.id }] });
  const lead2 = await createMember(org.id, 'STAFF', { name: 'Lead Two', teams: [{ teamId: team2.id, leader: true }] });
  const m3 = await createMember(org.id, 'STAFF', { name: 'Member Three', teams: [{ teamId: team2.id }] });
  const netLead = await createMember(org.id, 'STAFF', { name: 'Net Lead', teams: [{ teamId: net.id, leader: true }] });
  const netMember = await createMember(org.id, 'STAFF', { name: 'Net Member', teams: [{ teamId: net.id }] });
  const outsider = await createMember(org.id, 'STAFF', { name: 'Outsider' });
  await prisma.organization.update({ where: { id: org.id }, data: { portalEnabled: true } });
  return { org, admin, catLead, category, team1, team2, net, lead1, m1, m2, lead2, m3, netLead, netMember, outsider };
};

export type World = Awaited<ReturnType<typeof buildWorld>>;

/** Calls the workspace API of `slug` as the person owning `cookie`. */
export const as = (app: Express, slug: string, cookie: string) => {
  const base = `/api/v1/orgs/${slug}`;
  return {
    get: (p: string) =>
      request(app)
        .get(base + p)
        .set('Cookie', cookie),
    post: (p: string, body: object = {}) =>
      request(app)
        .post(base + p)
        .set('Cookie', cookie)
        .send(body),
    patch: (p: string, body: object = {}) =>
      request(app)
        .patch(base + p)
        .set('Cookie', cookie)
        .send(body),
    put: (p: string, body: object = {}) =>
      request(app)
        .put(base + p)
        .set('Cookie', cookie)
        .send(body),
    del: (p: string) =>
      request(app)
        .delete(base + p)
        .set('Cookie', cookie),
  };
};

export const complaint = (app: Express, slug: string, extra: object = {}) =>
  request(app)
    .post(`/api/v1/public/portals/${slug}/complaints`)
    .send({
      name: 'Asha Customer',
      email: 'asha@customer.test',
      phoneCode: '+91',
      phone: '98765 43210',
      subject: 'Server is down',
      description: 'Our website has been down since this morning.',
      ...extra,
    });
