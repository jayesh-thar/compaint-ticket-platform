import { Router } from 'express';
import * as requesterService from './requester.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { handle } from '../../shared/params.js';
import { parseTicketNumber } from '../tickets/tickets.schemas.js';

// Mounted at /api/v1/me/tickets. Login is enough: they are reading their own complaints.
export const requesterRouter = Router();
requesterRouter.use(requireAuth);

requesterRouter.get(
  '/',
  handle(200, (req) =>
    requesterService.listMyTickets(req.user!, requesterService.myTicketsQuerySchema.parse(req.query))
  )
);

requesterRouter.get(
  '/:orgSlug/:number',
  handle(200, (req) =>
    requesterService.getMyTicket(req.user!, String(req.params.orgSlug), parseTicketNumber(req.params.number))
  )
);

requesterRouter.post(
  '/:orgSlug/:number/comments',
  handle(201, (req) =>
    requesterService.replyToMyTicket(
      req.user!,
      String(req.params.orgSlug),
      parseTicketNumber(req.params.number),
      requesterService.requesterReplySchema.parse(req.body).body
    )
  )
);

requesterRouter.post(
  '/:orgSlug/:number/confirm',
  handle(200, (req) =>
    requesterService.confirmMyTicket(req.user!, String(req.params.orgSlug), parseTicketNumber(req.params.number))
  )
);

requesterRouter.post(
  '/:orgSlug/:number/withdraw',
  handle(200, (req) =>
    requesterService.withdrawMyTicket(req.user!, String(req.params.orgSlug), parseTicketNumber(req.params.number))
  )
);
