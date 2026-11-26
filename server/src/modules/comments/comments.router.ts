import { Router } from 'express';
import * as commentsService from './comments.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle } from '../../shared/params.js';
import { parseTicketNumber } from '../tickets/tickets.schemas.js';

// Mounted at /api/v1/orgs/:slug/tickets/:number/comments
export const commentsRouter = Router({ mergeParams: true });
commentsRouter.use(requireAuth, requireOrgMember);

commentsRouter.get(
  '/',
  handle(200, (req) => commentsService.listComments(req.actor!, parseTicketNumber(req.params.number)))
);

commentsRouter.post(
  '/',
  handle(201, (req) =>
    commentsService.createComment(
      req.actor!,
      parseTicketNumber(req.params.number),
      commentsService.createCommentSchema.parse(req.body)
    )
  )
);
