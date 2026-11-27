import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { emailTransport } from '../src/shared/email.js';
import { cleanDatabase } from './helpers/db.js';
import { buildWorld, as, complaint, type World } from './helpers/world.js';

const app = createApp();
let w: World;
const api = (who: { cookie: string }) => as(app, w.org.slug, who.cookie);
const act = (who: { cookie: string }, n: number, action: string, body: object = {}) =>
  api(who).post(`/tickets/${n}/actions/${action}`, body);

describe('Ticket flows (README 0.4-0.7)', () => {
  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
    vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
    w = await buildWorld();
  });
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('customer complaint: Admin -> Category Lead -> team leader -> group -> back up -> Done', async () => {
    const sub = await complaint(app, w.org.slug, { categoryId: w.category.id });
    expect(sub.status).toBe(201);
    expect(sub.body.reference).toBe('T-1');
    const token = sub.body.trackingToken as string;

    // Waiting for Admin: only the Admin sees it.
    expect((await api(w.admin).get('/tickets/1')).body.ticket.stage).toBe('PENDING_APPROVAL');
    for (const p of [w.catLead, w.lead1, w.m1]) expect((await api(p).get('/tickets/1')).status).toBe(404);
    expect(await prisma.notification.count({ where: { type: 'NEEDS_APPROVAL' } })).toBe(1);

    // Admin approves into the category -> Category Lead.
    const approved = await act(w.admin, 1, 'approve', {
      categoryId: w.category.id,
      priority: 'HIGH',
      dueDate: '2030-01-31',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.ticket).toMatchObject({ stage: 'AT_CATEGORY', priority: 'HIGH', dueDate: '2030-01-31' });
    expect((await api(w.catLead).get('/tickets/1')).body.allowed.actions).toEqual(['route']);

    // Category Lead picks a team of the category (Network is not in it).
    expect((await act(w.catLead, 1, 'route', { teamId: w.net.id })).status).toBe(422);
    expect((await act(w.catLead, 1, 'route', { teamId: w.team1.id })).body.ticket.stage).toBe('AT_TEAM');

    // Leader assigns a group; members must be in the team, a group needs a name.
    expect((await act(w.lead1, 1, 'assign', { membershipIds: [w.m3.membership.id] })).body.error.code).toBe(
      'ASSIGNEE_NOT_ELIGIBLE'
    );
    const ids = [w.m1.membership.id, w.m2.membership.id];
    expect((await act(w.lead1, 1, 'assign', { membershipIds: ids })).status).toBe(422);
    const assigned = await act(w.lead1, 1, 'assign', { membershipIds: ids, groupName: 'Server fixers' });
    expect(assigned.body.ticket).toMatchObject({ stage: 'ASSIGNED', groupName: 'Server fixers' });
    expect(await prisma.notification.count({ where: { type: 'ASSIGNED_TO_YOU' } })).toBe(2);

    // A member accepts, the leader adds a checklist item, the member ticks it and reports progress.
    expect((await act(w.m3, 1, 'accept')).status).toBe(404); // other team: cannot even see it
    expect((await act(w.m1, 1, 'accept')).body.ticket.stage).toBe('IN_PROGRESS');
    const withItem = await api(w.lead1).post('/tickets/1/checklist', {
      title: 'Restart the web server',
      priority: 'URGENT',
    });
    const itemId = withItem.body.ticket.checklistItems[0].id;
    expect((await api(w.m2).post('/tickets/1/checklist', { title: 'Not allowed' })).status).toBe(403);
    expect((await api(w.m2).patch(`/tickets/1/checklist/${itemId}`, { done: true })).body.ticket.checklist).toEqual({
      done: 1,
      total: 1,
    });
    expect((await api(w.m1).put('/tickets/1/progress', { progress: 60 })).body.ticket.progress).toBe(60);
    expect((await api(w.m1).patch('/tickets/1', { priority: 'LOW' })).status).toBe(403);

    // Back up: member submits -> leader approves -> Admin approves.
    expect((await act(w.m2, 1, 'submit')).body.ticket.stage).toBe('TEAM_REVIEW');
    expect((await act(w.m1, 1, 'team_approve')).status).toBe(403);
    expect((await act(w.lead1, 1, 'team_approve')).body.ticket.stage).toBe('ADMIN_REVIEW');
    expect((await act(w.lead1, 1, 'final_approve')).status).toBe(403);
    const done = await act(w.admin, 1, 'final_approve');
    expect(done.body.ticket.stage).toBe('DONE');
    expect(done.body.allowed.actions).toEqual([]);

    // History: still visible to the people who worked on it; the customer is told.
    expect((await api(w.m1).get('/tickets?view=my_done')).body.total).toBe(1);
    expect((await api(w.lead1).get('/tickets?view=history')).body.total).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'CUSTOMER_DONE', toEmail: 'asha@customer.test' } })).toBe(
      1
    );
    const track = await request(app).post('/api/v1/public/track').send({ token });
    expect(track.body.complaint).toMatchObject({ reference: 'T-1', status: 'Resolved', step: 4 });

    const activity = (await api(w.admin).get('/tickets/1/activity')).body.activity.map(
      (a: { action: string }) => a.action
    );
    expect(activity).toEqual([
      'CREATED',
      'APPROVED',
      'ROUTED_TO_TEAM',
      'ASSIGNED',
      'ACCEPTED',
      'CHECKLIST',
      'CHECKLIST',
      'PROGRESS',
      'SUBMITTED',
      'TEAM_APPROVED',
      'DONE',
    ]);
  });

  it('Admin can approve straight to a team, reject with a reason, and a category without Lead needs a team', async () => {
    await complaint(app, w.org.slug); // "Other"
    expect((await act(w.admin, 1, 'approve', {})).status).toBe(422);
    expect((await act(w.admin, 1, 'approve', { teamId: w.net.id })).body.ticket).toMatchObject({
      stage: 'AT_TEAM',
      team: { id: w.net.id },
    });

    await prisma.category.update({ where: { id: w.category.id }, data: { leadMembershipId: null } });
    const sub = await complaint(app, w.org.slug, { categoryId: w.category.id });
    expect((await act(w.admin, 2, 'approve', { categoryId: w.category.id })).status).toBe(422);
    expect((await act(w.admin, 2, 'reject', {})).body.error.fields.note).toBeDefined();
    expect((await act(w.admin, 2, 'reject', { note: 'Duplicate of T-1' })).body.ticket.stage).toBe('REJECTED');
    const track = await request(app).post('/api/v1/public/track').send({ token: sub.body.trackingToken });
    expect(track.body.complaint).toMatchObject({ status: 'Not accepted', rejectionReason: 'Duplicate of T-1' });
  });

  it('internal task: a leader raises it for another team; decline, send back and cancel paths', async () => {
    expect(
      (await api(w.m1).post('/tickets', { subject: 'Nope', description: 'Members cannot', teamId: w.net.id })).status
    ).toBe(403);
    const created = await api(w.lead1).post('/tickets', {
      subject: 'Open port 8443',
      description: 'Firewall change for the new server.',
      teamId: w.net.id,
      priority: 'HIGH',
      dueDate: '2030-02-01',
      checklist: [{ title: 'Change firewall rule' }, { title: 'Test from outside', priority: 'LOW' }],
    });
    expect(created.status).toBe(201);
    const t = (await api(w.lead1).get('/tickets/1')).body;
    expect(t.ticket).toMatchObject({ kind: 'TASK', stage: 'AT_TEAM', team: { id: w.net.id }, checklist: { total: 2 } });
    expect(t.allowed.actions).toEqual(['reject']); // creator of a task, not the Network leader

    await act(w.netLead, 1, 'assign', { membershipIds: [w.netMember.membership.id] });
    expect((await act(w.netMember, 1, 'decline', {})).status).toBe(422);
    expect((await act(w.netMember, 1, 'decline', { note: 'On leave' })).body.ticket.stage).toBe('AT_TEAM');

    await act(w.netLead, 1, 'assign', { membershipIds: [w.netLead.membership.id] }); // leader takes it
    await act(w.netLead, 1, 'accept');
    await act(w.netLead, 1, 'submit');
    expect((await act(w.netLead, 1, 'team_send_back', { note: 'Test again' })).body.ticket.stage).toBe('IN_PROGRESS');
    expect((await act(w.lead1, 1, 'reject', { note: 'Not needed any more' })).body.ticket.stage).toBe('REJECTED');
  });

  it('visibility: plain members see only their own work; leaders their team; 404 otherwise', async () => {
    await api(w.admin).post('/tickets', {
      subject: 'Team 1 queue',
      description: 'Waiting for the leader',
      teamId: w.team1.id,
    });
    expect((await api(w.lead1).get('/tickets/1')).status).toBe(200);
    expect((await api(w.catLead).get('/tickets/1')).status).toBe(200);
    for (const p of [w.m1, w.m3, w.lead2, w.outsider]) expect((await api(p).get('/tickets/1')).status).toBe(404);
    expect((await api(w.m1).get('/tickets')).body.total).toBe(0);
    expect((await api(w.admin).get('/tickets?view=unassigned')).body.total).toBe(1);
  });

  it('races: two final approvals and two accepts - exactly one wins, the other gets 409', async () => {
    await api(w.admin).post('/tickets', { subject: 'Race', description: 'Two people at once', teamId: w.team1.id });
    await act(w.lead1, 1, 'assign', { membershipIds: [w.m1.membership.id, w.m2.membership.id], groupName: 'Pair' });
    const accepts = await Promise.all([act(w.m1, 1, 'accept'), act(w.m2, 1, 'accept')]);
    expect(accepts.map((r) => r.status).sort()).toEqual([200, 409]);

    await act(w.m1, 1, 'submit');
    await act(w.lead1, 1, 'team_approve');
    const finals = await Promise.all([act(w.admin, 1, 'final_approve'), act(w.admin, 1, 'final_approve')]);
    expect(finals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.ticketActivity.count({ where: { action: 'DONE' } })).toBe(1);
  });

  it('removing a member from the team hands their live work back to the leader', async () => {
    await api(w.admin).post('/tickets', { subject: 'Handover', description: 'Member will leave', teamId: w.team1.id });
    await act(w.lead1, 1, 'assign', { membershipIds: [w.m1.membership.id] });
    await act(w.m1, 1, 'accept');
    expect((await api(w.lead1).del(`/teams/${w.team1.id}/members/${w.m1.membership.id}`)).status).toBe(200);
    const t = (await api(w.lead1).get('/tickets/1')).body.ticket;
    expect(t).toMatchObject({ stage: 'AT_TEAM', assignees: [] });
    expect((await api(w.m1).get('/tickets/1')).status).toBe(200); // past assignee keeps history
  });
});
