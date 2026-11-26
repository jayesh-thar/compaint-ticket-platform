import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { type Actor, canComment } from '../../shared/permissions.js';
import { findVisibleTicketRow } from '../tickets/tickets.repository.js';
import { notifyStaffReplied } from '../notifications/outbox.js';

/** Plain text, 1-10,000 characters (README 7.7). Never rendered as HTML. */
export const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(10000, 'Comments cannot exceed 10,000 characters.');

export const createCommentSchema = z.object({
  body: commentBodySchema,
  // The composer defaults to INTERNAL: the safe choice when someone forgets to pick.
  visibility: z.enum(['PUBLIC', 'INTERNAL']).default('INTERNAL'),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

const toCommentDto = (c: {
  id: string;
  body: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  authorType: 'STAFF' | 'REQUESTER';
  createdAt: Date;
  author: { name: string };
}) => ({
  id: c.id,
  body: c.body,
  visibility: c.visibility,
  authorType: c.authorType,
  authorName: c.author.name,
  createdAt: c.createdAt,
});

/** Members who can see the ticket see all of its comments (public + internal). */
export const listComments = async (actor: Actor, number: number) => {
  const ticket = await findVisibleTicketRow(actor, number);
  const comments = await prisma.comment.findMany({
    where: { organizationId: actor.organizationId, ticketId: ticket.id },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return { comments: comments.map(toCommentDto) };
};

export const createComment = async (actor: Actor, number: number, input: CreateCommentInput) => {
  const comment = await prisma.$transaction(async (tx) => {
    // Visibility rule first: a ticket you cannot see is "not found".
    const ticket = await findVisibleTicketRow(actor, number, tx);
    if (!canComment(actor, ticket)) throw new AppError(404, 'NOT_FOUND', 'Ticket not found.');

    if (input.visibility === 'PUBLIC' && !ticket.requesterId) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'This ticket has no requester, so only internal notes are possible.',
        {
          visibility: 'Only internal notes are possible on this ticket.',
        }
      );
    }

    const created = await tx.comment.create({
      data: {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        authorUserId: actor.userId,
        authorType: 'STAFF',
        visibility: input.visibility,
        body: input.body,
      },
      include: { author: { select: { name: true } } },
    });
    // A comment is activity on the ticket: it moves up in "last updated".
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });

    if (input.visibility === 'PUBLIC') await notifyStaffReplied(tx, ticket, created.id, actor.userId);
    return created;
  });
  return { comment: toCommentDto(comment) };
};
