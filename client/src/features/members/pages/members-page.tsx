import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/card';
import { UserPlus, Trash2, RefreshCw, ShieldCheck, Mail, Clock, AlertCircle } from 'lucide-react';
import { orgKeys, ROLES, useWorkspaceOrg, type Member, type Role } from '../../orgs/org-api';

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  expired: boolean;
}

const errorText = (err: unknown, fallback: string) => (err instanceof ClientApiError ? err.message : fallback);

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  STAFF: 'bg-slate-100 text-slate-600',
};

const RoleBadge: React.FC<{ role: Role }> = ({ role }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[role]}`}
  >
    {role === 'ADMIN' && <ShieldCheck className="h-3 w-3" />}
    {role}
  </span>
);

const selectClass =
  'rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export const MembersPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = org.myRole === 'ADMIN';

  const membersQuery = useQuery({
    queryKey: orgKeys.members(org.slug),
    queryFn: () => apiFetch<{ members: Member[] }>(`/orgs/${org.slug}/members`),
  });
  const invitationsQuery = useQuery({
    queryKey: orgKeys.invitations(org.slug),
    queryFn: () => apiFetch<{ invitations: Invitation[] }>(`/orgs/${org.slug}/invitations`),
    enabled: isAdmin,
  });

  const members = membersQuery.data?.members ?? [];
  const pendingInvites = invitationsQuery.data?.invitations ?? [];

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('STAFF');
  const [inviteMsg, setInviteMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [inviteRowMsg, setInviteRowMsg] = useState<Record<string, string>>({});

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orgKeys.members(org.slug) }),
      queryClient.invalidateQueries({ queryKey: orgKeys.invitations(org.slug) }),
    ]);

  const changeRole = useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: Role }) =>
      apiFetch(`/orgs/${org.slug}/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  });
  const removeMember = useMutation({
    mutationFn: (membershipId: string) => apiFetch(`/orgs/${org.slug}/members/${membershipId}`, { method: 'DELETE' }),
  });
  const sendInvite = useMutation({
    mutationFn: () =>
      apiFetch(`/orgs/${org.slug}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: () => {
      setInviteMsg({ kind: 'ok', text: `Invitation sent to ${inviteEmail.trim()}.` });
      setInviteEmail('');
      setInviteRole('STAFF');
      refresh();
    },
    onError: (err) => setInviteMsg({ kind: 'error', text: errorText(err, 'Failed to send invitation.') }),
  });
  const resendInvite = useMutation({
    mutationFn: (invId: string) => apiFetch(`/orgs/${org.slug}/invitations/${invId}/resend`, { method: 'POST' }),
    onSuccess: (_d, invId) => {
      setInviteRowMsg((p) => ({ ...p, [invId]: 'New link sent.' }));
      refresh();
    },
    onError: (err, invId) => setInviteRowMsg((p) => ({ ...p, [invId]: errorText(err, 'Could not resend.') })),
  });
  const revokeInvite = useMutation({
    mutationFn: (invId: string) => apiFetch(`/orgs/${org.slug}/invitations/${invId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err, invId) => setInviteRowMsg((p) => ({ ...p, [invId]: errorText(err, 'Could not revoke.') })),
  });

  const handleChangeRole = async (m: Member, role: Role) => {
    setRowErrors((p) => ({ ...p, [m.membershipId]: '' }));
    try {
      await changeRole.mutateAsync({ membershipId: m.membershipId, role });
      await refresh();
      // Demoting yourself changes what this workspace shows you.
      if (m.userId === user?.id) await queryClient.invalidateQueries({ queryKey: orgKeys.org(org.slug) });
    } catch (err) {
      setRowErrors((p) => ({ ...p, [m.membershipId]: errorText(err, 'Could not change role.') }));
    }
  };

  const handleRemove = async (m: Member) => {
    const isMe = m.userId === user?.id;
    const question = isMe
      ? `Leave ${org.name}? You will lose access immediately.`
      : `Remove ${m.name} from ${org.name}? Their history is kept.`;
    if (!window.confirm(question)) return;
    setRowErrors((p) => ({ ...p, [m.membershipId]: '' }));
    try {
      await removeMember.mutateAsync(m.membershipId);
      if (isMe) {
        await queryClient.invalidateQueries({ queryKey: orgKeys.myOrgs });
        navigate('/');
        return;
      }
      await refresh();
    } catch (err) {
      setRowErrors((p) => ({ ...p, [m.membershipId]: errorText(err, 'Could not remove member.') }));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Members</h1>
        <p className="text-sm text-slate-500 mt-1">
          People with access to <strong>{org.name}</strong>.
        </p>
      </div>

      {isAdmin && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600" /> Invite a member
            </CardTitle>
            <CardDescription>
              They get an email link (valid 7 days) and must accept it while logged in with that same email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col sm:flex-row gap-3 sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setInviteMsg(null);
                sendInvite.mutate();
              }}
            >
              <div className="flex-1 space-y-1">
                <Label htmlFor="inv-email">Email</Label>
                <Input
                  id="inv-email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-role">Role</Label>
                <select
                  id="inv-role"
                  className={`${selectClass} h-9 w-full sm:w-auto`}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={sendInvite.isPending || !inviteEmail.trim()} className="gap-2">
                <Mail className="h-4 w-4" />
                {sendInvite.isPending ? 'Sending...' : 'Send invite'}
              </Button>
            </form>
            {inviteMsg && (
              <p
                role="status"
                className={`mt-2 text-sm ${inviteMsg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {inviteMsg.text}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Active members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {membersQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            </div>
          ) : membersQuery.isError ? (
            <div role="alert" className="flex items-center justify-between gap-2 px-6 py-4 text-sm text-red-700">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Could not load members.
              </span>
              <Button variant="outline" size="sm" onClick={() => membersQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => {
                const isMe = m.userId === user?.id;
                return (
                  <li key={m.membershipId} className="px-4 sm:px-6 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {m.name} {isMe && <span className="text-xs font-normal text-slate-400">(you)</span>}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{m.email}</p>
                        {m.teams.length > 0 && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Teams: {m.teams.map((t) => `${t.name}${t.isLead ? ' (Lead)' : ''}`).join(', ')}
                          </p>
                        )}
                      </div>

                      {isAdmin ? (
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`Role of ${m.name}`}
                            className={`${selectClass} h-8 text-xs`}
                            value={m.role}
                            onChange={(e) => handleChangeRole(m, e.target.value as Role)}
                            disabled={changeRole.isPending}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={isMe ? 'Leave organization' : `Remove ${m.name}`}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                            onClick={() => handleRemove(m)}
                            disabled={removeMember.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </div>
                    {rowErrors[m.membershipId] && (
                      <p role="alert" className="mt-1 text-xs text-red-600">
                        {rowErrors[m.membershipId]}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" /> Pending invitations ({pendingInvites.length})
            </CardTitle>
            <CardDescription>Resend gives a fresh 7-day link and disables the old one.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {invitationsQuery.isError ? (
              <p role="alert" className="px-6 py-4 text-sm text-red-700">
                Could not load invitations.
              </p>
            ) : pendingInvites.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-500">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pendingInvites.map((inv) => (
                  <li key={inv.id} className="px-4 sm:px-6 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{inv.email}</p>
                        <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                          <RoleBadge role={inv.role} />
                          {inv.expired ? (
                            <span className="text-red-600 font-medium">Expired - resend to renew</span>
                          ) : (
                            <span>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => resendInvite.mutate(inv.id)}
                          disabled={resendInvite.isPending}
                        >
                          <RefreshCw className="h-3 w-3" /> Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 text-xs gap-1"
                          onClick={() => revokeInvite.mutate(inv.id)}
                          disabled={revokeInvite.isPending}
                        >
                          <Trash2 className="h-3 w-3" /> Revoke
                        </Button>
                      </div>
                    </div>
                    {inviteRowMsg[inv.id] && <p className="mt-1 text-xs text-slate-600">{inviteRowMsg[inv.id]}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
