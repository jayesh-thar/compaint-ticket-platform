import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useParams, Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';
import {
  Building2,
  Users,
  LayoutDashboard,
  LogOut,
  ChevronDown,
  Plus,
  Settings,
  UsersRound,
  Tags,
  Ticket,
} from 'lucide-react';
import { describeMe, orgKeys, useLiveUpdates, useMyOrgs, type OrgDetails, type WorkspaceMe } from '../org-api';

const Spinner = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
  </div>
);

/**
 * Shell for every /w/:slug page. Loads the org (the server returns 404 if we are
 * not an active member) and passes it to child pages through the Outlet context.
 * Nav items depend on role, but the server still checks every request.
 */
export const WorkspaceLayout: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user, logout } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: orgKeys.org(slug),
    queryFn: () => apiFetch<{ organization: OrgDetails; me: WorkspaceMe }>(`/orgs/${slug}`),
    retry: false,
  });
  const { data: myOrgsData } = useMyOrgs();
  // Live updates for every page of this workspace (README 0.10).
  useLiveUpdates(data ? slug : '');

  // Close the switcher when clicking outside it.
  useEffect(() => {
    if (!switcherOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [switcherOpen]);

  if (isLoading) return <Spinner />;

  if (error || !data) {
    const notFound = error instanceof ClientApiError && error.status === 404;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <h2 className="text-2xl font-bold text-slate-800">
          {notFound ? 'Organization not found' : 'Something went wrong'}
        </h2>
        <p className="text-sm text-slate-500 mt-1 max-w-sm">
          {notFound
            ? 'This organization does not exist, or you are not a member of it.'
            : 'We could not load this workspace. Please try again.'}
        </p>
        <div className="mt-4 flex gap-2">
          {!notFound && <Button onClick={() => refetch()}>Retry</Button>}
          <Link to="/start">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const org = data.organization;
  const myOrgs = myOrgsData?.organizations ?? [];
  const isAdmin = org.myRole === 'ADMIN';

  const navItems = [
    { to: `/w/${slug}`, label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: `/w/${slug}/tickets`, label: 'Tickets', icon: Ticket, end: false },
    { to: `/w/${slug}/teams`, label: 'Teams', icon: UsersRound, end: false },
    { to: `/w/${slug}/categories`, label: 'Categories', icon: Tags, end: false },
    ...(isAdmin
      ? [
          { to: `/w/${slug}/members`, label: 'Members', icon: Users, end: false },
          { to: `/w/${slug}/settings`, label: 'Settings', icon: Settings, end: false },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              className="flex items-center gap-2 font-semibold text-slate-900 hover:text-blue-600 py-1 px-2 rounded-md hover:bg-slate-100 transition-colors max-w-[60vw]"
            >
              <Building2 className="h-5 w-5 text-blue-600 shrink-0" />
              <span className="truncate">{org.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                {describeMe(data.me)}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            {switcherOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-2 z-50"
              >
                <div className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Switch organization
                </div>
                {myOrgs.map((o) => (
                  <Link
                    key={o.id}
                    role="menuitem"
                    to={`/w/${o.slug}`}
                    onClick={() => setSwitcherOpen(false)}
                    className={`px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${
                      o.slug === slug ? 'font-bold text-blue-600 bg-blue-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="text-xs text-slate-400">{o.role}</span>
                  </Link>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <Link
                    role="menuitem"
                    to="/orgs/new"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
                  >
                    <Plus className="h-4 w-4" /> Create new organization
                  </Link>
                  <Link
                    role="menuitem"
                    to="/start"
                    className="block px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    All organizations
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-slate-800">{user?.name}</p>
              <p className="text-[11px] text-slate-400">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              aria-label="Log out"
              className="text-slate-600 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <nav className="px-4 sm:px-6 flex items-center gap-1 overflow-x-auto text-sm font-medium">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 border-b-2 whitespace-nowrap ${
                  isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-blue-600'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6">
        {/* key: remount pages when switching orgs so forms never show the previous org's data */}
        <Outlet key={slug} context={{ org, me: data.me }} />
      </main>
    </div>
  );
};
