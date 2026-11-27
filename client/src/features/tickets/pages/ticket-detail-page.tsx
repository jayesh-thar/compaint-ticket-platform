import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, Phone, Trash2, User } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { useWorkspaceOrg } from '../../orgs/org-api';
import {
  PRIORITIES,
  ticketKey,
  useActivity,
  useComments,
  useTicket,
  type Priority,
  type TicketDetail,
} from '../tickets-api';
import { KindBadge, PriorityBadge, ProgressBar, StageBadge } from '../components/ticket-badges';
import { TicketActions } from '../components/ticket-actions';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, Spinner, errorMessage } from '../../../components/states';

const ACTION_WORDS: Record<string, string> = {
  CREATED: 'created the ticket',
  APPROVED: 'approved it',
  ROUTED_TO_TEAM: 'sent it to a team',
  ASSIGNED: 'assigned it',
  UNASSIGNED: 'took it back',
  ACCEPTED: 'accepted it',
  DECLINED: 'declined it',
  SUBMITTED: 'submitted the work',
  TEAM_APPROVED: 'approved the work',
  SENT_BACK: 'sent it back',
  DONE: 'gave final approval',
  REJECTED: 'rejected it',
  REROUTED: 'moved it to another team',
  PRIORITY_CHANGED: 'changed the priority',
  DEADLINE_CHANGED: 'changed the deadline',
  PROGRESS: 'updated progress',
  CHECKLIST: 'updated the tasks',
  EDITED: 'edited the text',
};

export const TicketDetailPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const n = Number(useParams().number);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useTicket(org.slug, n);
  const [opError, setOpError] = useState<unknown>(null);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { ticket: t, allowed } = data;

  /** Any small change: send it, put the fresh ticket in the cache, refresh lists. */
  const call = async (path: string, method: string, body?: object) => {
    setOpError(null);
    try {
      const res = await apiFetch<TicketDetail>(`/orgs/${org.slug}/tickets/${n}${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      qc.setQueryData(ticketKey(org.slug, n), res);
      await qc.invalidateQueries({ queryKey: ['org', org.slug] });
    } catch (err) {
      setOpError(err);
    }
  };

  return (
    <div className="space-y-5">
      <Link
        to={`/w/${org.slug}/tickets`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Tickets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-400">{t.reference}</p>
          <h1 className="text-2xl font-bold text-slate-900">{t.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageBadge stage={t.stage} />
            <KindBadge kind={t.kind} />
            <PriorityBadge priority={t.priority} />
            <span className="text-xs text-slate-500">{t.stageLabel}</span>
          </div>
        </div>
      </div>

      {opError != null && <ErrorState message={errorMessage(opError)} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What to do now</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketActions slug={org.slug} data={data} />
              {t.closeNote && (
                <p className="mt-3 rounded-md bg-slate-50 p-2 text-sm text-slate-700">Reason: {t.closeNote}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{t.description}</p>
            </CardContent>
          </Card>

          <Checklist data={data} onCall={call} />
          <Timeline slug={org.slug} n={n} />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Category">{t.category?.name ?? 'Other'}</Row>
              <Row label="Team">
                {t.team ? (
                  <Link className="text-blue-600 hover:underline" to={`/w/${org.slug}/teams/${t.team.id}`}>
                    {t.team.name}
                  </Link>
                ) : (
                  'Not chosen yet'
                )}
              </Row>
              <Row label="Raised by">{t.createdBy?.name ?? (t.kind === 'COMPLAINT' ? 'Customer' : '-')}</Row>
              <Row label="Priority">
                {allowed.canEditPriorityDeadline ? (
                  <Select
                    value={t.priority}
                    onChange={(e) => call('', 'PATCH', { priority: e.target.value as Priority })}
                    aria-label="Priority"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                ) : (
                  t.priority
                )}
              </Row>
              <Row label="Deadline">
                {allowed.canEditPriorityDeadline ? (
                  <Input
                    type="date"
                    value={t.dueDate ?? ''}
                    onChange={(e) => call('', 'PATCH', { dueDate: e.target.value || null })}
                    aria-label="Deadline"
                  />
                ) : (
                  <span className={t.overdue ? 'font-semibold text-red-600' : ''}>
                    {t.dueDate ?? 'None'}
                    {t.overdue ? ' (overdue)' : ''}
                  </span>
                )}
              </Row>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">Progress {t.progress}%</p>
                {allowed.canUpdateProgress ? (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    defaultValue={t.progress}
                    className="w-full"
                    aria-label="Progress"
                    onMouseUp={(e) =>
                      call('/progress', 'PUT', { progress: Number((e.target as HTMLInputElement).value) })
                    }
                    onKeyUp={(e) =>
                      call('/progress', 'PUT', { progress: Number((e.target as HTMLInputElement).value) })
                    }
                    onTouchEnd={(e) =>
                      call('/progress', 'PUT', { progress: Number((e.target as HTMLInputElement).value) })
                    }
                  />
                ) : (
                  <ProgressBar value={t.progress} />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.groupName ? `Group "${t.groupName}"` : 'Assigned to'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {t.allAssignees.length === 0 && <p className="text-slate-500">Nobody yet.</p>}
              {t.allAssignees.map((a) => (
                <div
                  key={a.membershipId}
                  className={`flex items-center justify-between gap-2 ${a.active ? '' : 'opacity-50'}`}
                >
                  <span>
                    <span className="font-medium">{a.name}</span>
                    {a.jobTitle && <span className="block text-xs text-slate-500">{a.jobTitle}</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {!a.active ? 'past' : a.acceptedAt ? 'accepted' : 'not accepted yet'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {t.customer && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p className="flex items-center gap-2">
                  <User className="h-4 w-4 text-slate-400" /> {t.customer.name}
                </p>
                <p className="flex items-center gap-2 break-all">
                  <Mail className="h-4 w-4 shrink-0 text-slate-400" /> {t.customer.email}
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-400" /> {t.customer.phoneCode} {t.customer.phone}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-0.5">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <div className="text-slate-800">{children}</div>
  </div>
);

const Checklist: React.FC<{ data: TicketDetail; onCall: (p: string, m: string, b?: object) => Promise<void> }> = ({
  data,
  onCall,
}) => {
  const { ticket: t, allowed } = data;
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  if (t.checklistItems.length === 0 && !allowed.canEditChecklist) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Tasks{' '}
          {t.checklist.total > 0 && (
            <span className="text-sm font-normal text-slate-500">
              ({t.checklist.done}/{t.checklist.total} done)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {t.checklistItems.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border border-slate-100 p-2 text-sm">
            <input
              type="checkbox"
              checked={c.done}
              disabled={!allowed.canTickChecklist}
              onChange={(e) => onCall(`/checklist/${c.id}`, 'PATCH', { done: e.target.checked })}
              aria-label={`Done: ${c.title}`}
            />
            <span className={`flex-1 ${c.done ? 'text-slate-400 line-through' : ''}`}>{c.title}</span>
            <PriorityBadge priority={c.priority} />
            {c.dueDate && <span className="text-xs text-slate-500">{c.dueDate}</span>}
            {allowed.canEditChecklist && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove task"
                onClick={() => onCall(`/checklist/${c.id}`, 'DELETE')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {allowed.canEditChecklist && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              await onCall('/checklist', 'POST', { title, priority, dueDate: dueDate || null });
              setTitle('');
              setDueDate('');
            }}
          >
            <Input
              placeholder="Add a task"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              aria-label="New task"
            />
            <Select
              className="sm:w-32"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              aria-label="Priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <Input
              className="sm:w-40"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Deadline"
            />
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
};

/** Who did what (activity) and the internal conversation, in one timeline. */
const Timeline: React.FC<{ slug: string; n: number }> = ({ slug, n }) => {
  const qc = useQueryClient();
  const { data: act } = useActivity(slug, n);
  const { data: com } = useComments(slug, n);
  const [body, setBody] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const items = [
    ...(act?.activity ?? []).map((a) => ({ id: a.id, at: a.createdAt, kind: 'act' as const, a })),
    ...(com?.comments ?? []).map((c) => ({ id: c.id, at: c.createdAt, kind: 'com' as const, c })),
  ].sort((x, y) => x.at.localeCompare(y.at));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">History and comments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-2">
          {items.map((i) =>
            i.kind === 'act' ? (
              <li key={i.id} className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">{i.a.actorName}</span>{' '}
                {ACTION_WORDS[i.a.action] ?? i.a.action}
                {i.a.toValue && i.a.action !== 'CREATED' && <span className="text-slate-500"> ({i.a.toValue})</span>}
                {i.a.note && <span className="block text-xs italic text-slate-500">"{i.a.note}"</span>}
                <span className="block text-[11px] text-slate-400">{new Date(i.at).toLocaleString()}</span>
              </li>
            ) : (
              <li key={i.id} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
                <span className="font-medium">{i.c.authorName}</span>
                <p className="whitespace-pre-wrap text-slate-700">{i.c.body}</p>
                <span className="text-[11px] text-slate-400">{new Date(i.at).toLocaleString()}</span>
              </li>
            )
          )}
        </ol>
        {err != null && <ErrorState error={err} />}
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await apiFetch(`/orgs/${slug}/tickets/${n}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
              setBody('');
              await qc.invalidateQueries({ queryKey: ticketKey(slug, n) });
            } catch (error) {
              setErr(error);
            }
          }}
        >
          <Textarea
            rows={2}
            placeholder="Internal comment (staff only)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            aria-label="Comment"
          />
          <Button type="submit" size="sm" variant="outline">
            Add comment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
