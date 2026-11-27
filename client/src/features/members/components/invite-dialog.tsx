import React, { useId, useMemo, useState } from 'react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import {
  LEADER_TITLES,
  TITLE_WORD,
  isAdminMe,
  useJobTitles,
  useRefreshOrg,
  useTeams,
  useWorkspaceMe,
  type LeaderTitle,
  type Team,
} from '../../orgs/org-api';
import { Dialog } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { FieldError, Select } from '../../../components/ui/form-controls';
import { ErrorState, Notice } from '../../../components/states';

/** One "Role" choice: Head / Lead / Manager lead the team, Staff is a team member. */
type RoleChoice = LeaderTitle | 'STAFF';

/**
 * Invite form: Team first, then Role.
 * - Admin: any team (or no team = Staff without a team). Head / Lead / Manager only
 *   while the team has no leader; the current leader is shown at the top as "assigned".
 * - Team leader: Staff for a team they lead, or Head / Lead / Manager for a team
 *   that has no leader yet. The server checks the same rules.
 */
export const InviteDialog: React.FC<{
  slug: string;
  open: boolean;
  onClose: () => void;
  /** Team to preselect (the team page passes its own team). */
  defaultTeamId?: string;
}> = ({ slug, open, onClose, defaultTeamId }) => {
  const listId = useId();
  const me = useWorkspaceMe();
  const admin = isAdminMe(me);
  const refresh = useRefreshOrg(slug);
  const { data: titles } = useJobTitles(slug);
  const { data: teamData, isLoading: teamsLoading } = useTeams(slug);

  const leadsTeam = (id: string) => me.leadTeamIds.includes(id);
  const leaderSlotFree = (t: Team) => !t.leader && !t.leaderInvited;

  // Admin sees every team; a leader sees their own teams + teams still without a leader.
  const teams = useMemo(
    () => (teamData?.teams ?? []).filter((t) => admin || leadsTeam(t.id) || leaderSlotFree(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamData, admin, me.leadTeamIds]
  );

  /** Choices for one team, in dropdown order. */
  const choicesFor = (teamId: string): RoleChoice[] => {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return admin ? ['STAFF'] : [];
    const out: RoleChoice[] = leaderSlotFree(team) ? [...LEADER_TITLES] : [];
    if (admin || leadsTeam(team.id)) out.push('STAFF');
    return out;
  };

  const initialTeam = defaultTeamId ?? (admin ? '' : (me.leadTeamIds[0] ?? ''));
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [teamId, setTeamId] = useState(initialTeam);
  const [choice, setChoice] = useState<RoleChoice>('STAFF');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = error instanceof ClientApiError ? (error.fields ?? {}) : {};

  const selectedTeam = teams.find((t) => t.id === teamId);
  const choices = choicesFor(teamId);
  // Keep the role valid when the team list loads or the team changes.
  const role: RoleChoice | '' = choices.includes(choice)
    ? choice
    : choices.includes('STAFF')
      ? 'STAFF'
      : (choices[0] ?? '');

  const changeTeam = (id: string) => {
    setTeamId(id);
    const next = choicesFor(id);
    // Staff is the safe default; a team with no Staff option starts at Head.
    setChoice(next.includes('STAFF') ? 'STAFF' : (next[0] ?? 'STAFF'));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const leader = role !== 'STAFF';
    try {
      await apiFetch(`/orgs/${slug}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          role: 'STAFF',
          jobTitle: jobTitle.trim() || undefined,
          teamId: teamId || null,
          teamRole: teamId ? (leader ? 'LEADER' : 'MEMBER') : undefined,
          leaderTitle: teamId && leader ? role : undefined,
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

  const noTeamsForLeader = !admin && !teamsLoading && teams.length === 0;

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
          <Label htmlFor="inv-team">Team{admin ? ' (optional)' : ''}</Label>
          <Select id="inv-team" value={teamId} onChange={(e) => changeTeam(e.target.value)} disabled={teamsLoading}>
            {teamsLoading && <option value={teamId}>Loading teams...</option>}
            {!teamsLoading && admin && <option value="">No team yet</option>}
            {!teamsLoading && !admin && !teamId && <option value="">Choose a team</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.leader ? ` - ${TITLE_WORD[t.leader.title ?? 'LEAD']}: ${t.leader.name}` : ' (no leader yet)'}
              </option>
            ))}
          </Select>
          <FieldError message={fields.teamId} />
          {admin && !teamsLoading && teams.length === 0 && (
            <p className="text-xs text-slate-500">No teams yet. Create one on the Teams page first.</p>
          )}
          {noTeamsForLeader && <p className="text-xs text-slate-500">You have no team to invite into.</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="inv-role">Role</Label>
          <Select
            id="inv-role"
            value={role}
            onChange={(e) => setChoice(e.target.value as RoleChoice)}
            disabled={choices.length === 0}
          >
            {/* The leader slot already taken: shown first, not selectable. */}
            {selectedTeam?.leader && (
              <option disabled value="__assigned">
                {TITLE_WORD[selectedTeam.leader.title ?? 'LEAD']}: {selectedTeam.leader.name} (assigned)
              </option>
            )}
            {selectedTeam && !selectedTeam.leader && selectedTeam.leaderInvited && (
              <option disabled value="__invited">
                {TITLE_WORD[selectedTeam.leaderInvited.title ?? 'LEAD']}: invitation pending
              </option>
            )}
            {choices.map((c) => (
              <option key={c} value={c}>
                {c === 'STAFF' ? 'Staff' : TITLE_WORD[c]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            {!teamId
              ? 'Without a team they join as Staff. Add them to a team later.'
              : role === 'STAFF'
                ? 'Staff work on the tickets of this team.'
                : 'Head, Lead and Manager have the same powers; only the title differs. One per team.'}
          </p>
          <FieldError message={fields.teamRole ?? fields.leaderTitle} />
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

        <Button type="submit" disabled={busy || !role || (!admin && !teamId)} className="w-full">
          {busy ? 'Sending...' : 'Send invitation'}
        </Button>
      </form>
    </Dialog>
  );
};
