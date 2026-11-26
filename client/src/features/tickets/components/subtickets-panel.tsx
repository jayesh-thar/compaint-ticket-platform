import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Dialog } from '../../../components/ui/dialog';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState } from '../../../components/states';
import { ClientApiError } from '../../../lib/api';
import { useMembers, useWorkspaceMe, useWorkspaceOrg } from '../../orgs/org-api';
import { assigneeOptions, useTicketAction, workflowErrorText, type TicketDetail } from '../tickets-api';
import { StatusBadge } from './ticket-badges';

export const SubticketsPanel: React.FC<{ ticket: TicketDetail }> = ({ ticket }) => {
  const org = useWorkspaceOrg();
  const [open, setOpen] = useState(false);
  const canAdd = ticket.allowedActions.canAddSubticket;
  if (ticket.subtickets.length === 0 && !canAdd) return null;

  const pct = ticket.progress.total ? Math.round((ticket.progress.done / ticket.progress.total) * 100) : 0;

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">
          Sub-tickets{' '}
          {ticket.progress.total > 0 && (
            <span className="font-normal text-slate-500">
              ({ticket.progress.done} of {ticket.progress.total} done)
            </span>
          )}
        </CardTitle>
        {canAdd && (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add sub-ticket
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {ticket.progress.total > 0 && (
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Sub-tickets done"
          >
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {ticket.subtickets.length === 0 ? (
          <p className="text-sm text-slate-500">
            Split big work into parts, each with its own assignee. The ticket can only be resolved when all parts are
            done.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ticket.subtickets.map((s) => (
              <li key={s.number} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link to={`/w/${org.slug}/tickets/${s.number}`} className="min-w-0 truncate hover:text-blue-600">
                  <span className="font-mono text-xs text-slate-400">{s.reference}</span> {s.subject}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  {s.assignee?.name ?? 'Unassigned'}
                  <StatusBadge status={s.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {canAdd && <AddSubticketDialog open={open} onClose={() => setOpen(false)} parent={ticket} />}
    </Card>
  );
};

const AddSubticketDialog: React.FC<{ open: boolean; onClose: () => void; parent: TicketDetail }> = ({
  open,
  onClose,
  parent,
}) => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const members = useMembers(org.slug).data?.members ?? [];
  const action = useTicketAction(org.slug, parent.number);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const people = assigneeOptions(me, members, parent.team?.id ?? null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add a sub-ticket to ${parent.reference}`}
      description={`Team: ${parent.team?.name ?? 'none'} · priority and due date are copied from the parent.`}
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setFieldErrors({});
          try {
            await action.mutateAsync({
              path: '/subtickets',
              body: { subject, description, assigneeId: assigneeId || null },
            });
            setSubject('');
            setDescription('');
            setAssigneeId('');
            onClose();
          } catch (err) {
            setError(workflowErrorText(err));
            if (err instanceof ClientApiError && err.fields) setFieldErrors(err.fields);
          }
        }}
      >
        {error && <ErrorState message={error} />}
        <div className="space-y-1">
          <Label htmlFor="sub-subject">Subject</Label>
          <Input id="sub-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <FieldError message={fieldErrors.subject} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sub-description">Description</Label>
          <Textarea
            id="sub-description"
            rows={4}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <FieldError message={fieldErrors.description} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sub-assignee">Assignee</Label>
          <Select id="sub-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Nobody yet</option>
            {people.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
              </option>
            ))}
          </Select>
          <FieldError message={fieldErrors.assigneeId} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={action.isPending || subject.trim().length < 3 || description.trim().length < 10}
          >
            {action.isPending ? 'Adding...' : 'Add sub-ticket'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
