import React, { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import {
  TITLE_WORD,
  describeMe,
  orgKeys,
  useWorkspaceMe,
  useWorkspaceOrg,
  type LeaderTitle,
  type TeamRole,
} from '../../orgs/org-api';
import { ErrorState, PageHeader, Spinner } from '../../../components/states';

interface Dashboard {
  sections: { key: string; title: string; cards: { view: string; label: string; count: number }[] }[];
  myTeams: {
    id: string;
    name: string;
    teamRole: TeamRole;
    leaderTitle: LeaderTitle | null;
    categories: { name: string; teamCount: number }[];
  }[];
  canSeeGraph: boolean;
}

// React Flow is big: load it only for people who see the graph.
const FlowGraph = lazy(() => import('../components/flow-graph').then((m) => ({ default: m.FlowGraph })));

/** Cards that mean "someone is waiting for you" turn red when not zero. */
const URGENT = new Set([
  'pending_approval',
  'admin_review',
  'category_waiting',
  'team_new',
  'team_review',
  'my_requests',
  'overdue',
  'team_overdue',
  'my_overdue',
]);

/** README 0.9: one page, a section for each thing you are; every card opens the matching list. */
export const DashboardPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: orgKeys.dashboard(org.slug),
    queryFn: () => apiFetch<Dashboard>(`/orgs/${org.slug}/dashboard`),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={org.name} description={`Dashboard · you are ${describeMe(me)} · counts update live.`} />
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data?.sections.map((s) => (
        <section key={s.key} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{s.title}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {s.cards.map((c) => (
              <Link
                key={c.view}
                to={`/w/${org.slug}/tickets?view=${c.view}`}
                className={`rounded-xl border bg-white p-4 shadow-sm transition hover:border-blue-400 ${
                  URGENT.has(c.view) && c.count > 0 ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <p
                  className={`text-2xl font-bold ${URGENT.has(c.view) && c.count > 0 ? 'text-red-600' : 'text-slate-900'}`}
                >
                  {c.count}
                </p>
                <p className="mt-1 text-xs text-slate-500">{c.label}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {data && data.myTeams.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">My teams</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.myTeams.map((t) => (
              <Link
                key={t.id}
                to={`/w/${org.slug}/teams/${t.id}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400"
              >
                <p className="font-semibold text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {t.teamRole === 'LEADER' ? `You are the ${TITLE_WORD[t.leaderTitle ?? 'LEAD']}` : 'You are a member'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t.categories.length > 0
                    ? t.categories.map((c) => `"${c.name}" (${c.teamCount} teams)`).join(' · ')
                    : 'Not in a category'}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data?.canSeeGraph && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Workflow className="h-4 w-4" /> Live flow
          </h2>
          <p className="text-xs text-slate-500">
            Where every ticket is right now. Red boxes have work waiting; green ones are clear. Click a team to open it.
          </p>
          <Suspense fallback={<Spinner />}>
            <FlowGraph slug={org.slug} />
          </Suspense>
        </section>
      )}
    </div>
  );
};
