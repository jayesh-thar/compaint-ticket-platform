import type { MembershipRole } from '@prisma/client';

/**
 * Who is calling, loaded once per request by requireOrgMember (README 0.2).
 * Every permission check reads this object; nothing comes from the request body.
 */
export interface Actor {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
  /** Teams I am in (any team role). */
  teamIds: string[];
  /** Teams I lead (Head / Lead / Manager). */
  leadTeamIds: string[];
  /** Categories I am the Category Lead of. */
  leadCategoryIds: string[];
}

export const isAdmin = (a: Actor) => a.role === 'ADMIN';
export const isLeaderOf = (a: Actor, teamId: string | null | undefined) => !!teamId && a.leadTeamIds.includes(teamId);
export const leadsCategory = (a: Actor, categoryId: string | null | undefined) =>
  !!categoryId && a.leadCategoryIds.includes(categoryId);

/** Admins, Team Leaders and Category Leads see the flow graph (README 0.10). */
export const canSeeGraph = (a: Actor) => isAdmin(a) || a.leadTeamIds.length > 0 || a.leadCategoryIds.length > 0;

/** Admins raise tasks for any team; Team Leaders too (README 0.4). */
export const canRaiseTask = (a: Actor) => isAdmin(a) || a.leadTeamIds.length > 0;

/** Admin manages every team; a Leader manages members of their own team. */
export const canManageTeamMembers = (a: Actor, teamId: string) => isAdmin(a) || isLeaderOf(a, teamId);
