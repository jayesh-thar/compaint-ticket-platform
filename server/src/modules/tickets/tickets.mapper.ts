import type { Actor } from '../../shared/permissions.js';
import {
  canChangeTeam,
  canComment,
  canCreateSubticket,
  canEditText,
  canEditTriageFields,
  canManageTicket,
  canTakeTicket,
} from '../../shared/permissions.js';
import { isOverdue } from '../../shared/visibility.js';
import type { TicketDetailRow, TicketListRow } from './tickets.repository.js';
import { actorKindsFor, closeReasonsFor, statusTargetsFor } from './status-machine.js';

/**
 * DB rows -> response objects. Explicit fields only: a new column never leaks
 * into the API by accident.
 */

type Person = { id: string; status: string; user: { name: string } } | null;

/** "Asha" or "Asha (removed)" (README 8.4: history keeps removed members' names). */
const person = (p: Person) =>
  p ? { membershipId: p.id, name: p.status === 'REMOVED' ? `${p.user.name} (removed)` : p.user.name } : null;

export const ticketRef = (number: number) => `T-${number}`;

/** "2026-12-01" for a @db.Date column (or null). */
export const formatDueDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const toTicketListItem = (t: TicketListRow) => ({
  number: t.number,
  reference: ticketRef(t.number),
  subject: t.subject,
  status: t.status,
  priority: t.priority,
  source: t.source,
  closeReason: t.closeReason,
  category: t.category ? { id: t.category.id, name: t.category.name } : null,
  team: t.team ? { id: t.team.id, name: t.team.name } : null,
  assignee: person(t.assignee),
  dueDate: formatDueDate(t.dueDate),
  overdue: isOverdue(t),
  parentNumber: t.parent?.number ?? null,
  subticketCount: t._count.subtickets,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

const DONE = new Set(['RESOLVED', 'CLOSED']);

/** Status moves come from the status machine itself, so the UI never offers a move the server refuses. */
const statusActions = (actor: Actor, t: TicketDetailRow) => {
  const kinds = actorKindsFor(actor, t);
  const facts = { assigneeId: t.assigneeId, requesterId: t.requesterId, openSubtickets: [] };
  const closeReasons = t.status === 'CLOSED' ? [] : closeReasonsFor(kinds, t.status);
  return {
    statusTargets: t.status === 'CLOSED' ? [] : statusTargetsFor(kinds, t.status, facts),
    canClose: closeReasons.length > 0,
    closeReasons,
    canReopen: t.status === 'CLOSED' && kinds.includes('MANAGER_PLUS'),
  };
};

/** What the current member may do; the UI shows only these. The server re-checks every action. */
export const allowedActionsFor = (actor: Actor, t: TicketDetailRow) => {
  const ref = { teamId: t.teamId, assigneeId: t.assigneeId, createdByMembershipId: t.createdByMembershipId };
  return {
    canEditText: canEditText(actor),
    canEditTriage: canEditTriageFields(actor, ref),
    canChangeTeam: canChangeTeam(actor),
    // Choosing *someone else* (or unassigning) needs manage powers.
    canAssignOthers: canManageTicket(actor, ref),
    canTake: t.status !== 'CLOSED' && canTakeTicket(actor, ref),
    // One level only: a sub-ticket cannot get its own sub-tickets.
    canAddSubticket: !t.parentId && t.status !== 'CLOSED' && canCreateSubticket(actor, ref),
    canComment: canComment(actor, ref),
    canPublicReply: canComment(actor, ref) && !!t.requesterId,
    ...statusActions(actor, t),
  };
};

export const toTicketDetail = (actor: Actor, t: TicketDetailRow) => {
  const done = t.subtickets.filter((s) => DONE.has(s.status)).length;
  return {
    number: t.number,
    reference: ticketRef(t.number),
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    source: t.source,
    closeReason: t.closeReason,
    closeNote: t.closeNote,
    category: t.category
      ? { id: t.category.id, name: t.category.name, archived: t.category.archivedAt !== null }
      : null,
    team: t.team ? { id: t.team.id, name: t.team.name, archived: t.team.archivedAt !== null } : null,
    assignee: person(t.assignee),
    createdBy: person(t.createdBy),
    // Members may contact the requester; requesters never see members' emails.
    requester: t.requester ? { name: t.requester.name, email: t.requester.email } : null,
    dueDate: formatDueDate(t.dueDate),
    overdue: isOverdue(t),
    parent: t.parent
      ? {
          number: t.parent.number,
          reference: ticketRef(t.parent.number),
          subject: t.parent.subject,
          status: t.parent.status,
        }
      : null,
    subtickets: t.subtickets.map((s) => ({
      number: s.number,
      reference: ticketRef(s.number),
      subject: s.subject,
      status: s.status,
      priority: s.priority,
      assignee: person(s.assignee),
    })),
    progress: { done, total: t.subtickets.length },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    allowedActions: allowedActionsFor(actor, t),
  };
};
