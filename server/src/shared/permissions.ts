/**
 * The permission matrix of README section 5.3 as small pure functions.
 *
 * No database access here: callers pass in the actor (built per request by
 * requireOrgMember) and the few ticket fields a rule needs. That keeps every
 * rule easy to unit-test row by row, and lets the server compute
 * `allowedActions` for the UI with exactly the same code it uses to enforce.
 */

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';

export interface Actor {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  teamIds: string[]; // teams the member belongs to
  leadTeamIds: string[]; // subset where isLead = true
}

/** The ticket fields permission rules look at. */
export interface TicketRef {
  teamId: string | null;
  assigneeId: string | null;
  createdByMembershipId: string | null;
  parentId?: string | null;
}

export const isAdmin = (actor: Actor) => actor.role === 'ADMIN';

/** Manager or Admin ("M+" in the README). */
export const isManagerPlus = (actor: Actor) => actor.role === 'ADMIN' || actor.role === 'MANAGER';

export const isLeadOf = (actor: Actor, teamId: string | null | undefined) =>
  !!teamId && actor.leadTeamIds.includes(teamId);

export const isInTeam = (actor: Actor, teamId: string | null | undefined) => !!teamId && actor.teamIds.includes(teamId);

// ---------- organization structure ----------

/** Settings, portal toggle, members, invitations, teams, categories. */
export const canManageOrganization = (actor: Actor) => isAdmin(actor);

// ---------- ticket visibility (README 5.2) ----------

export const canViewTicket = (actor: Actor, ticket: TicketRef) =>
  isManagerPlus(actor) ||
  ticket.assigneeId === actor.membershipId ||
  ticket.createdByMembershipId === actor.membershipId ||
  isInTeam(actor, ticket.teamId);

// ---------- ticket actions ----------

/**
 * "Manage" powers over a ticket: M+ always, a Lead for their team's tickets.
 * Covers priority / due date / category, close, sub-tickets, working status,
 * and assigning within the team.
 */
export const canManageTicket = (actor: Actor, ticket: TicketRef) =>
  isManagerPlus(actor) || isLeadOf(actor, ticket.teamId);

export type CreateCheck = { ok: true } | { ok: false; reason: 'TEAM_REQUIRED' | 'NOT_OWN_TEAM' | 'SELF_ASSIGN_ONLY' };

/**
 * Create internal ticket: M+ any team; Lead own (led) team; Staff own team and
 * may only leave it unassigned or assign themselves.
 * (Whether the assignee is *eligible* is checked separately.)
 */
export const checkCreateTicket = (
  actor: Actor,
  input: { teamId: string | null; assigneeId: string | null }
): CreateCheck => {
  if (isManagerPlus(actor)) return { ok: true };
  if (!input.teamId) return { ok: false, reason: 'TEAM_REQUIRED' };
  if (isLeadOf(actor, input.teamId)) return { ok: true };
  if (!isInTeam(actor, input.teamId)) return { ok: false, reason: 'NOT_OWN_TEAM' };
  if (input.assigneeId && input.assigneeId !== actor.membershipId) {
    return { ok: false, reason: 'SELF_ASSIGN_ONLY' };
  }
  return { ok: true };
};

/** Sub-tickets: M+ any parent; Lead when the parent is in a team they lead; never Staff. */
export const canCreateSubticket = (actor: Actor, parent: TicketRef) => canManageTicket(actor, parent);

/**
 * Assign / reassign / unassign.
 * - M+ : anyone eligible, or unassign.
 * - Lead of the ticket's team: members of that team, or unassign.
 * - Anyone in the ticket's team: "Take it" = assign an *unassigned* ticket to themselves.
 *
 * `targetInTicketTeam` tells whether the target is a member of the ticket's team.
 */
export const canAssign = (
  actor: Actor,
  ticket: TicketRef,
  target: { membershipId: string | null; inTicketTeam: boolean }
) => {
  if (isManagerPlus(actor)) return true;
  if (isLeadOf(actor, ticket.teamId)) return target.membershipId === null || target.inTicketTeam;
  // Self-assign ("Take it"): only unassigned tickets of one of my teams.
  return target.membershipId === actor.membershipId && ticket.assigneeId === null && isInTeam(actor, ticket.teamId);
};

/** Show the "Take it" button. */
export const canTakeTicket = (actor: Actor, ticket: TicketRef) =>
  ticket.assigneeId === null &&
  (isManagerPlus(actor) || isLeadOf(actor, ticket.teamId) || isInTeam(actor, ticket.teamId));

export const canChangeTeam = (actor: Actor) => isManagerPlus(actor);

/** Priority, due date, category. */
export const canEditTriageFields = (actor: Actor, ticket: TicketRef) => canManageTicket(actor, ticket);

/** Subject and description. */
export const canEditText = (actor: Actor) => isManagerPlus(actor);

/** In progress, waiting, resolved, back to open, reopen from resolved. */
export const canChangeWorkingStatus = (actor: Actor, ticket: TicketRef) =>
  canManageTicket(actor, ticket) || ticket.assigneeId === actor.membershipId;

export const canCloseTicket = (actor: Actor, ticket: TicketRef) => canManageTicket(actor, ticket);

/** CLOSED -> OPEN with a reason. */
export const canReopenClosed = (actor: Actor) => isManagerPlus(actor);

/** Public reply / internal note: anyone who can see the ticket. */
export const canComment = (actor: Actor, ticket: TicketRef) => canViewTicket(actor, ticket);
