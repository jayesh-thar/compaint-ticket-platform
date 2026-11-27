import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { orgKeys } from '../orgs/org-api';

export type Stage =
  | 'PENDING_APPROVAL'
  | 'AT_CATEGORY'
  | 'AT_TEAM'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'TEAM_REVIEW'
  | 'ADMIN_REVIEW'
  | 'DONE'
  | 'REJECTED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export type ActionName =
  | 'approve'
  | 'route'
  | 'assign'
  | 'unassign'
  | 'accept'
  | 'decline'
  | 'submit'
  | 'team_approve'
  | 'team_send_back'
  | 'final_approve'
  | 'admin_send_back'
  | 'reroute'
  | 'reject';

export interface TicketListItem {
  number: number;
  reference: string;
  kind: 'COMPLAINT' | 'TASK';
  stage: Stage;
  stageLabel: string;
  subject: string;
  priority: Priority;
  dueDate: string | null;
  overdue: boolean;
  progress: number;
  groupName: string | null;
  team: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  assignees: { membershipId: string; name: string; accepted: boolean }[];
  checklist: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface TicketDetail {
  ticket: TicketListItem & {
    description: string;
    closeNote: string | null;
    createdBy: { membershipId: string; name: string } | null;
    customer: { name: string; email: string; phoneCode: string | null; phone: string | null } | null;
    allAssignees: {
      membershipId: string;
      name: string;
      jobTitle: string | null;
      active: boolean;
      acceptedAt: string | null;
    }[];
    checklistItems: { id: string; title: string; priority: Priority; dueDate: string | null; done: boolean }[];
  };
  allowed: {
    actions: ActionName[];
    canEditText: boolean;
    canEditPriorityDeadline: boolean;
    canEditChecklist: boolean;
    canTickChecklist: boolean;
    canUpdateProgress: boolean;
    canComment: boolean;
    myKinds: string[];
    iAccepted: boolean;
  };
}

export interface ActivityRow {
  id: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  actorName: string;
  createdAt: string;
}

export const useTicketList = (slug: string, params: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString();
  return useQuery({
    queryKey: [...orgKeys.tickets(slug), 'list', qs],
    queryFn: () =>
      apiFetch<{ tickets: TicketListItem[]; total: number; page: number; pageSize: number }>(
        `/orgs/${slug}/tickets?${qs}`
      ),
  });
};

export const ticketKey = (slug: string, n: number) => [...orgKeys.tickets(slug), 'detail', n] as const;

export const useTicket = (slug: string, n: number) =>
  useQuery({
    queryKey: ticketKey(slug, n),
    queryFn: () => apiFetch<TicketDetail>(`/orgs/${slug}/tickets/${n}`),
    retry: false,
  });

export const useActivity = (slug: string, n: number) =>
  useQuery({
    queryKey: [...ticketKey(slug, n), 'activity'],
    queryFn: () => apiFetch<{ activity: ActivityRow[] }>(`/orgs/${slug}/tickets/${n}/activity`),
  });

export const useComments = (slug: string, n: number) =>
  useQuery({
    queryKey: [...ticketKey(slug, n), 'comments'],
    queryFn: () =>
      apiFetch<{ comments: { id: string; body: string; authorName: string; createdAt: string }[] }>(
        `/orgs/${slug}/tickets/${n}/comments`
      ),
  });

/** Words for list tabs / dashboard cards that link to `?view=`. */
export const VIEW_LABEL: Record<string, string> = {
  all: 'Everything I can see',
  live: 'Live tickets',
  history: 'History',
  pending_approval: 'Pending approval',
  at_category: 'At categories',
  unassigned: 'Unassigned in teams',
  overdue: 'Overdue',
  admin_review: 'Awaiting final approval',
  done_30d: 'Done (30 days)',
  category_waiting: 'Waiting for a team choice',
  team_new: 'New to my team',
  team_waiting_accept: 'Waiting for accept',
  team_in_progress: 'Team in progress',
  team_review: 'Needs my review',
  team_overdue: 'Team overdue',
  team_done_30d: 'Team done (30 days)',
  my_requests: 'Requests to accept',
  my_in_progress: 'My work in progress',
  my_review: 'Submitted, in review',
  my_overdue: 'My overdue',
  my_done: 'My done work',
};
