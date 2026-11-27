import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember } from '../../middleware/org-member.js';
import { handle, parseIdParam } from '../../shared/params.js';
import * as tickets from './tickets.service.js';
import { actionParamSchema, runAction } from './tickets.actions.js';
import { AppError } from '../../shared/errors.js';

// Mounted at /api/v1/orgs/:slug/tickets
export const ticketsRouter = Router({ mergeParams: true });
ticketsRouter.use(requireAuth, requireOrgMember);

const num = (raw: unknown) => tickets.parseNumber(raw);

ticketsRouter.get(
  '/',
  handle(200, (req) => tickets.listTickets(req.actor!, req.query))
);
ticketsRouter.post(
  '/',
  handle(201, (req) => tickets.createTask(req.actor!, tickets.createTaskSchema.parse(req.body)))
);
ticketsRouter.get(
  '/:number',
  handle(200, (req) => tickets.getTicket(req.actor!, num(req.params.number)))
);
ticketsRouter.patch(
  '/:number',
  handle(200, (req) =>
    tickets.updateFields(req.actor!, num(req.params.number), tickets.updateFieldsSchema.parse(req.body))
  )
);
ticketsRouter.get(
  '/:number/activity',
  handle(200, (req) => tickets.listActivity(req.actor!, num(req.params.number)))
);
ticketsRouter.post(
  '/:number/actions/:action',
  handle(200, (req) => {
    const parsed = actionParamSchema.safeParse(req.params.action);
    if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'Unknown action.');
    return runAction(req.actor!, num(req.params.number), parsed.data, req.body);
  })
);
ticketsRouter.put(
  '/:number/progress',
  handle(200, (req) =>
    tickets.updateProgress(req.actor!, num(req.params.number), tickets.progressSchema.parse(req.body))
  )
);
ticketsRouter.post(
  '/:number/checklist',
  handle(201, (req) =>
    tickets.addChecklistItem(req.actor!, num(req.params.number), tickets.addChecklistSchema.parse(req.body))
  )
);
ticketsRouter.patch(
  '/:number/checklist/:itemId',
  handle(200, (req) =>
    tickets.updateChecklistItem(
      req.actor!,
      num(req.params.number),
      parseIdParam(req.params.itemId, 'Task'),
      tickets.updateChecklistSchema.parse(req.body)
    )
  )
);
ticketsRouter.delete(
  '/:number/checklist/:itemId',
  handle(200, (req) =>
    tickets.deleteChecklistItem(req.actor!, num(req.params.number), parseIdParam(req.params.itemId, 'Task'))
  )
);
