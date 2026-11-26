import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, Notice, Spinner, errorMessage } from '../../../components/states';
import { apiFetch } from '../../../lib/api';
import { orgKeys, useWorkspaceOrg } from '../../orgs/org-api';
import {
  CLOSE_REASON_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  ticketKeys,
  useTicketActivity,
  useTicketComments,
  type ActivityEntry,
  type CloseReason,
  type TicketComment,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
} from '../tickets-api';

const statusText = (v: string | null) => {
  if (!v) return '-';
  const [s, reason] = v.split(':');
  const label = STATUS_LABEL[s as TicketStatus] ?? s;
  return reason ? `${label} (${CLOSE_REASON_LABEL[reason as CloseReason] ?? reason})` : label;
};

/** One activity row in plain words: "Sam changed status from Open to In progress". */
export const describeActivity = (a: ActivityEntry): string => {
  switch (a.type) {
    case 'CREATED':
      return `created ${a.toValue ?? 'the ticket'}`;
    case 'STATUS_CHANGED':
      return `changed status from ${statusText(a.fromValue)} to ${statusText(a.toValue)}`;
    case 'ASSIGNED':
      return a.fromValue ? `reassigned from ${a.fromValue} to ${a.toValue}` : `assigned it to ${a.toValue}`;
    case 'UNASSIGNED':
      return `unassigned ${a.fromValue ?? 'the assignee'}`;
    case 'TEAM_CHANGED':
      return `moved it from ${a.fromValue ?? 'no team'} to ${a.toValue ?? 'no team'}`;
    case 'PRIORITY_CHANGED':
      return `changed priority from ${PRIORITY_LABEL[a.fromValue as TicketPriority] ?? a.fromValue} to ${PRIORITY_LABEL[a.toValue as TicketPriority] ?? a.toValue}`;
    case 'DUE_DATE_CHANGED':
      return `changed the due date from ${a.fromValue ?? 'none'} to ${a.toValue ?? 'none'}`;
    case 'CATEGORY_CHANGED':
      return `changed the category from ${a.fromValue ?? 'none'} to ${a.toValue ?? 'none'}`;
    case 'EDITED':
      return a.fromValue === 'subject' ? `renamed it to "${a.toValue}"` : 'edited the description';
    case 'SUBTICKET_ADDED':
      return `added sub-ticket ${a.toValue}`;
    default:
      return a.type.toLowerCase().replace(/_/g, ' ');
  }
};

const ActivityRow: React.FC<{ entry: ActivityEntry }> = ({ entry }) => (
  <li className="flex gap-3 py-2 text-sm">
    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
    <div className="min-w-0">
      <p className="text-slate-600">
        <strong className="font-medium text-slate-800">{entry.actorName}</strong> {describeActivity(entry)}
      </p>
      {entry.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-500">“{entry.note}”</p>}
      <time className="text-xs text-slate-400" dateTime={entry.createdAt}>
        {new Date(entry.createdAt).toLocaleString()}
      </time>
    </div>
  </li>
);

const CommentRow: React.FC<{ comment: TicketComment }> = ({ comment }) => {
  const isPublic = comment.visibility === 'PUBLIC';
  return (
    <li className="py-2">
      <div
        className={`rounded-lg border p-3 ${isPublic ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <strong className="text-sm text-slate-900">{comment.authorName}</strong>
          {comment.authorType === 'REQUESTER' ? (
            <Badge tone="green">Requester</Badge>
          ) : isPublic ? (
            <Badge tone="green">
              <Globe className="h-3 w-3" /> Public reply
            </Badge>
          ) : (
            <Badge tone="amber">
              <Lock className="h-3 w-3" /> Internal note
            </Badge>
          )}
          <time className="text-slate-400" dateTime={comment.createdAt}>
            {new Date(comment.createdAt).toLocaleString()}
          </time>
        </div>
        {/* Plain text: rendered as text, never as HTML. */}
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{comment.body}</p>
      </div>
    </li>
  );
};

type Item =
  { kind: 'comment'; at: string; comment: TicketComment } | { kind: 'activity'; at: string; entry: ActivityEntry };

/** Comments and activity in one list, oldest first, with the composer at the bottom. */
export const TicketTimeline: React.FC<{ ticket: TicketDetail }> = ({ ticket }) => {
  const org = useWorkspaceOrg();
  const activity = useTicketActivity(org.slug, ticket.number);
  const comments = useTicketComments(org.slug, ticket.number);

  const items: Item[] = [
    ...(comments.data?.comments ?? []).map((c): Item => ({ kind: 'comment', at: c.createdAt, comment: c })),
    ...(activity.data?.activity ?? []).map((a): Item => ({ kind: 'activity', at: a.createdAt, entry: a })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Conversation and activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activity.isLoading || comments.isLoading ? (
          <Spinner className="py-4" />
        ) : activity.isError || comments.isError ? (
          <ErrorState
            error={activity.error ?? comments.error}
            onRetry={() => {
              activity.refetch();
              comments.refetch();
            }}
          />
        ) : (
          <ul className="divide-y divide-slate-50">
            {items.map((i) =>
              i.kind === 'comment' ? (
                <CommentRow key={`c-${i.comment.id}`} comment={i.comment} />
              ) : (
                <ActivityRow key={`a-${i.entry.id}`} entry={i.entry} />
              )
            )}
          </ul>
        )}
        {ticket.allowedActions.canComment && <Composer ticket={ticket} />}
      </CardContent>
    </Card>
  );
};

const Composer: React.FC<{ ticket: TicketDetail }> = ({ ticket }) => {
  const org = useWorkspaceOrg();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  // Defaults to INTERNAL: forgetting to choose never exposes a note to the requester.
  const [visibility, setVisibility] = useState<'INTERNAL' | 'PUBLIC'>('INTERNAL');
  const [error, setError] = useState<string | null>(null);
  const canPublic = ticket.allowedActions.canPublicReply;

  const send = useMutation({
    mutationFn: () =>
      apiFetch(`/orgs/${org.slug}/tickets/${ticket.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, visibility }),
      }),
    onSuccess: async () => {
      setBody('');
      setVisibility('INTERNAL');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...ticketKeys.detail(org.slug, ticket.number), 'comments'] }),
        queryClient.invalidateQueries({ queryKey: orgKeys.tickets(org.slug), refetchType: 'none' }),
      ]);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const isPublic = visibility === 'PUBLIC';
  return (
    <form
      className="space-y-2 border-t border-slate-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        send.mutate();
      }}
    >
      {canPublic && (
        <div role="radiogroup" aria-label="Who can see this comment" className="flex gap-2">
          <Button
            type="button"
            role="radio"
            aria-checked={!isPublic}
            size="sm"
            variant={!isPublic ? 'default' : 'outline'}
            className={!isPublic ? 'bg-amber-600 hover:bg-amber-700' : ''}
            onClick={() => setVisibility('INTERNAL')}
          >
            <Lock className="mr-1 h-3.5 w-3.5" /> Internal note
          </Button>
          <Button
            type="button"
            role="radio"
            aria-checked={isPublic}
            size="sm"
            variant={isPublic ? 'default' : 'outline'}
            className={isPublic ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            onClick={() => setVisibility('PUBLIC')}
          >
            <Globe className="mr-1 h-3.5 w-3.5" /> Public reply
          </Button>
        </div>
      )}
      <Textarea
        aria-label={isPublic ? 'Public reply' : 'Internal note'}
        rows={3}
        maxLength={10000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={isPublic ? 'border-emerald-400 ring-1 ring-emerald-200' : ''}
        placeholder={
          isPublic
            ? 'The requester will see this and get an email.'
            : 'Only members who can see this ticket will see this note.'
        }
      />
      {isPublic && (
        <p className="text-xs font-medium text-emerald-700">Visible to the requester and emailed to them.</p>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" disabled={send.isPending || !body.trim()}>
          {send.isPending ? 'Sending...' : isPublic ? 'Send public reply' : 'Add internal note'}
        </Button>
      </div>
    </form>
  );
};
