import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';
export const ROLES: Role[] = ['ADMIN', 'MANAGER', 'STAFF'];

export interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  portalEnabled: boolean;
  portalIntro: string | null;
  myRole: Role;
}

/** The current member inside this organization (from GET /orgs/:slug). */
export interface WorkspaceMe {
  membershipId: string;
  role: Role;
  teamIds: string[];
  leadTeamIds: string[];
}

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  role: Role;
  membershipId: string;
}

// Query keys always include the slug, so two tabs in two orgs never mix data.
export const orgKeys = {
  myOrgs: ['me', 'orgs'] as const,
  org: (slug: string) => ['org', slug] as const,
  members: (slug: string) => ['org', slug, 'members'] as const,
  invitations: (slug: string) => ['org', slug, 'invitations'] as const,
  teams: (slug: string, includeArchived = false) => ['org', slug, 'teams', { includeArchived }] as const,
  categories: (slug: string, includeArchived = false) => ['org', slug, 'categories', { includeArchived }] as const,
  tickets: (slug: string) => ['org', slug, 'tickets'] as const,
  dashboard: (slug: string) => ['org', slug, 'dashboard'] as const,
};

export interface MemberTeam {
  id: string;
  name: string;
  isLead: boolean;
  archived: boolean;
}

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
  teams: MemberTeam[];
}

export interface TeamMemberInfo {
  membershipId: string;
  name: string;
  email: string;
  role: Role;
  isLead: boolean;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  openTicketCount: number;
  members: TeamMemberInfo[];
}

export interface Category {
  id: string;
  name: string;
  isPublic: boolean;
  archived: boolean;
  defaultTeam: { id: string; name: string; archived: boolean } | null;
}

export const useMembers = (slug: string) =>
  useQuery({
    queryKey: orgKeys.members(slug),
    queryFn: () => apiFetch<{ members: Member[] }>(`/orgs/${slug}/members`),
  });

/** Selection lists hide archived items; management pages ask for them too. */
export const useTeams = (slug: string, includeArchived = false) =>
  useQuery({
    queryKey: orgKeys.teams(slug, includeArchived),
    queryFn: () => apiFetch<{ teams: Team[] }>(`/orgs/${slug}/teams${includeArchived ? '?includeArchived=true' : ''}`),
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
