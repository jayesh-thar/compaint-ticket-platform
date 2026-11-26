import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Globe, Lock, Plus } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent } from '../../../components/ui/card';
import { Badge, FieldError, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, Notice, PageHeader, Spinner, errorMessage } from '../../../components/states';
import { useCategories, useTeams, useWorkspaceOrg } from '../../orgs/org-api';

export const CategoriesPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const isAdmin = org.myRole === 'ADMIN';
  const queryClient = useQueryClient();
  const categoriesQuery = useCategories(org.slug, isAdmin);
  const teamsQuery = useTeams(org.slug); // active teams only: archived ones cannot be chosen

  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [defaultTeamId, setDefaultTeamId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org', org.slug, 'categories'] });

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/orgs/${org.slug}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name, isPublic, defaultTeamId: defaultTeamId || null }),
      }),
    onSuccess: async () => {
      setName('');
      setDefaultTeamId('');
      setNotice({ kind: 'ok', text: 'Category created.' });
      await refresh();
    },
    onError: (err) => {
      if (err instanceof ClientApiError && err.fields) setFieldErrors(err.fields);
      setNotice({ kind: 'error', text: errorMessage(err) });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/orgs/${org.slug}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (err) => setNotice({ kind: 'error', text: errorMessage(err) }),
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const teams = teamsQuery.data?.teams ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Types of complaints. Public categories appear on the portal; a default team routes new tickets."
      />

      {isAdmin && (
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <form
              className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setFieldErrors({});
                setNotice(null);
                create.mutate();
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  placeholder="e.g. Wi-Fi, Refund"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                />
                <FieldError message={fieldErrors.name} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-team">Default team</Label>
                <Select id="cat-team" value={defaultTeamId} onChange={(e) => setDefaultTeamId(e.target.value)}>
                  <option value="">No team (Managers triage)</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <FieldError message={fieldErrors.defaultTeamId} />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Show on portal
              </label>
              <Button type="submit" className="gap-2" disabled={create.isPending || name.trim().length < 2}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <Card className="shadow-sm">
        {categoriesQuery.isLoading ? (
          <Spinner />
        ) : categoriesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={categoriesQuery.error} onRetry={() => categoriesQuery.refetch()} />
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            hint={isAdmin ? 'Add one above, e.g. "Wi-Fi" routed to IT.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <li
                key={c.id}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 ${c.archived ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    {c.name}
                    {c.isPublic ? (
                      <Badge tone="green">
                        <Globe className="h-3 w-3" /> Public
                      </Badge>
                    ) : (
                      <Badge>
                        <Lock className="h-3 w-3" /> Internal
                      </Badge>
                    )}
                    {c.archived && <Badge tone="amber">Archived</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    Routes to:{' '}
                    {c.defaultTeam
                      ? `${c.defaultTeam.name}${c.defaultTeam.archived ? ' (archived - unrouted)' : ''}`
                      : 'no team'}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!c.archived && (
                      <>
                        <Select
                          aria-label={`Default team of ${c.name}`}
                          className="h-8 w-40 text-xs"
                          value={c.defaultTeam && !c.defaultTeam.archived ? c.defaultTeam.id : ''}
                          disabled={update.isPending}
                          onChange={(e) => update.mutate({ id: c.id, body: { defaultTeamId: e.target.value || null } })}
                        >
                          <option value="">No team</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: c.id, body: { isPublic: !c.isPublic } })}
                        >
                          {c.isPublic ? 'Make internal' : 'Make public'}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      aria-label={c.archived ? `Unarchive ${c.name}` : `Archive ${c.name}`}
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id, body: { archived: !c.archived } })}
                    >
                      {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
