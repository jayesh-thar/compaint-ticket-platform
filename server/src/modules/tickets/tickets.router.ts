import { Router } from 'express';
import * as ticketsService from './tickets.service.js';
import * as workflow from './tickets.workflow.js';
import {
  assignmentSchema,
  changeStatusSchema,
  createSubticketSchema,
  createTicketSchema,
  parseTicketNumber,
  updateTicketSchema,
} from './tickets.schemas.js';
import { ticketListQuerySchema } from '../../shared/ticket-filters.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle } from '../../shared/params.js';

// Mounted at /api/v1/orgs/:slug/tickets. Permissions are checked per ticket in the service.
export const ticketsRouter = Router({ mergeParams: true });
ticketsRouter.use(requireAuth, requireOrgMember);

ticketsRouter.get(
  '/',
  handle(200, (req) => ticketsService.listTickets(req.actor!, ticketListQuerySchema.parse(req.query)))
);

ticketsRouter.post(
  '/',
  handle(201, (req) => ticketsService.createInternalTicket(req.actor!, createTicketSchema.parse(req.body)))
);

ticketsRouter.get(
  '/:number',
  handle(200, (req) => ticketsService.getTicket(req.actor!, parseTicketNumber(req.params.number)))
);

ticketsRouter.patch(
  '/:number',
  handle(200, (req) =>
    workflow.updateTicket(req.actor!, parseTicketNumber(req.params.number), updateTicketSchema.parse(req.body))
  )
);

ticketsRouter.post(
  '/:number/status',
  handle(200, (req) =>
    workflow.changeStatus(req.actor!, parseTicketNumber(req.params.number), changeStatusSchema.parse(req.body))
  )
);

ticketsRouter.post(
  '/:number/assignment',
  handle(200, (req) =>
    workflow.changeAssignment(req.actor!, parseTicketNumber(req.params.number), assignmentSchema.parse(req.body))
  )
);

ticketsRouter.post(
  '/:number/subtickets',
  handle(201, (req) =>
    workflow.createSubticket(req.actor!, parseTicketNumber(req.params.number), createSubticketSchema.parse(req.body))
  )
);

ticketsRouter.get(
  '/:number/activity',
  handle(200, (req) => workflow.listActivity(req.actor!, parseTicketNumber(req.params.number)))
);
