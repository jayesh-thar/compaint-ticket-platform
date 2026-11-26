import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { commentBodySchema } from '../comments/comments.service.js';
import { applyTransition, findTransition } from '../tickets/status-machine.js';
import { ticketRef } from '../tickets/tickets.mapper.js';
import { notifyRequesterReplied, notifyStatusChange } from '../notifications/outbox.js';

/**
 * "My complaints" (README 6.2 step 6). Requesters are NOT members: every query
 * here is filtered by `requesterId = me`, never by the member visibility rule.
 *
 * What a requester may see: reference, subject, description, status, category
 * name, timestamps, PUBLIC comments, and their allowed actions. Never internal
 * notes, sub-tickets, activity, assignee, team internals, or other tickets.
 */

export const requesterReplySchema = z.object({ body: commentBodySchema });
export const myTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const notFound = () => new AppError(404, 'NOT_FOUND', 'Complaint not found.');

/** Ownership check: org from the URL slug + number + requesterId = me. Anything else is 404. */
const findMine = async (db: Prisma.TransactionClient | typeof prisma, user: User, orgSlug: string, number: number) => {
  const ticket = await db.ticket.findFirst({
    where: { number, requesterId: user.id, organization: { slug: orgSlug.toLowerCase() } },
    include: { organization: { select: { name: true, slug: true } }, category: { select: { name: true } } },
  });
  if (!ticket) throw notFound();
  return ticket;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const allowedActions = (t: { status: string }) => ({
  canReply: t.status !== 'CLOSED',
  canConfirm: t.status === 'RESOLVED',
  canWithdraw: t.status === 'OPEN',
});

export const listMyTickets = async (user: User, query: z.infer<typeof myTicketsQuerySchema>) => {
  const where = { requesterId: user.id };
  const [total, rows] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: { organization: { select: { name: true, slug: true } }, category: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    complaints: rows.map((t) => ({
      reference: ticketRef(t.number),
      number: t.number,
      organization: t.organization,
      subject: t.subject,
      status: t.status,
      closeReason: t.closeReason,
      category: t.category?.name ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const getMyTicket = async (user: User, orgSlug: string, number: number) => {
  const t = await findMine(prisma, user, orgSlug, number);
  // Internal notes are excluded IN THE QUERY, not filtered afterwards.
  const comments = await prisma.comment.findMany({
    where: { ticketId: t.id, organizationId: t.organizationId, visibility: 'PUBLIC' },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    complaint: {
      reference: ticketRef(t.number),
      number: t.number,
      organization: t.organization,
      subject: t.subject,
      description: t.description,
      status: t.status,
      closeReason: t.closeReason,
      closeNote: t.status === 'CLOSED' ? t.closeNote : null,
      category: t.category?.name ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        // Staff: first name + organization; never their email.
        author: c.authorType === 'REQUESTER' ? 'You' : `${firstName(c.author.name)} (${t.organization.name})`,
        fromYou: c.authorType === 'REQUESTER',
        createdAt: c.createdAt,
      })),
      allowedActions: allowedActions(t),
    },
  };
};

/**
 * Requester reply. Side effects (README 6.2): WAITING -> IN_PROGRESS (or OPEN if
 * unassigned), RESOLVED -> reopened; CLOSED is blocked (409, "submit a new one").
 */
export const replyToMyTicket = async (user: User, orgSlug: string, number: number, body: string) => {
  await prisma.$transaction(async (tx) => {
    const t = await findMine(tx, user, orgSlug, number);
    if (t.status === 'CLOSED') {
      throw new AppError(
        409,
        'CONFLICT',
        'This complaint is closed. Please submit a new complaint if you still need help.'
      );
    }

    await tx.comment.create({
      data: {
        organizationId: t.organizationId,
        ticketId: t.id,
        authorUserId: user.id,
        authorType: 'REQUESTER',
        visibility: 'PUBLIC',
        body,
      },
    });
    await tx.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });

    if (t.status === 'WAITING_ON_REQUESTER' || t.status === 'RESOLVED') {
      // The SYSTEM moves it, on the requester's behalf: back to work if someone has it, else the queue.
      const to = t.assigneeId ? 'IN_PROGRESS' : 'OPEN';
      if (findTransition(t.status, to, ['SYSTEM'])) {
        await applyTransition(tx, { ticket: t, to, kinds: ['SYSTEM'], actorUserId: null, note: 'Requester replied' });
      }
    }
    await notifyRequesterReplied(tx, t, user.id);
  });
  return getMyTicket(user, orgSlug, number);
};

/** "Yes, it's resolved": RESOLVED -> CLOSED / COMPLETED. */
export const confirmMyTicket = async (user: User, orgSlug: string, number: number) => {
  await prisma.$transaction(async (tx) => {
    const t = await findMine(tx, user, orgSlug, number);
    if (t.status !== 'RESOLVED') {
      throw new AppError(409, 'INVALID_TRANSITION', 'Only a resolved complaint can be confirmed.');
    }
    await applyTransition(tx, {
      ticket: t,
      to: 'CLOSED',
      kinds: ['REQUESTER'],
      actorUserId: user.id,
      closeReason: 'COMPLETED',
    });
    await notifyStatusChange(tx, t, 'CLOSED', user.id);
  });
  return getMyTicket(user, orgSlug, number);
};

/** Withdraw: only while nobody has started (OPEN) -> CLOSED / CANCELLED. */
export const withdrawMyTicket = async (user: User, orgSlug: string, number: number) => {
  await prisma.$transaction(async (tx) => {
    const t = await findMine(tx, user, orgSlug, number);
    if (t.status !== 'OPEN') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'Work has already started, so it can no longer be withdrawn. Reply instead and staff can cancel it.'
      );
    }
    await applyTransition(tx, {
      ticket: t,
      to: 'CLOSED',
      kinds: ['REQUESTER'],
      actorUserId: user.id,
      closeReason: 'CANCELLED',
    });
    await notifyStatusChange(tx, t, 'CLOSED', user.id);
  });
  return getMyTicket(user, orgSlug, number);
};
