import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import type { CloseReason, TicketStatus } from '../tickets/tickets-api';

export interface PublicPortal {
  name: string;
  slug: string;
  intro: string | null;
  acceptingComplaints: boolean;
  categories: { id: string; name: string }[];
}

export const usePortal = (slug: string) =>
  useQuery({
    queryKey: ['portal', slug],
    queryFn: () => apiFetch<{ portal: PublicPortal }>(`/public/portals/${slug}`),
    retry: false,
  });

export interface MyComplaintListItem {
  reference: string;
  number: number;
  organization: { name: string; slug: string };
  subject: string;
  status: TicketStatus;
  closeReason: CloseReason | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyComplaint extends MyComplaintListItem {
  description: string;
  closeNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: { id: string; body: string; author: string; fromYou: boolean; createdAt: string }[];
  allowedActions: { canReply: boolean; canConfirm: boolean; canWithdraw: boolean };
}

export const myComplaintKeys = {
  list: (page: number) => ['me', 'complaints', page] as const,
  detail: (slug: string, number: number) => ['me', 'complaints', slug, number] as const,
};

export const useMyComplaints = (page: number) =>
  useQuery({
    queryKey: myComplaintKeys.list(page),
    queryFn: () =>
      apiFetch<{ complaints: MyComplaintListItem[]; total: number; page: number; pageSize: number }>(
        `/me/tickets?page=${page}`
      ),
  });

export const useMyComplaint = (slug: string, number: number) =>
  useQuery({
    queryKey: myComplaintKeys.detail(slug, number),
    queryFn: () => apiFetch<{ complaint: MyComplaint }>(`/me/tickets/${slug}/${number}`),
    retry: false,
  });

/** Plain words for requesters (no internal jargon). */
export const REQUESTER_STATUS: Record<TicketStatus, { label: string; hint: string }> = {
  OPEN: { label: 'Received', hint: 'Your complaint is waiting to be picked up.' },
  IN_PROGRESS: { label: 'Being worked on', hint: 'Someone is working on it.' },
  WAITING_ON_REQUESTER: {
    label: 'Waiting for your reply',
    hint: 'We need more information from you. Please reply below.',
  },
  RESOLVED: { label: 'Resolved', hint: 'We think this is fixed. Confirm it, or reply within 7 days to reopen it.' },
  CLOSED: { label: 'Closed', hint: 'This complaint is closed.' },
};
