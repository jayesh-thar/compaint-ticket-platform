import React, { useId, useState } from 'react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import {
  LEADER_TITLES,
  TITLE_WORD,
  useJobTitles,
  useRefreshOrg,
  useTeams,
  type LeaderTitle,
  type Role,
} from '../../orgs/org-api';
import { Dialog } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { FieldError, Select } from '../../../components/ui/form-controls';
import { ErrorState, Notice } from '../../../components/states';

/**
 * README 0.8. Admin: any role, any team, Leader or Member.
 * Team leader (fixedTeamId): a Member of their own team only.
 * The job title input suggests titles already used (type a new one or pick one).
 */
export const InviteDialog: React.FC<{
  slug: string;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  fixedTeamId?: string;
}> = ({ slug, open, onClose, isAdmin, fixedTeamId }) => {
  const listId = useId();
  const refresh = useRefreshOrg(slug);
  const { data: titles } = useJobTitles(slug);
  const { data: teams } = useTeams(slug);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [jobTitle, setJobTitle] = useState('');
  const [teamId, setTeamId] = useState(fixedTeamId ?? '');
  const [teamRole, setTeamRole] = useState<'MEMBER' | 'LEADER'>('MEMBER');
  const [leaderTitle, setLeaderTitle] = useState<LeaderTitle>('HEAD');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = error instanceof ClientApiError ? (error.fields ?? {}) : {};
  const selectedTeam = teams?.teams.find((t) => t.id === teamId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiFetch(`/orgs/${slug}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          role: isAdmin ? role : 'STAFF',
          jobTitle: jobTitle.trim() || undefined,
          teamId: teamId || null,
          teamRole: teamId ? (isAdmin ? teamRole : 'MEMBER') : undefined,
          leaderTitle: teamId && teamRole === 'LEADER' ? leaderTitle : undefined,
        }),
      });
      setDone(`Invitation sent to ${email}. While email is not set up, copy the link from the server console.`);
      setEmail('');
      setJobTitle('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Invite someone"
      description="They get a one-time link valid for 7 days."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {error != null && <ErrorState error={error} />}
        {done && <Notice kind="ok">{done}</Notice>}
        <div className="space-y-1">
          <Label htmlFor="inv-email">Email</Label>
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <FieldError message={fields.email} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-title">Job title (type or pick)</Label>
          <Input
            id="inv-title"
            list={listId}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Network layer security engineer"
          />
          <datalist id={listId}>
            {titles?.jobTitles.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        {isAdmin && (
          <div className="space-y-1">
            <Label htmlFor="inv-role">Organization role</Label>
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </div>
        )}
        {!fixedTeamId && (
          <div className="space-y-1">
            <Label htmlFor="inv-team">Team (optional)</Label>
            <Select id="inv-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No team yet</option>
              {teams?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.leader ? '' : ' (no leader yet)'}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">Create the team first if it is not in the list.</p>
          </div>
        )}
        {teamId && isAdmin && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="inv-trole">Role in the team</Label>
              <Select
                id="inv-trole"
                value={teamRole}
                onChange={(e) => setTeamRole(e.target.value as 'MEMBER' | 'LEADER')}
              >
                <option value="MEMBER">Member</option>
                <option value="LEADER" disabled={!!selectedTeam?.leader}>
                  Leader{selectedTeam?.leader ? ' (taken)' : ''}
                </option>
              </Select>
              <FieldError message={fields.teamRole} />
            </div>
            {teamRole === 'LEADER' && (
              <div className="space-y-1">
                <Label htmlFor="inv-ltitle">Leader title</Label>
                <Select
                  id="inv-ltitle"
                  value={leaderTitle}
                  onChange={(e) => setLeaderTitle(e.target.value as LeaderTitle)}
                >
                  {LEADER_TITLES.map((t) => (
                    <option key={t} value={t}>
                      {TITLE_WORD[t]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Sending...' : 'Send invitation'}
        </Button>
      </form>
    </Dialog>
  );
};
