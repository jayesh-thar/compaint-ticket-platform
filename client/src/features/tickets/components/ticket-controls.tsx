import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Hand, Pencil, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Dialog } from '../../../components/ui/dialog';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { Notice } from '../../../components/states';
import { ClientApiError } from '../../../lib/api';
import { useCategories, useMembers, useTeams, useWorkspaceMe, useWorkspaceOrg } from '../../orgs/org-api';
import {
  CLOSE_REASON_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  assigneeOptions,
  ticketKeys,
  useTicketAction,
  workflowErrorText,
  type CloseReason,
  type TicketDetail,
  type TicketStatus,
} from '../tickets-api';

/** Button text for each status move (from the current status). */
const moveLabel = (from: TicketStatus, to: TicketStatus) => {
  if (from === 'RESOLVED') return 'Reopen';
  if (to === 'OPEN') return 'Back to queue';
  if (to === 'IN_PROGRESS') return from === 'WAITING_ON_REQUESTER' ? 'Resume work' : 'Start work';
  if (to === 'WAITING_ON_REQUESTER') return 'Wait on requester';
  if (to === 'RESOLVED') return 'Resolve';
  return STATUS_LABEL[to];
};

export const TicketControls: React.FC<{ ticket: TicketDetail }> = ({ ticket: t }) => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const queryClient = useQueryClient();
  const action = useTicketAction(org.slug, t.number);
  const a = t.allowedActions;

  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const members = useMembers(org.slug).data?.members ?? [];
  const teams = useTeams(org.slug).data?.teams ?? [];
  const categories = useCategories(org.slug).data?.categories ?? [];

  const run = (path: string, body: unknown, ok: string, method = 'POST') => {
    setNotice(null);
    return action.mutateAsync({ path, body, method }).then(
      () => {
        setNotice({ kind: 'ok', text: ok });
        return true;
      },
      (err: unknown) => {
        setNotice({ kind: 'error', text: workflowErrorText(err) });
        // Someone else changed it meanwhile: show the current state.
        if (err instanceof ClientApiError && err.status === 409) {
          queryClient.invalidateQueries({ queryKey: ticketKeys.detail(org.slug, t.number) });
        }
        return false;
      }
    );
  };

  const statusTargets = a.statusTargets ?? [];
  const people = assigneeOptions(me, members, t.team?.id ?? null);
  const closed = t.status === 'CLOSED';
  const hasAnything =
    statusTargets.length > 0 ||
    a.canClose ||
    a.canReopen ||
    a.canTake ||
    a.canAssignOthers ||
    a.canEditTriage ||
    a.canChangeTeam ||
    a.canEditText;
  if (!hasAnything) return null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

        {(statusTargets.length > 0 || a.canClose || a.canReopen) && (
          <div className="flex flex-wrap gap-2">
            {statusTargets.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === 'RESOLVED' ? 'default' : 'outline'}
                disabled={action.isPending}
                onClick={() => run('/status', { status: to }, `Moved to ${STATUS_LABEL[to]}.`)}
              >
                {moveLabel(t.status, to)}
              </Button>
            ))}
            {a.canClose && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setCloseOpen(true)}>
                <XCircle className="h-4 w-4" /> Close...
              </Button>
            )}
            {a.canReopen && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setReopenOpen(true)}>
                <RotateCcw className="h-4 w-4" /> Reopen...
              </Button>
            )}
          </div>
        )}

        {!closed && (a.canTake || a.canAssignOthers) && (
          <div className="space-y-1">
            <Label htmlFor="ctl-assignee">Assignee</Label>
            {a.canAssignOthers ? (
              <Select
                id="ctl-assignee"
                value={t.assignee?.membershipId ?? ''}
                disabled={action.isPending}
                onChange={(e) => run('/assignment', { assigneeId: e.target.value || null }, 'Assignee updated.')}
              >
                <option value="">Unassigned</option>
                {/* Keep a current assignee visible even if they would not be offered now. */}
                {t.assignee && !people.some((p) => p.membershipId === t.assignee!.membershipId) && (
                  <option value={t.assignee.membershipId}>{t.assignee.name}</option>
                )}
                {people.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                    {m.membershipId === me.membershipId ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-slate-700">{t.assignee?.name ?? 'Unassigned'}</p>
            )}
            {a.canTake && (
              <Button
                size="sm"
                className="mt-1 gap-1"
                disabled={action.isPending}
                onClick={() => run('/assignment', { assigneeId: me.membershipId }, 'You took this ticket.')}
              >
                <Hand className="h-4 w-4" /> Take it
              </Button>
            )}
          </div>
        )}

        {!closed && a.canChangeTeam && (
          <div className="space-y-1">
            <Label htmlFor="ctl-team">Team</Label>
            <Select
              id="ctl-team"
              value={t.team?.id ?? ''}
              disabled={action.isPending}
              onChange={(e) => run('', { teamId: e.target.value || null }, 'Team changed.', 'PATCH')}
            >
              <option value="">No team</option>
              {t.team?.archived && <option value={t.team.id}>{t.team.name} (archived)</option>}
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {!closed && a.canEditTriage && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ctl-priority">Priority</Label>
              <Select
                id="ctl-priority"
                value={t.priority}
                disabled={action.isPending}
                onChange={(e) => run('', { priority: e.target.value }, 'Priority changed.', 'PATCH')}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctl-due">Due date</Label>
              <Input
                id="ctl-due"
                type="date"
                value={t.dueDate ?? ''}
                disabled={action.isPending}
                onChange={(e) => run('', { dueDate: e.target.value || null }, 'Due date changed.', 'PATCH')}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="ctl-category">Category</Label>
              <Select
                id="ctl-category"
                value={t.category?.id ?? ''}
                disabled={action.isPending}
                onChange={(e) => run('', { categoryId: e.target.value || null }, 'Category changed.', 'PATCH')}
              >
                <option value="">No category</option>
                {t.category?.archived && <option value={t.category.id}>{t.category.name} (archived)</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {!closed && a.canEditText && (
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit subject / description
          </Button>
        )}
      </CardContent>

      <CloseDialog
        open={closeOpen}
        reasons={a.closeReasons ?? []}
        isPortal={t.source === 'PORTAL'}
        busy={action.isPending}
        onClose={() => setCloseOpen(false)}
        onSubmit={async (closeReason, note) => {
          if (await run('/status', { status: 'CLOSED', closeReason, note: note || undefined }, 'Ticket closed.'))
            setCloseOpen(false);
        }}
      />
      <ReasonDialog
        open={reopenOpen}
        title="Reopen this ticket"
        description="It goes back to Open. The reason is recorded in the activity log."
        busy={action.isPending}
        onClose={() => setReopenOpen(false)}
        onSubmit={async (note) => {
          if (await run('/status', { status: 'OPEN', note }, 'Ticket reopened.')) setReopenOpen(false);
        }}
      />
      <EditTextDialog
        open={editOpen}
        ticket={t}
        busy={action.isPending}
        onClose={() => setEditOpen(false)}
        onSubmit={async (subject, description) => {
          if (await run('', { subject, description }, 'Ticket updated.', 'PATCH')) setEditOpen(false);
        }}
      />
    </Card>
  );
};

const CloseDialog: React.FC<{
  open: boolean;
  reasons: CloseReason[];
  isPortal: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: CloseReason, note: string) => void;
}> = ({ open, reasons, isPortal, busy, onClose, onSubmit }) => {
  const [reason, setReason] = useState<CloseReason>('COMPLETED');
  const [note, setNote] = useState('');
  const effective = reasons.includes(reason) ? reason : (reasons[0] ?? 'COMPLETED');
  const noteMissing = effective === 'REJECTED' && !note.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close ticket"
      description={
        isPortal
          ? 'The requester is emailed and can see the reason and your note.'
          : 'Closing is final; Admins and Managers can reopen it.'
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(effective, note.trim());
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="close-reason">Reason</Label>
          <Select id="close-reason" value={effective} onChange={(e) => setReason(e.target.value as CloseReason)}>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {CLOSE_REASON_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="close-note">Note {effective === 'REJECTED' ? '(required)' : '(optional)'}</Label>
          <Textarea
            id="close-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={effective === 'REJECTED' ? 'Spam, invalid, out of scope, duplicate of T-...' : ''}
          />
          {noteMissing && <FieldError message="A note is required when rejecting." />}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || noteMissing}>
            Close ticket
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const ReasonDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}> = ({ open, title, description, busy, onClose, onSubmit }) => {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(note.trim());
        }}
      >
        <Label htmlFor="reason-note">Reason (required)</Label>
        <Textarea id="reason-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !note.trim()}>
            Reopen
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const EditTextDialog: React.FC<{
  open: boolean;
  ticket: TicketDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: (subject: string, description: string) => void;
}> = ({ open, ticket, busy, onClose, onSubmit }) => {
  const [subject, setSubject] = useState(ticket.subject);
  const [description, setDescription] = useState(ticket.description);
  return (
    <Dialog open={open} onClose={onClose} title={`Edit ${ticket.reference}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(subject, description);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="edit-subject">Subject</Label>
          <Input id="edit-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-description">Description</Label>
          <Textarea
            id="edit-description"
            rows={8}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || subject.trim().length < 3 || description.trim().length < 10}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
