import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import {
  isAdminMe,
  useCategories,
  useMembers,
  useRefreshOrg,
  useTeams,
  useWorkspaceMe,
  useWorkspaceOrg,
  type Category,
} from '../../orgs/org-api';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Badge, FieldError, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../../components/states';

/**
 * README 0.3: a category groups teams (multi-select) and has one Category Lead
 * ("Server issue - Lead") who picks the team. Customers see category names.
 */
export const CategoriesPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const { data, isLoading, error, refetch } = useCategories(org.slug, isAdminMe(me));
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        description="Group teams under a category. Customers choose the category on the complaint form."
        actions={
          isAdminMe(me) && (
            <Button className="gap-1" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New category
            </Button>
          )
        }
      />
      {editing && (
        <CategoryForm
          key={editing === 'new' ? 'new' : editing.id}
          category={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.categories.length === 0 && (
        <EmptyState title="No categories yet" hint="Complaints then arrive as 'Other' and the Admin picks a team." />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.categories.map((c) => (
          <Card key={c.id} className={c.archived ? 'opacity-60' : ''}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  {c.name} {c.archived && <span className="text-xs font-normal text-slate-400">(archived)</span>}
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {c.lead ? `${c.lead.label}: ${c.lead.name}` : 'No Category Lead yet'}
                </p>
              </div>
              {isAdminMe(me) && (
                <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {c.teams.length === 0 && <span className="text-xs text-slate-400">No teams</span>}
                {c.teams.map((t) => (
                  <Badge key={t.id}>{t.name}</Badge>
                ))}
              </div>
              <p className="text-xs text-slate-500">{c.liveTicketCount} live ticket(s)</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const CategoryForm: React.FC<{ category: Category | null; onDone: () => void }> = ({ category, onDone }) => {
  const org = useWorkspaceOrg();
  const refresh = useRefreshOrg(org.slug);
  const { data: teams } = useTeams(org.slug);
  const { data: members } = useMembers(org.slug);
  const [name, setName] = useState(category?.name ?? '');
  const [teamIds, setTeamIds] = useState<string[]>(category?.teams.map((t) => t.id) ?? []);
  const [leadId, setLeadId] = useState(category?.lead?.membershipId ?? '');
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ClientApiError ? (error.fields ?? {}) : {};

  const save = async (extra: object = {}) => {
    setError(null);
    try {
      await apiFetch(`/orgs/${org.slug}/categories${category ? `/${category.id}` : ''}`, {
        method: category ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, teamIds, leadMembershipId: leadId || null, ...extra }),
      });
      await refresh();
      onDone();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{category ? `Edit ${category.name}` : 'New category'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {error != null && <ErrorState error={error} />}
          <div className="space-y-1">
            <Label htmlFor="cat-name">Name (customers see this)</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Server issue"
            />
            <FieldError message={fields.name} />
          </div>
          <div className="space-y-1">
            <Label>Teams in this category</Label>
            <div className="grid gap-1 rounded-md border border-slate-200 p-2 sm:grid-cols-2">
              {teams?.teams.length === 0 && <p className="text-xs text-slate-500">Create teams first.</p>}
              {teams?.teams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={teamIds.includes(t.id)}
                    onChange={(e) =>
                      setTeamIds(e.target.checked ? [...teamIds, t.id] : teamIds.filter((x) => x !== t.id))
                    }
                  />
                  {t.name}
                  {t.categories.some((c) => c.id !== category?.id) && (
                    <span className="text-xs text-slate-400">
                      (also in{' '}
                      {t.categories
                        .filter((c) => c.id !== category?.id)
                        .map((c) => c.name)
                        .join(', ')}
                      )
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cat-lead">{name ? `${name} - Lead` : 'Category Lead'}</Label>
            <Select id="cat-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Nobody yet</option>
              {members?.members.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name}
                  {m.jobTitle ? ` - ${m.jobTitle}` : ''}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">Chooses which team of the category gets an approved complaint.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            {category && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600"
                onClick={() => save({ archived: !category.archived })}
              >
                {category.archived ? 'Restore' : 'Archive'}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
