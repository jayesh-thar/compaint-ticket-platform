import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import {
  TITLE_WORD,
  orgKeys,
  useMembers,
  useRefreshOrg,
  useWorkspaceMe,
  useWorkspaceOrg,
  type Invitation,
  type Role,
} from '../../orgs/org-api';
import { InviteDialog } from '../components/invite-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge, Select } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../../components/states';

/** Admin page: everyone in the organization, roles, job titles, teams, invitations. */
export const MembersPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const refresh = useRefreshOrg(org.slug);
  const { data, isLoading, error, refetch } = useMembers(org.slug);
  const invitations = useQuery({
    queryKey: orgKeys.invitations(org.slug),
    queryFn: () => apiFetch<{ invitations: Invitation[] }>(`/orgs/${org.slug}/invitations`),
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [opError, setOpError] = useState<unknown>(null);

  const call = async (path: string, method: string, body?: object) => {
    setOpError(null);
    try {
      await apiFetch(`/orgs/${org.slug}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
      await refresh();
    } catch (err) {
      setOpError(err);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Members"
        description="Everyone in the organization. Team leaders manage their own team from the team page."
        actions={
          <Button className="gap-1" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        }
      />
      {opError != null && <ErrorState error={opError} />}
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Job title</th>
                  <th className="px-4 py-2">Teams</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.membershipId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-900">{m.name}</p>
                      <p className="text-xs text-slate-500">{m.email}</p>
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        defaultValue={m.jobTitle ?? ''}
                        placeholder="-"
                        aria-label={`Job title of ${m.name}`}
                        onBlur={(e) =>
                          e.target.value !== (m.jobTitle ?? '') &&
                          call(`/members/${m.membershipId}/job-title`, 'PATCH', { jobTitle: e.target.value || null })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {m.teams.length === 0 && <span className="text-xs text-slate-400">No team</span>}
                        {m.teams.map((t) => (
                          <Badge key={t.id} tone={t.teamRole === 'LEADER' ? 'blue' : 'slate'}>
                            {t.teamRole === 'LEADER' ? `${TITLE_WORD[t.leaderTitle ?? 'LEAD']} · ` : ''}
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Select
                        value={m.role}
                        onChange={(e) => call(`/members/${m.membershipId}`, 'PATCH', { role: e.target.value as Role })}
                        aria-label={`Role of ${m.name}`}
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="STAFF">Staff</option>
                      </Select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.membershipId !== me.membershipId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() =>
                            window.confirm(`Remove ${m.name} from the organization?`) &&
                            call(`/members/${m.membershipId}`, 'DELETE')
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending invitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {invitations.data?.invitations.length === 0 && <EmptyState title="No pending invitations" />}
          {invitations.data?.invitations.map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm"
            >
              <span>
                <span className="font-medium">{i.email}</span>{' '}
                <span className="text-xs text-slate-500">
                  {i.team
                    ? `${i.teamRole === 'LEADER' ? TITLE_WORD[i.leaderTitle ?? 'LEAD'] : 'Member'} of ${i.team.name}`
                    : i.role}
                  {i.jobTitle ? ` · ${i.jobTitle}` : ''}
                  {i.expired ? ' · expired' : ''}
                </span>
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => call(`/invitations/${i.id}/resend`, 'POST')}>
                  Resend
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => call(`/invitations/${i.id}`, 'DELETE')}
                >
                  Revoke
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {inviteOpen && <InviteDialog slug={org.slug} open isAdmin onClose={() => setInviteOpen(false)} />}
    </div>
  );
};
