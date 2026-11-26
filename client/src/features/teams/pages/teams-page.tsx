import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Crown, Plus, Trash2, UserPlus } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge, FieldError, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, Notice, PageHeader, Spinner, errorMessage } from '../../../components/states';
import { useMembers, useTeams, useWorkspaceOrg, type Team } from '../../orgs/org-api';

export const TeamsPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const isAdmin = org.myRole === 'ADMIN';
  const queryClient = useQueryClient();
  const teamsQuery = useTeams(org.slug, isAdmin);
  const membersQuery = useMembers(org.slug);

  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | undefined>();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['org', org.slug, 'teams'] }),
      queryClient.invalidateQueries({ queryKey: ['org', org.slug, 'members'] }),
      queryClient.invalidateQueries({ queryKey: ['org', org.slug, 'categories'] }),
    ]);

  const create = useMutation({
    mutationFn: () => apiFetch(`/orgs/${org.slug}/teams`, { method: 'POST', body: JSON.stringify({ name: newName }) }),
    onSuccess: async () => {
      setNewName('');
      setNotice({ kind: 'ok', text: 'Team created.' });
      await refresh();
    },
    onError: (err) =>
      setCreateError(err instanceof ClientApiError ? (err.fields?.name ?? err.message) : 'Could not create the team.'),
  });

  /** One mutation for every per-team change; the caller passes path, method and body. */
  const change = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      apiFetch(`/orgs/${org.slug}/teams/${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: refresh,
    onError: (err) => setNotice({ kind: 'error', text: errorMessage(err) }),
  });

  const teams = teamsQuery.data?.teams ?? [];
  const members = membersQuery.data?.members ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Teams" description="Tickets are routed to teams. A team Lead manages that team's tickets." />

      {isAdmin && (
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setCreateError(undefined);
                setNotice(null);
                create.mutate();
              }}
            >
              <div className="flex-1 space-y-1">
                <Label htmlFor="team-name">New team name</Label>
                <Input
                  id="team-name"
                  placeholder="e.g. IT, Hostel, Accounts"
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <FieldError message={createError} />
              </div>
              <Button type="submit" className="gap-2" disabled={create.isPending || newName.trim().length < 2}>
                <Plus className="h-4 w-4" /> {create.isPending ? 'Creating...' : 'Create team'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {teamsQuery.isLoading ? (
        <Spinner />
      ) : teamsQuery.isError ? (
        <ErrorState error={teamsQuery.error} onRetry={() => teamsQuery.refetch()} />
      ) : teams.length === 0 ? (
        <Card>
          <EmptyState
            title="No teams yet"
            hint={
              isAdmin
                ? 'Create your first team above, e.g. "IT" or "Hostel".'
                : 'An Admin has not created any teams yet.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              isAdmin={isAdmin}
              allMembers={members}
              busy={change.isPending}
              onChange={(path, method, body) => {
                setNotice(null);
                change.mutate({ path, method, body });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TeamCard: React.FC<{
  team: Team;
  isAdmin: boolean;
  allMembers: { membershipId: string; name: string; role: string }[];
  busy: boolean;
  onChange: (path: string, method: string, body?: unknown) => void;
}> = ({ team, isAdmin, allMembers, busy, onChange }) => {
  const [toAdd, setToAdd] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const inTeam = new Set(team.members.map((m) => m.membershipId));
  const candidates = allMembers.filter((m) => !inTeam.has(m.membershipId));

  const archiveToggle = () => {
    const question = team.archived
      ? `Unarchive ${team.name}?`
      : `Archive ${team.name}? It has ${team.openTicketCount} open ticket(s). They keep the team and stay workable, but the team can no longer be chosen for new tickets.`;
    if (window.confirm(question)) onChange(team.id, 'PATCH', { archived: !team.archived });
  };

  return (
    <Card className={`shadow-sm ${team.archived ? 'opacity-70' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {renaming ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onChange(team.id, 'PATCH', { name });
                  setRenaming(false);
                }}
              >
                <Input aria-label="Team name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <Button type="submit" size="sm" disabled={name.trim().length < 2}>
                  Save
                </Button>
              </form>
            ) : (
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {team.name}
                {team.archived && <Badge tone="amber">Archived</Badge>}
              </CardTitle>
            )}
            <CardDescription>
              {team.members.length} member(s) · {team.openTicketCount} open ticket(s)
            </CardDescription>
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-1">
              {!team.archived && !renaming && (
                <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
                  Rename
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={archiveToggle}
                disabled={busy}
                aria-label={team.archived ? `Unarchive ${team.name}` : `Archive ${team.name}`}
              >
                {team.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {team.members.length === 0 ? (
          <p className="text-sm text-slate-500">No members yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {team.members.map((m) => (
              <li key={m.membershipId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {m.name}{' '}
                    {m.isLead && (
                      <Badge tone="purple">
                        <Crown className="h-3 w-3" /> Lead
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">{m.role}</p>
                </div>
                {isAdmin && !team.archived && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy}
                      onClick={() => onChange(`${team.id}/members/${m.membershipId}`, 'PUT', { isLead: !m.isLead })}
                    >
                      {m.isLead ? 'Remove Lead' : 'Make Lead'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove ${m.name} from ${team.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${m.name} from ${team.name}? Their open tickets in this team become unassigned.`
                          )
                        ) {
                          onChange(`${team.id}/members/${m.membershipId}`, 'DELETE');
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && !team.archived && candidates.length > 0 && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!toAdd) return;
              onChange(`${team.id}/members/${toAdd}`, 'PUT', { isLead: false });
              setToAdd('');
            }}
          >
            <Select
              aria-label={`Add a member to ${team.name}`}
              value={toAdd}
              onChange={(e) => setToAdd(e.target.value)}
            >
              <option value="">Add a member...</option>
              {candidates.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name} ({m.role})
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="outline" className="h-9 gap-1" disabled={!toAdd || busy}>
              <UserPlus className="h-4 w-4" /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
};
