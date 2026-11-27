import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle } from '../../shared/params.js';
import { prisma } from '../../config/prisma.js';
import { publish } from '../../shared/events.js';
import { loadVisibleTicket, parseNumber } from '../tickets/tickets.service.js';

/** Internal comments between staff who can see the ticket. Plain text, immutable. */
const bodySchema = z.object({ body: z.string().trim().min(1, 'Write something first').max(10000) });

// Mounted at /api/v1/orgs/:slug/tickets/:number/comments
export const commentsRouter = Router({ mergeParams: true });
commentsRouter.use(requireAuth, requireOrgMember);

commentsRouter.get(
  '/',
  handle(200, async (req) => {
    const t = await loadVisibleTicket(req.actor!, parseNumber(req.params.number));
    const rows = await prisma.comment.findMany({
      where: { ticketId: t.id, organizationId: t.organizationId },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      comments: rows.map((c) => ({ id: c.id, body: c.body, authorName: c.author.name, createdAt: c.createdAt })),
    };
  })
);

commentsRouter.post(
  '/',
  handle(201, async (req) => {
    const input = bodySchema.parse(req.body);
    const t = await loadVisibleTicket(req.actor!, parseNumber(req.params.number));
    const c = await prisma.comment.create({
      data: { organizationId: t.organizationId, ticketId: t.id, authorUserId: req.actor!.userId, body: input.body },
      include: { author: { select: { name: true } } },
    });
    publish(t.organizationId, 'tickets');
    return { comment: { id: c.id, body: c.body, authorName: c.author.name, createdAt: c.createdAt } };
  })
);
