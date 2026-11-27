import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, UsersRound } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import {
  TITLE_WORD,
  isAdminMe,
  useCategories,
  useRefreshOrg,
  useTeams,
  useWorkspaceMe,
  useWorkspaceOrg,
  type Team,
} from '../../orgs/org-api';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { FieldError } from '../../../components/ui/form-controls';
import { CategoryPicker } from '../components/category-picker';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../../components/states';

/** README 0.3: teams grouped under their category; updates live without refresh. */
export const TeamsPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const admin = isAdminMe(me);
  const refresh = useRefreshOrg(org.slug);
  const { data, isLoading, error, refetch } = useTeams(org.slug, admin);
  const { data: cats } = useCategories(org.slug);
  const [name, setName] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<unknown>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiFetch(`/orgs/${org.slug}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name, categoryIds }),
      });
      setName('');
      setCategoryIds([]);
      await refresh();
    } catch (err) {
      setFormError(err);
    }
  };

  const teams = data?.teams ?? [];
  const groups = [
    ...(cats?.categories ?? []).map((c) => ({
      key: c.id,
      title: c.name,
      lead: c.lead ? `${c.lead.label}: ${c.lead.name}` : 'No Category Lead yet',
      teams: teams.filter((t) => t.categories.some((x) => x.id === c.id)),
    })),
    {
      key: 'none',
      title: 'No category',
      lead: null as string | null,
      teams: teams.filter((t) => t.categories.length === 0),
    },
  ].filter((g) => g.teams.length > 0 || g.key !== 'none');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams"
        description="Teams grouped by category. Open a team to see its members, tickets and groups."
      />

      {admin && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={create} className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="New team name, e.g. Server team 01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  aria-label="Team name"
                />
                <Button type="submit" className="gap-1">
                  <Plus className="h-4 w-4" /> Create team
                </Button>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">
                  Categories (tick one or more - each shows on the complaint form)
                </p>
                <CategoryPicker categories={cats?.categories ?? []} value={categoryIds} onChange={setCategoryIds} />
              </div>
            </form>
            {formError != null && (
              <div className="mt-2">
                <FieldError
                  message={
                    formError instanceof ClientApiError
                      ? (formError.fields?.name ?? formError.message)
                      : 'Could not create the team.'
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && teams.length === 0 && (
        <EmptyState title="No teams yet" hint={admin ? 'Create the first team above.' : undefined} />
      )}

      {teams.length > 0 &&
        groups.map((g) => (
          <section key={g.key} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{g.title}</h2>
              {g.lead && <span className="text-xs text-slate-500">{g.lead}</span>}
            </div>
            {g.teams.length === 0 ? (
              <p className="text-sm text-slate-500">No teams in this category yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.teams.map((t) => (
                  <TeamCard key={t.id} slug={org.slug} t={t} />
                ))}
              </div>
            )}
          </section>
        ))}
    </div>
  );
};

const TeamCard: React.FC<{ slug: string; t: Team }> = ({ slug, t }) => (
  <Link
    to={`/w/${slug}/teams/${t.id}`}
    className={`flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400 ${t.archived ? 'opacity-60' : ''}`}
  >
    <div className="min-w-0">
      <p className="flex items-center gap-2 font-semibold text-slate-900">
        <UsersRound className="h-4 w-4 text-blue-600" /> {t.name}{' '}
        {t.archived && <span className="text-xs text-slate-400">(archived)</span>}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {t.leader ? `${TITLE_WORD[t.leader.title ?? 'LEAD']}: ${t.leader.name}` : 'No leader yet'} · {t.memberCount}{' '}
        people · {t.liveTicketCount} live
      </p>
    </div>
    <ChevronRight className="h-4 w-4 text-slate-400" />
  </Link>
);
