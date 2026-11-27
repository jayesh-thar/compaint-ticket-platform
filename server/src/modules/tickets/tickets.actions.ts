import { z } from 'zod';
import type { NotificationType, Prisma, TicketStage } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import type { Actor } from '../../shared/permissions.js';
import { publish } from '../../shared/events.js';
import { notify } from '../notifications/outbox.js';
import { ACTION_NAMES, RULES, actorKindsFor, checkAction, type ActionName } from './stage-machine.js';
import {
  addActivity,
  categoryForTeam,
  dateOnly,
  getTicket,
  loadVisibleTicket,
  type LoadedTicket,
} from './tickets.service.js';

type Tx = Prisma.TransactionClient;

const note = z.string().trim().max(2000).optional();
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional();

const BODIES = {
  approve: z.object({
    categoryId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    priority,
    dueDate: dateOnly.nullable().optional(),
    note,
  }),
  route: z.object({ teamId: z.string().uuid({ message: 'Choose a team.' }), note }),
  assign: z.object({
    membershipIds: z.array(z.string().uuid()).min(1, 'Choose at least one member.').max(20),
    groupName: z.string().trim().max(80).optional(),
    priority,
    dueDate: dateOnly.nullable().optional(),
    note,
  }),
  reroute: z.object({ teamId: z.string().uuid({ message: 'Choose a team.' }), note }),
  other: z.object({ note }),
};

export const actionParamSchema = z.enum(ACTION_NAMES as [ActionName, ...ActionName[]]);

const invalid = (msg: string, fields?: Record<string, string>) => new AppError(422, 'VALIDATION_ERROR', msg, fields);

/** Conditional update: only one of two racing requests can move the ticket (409 for the other). */
const moveStage = async (
  tx: Tx,
  t: LoadedTicket,
  to: TicketStage,
  data: Prisma.TicketUncheckedUpdateManyInput = {}
) => {
  const { count } = await tx.ticket.updateMany({
    where: { id: t.id, stage: t.stage },
    data: { ...data, stage: to, ...(to === 'DONE' || to === 'REJECTED' ? { finishedAt: new Date() } : {}) },
  });
  if (count === 0) {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      'Someone else changed this ticket a moment ago. Reload and try again.'
    );
  }
};

const activeTeam = async (orgId: string, teamId: string) => {
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId: orgId, archivedAt: null },
    include: { categories: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!team) throw invalid('Team not found.', { teamId: 'Unknown team.' });
  return { ...team, categoryIds: team.categories.map((c) => c.id) };
};

const deactivateAll = (tx: Tx, ticketId: string) =>
  tx.ticketAssignee.updateMany({ where: { ticketId, active: true }, data: { active: false, removedAt: new Date() } });

export const runAction = async (actor: Actor, number: number, action: ActionName, rawBody: unknown) => {
  const t = await loadVisibleTicket(actor, number);
  const kinds = actorKindsFor(actor, t);
  const check = checkAction(action, t.stage, kinds);
  if (check === 'wrong-stage') {
    throw new AppError(409, 'INVALID_TRANSITION', `This ticket is "${t.stage}", so "${action}" is not possible now.`);
  }
  if (check === 'not-allowed') throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this on this ticket.');

  const schema = action in BODIES ? BODIES[action as keyof typeof BODIES] : BODIES.other;
  const body = schema.parse(rawBody ?? {}) as Record<string, unknown> & { note?: string };
  if (RULES[action].noteRequired && !body.note) throw invalid('Please write a short reason.', { note: 'Required.' });

  const me = actor.userId;
  const log = (tx: Tx, a: string, to: TicketStage | null, extra: { toValue?: string; note?: string } = {}) =>
    addActivity(tx, t, me, a, {
      fromValue: t.stage,
      toValue: extra.toValue ?? to,
      note: extra.note ?? body.note ?? null,
    });
  const tell = (tx: Tx, type: NotificationType, over: Partial<LoadedTicket> = {}) =>
    notify(tx, { ...t, ...over }, type, me);

  await prisma.$transaction(async (tx) => {
    switch (action) {
      case 'approve': {
        const b = body as z.infer<typeof BODIES.approve>;
        const extra = { priority: b.priority, dueDate: b.dueDate };
        if (b.teamId) {
          const team = await activeTeam(actor.organizationId, b.teamId);
          const categoryId = categoryForTeam(team.categoryIds, b.categoryId, t.categoryId);
          await moveStage(tx, t, 'AT_TEAM', { ...extra, teamId: team.id, categoryId });
          await log(tx, 'APPROVED', 'AT_TEAM', { toValue: team.name });
          await tell(tx, 'AT_TEAM', { teamId: team.id, categoryId });
        } else {
          const categoryId = b.categoryId ?? t.categoryId;
          const category = categoryId
            ? await tx.category.findFirst({
                where: { id: categoryId, organizationId: actor.organizationId, archivedAt: null },
                include: { _count: { select: { teams: { where: { archivedAt: null } } } } },
              })
            : null;
          if (!category) throw invalid('Choose a category or a team.', { teamId: 'Choose a team.' });
          if (!category.leadMembershipId || category._count.teams === 0) {
            throw invalid(`"${category.name}" has no Category Lead or no teams yet - choose a team directly.`, {
              teamId: 'Choose a team.',
            });
          }
          await moveStage(tx, t, 'AT_CATEGORY', { ...extra, categoryId: category.id, teamId: null });
          await log(tx, 'APPROVED', 'AT_CATEGORY', { toValue: category.name });
          await tell(tx, 'AT_CATEGORY', { categoryId: category.id });
        }
        break;
      }
      case 'route': {
        const team = await activeTeam(actor.organizationId, (body as { teamId: string }).teamId);
        if (!t.categoryId || !team.categoryIds.includes(t.categoryId))
          throw invalid('That team is not in this category.', { teamId: 'Not in category.' });
        await moveStage(tx, t, 'AT_TEAM', { teamId: team.id });
        await log(tx, 'ROUTED_TO_TEAM', 'AT_TEAM', { toValue: team.name });
        await tell(tx, 'AT_TEAM', { teamId: team.id });
        break;
      }
      case 'assign': {
        const b = body as z.infer<typeof BODIES.assign>;
        const ids = [...new Set(b.membershipIds)];
        if (ids.length > 1 && !b.groupName)
          throw invalid('Give the group a name.', { groupName: 'Required for a group.' });
        // Only active members of THIS team can be assigned.
        const members = await tx.teamMember.findMany({
          where: { teamId: t.teamId!, membershipId: { in: ids }, membership: { status: 'ACTIVE' } },
          include: { membership: { select: { user: { select: { name: true } } } } },
        });
        if (members.length !== ids.length) {
          throw new AppError(
            422,
            'ASSIGNEE_NOT_ELIGIBLE',
            'Everyone you assign must be an active member of this team.'
          );
        }
        await moveStage(tx, t, 'ASSIGNED', {
          groupName: ids.length > 1 ? b.groupName : null,
          priority: b.priority,
          dueDate: b.dueDate,
        });
        for (const membershipId of ids) {
          await tx.ticketAssignee.upsert({
            where: { ticketId_membershipId: { ticketId: t.id, membershipId } },
            create: { organizationId: actor.organizationId, ticketId: t.id, membershipId },
            update: { active: true, acceptedAt: null, removedAt: null },
          });
        }
        const names = members.map((m) => m.membership.user.name).join(', ');
        await log(tx, 'ASSIGNED', 'ASSIGNED', { toValue: ids.length > 1 ? `Group "${b.groupName}": ${names}` : names });
        await tell(tx, 'ASSIGNED_TO_YOU');
        break;
      }
      case 'unassign':
        await moveStage(tx, t, 'AT_TEAM', { groupName: null });
        await deactivateAll(tx, t.id);
        await log(tx, 'UNASSIGNED', 'AT_TEAM');
        break;
      case 'accept': {
        await moveStage(tx, t, 'IN_PROGRESS');
        await tx.ticketAssignee.updateMany({
          where: { ticketId: t.id, membershipId: actor.membershipId, active: true },
          data: { acceptedAt: new Date() },
        });
        await log(tx, 'ACCEPTED', 'IN_PROGRESS');
        break;
      }
      case 'decline': {
        await tx.ticketAssignee.updateMany({
          where: { ticketId: t.id, membershipId: actor.membershipId, active: true },
          data: { active: false, removedAt: new Date() },
        });
        const left = await tx.ticketAssignee.count({ where: { ticketId: t.id, active: true } });
        if (left === 0) {
          await moveStage(tx, t, 'AT_TEAM', { groupName: null });
          await log(tx, 'DECLINED', 'AT_TEAM');
          await tell(tx, 'AT_TEAM');
        } else {
          await tx.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
          await log(tx, 'DECLINED', 'ASSIGNED');
        }
        break;
      }
      case 'submit':
        await moveStage(tx, t, 'TEAM_REVIEW', { progress: 100 });
        await log(tx, 'SUBMITTED', 'TEAM_REVIEW');
        await tell(tx, 'NEEDS_TEAM_REVIEW');
        break;
      case 'team_approve':
        await moveStage(tx, t, 'ADMIN_REVIEW');
        await log(tx, 'TEAM_APPROVED', 'ADMIN_REVIEW');
        await tell(tx, 'NEEDS_ADMIN_REVIEW');
        break;
      case 'team_send_back':
      case 'admin_send_back':
        await moveStage(tx, t, 'IN_PROGRESS');
        await log(tx, 'SENT_BACK', 'IN_PROGRESS');
        await tell(tx, 'SENT_BACK');
        break;
      case 'final_approve':
        await moveStage(tx, t, 'DONE');
        await log(tx, 'DONE', 'DONE', t.groupName ? { note: `Group "${t.groupName}" dissolved` } : {});
        await tell(tx, 'TICKET_DONE');
        await tell(tx, 'CUSTOMER_DONE');
        break;
      case 'reroute': {
        const team = await activeTeam(actor.organizationId, (body as { teamId: string }).teamId);
        if (team.id === t.teamId) throw invalid('The ticket is already in this team.', { teamId: 'Same team.' });
        await moveStage(tx, t, 'AT_TEAM', {
          teamId: team.id,
          categoryId: categoryForTeam(team.categoryIds, t.categoryId),
          groupName: null,
        });
        await deactivateAll(tx, t.id);
        await log(tx, 'REROUTED', 'AT_TEAM', { toValue: team.name });
        await tell(tx, 'AT_TEAM', { teamId: team.id });
        break;
      }
      case 'reject':
        await moveStage(tx, t, 'REJECTED', { closeNote: body.note });
        await log(tx, 'REJECTED', 'REJECTED');
        await tell(tx, 'CUSTOMER_REJECTED', { closeNote: body.note ?? null });
        break;
    }
  });

  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};
