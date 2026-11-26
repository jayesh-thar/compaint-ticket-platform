import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Inbox, Plus, User, UserX } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ErrorState, PageHeader, Spinner } from '../../../components/states';
import { orgKeys, useWorkspaceOrg } from '../../orgs/org-api';
import { PRIORITY_LABEL, STATUS_LABEL, type TicketPriority, type TicketStatus } from '../../tickets/tickets-api';

interface Metric {
  count: number;
  /** The exact ticket-list query that produced this count. */
  query: string;
}

interface Dashboard {
  metrics: Record<
    'openWorkload' | 'unassigned' | 'overdue' | 'waitingOnRequester' | 'resolvedLast30Days' | 'myWork',
    Metric
  >;
  byStatus: (Metric & { status: TicketStatus })[];
  byPriority: (Metric & { priority: TicketPriority })[];
  byTeam: (Metric & { teamId: string | null; name: string })[];
}

const CARDS: { key: keyof Dashboard['metrics']; label: string; icon: React.ElementType; tone: string }[] = [
  { key: 'openWorkload', label: 'Open workload', icon: Inbox, tone: 'text-blue-600 bg-blue-50' },
  { key: 'unassigned', label: 'Unassigned', icon: UserX, tone: 'text-amber-700 bg-amber-50' },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
  { key: 'waitingOnRequester', label: 'Waiting on requester', icon: Clock, tone: 'text-purple-600 bg-purple-50' },
  {
    key: 'resolvedLast30Days',
    label: 'Resolved (30 days)',
    icon: CheckCircle2,
    tone: 'text-emerald-600 bg-emerald-50',
  },
  { key: 'myWork', label: 'My work', icon: User, tone: 'text-slate-700 bg-slate-100' },
];

export const DashboardPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const query = useQuery({
    queryKey: orgKeys.dashboard(org.slug),
    queryFn: () => apiFetch<Dashboard>(`/orgs/${org.slug}/dashboard`),
  });
  const list = (qs: string) => `/w/${org.slug}/tickets?${qs}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={
          <>
            Dashboard · your role: <strong className="text-slate-700">{org.myRole}</strong> · counts include only
            tickets you can see.
          </>
        }
        actions={
          <Link to={`/w/${org.slug}/tickets/new`}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New ticket
            </Button>
          </Link>
        }
      />

      {query.isLoading ? (
        <Spinner />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {CARDS.map(({ key, label, icon: Icon, tone }) => (
              <Link key={key} to={list(query.data.metrics[key].query)} className="group">
                <Card className="h-full shadow-sm transition-colors group-hover:border-blue-400">
                  <CardContent className="flex flex-col gap-2 pt-5">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-3xl font-bold text-slate-900">{query.data.metrics[key].count}</span>
                    <span className="text-xs font-medium text-slate-500">{label}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {query.data.metrics.openWorkload.count === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500">
                Nothing open right now. New tickets and complaints will show up here.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown
                title="Open by status"
                rows={query.data.byStatus.map((r) => ({ label: STATUS_LABEL[r.status], ...r }))}
                to={list}
              />
              <Breakdown
                title="Open by priority"
                rows={query.data.byPriority.map((r) => ({ label: PRIORITY_LABEL[r.priority], ...r }))}
                to={list}
              />
              <Breakdown
                title="Open by team"
                rows={query.data.byTeam.map((r) => ({ label: r.name, ...r }))}
                to={list}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Breakdown: React.FC<{
  title: string;
  rows: { label: string; count: number; query: string }[];
  to: (qs: string) => string;
}> = ({ title, rows, to }) => {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.query}>
              <Link to={to(r.query)} className="block rounded px-1 py-0.5 hover:bg-slate-50">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-700">{r.label}</span>
                  <span className="font-semibold text-slate-900">{r.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
