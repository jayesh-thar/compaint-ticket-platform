import { z } from 'zod';
import type { Prisma, TicketStage } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { canRaiseTask, type Actor } from '../../shared/permissions.js';
import { publish } from '../../shared/events.js';
import { notify } from '../notifications/outbox.js';
import { actorKindsFor, allowedActionsFor, fieldPowers, STAGE_LABEL, ALL_STAGES } from './stage-machine.js';
import { VIEW_NAMES, viewWhere, isOverdue, type ViewName } from './views.js';

type Tx = Prisma.TransactionClient;

// ---------- schemas ----------

const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
/** Calendar date "YYYY-MM-DD" -> Date at UTC midnight (matches @db.Date). */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker (YYYY-MM-DD).')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date.');
const subject = z.string().trim().min(3, 'Subject must be at least 3 characters').max(200);
const description = z.string().trim().min(5, 'Please describe it in a few words').max(10000);
const checklistInput = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(200),
  priority: priority.default('MEDIUM'),
  dueDate: dateOnly.nullable().optional(),
});

export const createTaskSchema = z.object({
  subject,
  description,
  teamId: z.string().uuid({ message: 'Choose a team.' }),
  priority: priority.default('MEDIUM'),
  dueDate: dateOnly.nullable().optional(),
  checklist: z.array(checklistInput).max(50).default([]),
});
export const updateFieldsSchema = z.object({
  subject: subject.optional(),
  description: description.optional(),
  priority: priority.optional(),
  dueDate: dateOnly.nullable().optional(),
});
export const progressSchema = z.object({ progress: z.number().int().min(0).max(100) });
export const addChecklistSchema = checklistInput;
export const updateChecklistSchema = checklistInput.partial().extend({ done: z.boolean().optional() });

export const listQuerySchema = z.object({
  view: z.enum(VIEW_NAMES as [ViewName, ...ViewName[]]).default('all'),
  teamId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  stage: z.enum(ALL_STAGES as [TicketStage, ...TicketStage[]]).optional(),
  kind: z.enum(['COMPLAINT', 'TASK']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------- loading ----------

export const ticketInclude = {
  team: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  createdBy: { select: { id: true, user: { select: { name: true } } } },
  assignees: {
    include: { membership: { select: { id: true, jobTitle: true, user: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  },
  checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.TicketInclude;

export type LoadedTicket = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Ticket not found.');

export const parseNumber = (raw: unknown) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2_000_000_000) throw notFound();
  return n;
};

/** Through the visibility rule: other org / missing / not allowed all look the same (404). */
export const loadVisibleTicket = async (actor: Actor, number: number, db: Tx | typeof prisma = prisma) => {
  const ticket = await db.ticket.findFirst({
    where: { AND: [viewWhere(actor, 'all'), { number }] },
    include: ticketInclude,
  });
  if (!ticket) throw notFound();
  return ticket;
};

export const addActivity = (
  tx: Tx,
  t: { id: string; organizationId: string },
  actorUserId: string | null,
  action: string,
  extra: { fromValue?: string | null; toValue?: string | null; note?: string | null } = {}
) =>
  tx.ticketActivity.create({
    data: { organizationId: t.organizationId, ticketId: t.id, actorUserId, action, ...extra },
  });

// ---------- DTOs ----------

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const toListItem = (t: LoadedTicket) => ({
  number: t.number,
  reference: `T-${t.number}`,
  kind: t.kind,
  stage: t.stage,
  stageLabel: STAGE_LABEL[t.stage],
  subject: t.subject,
  priority: t.priority,
  dueDate: day(t.dueDate),
  overdue: isOverdue(t),
  progress: t.progress,
  groupName: t.groupName,
  team: t.team,
  category: t.category,
  assignees: t.assignees
    .filter((a) => a.active)
    .map((a) => ({ membershipId: a.membershipId, name: a.membership.user.name, accepted: !!a.acceptedAt })),
  checklist: { done: t.checklist.filter((c) => c.doneAt).length, total: t.checklist.length },
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  finishedAt: t.finishedAt,
});

export const toDetail = (actor: Actor, t: LoadedTicket) => {
  const kinds = actorKindsFor(actor, t);
  return {
    ticket: {
      ...toListItem(t),
      description: t.description,
      closeNote: t.closeNote,
      createdBy: t.createdBy ? { membershipId: t.createdBy.id, name: t.createdBy.user.name } : null,
      customer:
        t.kind === 'COMPLAINT'
          ? { name: t.customerName, email: t.customerEmail, phoneCode: t.customerPhoneCode, phone: t.customerPhone }
          : null,
      allAssignees: t.assignees.map((a) => ({
        membershipId: a.membershipId,
        name: a.membership.user.name,
        jobTitle: a.membership.jobTitle,
        active: a.active,
        acceptedAt: a.acceptedAt,
      })),
      checklistItems: t.checklist.map((c) => ({
        id: c.id,
        title: c.title,
        priority: c.priority,
        dueDate: day(c.dueDate),
        done: !!c.doneAt,
        doneAt: c.doneAt,
      })),
    },
    allowed: {
      actions: allowedActionsFor(t.stage, kinds),
      ...fieldPowers(t.stage, kinds),
      canComment: true,
      myKinds: kinds,
      iAccepted: t.assignees.some((a) => a.active && a.membershipId === actor.membershipId && !!a.acceptedAt),
    },
  };
};

// ---------- queries ----------

export const listTickets = async (actor: Actor, rawQuery: unknown) => {
  const q = listQuerySchema.parse(rawQuery);
  const num = q.q ? Number(q.q.replace(/^t-?/i, '')) : NaN;
  const where: Prisma.TicketWhereInput = {
    AND: [
      viewWhere(actor, q.view),
      q.teamId ? { teamId: q.teamId } : {},
      q.categoryId ? { categoryId: q.categoryId } : {},
      q.stage ? { stage: q.stage } : {},
      q.kind ? { kind: q.kind } : {},
      q.q
        ? {
            OR: [
              { subject: { contains: q.q, mode: 'insensitive' } },
              ...(Number.isInteger(num) && num > 0 ? [{ number: num }] : []),
            ],
          }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: [{ updatedAt: 'desc' }, { number: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { tickets: rows.map(toListItem), total, page: q.page, pageSize: q.pageSize };
};

export const getTicket = async (actor: Actor, number: number) =>
  toDetail(actor, await loadVisibleTicket(actor, number));

export const listActivity = async (actor: Actor, number: number) => {
  const t = await loadVisibleTicket(actor, number);
  const rows = await prisma.ticketActivity.findMany({
    where: { ticketId: t.id, organizationId: actor.organizationId },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    activity: rows.map((r) => ({
      id: r.id,
      action: r.action,
      fromValue: r.fromValue,
      toValue: r.toValue,
      note: r.note,
      actorName: r.actor?.name ?? (t.kind === 'COMPLAINT' && r.action === 'CREATED' ? 'Customer' : 'System'),
      createdAt: r.createdAt,
    })),
  };
};

/**
 * Which category a ticket keeps when it lands in a team (D-31): the first
 * preferred one the team is in; else the team's only category; else none.
 */
export const categoryForTeam = (teamCategoryIds: string[], ...preferred: (string | null | undefined)[]) =>
  preferred.find((id) => !!id && teamCategoryIds.includes(id)) ??
  (teamCategoryIds.length === 1 ? teamCategoryIds[0] : null);

// ---------- tasks ----------

export const nextNumber = async (tx: Tx, organizationId: string) => {
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { ticketCounter: { increment: 1 } },
    select: { ticketCounter: true },
  });
  return org.ticketCounter;
};

/** Admin (any team) or a Team Leader (any team) raises a task; it goes to that team's leader. */
export const createTask = async (actor: Actor, input: z.infer<typeof createTaskSchema>) => {
  if (!canRaiseTask(actor)) throw new AppError(403, 'FORBIDDEN', 'Only Admins and team leaders can raise tasks.');
  const team = await prisma.team.findFirst({
    where: { id: input.teamId, organizationId: actor.organizationId, archivedAt: null },
    include: { categories: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!team) throw new AppError(422, 'VALIDATION_ERROR', 'Team not found.', { teamId: 'Unknown team.' });

  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, actor.organizationId);
    const t = await tx.ticket.create({
      data: {
        organizationId: actor.organizationId,
        number,
        kind: 'TASK',
        stage: 'AT_TEAM',
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        teamId: team.id,
        categoryId: categoryForTeam(team.categories.map((c) => c.id)),
        createdByMembershipId: actor.membershipId,
        checklist: {
          create: input.checklist.map((c, i) => ({
            organizationId: actor.organizationId,
            title: c.title,
            priority: c.priority,
            dueDate: c.dueDate ?? null,
            position: i,
          })),
        },
      },
    });
    await addActivity(tx, t, actor.userId, 'CREATED', { toValue: 'AT_TEAM', note: `Task for ${team.name}` });
    await notify(tx, t, 'AT_TEAM', actor.userId);
    return t;
  });
  publish(actor.organizationId, 'tickets');
  return { ticket: { number: ticket.number, reference: `T-${ticket.number}` }, message: 'Task created.' };
};

// ---------- fields, progress, checklist ----------

const powersFor = (actor: Actor, t: LoadedTicket) => fieldPowers(t.stage, actorKindsFor(actor, t));
const deny = (msg: string) => new AppError(403, 'FORBIDDEN', msg);

export const updateFields = async (actor: Actor, number: number, input: z.infer<typeof updateFieldsSchema>) => {
  const t = await loadVisibleTicket(actor, number);
  const p = powersFor(actor, t);
  if ((input.subject !== undefined || input.description !== undefined) && !p.canEditText) {
    throw deny('You cannot edit the text of this ticket.');
  }
  if ((input.priority !== undefined || input.dueDate !== undefined) && !p.canEditPriorityDeadline) {
    throw deny('Only the Admin or the team leader sets priority and deadline.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: input });
    if (input.priority && input.priority !== t.priority) {
      await addActivity(tx, t, actor.userId, 'PRIORITY_CHANGED', { fromValue: t.priority, toValue: input.priority });
    }
    if (input.dueDate !== undefined && day(input.dueDate) !== day(t.dueDate)) {
      await addActivity(tx, t, actor.userId, 'DEADLINE_CHANGED', {
        fromValue: day(t.dueDate),
        toValue: day(input.dueDate),
      });
    }
    if (input.subject !== undefined || input.description !== undefined)
      await addActivity(tx, t, actor.userId, 'EDITED');
  });
  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};

export const updateProgress = async (actor: Actor, number: number, input: z.infer<typeof progressSchema>) => {
  const t = await loadVisibleTicket(actor, number);
  if (!powersFor(actor, t).canUpdateProgress) throw deny('Only the assignee updates progress while working.');
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { progress: input.progress } });
    await addActivity(tx, t, actor.userId, 'PROGRESS', { fromValue: `${t.progress}%`, toValue: `${input.progress}%` });
  });
  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};

export const addChecklistItem = async (actor: Actor, number: number, input: z.infer<typeof addChecklistSchema>) => {
  const t = await loadVisibleTicket(actor, number);
  if (!powersFor(actor, t).canEditChecklist) throw deny('Only the Admin, team leader or task creator edits tasks.');
  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.create({
      data: {
        organizationId: actor.organizationId,
        ticketId: t.id,
        title: input.title,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        position: t.checklist.length,
      },
    });
    await addActivity(tx, t, actor.userId, 'CHECKLIST', { toValue: input.title, note: 'Task added' });
  });
  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};

export const updateChecklistItem = async (
  actor: Actor,
  number: number,
  itemId: string,
  input: z.infer<typeof updateChecklistSchema>
) => {
  const t = await loadVisibleTicket(actor, number);
  const item = t.checklist.find((c) => c.id === itemId);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Task not found.');
  const p = powersFor(actor, t);
  const { done, ...edit } = input;
  if (done !== undefined && !p.canTickChecklist) throw deny('Only the assignee or team leader ticks tasks.');
  if (Object.keys(edit).length > 0 && !p.canEditChecklist)
    throw deny('Only the Admin, team leader or task creator edits tasks.');
  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.update({
      where: { id: item.id },
      data: {
        ...edit,
        ...(done === undefined
          ? {}
          : { doneAt: done ? new Date() : null, doneByMembershipId: done ? actor.membershipId : null }),
      },
    });
    if (done !== undefined && done !== !!item.doneAt) {
      await addActivity(tx, t, actor.userId, 'CHECKLIST', {
        toValue: item.title,
        note: done ? 'Task done' : 'Task reopened',
      });
    }
  });
  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};

export const deleteChecklistItem = async (actor: Actor, number: number, itemId: string) => {
  const t = await loadVisibleTicket(actor, number);
  const item = t.checklist.find((c) => c.id === itemId);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Task not found.');
  if (!powersFor(actor, t).canEditChecklist) throw deny('Only the Admin, team leader or task creator edits tasks.');
  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.delete({ where: { id: item.id } });
    await addActivity(tx, t, actor.userId, 'CHECKLIST', { toValue: item.title, note: 'Task removed' });
  });
  publish(actor.organizationId, 'tickets');
  return getTicket(actor, number);
};
