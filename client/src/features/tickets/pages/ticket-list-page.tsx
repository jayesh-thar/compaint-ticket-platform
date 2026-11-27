import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useWorkspaceMe, useWorkspaceOrg, isAdminMe, isLeaderMe, isCategoryLeadMe } from '../../orgs/org-api';
import { useTicketList, VIEW_LABEL } from '../tickets-api';
import { TicketGrid } from '../components/ticket-card';
import { ErrorState, PageHeader, Spinner } from '../../../components/states';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/form-controls';

export const TicketListPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');

  const views = [
    ...(isAdminMe(me) ? ['pending_approval', 'live', 'unassigned', 'admin_review', 'overdue'] : []),
    ...(isCategoryLeadMe(me) ? ['category_waiting'] : []),
    ...(isLeaderMe(me) ? ['team_new', 'team_review', 'team_overdue'] : []),
    'my_requests',
    'my_in_progress',
    'history',
    'all',
  ];
  const view = params.get('view') ?? (isAdminMe(me) ? 'live' : isLeaderMe(me) ? 'team_new' : 'my_in_progress');
  const page = Number(params.get('page') ?? 1);
  const kind = params.get('kind') ?? '';
  const teamId = params.get('teamId') ?? '';

  const { data, isLoading, error, refetch } = useTicketList(org.slug, {
    view,
    page,
    kind,
    teamId,
    q: params.get('q') ?? '',
    pageSize: 24,
  });

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description="Complaints from customers and internal tasks. Updates arrive live."
        actions={
          (isAdminMe(me) || isLeaderMe(me)) && (
            <Link to={`/w/${org.slug}/tickets/new`}>
              <Button className="gap-1">
                <Plus className="h-4 w-4" /> New task
              </Button>
            </Link>
          )
        }
      />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {[...new Set(views.includes(view) ? views : [view, ...views])].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => set({ view: v })}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              v === view ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-blue-600'
            }`}
          >
            {VIEW_LABEL[v] ?? v}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() });
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Search subject or T-number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
        <Select className="sm:w-44" value={kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Kind">
          <option value="">Complaints and tasks</option>
          <option value="COMPLAINT">Complaints only</option>
          <option value="TASK">Tasks only</option>
        </Select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {teamId && (
        <p className="text-xs text-slate-500">
          Filtered to one team.{' '}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => set({ teamId: '' })}>
            Show all teams
          </button>
        </p>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <>
          <p className="text-xs text-slate-500">{data.total} ticket(s)</p>
          <TicketGrid
            slug={org.slug}
            tickets={data.tickets}
            empty="No tickets here"
            hint="Nothing matches this view right now."
          />
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                Previous
              </Button>
              <span className="text-xs text-slate-500">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => set({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
