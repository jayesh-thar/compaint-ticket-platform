import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { useCategories, useTeam, useTeams, type Category } from '../../orgs/org-api';
import { PRIORITIES, ticketKey, type ActionName, type TicketDetail } from '../tickets-api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Dialog } from '../../../components/ui/dialog';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, Spinner } from '../../../components/states';

const LABEL: Record<ActionName, string> = {
  approve: 'Approve',
  route: 'Send to a team',
  assign: 'Assign',
  unassign: 'Take back',
  accept: 'Accept',
  decline: 'Decline',
  submit: 'Submit for review',
  team_approve: 'Approve work',
  team_send_back: 'Send back',
  final_approve: 'Final approval',
  admin_send_back: 'Send back to team',
  reroute: 'Move to another team',
  reject: 'Reject',
};
const PRIMARY: ActionName[] = ['approve', 'route', 'assign', 'accept', 'submit', 'team_approve', 'final_approve'];
const NEEDS_NOTE: ActionName[] = ['decline', 'team_send_back', 'admin_send_back', 'reject'];
/** These run with one click; the rest open a dialog. */
const ONE_CLICK: ActionName[] = ['accept'];

const HINT: Partial<Record<ActionName, string>> = {
  approve: 'Approve the complaint and send it to a category (its Category Lead picks the team) or straight to a team.',
  route: 'Choose which team of this category handles it.',
  assign: 'Choose one member, or several to form a temporary group.',
  unassign: 'The ticket goes back to the team queue.',
  decline: 'Tell your leader why you cannot take it.',
  submit: 'The team leader reviews your work next.',
  team_approve: 'The work goes to the Admin for final approval.',
  final_approve: 'The ticket is done and moves to history. Any group is dissolved.',
  team_send_back: 'The assignees continue working; tell them what is missing.',
  admin_send_back: 'The team continues working; tell them what is missing.',
  reroute: 'Assignees are cleared and the new team leader assigns again.',
  reject: 'The ticket closes as rejected. A customer sees this reason.',
};

export const TicketActions: React.FC<{ slug: string; data: TicketDetail }> = ({ slug, data }) => {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ActionName | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { ticket, allowed } = data;

  const run = async (action: ActionName, body: object = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<TicketDetail>(`/orgs/${slug}/tickets/${ticket.number}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      qc.setQueryData(ticketKey(slug, ticket.number), res);
      await qc.invalidateQueries({ queryKey: ['org', slug] });
      setOpen(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (allowed.actions.length === 0) {
    return <p className="text-sm text-slate-500">Nothing for you to do on this ticket right now.</p>;
  }

  return (
    <div className="space-y-3">
      {error != null && !open && <ErrorState error={error} />}
      <div className="flex flex-wrap gap-2">
        {allowed.actions.map((a) => (
          <Button
            key={a}
            variant={PRIMARY.includes(a) ? 'default' : a === 'reject' ? 'destructive' : 'outline'}
            size="sm"
            disabled={busy}
            onClick={() => (ONE_CLICK.includes(a) ? run(a) : (setError(null), setOpen(a)))}
          >
            {a === 'reject' && ticket.kind === 'TASK' && !allowed.myKinds.includes('ADMIN') ? 'Cancel task' : LABEL[a]}
          </Button>
        ))}
      </div>
      {open && (
        <Dialog open title={LABEL[open]} description={HINT[open]} onClose={() => setOpen(null)}>
          <ActionForm slug={slug} data={data} action={open} busy={busy} error={error} onSubmit={(b) => run(open, b)} />
        </Dialog>
      )}
    </div>
  );
};

const ActionForm: React.FC<{
  slug: string;
  data: TicketDetail;
  action: ActionName;
  busy: boolean;
  error: unknown;
  onSubmit: (body: object) => void;
}> = ({ slug, data, action, busy, error, onSubmit }) => {
  const { ticket } = data;
  const [note, setNote] = useState('');
  const [teamId, setTeamId] = useState('');
  const [categoryId, setCategoryId] = useState(action === 'approve' ? (ticket.category?.id ?? '') : '');
  const [priority, setPriority] = useState(ticket.priority);
  const [dueDate, setDueDate] = useState(ticket.dueDate ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const fields = error instanceof ClientApiError ? (error.fields ?? {}) : {};

  const { data: teams } = useTeams(slug);
  const { data: cats } = useCategories(slug);
  const { data: team, isLoading: teamLoading } = useTeam(slug, ticket.team?.id ?? '', action === 'assign');
  const category: Category | undefined = cats?.categories.find((c) => c.id === (categoryId || ticket.category?.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = { note: note.trim() || undefined };
    if (action === 'approve') {
      onSubmit({
        ...base,
        priority,
        dueDate: dueDate || null,
        ...(teamId ? { teamId } : { categoryId: categoryId || null }),
      });
    } else if (action === 'route' || action === 'reroute') onSubmit({ ...base, teamId });
    else if (action === 'assign') {
      onSubmit({
        ...base,
        membershipIds: picked,
        groupName: picked.length > 1 ? groupName : undefined,
        priority,
        dueDate: dueDate || null,
      });
    } else onSubmit(base);
  };

  const teamOptions =
    action === 'route'
      ? (category?.teams ?? [])
      : (teams?.teams ?? []).filter((t) => action !== 'reroute' || t.id !== ticket.team?.id);

  return (
    <form onSubmit={submit} className="space-y-4">
      {error != null && <ErrorState error={error} />}

      {action === 'approve' && (
        <>
          <div className="space-y-1">
            <Label htmlFor="cat">Category (its Lead chooses the team)</Label>
            <Select
              id="cat"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setTeamId('');
              }}
            >
              <option value="">- none -</option>
              {cats?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.lead ? `(Lead: ${c.lead.name})` : '(no Lead)'}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="team">Or straight to a team</Label>
            <Select id="team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">- via the category -</option>
              {teams?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.categories.length > 0 ? ` (${t.categories.map((c) => c.name).join(', ')})` : ''}
                </option>
              ))}
            </Select>
            <FieldError message={fields.teamId} />
          </div>
        </>
      )}

      {(action === 'route' || action === 'reroute') && (
        <div className="space-y-1">
          <Label htmlFor="team">Team</Label>
          <Select id="team" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
            <option value="">Choose a team</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <FieldError message={fields.teamId} />
        </div>
      )}

      {action === 'assign' && (
        <div className="space-y-2">
          <Label>Members of {ticket.team?.name}</Label>
          {teamLoading && <Spinner className="py-2" />}
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {team?.team.members.map((m) => (
              <label
                key={m.membershipId}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={picked.includes(m.membershipId)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked ? [...picked, m.membershipId] : picked.filter((x) => x !== m.membershipId)
                    )
                  }
                />
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-slate-500">
                  {m.teamRole === 'LEADER' ? 'Leader' : (m.jobTitle ?? 'Member')}
                </span>
              </label>
            ))}
          </div>
          {picked.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor="group">Group name ({picked.length} people)</Label>
              <Input
                id="group"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                placeholder="e.g. Server fixers"
              />
              <p className="text-xs text-slate-500">
                The group lives until the ticket is approved, then it is dissolved.
              </p>
              <FieldError message={fields.groupName} />
            </div>
          )}
        </div>
      )}

      {(action === 'approve' || action === 'assign') && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="prio">Priority</Label>
            <Select id="prio" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="due">Deadline</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="note">{NEEDS_NOTE.includes(action) ? 'Reason (required)' : 'Note (optional)'}</Label>
        <Textarea
          id="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required={NEEDS_NOTE.includes(action)}
        />
        <FieldError message={fields.note} />
      </div>
      <Button type="submit" disabled={busy || (action === 'assign' && picked.length === 0)} className="w-full">
        {busy ? 'Saving...' : LABEL[action]}
      </Button>
    </form>
  );
};
