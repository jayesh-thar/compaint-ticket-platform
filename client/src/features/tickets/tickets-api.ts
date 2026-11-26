import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../lib/api';
import { orgKeys, type Member, type Role } from '../orgs/org-api';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_REQUESTER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type CloseReason = 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'];
export const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export interface PersonRef {
  membershipId: string;
  name: string;
}

export interface TicketListItem {
  number: number;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: 'INTERNAL' | 'PORTAL';
  closeReason: CloseReason | null;
  category: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  assignee: PersonRef | null;
  dueDate: string | null;
  overdue: boolean;
  parentNumber: number | null;
  subticketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketList {
  tickets: TicketListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AllowedActions {
  canEditText: boolean;
  canEditTriage: boolean;
  canChangeTeam: boolean;
  canAssignOthers: boolean;
  canTake: boolean;
  canAddSubticket: boolean;
  canComment: boolean;
  canPublicReply: boolean;
  /** Status targets this member may move the ticket to right now (Phase 6). */
  statusTargets?: TicketStatus[];
  canClose?: boolean;
  closeReasons?: CloseReason[];
  canReopen?: boolean;
}

export interface TicketDetail {
  number: number;
  reference: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: 'INTERNAL' | 'PORTAL';
  closeReason: CloseReason | null;
  closeNote: string | null;
  category: { id: string; name: string; archived: boolean } | null;
  team: { id: string; name: string; archived: boolean } | null;
  assignee: PersonRef | null;
  createdBy: PersonRef | null;
  requester: { name: string; email: string } | null;
  dueDate: string | null;
  overdue: boolean;
  parent: { number: number; reference: string; subject: string; status: TicketStatus } | null;
  subtickets: {
    number: number;
    reference: string;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
    assignee: PersonRef | null;
  }[];
  progress: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  allowedActions: AllowedActions;
}

export const ticketKeys = {
  list: (slug: string, qs: string) => [...orgKeys.tickets(slug), 'list', qs] as const,
  detail: (slug: string, number: number) => [...orgKeys.tickets(slug), 'detail', number] as const,
};

/** `qs` is the URL query string, so the list is always exactly what the address bar says. */
export const useTicketList = (slug: string, qs: string) =>
  useQuery({
    queryKey: ticketKeys.list(slug, qs),
    queryFn: () => apiFetch<TicketList>(`/orgs/${slug}/tickets${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData, // keep the old page visible while the next one loads
  });

export const useTicket = (slug: string, number: number) =>
  useQuery({
    queryKey: ticketKeys.detail(slug, number),
    queryFn: () => apiFetch<{ ticket: TicketDetail }>(`/orgs/${slug}/tickets/${number}`),
    retry: false,
  });

/**
 * Who the current member may pick as assignee for a ticket of `teamId`.
 * Mirrors the server rules (the server still re-checks):
 * - Admin/Manager: team members + Managers/Admins (any active member if no team)
 * - Lead of the team: members of that team
 * - Staff: only themselves
 */
export const assigneeOptions = (
  me: { role: Role; membershipId: string; leadTeamIds: string[] },
  members: Member[],
  teamId: string | null
): Member[] => {
  const inTeam = (m: Member) => !!teamId && m.teams.some((t) => t.id === teamId);
  if (me.role !== 'STAFF') return members.filter((m) => !teamId || inTeam(m) || m.role !== 'STAFF');
  if (teamId && me.leadTeamIds.includes(teamId)) return members.filter(inTeam);
  return members.filter((m) => m.membershipId === me.membershipId);
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_REQUESTER: 'Waiting on requester',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export interface ActivityEntry {
  id: string;
  type: string;
  actorName: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  createdAt: string;
}

export const useTicketActivity = (slug: string, number: number) =>
  useQuery({
    queryKey: [...ticketKeys.detail(slug, number), 'activity'],
    queryFn: () => apiFetch<{ activity: ActivityEntry[] }>(`/orgs/${slug}/tickets/${number}/activity`),
  });

/**
 * Every ticket change returns the fresh ticket. We put it straight into the
 * cache and refresh lists, activity and the dashboard in the background.
 */
export const useTicketAction = (slug: string, number: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      apiFetch<{ ticket: TicketDetail }>(`/orgs/${slug}/tickets/${number}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: async ({ ticket }) => {
      if (ticket.number === number) queryClient.setQueryData(ticketKeys.detail(slug, number), { ticket });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgKeys.tickets(slug) }),
        queryClient.invalidateQueries({ queryKey: orgKeys.dashboard(slug) }),
      ]);
    },
  });
};

/** Friendly words for the errors the workflow endpoints return. */
export const workflowErrorText = (err: unknown): string => {
  if (err instanceof ClientApiError) {
    if (err.code === 'INVALID_TRANSITION' && err.status === 409) return `${err.message} The page has been refreshed.`;
    return err.message;
  }
  return 'Something went wrong. Please try again.';
};

export interface TicketComment {
  id: string;
  body: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  authorType: 'STAFF' | 'REQUESTER';
  authorName: string;
  createdAt: string;
}

export const useTicketComments = (slug: string, number: number) =>
  useQuery({
    queryKey: [...ticketKeys.detail(slug, number), 'comments'],
    queryFn: () => apiFetch<{ comments: TicketComment[] }>(`/orgs/${slug}/tickets/${number}/comments`),
  });
