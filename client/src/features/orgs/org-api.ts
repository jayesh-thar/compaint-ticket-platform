import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

export type Role = 'ADMIN' | 'STAFF';
export const ROLES: Role[] = ['ADMIN', 'STAFF'];
export type TeamRole = 'LEADER' | 'MEMBER';
export type LeaderTitle = 'HEAD' | 'LEAD' | 'MANAGER';
export const LEADER_TITLES: LeaderTitle[] = ['HEAD', 'LEAD', 'MANAGER'];
export const TITLE_WORD: Record<LeaderTitle, string> = { HEAD: 'Head', LEAD: 'Lead', MANAGER: 'Manager' };

export interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  portalEnabled: boolean;
  portalIntro: string | null;
  myRole: Role;
}

export interface MyTeam {
  id: string;
  name: string;
  categoryIds: string[];
  archived: boolean;
  teamRole: TeamRole;
  leaderTitle: LeaderTitle | null;
}

/** The current member inside this organization (from GET /orgs/:slug). */
export interface WorkspaceMe {
  membershipId: string;
  role: Role;
  jobTitle: string | null;
  teamIds: string[];
  leadTeamIds: string[];
  leadCategoryIds: string[];
  teams: MyTeam[];
  ledCategories: { id: string; name: string }[];
}

export const isAdminMe = (me: WorkspaceMe) => me.role === 'ADMIN';
export const isLeaderMe = (me: WorkspaceMe) => me.leadTeamIds.length > 0;
export const isCategoryLeadMe = (me: WorkspaceMe) => me.leadCategoryIds.length > 0;

/** "Admin", "Head of Server team 01", "Server issue - Lead", "Member of Network". */
export const describeMe = (me: WorkspaceMe) => {
  if (me.role === 'ADMIN') return 'Admin';
  const led = me.teams.find((t) => t.teamRole === 'LEADER');
  if (led) return `${TITLE_WORD[led.leaderTitle ?? 'LEAD']} of ${led.name}`;
  if (me.ledCategories[0]) return `${me.ledCategories[0].name} - Lead`;
  if (me.teams[0]) return `Member of ${me.teams[0].name}`;
  return 'Staff';
};

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  role: Role;
  membershipId: string;
}

// Query keys always start with ['org', slug], so live events can refresh everything of one org.
export const orgKeys = {
  myOrgs: ['me', 'orgs'] as const,
  org: (slug: string) => ['org', slug] as const,
  members: (slug: string) => ['org', slug, 'members'] as const,
  jobTitles: (slug: string) => ['org', slug, 'job-titles'] as const,
  invitations: (slug: string) => ['org', slug, 'invitations'] as const,
  teams: (slug: string, includeArchived = false) => ['org', slug, 'teams', { includeArchived }] as const,
  team: (slug: string, id: string) => ['org', slug, 'team', id] as const,
  categories: (slug: string, includeArchived = false) => ['org', slug, 'categories', { includeArchived }] as const,
  tickets: (slug: string) => ['org', slug, 'tickets'] as const,
  dashboard: (slug: string) => ['org', slug, 'dashboard'] as const,
  graph: (slug: string) => ['org', slug, 'graph'] as const,
};

export interface MemberTeam {
  id: string;
  name: string;
  teamRole: TeamRole;
  leaderTitle: LeaderTitle | null;
  archived: boolean;
}

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  jobTitle: string | null;
  joinedAt: string;
  teams: MemberTeam[];
}

export interface Leader {
  membershipId: string;
  name: string;
  title: LeaderTitle | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  /** A team can be in several categories (D-31). */
  categories: { id: string; name: string }[];
  leader: Leader | null;
  memberCount: number;
  liveTicketCount: number;
}

export interface TeamDetail {
  team: {
    id: string;
    name: string;
    description: string | null;
    archived: boolean;
    categories: { id: string; name: string; teamCount: number }[];
    leader: Leader | null;
    members: {
      membershipId: string;
      name: string;
      email: string | null;
      jobTitle: string | null;
      teamRole: TeamRole;
      leaderTitle: LeaderTitle | null;
      status: string;
    }[];
    pendingInvitations: {
      id: string;
      email: string;
      teamRole: TeamRole | null;
      leaderTitle: LeaderTitle | null;
      jobTitle: string | null;
      expiresAt: string;
      expired: boolean;
    }[];
  };
  permissions: { canManageMembers: boolean; canSetLeader: boolean; canEditTeam: boolean };
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  lead: { membershipId: string; name: string; label: string } | null;
  teams: { id: string; name: string }[];
  liveTicketCount: number;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  jobTitle: string | null;
  team: { id: string; name: string } | null;
  teamRole: TeamRole | null;
  leaderTitle: LeaderTitle | null;
  expiresAt: string;
  expired: boolean;
}

export const useMembers = (slug: string) =>
  useQuery({
    queryKey: orgKeys.members(slug),
    queryFn: () => apiFetch<{ members: Member[] }>(`/orgs/${slug}/members`),
  });

export const useJobTitles = (slug: string) =>
  useQuery({
    queryKey: orgKeys.jobTitles(slug),
    queryFn: () => apiFetch<{ jobTitles: string[] }>(`/orgs/${slug}/members/job-titles`),
  });

/** Selection lists hide archived items; management pages ask for them too. */
export const useTeams = (slug: string, includeArchived = false) =>
  useQuery({
    queryKey: orgKeys.teams(slug, includeArchived),
    queryFn: () => apiFetch<{ teams: Team[] }>(`/orgs/${slug}/teams${includeArchived ? '?includeArchived=true' : ''}`),
  });

export const useTeam = (slug: string, id: string, enabled = true) =>
  useQuery({
    queryKey: orgKeys.team(slug, id),
    queryFn: () => apiFetch<TeamDetail>(`/orgs/${slug}/teams/${id}`),
    enabled: enabled && !!id,
    retry: false,
  });

export const useCategories = (slug: string, includeArchived = false) =>
  useQuery({
    queryKey: orgKeys.categories(slug, includeArchived),
    queryFn: () =>
      apiFetch<{ categories: Category[] }>(`/orgs/${slug}/categories${includeArchived ? '?includeArchived=true' : ''}`),
  });

export const useMyOrgs = () =>
  useQuery({
    queryKey: orgKeys.myOrgs,
    queryFn: () => apiFetch<{ organizations: MyOrg[] }>('/me/orgs'),
  });

/** Refresh everything of this organization (after any change). */
export const useRefreshOrg = (slug: string) => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['org', slug] });
};

/**
 * Live updates (README 0.10, D-27): one EventSource per workspace. Any change
 * event refetches the queries of this organization that are on screen, so
 * dashboards, the graph, lists and team pages update without a refresh.
 */
export const useLiveUpdates = (slug: string) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!slug || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/v1/orgs/${slug}/events`, { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      // Several events in a burst -> one refetch.
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['org', slug] }), 150);
    };
    source.addEventListener('change', onChange);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [slug, qc]);
};

/** The organization loaded by WorkspaceLayout, available to every /w/:slug page. */
export const useWorkspaceOrg = () => useOutletContext<{ org: OrgDetails; me: WorkspaceMe }>().org;
export const useWorkspaceMe = () => useOutletContext<{ org: OrgDetails; me: WorkspaceMe }>().me;

/** Same rule as the server: lowercase letters/digits/hyphens, 3-40 chars, no edge hyphens. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const slugFromName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
