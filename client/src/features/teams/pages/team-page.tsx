import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, UserPlus } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import {
  LEADER_TITLES,
  TITLE_WORD,
  isAdminMe,
  isLeaderMe,
  useCategories,
  useMembers,
  useRefreshOrg,
  useTeam,
  useWorkspaceMe,
  useWorkspaceOrg,
  type LeaderTitle,
} from '../../orgs/org-api';
import { useTicketList } from '../../tickets/tickets-api';
import { TicketGrid } from '../../tickets/components/ticket-card';
import { InviteDialog } from '../../members/components/invite-dialog';
import { CategoryPicker } from '../components/category-picker';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, Spinner } from '../../../components/states';

const TABS = ['members', 'tickets', 'groups', 'history'] as const;
type Tab = (typeof TABS)[number];

export const TeamPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const { teamId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'members') as Tab;
  const { data, isLoading, error, refetch } = useTeam(org.slug, teamId);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { team, permissions } = data;

  return (
    <div className="space-y-5">
      <Link
        to={`/w/${org.slug}/teams`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Teams
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{team.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {team.categories.length > 0
              ? `Categories: ${team.categories.map((c) => `${c.name} (${c.teamCount} teams)`).join(', ')}`
              : 'No category'}{' '}
            · {team.leader ? `${TITLE_WORD[team.leader.title ?? 'LEAD']}: ${team.leader.name}` : 'No leader yet'}
          </p>
        </div>
        {(isAdminMe(me) || isLeaderMe(me)) && (
          <Link to={`/w/${org.slug}/tickets/new?teamId=${team.id}`}>
            <Button className="gap-1" variant="outline">
              <Plus className="h-4 w-4" /> New task for this team
            </Button>
          </Link>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setParams({ tab: t })}
            className={`border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              t === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-blue-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'members' && <MembersTab data={data} />}
      {tab === 'tickets' && <TeamTickets teamId={team.id} view="live" empty="No live tickets in this team" />}
      {tab === 'groups' && <GroupsTab teamId={team.id} />}
      {tab === 'history' && <TeamTickets teamId={team.id} view="history" empty="No finished tickets yet" />}
      {permissions.canEditTeam && tab === 'members' && (
        <TeamSettings teamId={team.id} categoryIds={team.categories.map((c) => c.id)} archived={team.archived} />
      )}
    </div>
  );
};

const MembersTab: React.FC<{ data: NonNullable<ReturnType<typeof useTeam>['data']> }> = ({ data }) => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const refresh = useRefreshOrg(org.slug);
  const { team, permissions } = data;
  const { data: all } = useMembers(org.slug);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [opError, setOpError] = useState<unknown>(null);
  const notInTeam = (all?.members ?? []).filter((m) => !team.members.some((t) => t.membershipId === m.membershipId));

  const call = async (path: string, method: string, body?: object) => {
    setOpError(null);
    try {
      await apiFetch(`/orgs/${org.slug}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
      await refresh();
    } catch (err) {
      setOpError(err);
    }
  };
  const setRole = (membershipId: string, teamRole: 'LEADER' | 'MEMBER', leaderTitle?: LeaderTitle) =>
    call(`/teams/${team.id}/members/${membershipId}`, 'PUT', { teamRole, leaderTitle });

  return (
    <div className="space-y-4">
      {opError != null && <ErrorState error={opError} />}
      {permissions.canManageMembers && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="gap-1" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invite to this team
          </Button>
          <Select
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            aria-label="Add an existing member"
            className="sm:w-64"
          >
            <option value="">Add an existing member...</option>
            {notInTeam.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
                {m.jobTitle ? ` - ${m.jobTitle}` : ''}
              </option>
            ))}
          </Select>
          <Button variant="outline" disabled={!addId} onClick={() => setRole(addId, 'MEMBER').then(() => setAddId(''))}>
            Add
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Job title</th>
                <th className="px-4 py-2">Team role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.membershipId} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    <p className="font-medium text-slate-900">{m.name}</p>
                    {m.email && <p className="text-xs text-slate-500">{m.email}</p>}
                  </td>
                  <td className="px-4 py-2">
                    {permissions.canManageMembers ? (
                      <Input
                        defaultValue={m.jobTitle ?? ''}
                        placeholder="-"
                        aria-label={`Job title of ${m.name}`}
                        onBlur={(e) =>
                          e.target.value !== (m.jobTitle ?? '') &&
                          call(`/members/${m.membershipId}/job-title`, 'PATCH', { jobTitle: e.target.value || null })
                        }
                      />
                    ) : (
                      (m.jobTitle ?? '-')
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {permissions.canSetLeader ? (
                      <Select
                        value={m.teamRole === 'LEADER' ? (m.leaderTitle ?? 'LEAD') : 'MEMBER'}
                        onChange={(e) =>
                          e.target.value === 'MEMBER'
                            ? setRole(m.membershipId, 'MEMBER')
                            : setRole(m.membershipId, 'LEADER', e.target.value as LeaderTitle)
                        }
                        aria-label={`Team role of ${m.name}`}
                      >
                        <option value="MEMBER">Member</option>
                        {LEADER_TITLES.map((t) => (
                          <option key={t} value={t}>
                            Leader: {TITLE_WORD[t]}
                          </option>
                        ))}
                      </Select>
                    ) : m.teamRole === 'LEADER' ? (
                      <Badge tone="blue">{TITLE_WORD[m.leaderTitle ?? 'LEAD']}</Badge>
                    ) : (
                      'Member'
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone="green">Active</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {permissions.canManageMembers &&
                      (m.teamRole !== 'LEADER' || permissions.canSetLeader) &&
                      m.membershipId !== me.membershipId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() =>
                            window.confirm(`Remove ${m.name} from ${team.name}?`) &&
                            call(`/teams/${team.id}/members/${m.membershipId}`, 'DELETE')
                          }
                        >
                          Remove
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
              {team.pendingInvitations.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 bg-amber-50/40 last:border-0">
                  <td className="px-4 py-2 text-slate-700">{i.email}</td>
                  <td className="px-4 py-2 text-slate-500">{i.jobTitle ?? '-'}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {i.teamRole === 'LEADER' ? TITLE_WORD[i.leaderTitle ?? 'LEAD'] : 'Member'}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone="amber">{i.expired ? 'Invite expired' : 'Invited'}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => call(`/invitations/${i.id}/resend`, 'POST')}>
                      Resend
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      onClick={() => call(`/invitations/${i.id}`, 'DELETE')}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {team.members.length === 0 && team.pendingInvitations.length === 0 && <EmptyState title="No members yet" />}
        </CardContent>
      </Card>
      {inviteOpen && (
        <InviteDialog
          slug={org.slug}
          open
          isAdmin={isAdminMe(me)}
          fixedTeamId={isAdminMe(me) ? undefined : team.id}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
};

const TeamTickets: React.FC<{ teamId: string; view: string; empty: string }> = ({ teamId, view, empty }) => {
  const org = useWorkspaceOrg();
  const { data, isLoading, error } = useTicketList(org.slug, { view, teamId, pageSize: 60 });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  return (
    <TicketGrid
      slug={org.slug}
      tickets={data?.tickets ?? []}
      empty={empty}
      hint="You see the tickets you are allowed to see."
    />
  );
};

/** Live groups = live tickets of this team that were given to a group (D-26). */
const GroupsTab: React.FC<{ teamId: string }> = ({ teamId }) => {
  const org = useWorkspaceOrg();
  const { data, isLoading } = useTicketList(org.slug, { view: 'live', teamId, pageSize: 100 });
  if (isLoading) return <Spinner />;
  const groups = (data?.tickets ?? []).filter((t) => t.groupName);
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No live groups"
        hint="Assign a ticket to several members to form a group. It is dissolved when the ticket is approved."
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((t) => (
        <Card key={t.number}>
          <CardHeader>
            <CardTitle className="text-base">{t.groupName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-slate-600">{t.assignees.map((a) => a.name).join(', ')}</p>
            <Link className="text-blue-600 hover:underline" to={`/w/${org.slug}/tickets/${t.number}`}>
              {t.reference} {t.subject}
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const TeamSettings: React.FC<{ teamId: string; categoryIds: string[]; archived: boolean }> = ({
  teamId,
  categoryIds,
  archived,
}) => {
  const org = useWorkspaceOrg();
  const refresh = useRefreshOrg(org.slug);
  const { data: cats } = useCategories(org.slug);
  const [err, setErr] = useState<unknown>(null);
  const patch = async (body: object) => {
    setErr(null);
    try {
      await apiFetch(`/orgs/${org.slug}/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team settings (Admin)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {err != null && <ErrorState error={err} />}
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">Categories of this team (tick one or more)</p>
          <CategoryPicker
            categories={cats?.categories ?? []}
            value={categoryIds}
            onChange={(ids) => patch({ categoryIds: ids })}
          />
        </div>
        <Button variant="outline" onClick={() => patch({ archived: !archived })}>
          {archived ? 'Restore team' : 'Archive team'}
        </Button>
      </CardContent>
    </Card>
  );
};
