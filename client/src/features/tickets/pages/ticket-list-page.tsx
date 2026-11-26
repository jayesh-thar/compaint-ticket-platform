import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, CornerDownRight, Plus, Search, UserX } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card } from '../../../components/ui/card';
import { Badge, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../../components/states';
import { useMembers, useTeams, useWorkspaceMe, useWorkspaceOrg } from '../../orgs/org-api';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, useTicketList } from '../tickets-api';
import { PriorityBadge, StatusBadge } from '../components/ticket-badges';

/** Quick queues (planning Phase 6): just presets of the same URL filters. */
const queues = (myTeamIds: string[]) => [
  { label: 'All open', params: { open: 'true' } },
  { label: 'Unassigned', params: { open: 'true', unassigned: 'true' } },
  { label: 'My tickets', params: { open: 'true', mine: 'true' } },
  ...(myTeamIds.length === 1 ? [{ label: 'My team', params: { open: 'true', teamId: myTeamIds[0] } }] : []),
  { label: 'Everything', params: {} as Record<string, string> },
];

const FILTER_KEYS = [
  'status',
  'open',
  'priority',
  'teamId',
  'assigneeId',
  'source',
  'unassigned',
  'overdue',
  'mine',
  'q',
];

export const TicketListPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const [params, setParams] = useSearchParams();
  const qs = params.toString();
  const list = useTicketList(org.slug, qs);
  const teams = useTeams(org.slug, true).data?.teams ?? [];
  const members = useMembers(org.slug).data?.members ?? [];

  // Search box: typed text is applied on submit, not on every key press.
  const [search, setSearch] = useState(params.get('q') ?? '');
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  /** Change some params; any filter change goes back to page 1. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const applyQueue = (preset: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const k of ['sort', 'order']) if (params.get(k)) next.set(k, params.get(k)!);
    for (const [k, v] of Object.entries(preset)) next.set(k, v);
    setParams(next);
  };

  const isQueueActive = (preset: Record<string, string>) =>
    FILTER_KEYS.every((k) => (params.get(k) ?? undefined) === preset[k]);

  const data = list.data;
  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description="Everything you can see in this organization."
        actions={
          <Link to={`/w/${org.slug}/tickets/new`}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New ticket
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Queues">
        {queues(me.teamIds).map((q) => (
          <Button
            key={q.label}
            role="tab"
            aria-selected={isQueueActive(q.params)}
            variant={isQueueActive(q.params) ? 'default' : 'outline'}
            size="sm"
            onClick={() => applyQueue(q.params)}
          >
            {q.label}
          </Button>
        ))}
      </div>

      <Card className="p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <form
            className="relative lg:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search.trim() || null });
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              aria-label="Search by T-number or subject"
              placeholder="Search T-42 or subject..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <Select
            aria-label="Status"
            value={params.get('status') ?? ''}
            onChange={(e) => update({ status: e.target.value, open: null })}
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Priority"
            value={params.get('priority') ?? ''}
            onChange={(e) => update({ priority: e.target.value })}
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Team"
            value={params.get('teamId') ?? ''}
            onChange={(e) => update({ teamId: e.target.value })}
          >
            <option value="">Any team</option>
            <option value="none">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.archived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Assignee"
            value={params.get('assigneeId') ?? ''}
            onChange={(e) => update({ assigneeId: e.target.value, mine: null, unassigned: null })}
          >
            <option value="">Any assignee</option>
            {members.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={params.get('overdue') === 'true'}
              onChange={(e) => update({ overdue: e.target.checked ? 'true' : null })}
            />
            Overdue only
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={params.get('unassigned') === 'true'}
              onChange={(e) => update({ unassigned: e.target.checked ? 'true' : null, assigneeId: null, mine: null })}
            />
            Unassigned
          </label>
          <Select
            aria-label="Source"
            className="h-8 w-auto"
            value={params.get('source') ?? ''}
            onChange={(e) => update({ source: e.target.value })}
          >
            <option value="">Internal + portal</option>
            <option value="INTERNAL">Internal only</option>
            <option value="PORTAL">Portal only</option>
          </Select>
          <span className="ml-auto flex items-center gap-1.5">
            <Select
              aria-label="Sort by"
              className="h-8 w-auto"
              value={params.get('sort') ?? 'updatedAt'}
              onChange={(e) => update({ sort: e.target.value })}
            >
              <option value="updatedAt">Last updated</option>
              <option value="createdAt">Created</option>
              <option value="priority">Priority</option>
              <option value="dueDate">Due date</option>
              <option value="number">Number</option>
            </Select>
            <Select
              aria-label="Order"
              className="h-8 w-auto"
              value={params.get('order') ?? 'desc'}
              onChange={(e) => update({ order: e.target.value })}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </Select>
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden shadow-sm">
        {list.isLoading ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !data || data.tickets.length === 0 ? (
          <EmptyState
            title={qs ? 'No tickets match these filters' : 'No tickets yet'}
            hint={qs ? 'Try another queue or clear the filters.' : 'Create the first one with "New ticket".'}
            action={
              qs ? (
                <Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams())}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className={`divide-y divide-slate-100 ${list.isFetching ? 'opacity-60' : ''}`}>
            {data.tickets.map((t) => (
              <li key={t.number}>
                <Link to={`/w/${org.slug}/tickets/${t.number}`} className="block px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{t.reference}</span>
                    {t.parentNumber && (
                      <span className="flex items-center gap-0.5 text-xs text-slate-500">
                        <CornerDownRight className="h-3 w-3" /> sub-ticket of T-{t.parentNumber}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{t.subject}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <StatusBadge status={t.status} closeReason={t.closeReason} />
                    <PriorityBadge priority={t.priority} />
                    {t.source === 'PORTAL' && <Badge tone="green">Portal</Badge>}
                    {!t.assignee && t.status !== 'CLOSED' && t.status !== 'RESOLVED' && (
                      <Badge tone="amber">
                        <UserX className="h-3 w-3" /> Unassigned
                      </Badge>
                    )}
                    {t.overdue && (
                      <Badge tone="red">
                        <AlertTriangle className="h-3 w-3" /> Overdue
                      </Badge>
                    )}
                    <span>· {t.team?.name ?? 'No team'}</span>
                    {t.assignee && <span>· {t.assignee.name}</span>}
                    {t.dueDate && <span>· due {t.dueDate}</span>}
                    {t.subticketCount > 0 && <span>· {t.subticketCount} sub-ticket(s)</span>}
                    <span className="ml-auto">updated {new Date(t.updatedAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.total > 0 && (
        <nav className="flex items-center justify-between text-sm text-slate-600" aria-label="Pagination">
          <span>
            {data.total} ticket(s) · page {page} of {pages}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </nav>
      )}
    </div>
  );
};
