import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Undo2 } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Textarea } from '../../../components/ui/form-controls';
import { ErrorState, FullPageSpinner, Notice, errorMessage } from '../../../components/states';
import { PortalShell } from '../../portal/pages/portal-page';
import { REQUESTER_STATUS, myComplaintKeys, useMyComplaint, type MyComplaint } from '../../portal/portal-api';
import { CLOSE_REASON_LABEL } from '../../tickets/tickets-api';
import { RequesterStatusBadge } from './my-complaints-page';

export const MyComplaintDetailPage: React.FC = () => {
  const { orgSlug = '', number: raw = '' } = useParams();
  const number = Number(raw);
  const query = useMyComplaint(orgSlug, number);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      apiFetch<{ complaint: MyComplaint }>(`/me/tickets/${orgSlug}/${number}${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: ({ complaint }) => {
      queryClient.setQueryData(myComplaintKeys.detail(orgSlug, number), { complaint });
      queryClient.invalidateQueries({ queryKey: ['me', 'complaints'], exact: false, refetchType: 'none' });
    },
  });

  const run = async (path: string, ok: string, body?: unknown) => {
    setNotice(null);
    try {
      await act.mutateAsync({ path, body });
      setNotice({ kind: 'ok', text: ok });
      return true;
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
      if (err instanceof ClientApiError && err.status === 409) query.refetch();
      return false;
    }
  };

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ClientApiError && query.error.status === 404;
    return (
      <PortalShell title="My complaints">
        {notFound ? (
          <Card>
            <CardHeader>
              <CardTitle>Complaint not found</CardTitle>
              <p className="text-sm text-slate-500">It does not exist, or it was submitted from another account.</p>
            </CardHeader>
          </Card>
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </PortalShell>
    );
  }

  const c = query.data.complaint;
  const a = c.allowedActions;

  return (
    <PortalShell title={c.organization.name}>
      <Link to="/my/complaints" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> My complaints
      </Link>

      <div className="space-y-2">
        <p className="font-mono text-sm text-slate-500">
          {c.reference} · {c.organization.name}
          {c.category ? ` · ${c.category}` : ''}
        </p>
        <h1 className="text-2xl font-bold text-slate-900">{c.subject}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <RequesterStatusBadge status={c.status} />
          <span className="text-sm text-slate-500">{REQUESTER_STATUS[c.status].hint}</span>
        </div>
      </div>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {(a.canConfirm || a.canWithdraw) && (
        <Card className="border-blue-200 bg-blue-50/50 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            {a.canConfirm ? (
              <>
                <p className="text-sm text-slate-700">Is the problem fixed?</p>
                <Button
                  className="gap-1"
                  disabled={act.isPending}
                  onClick={() => run('/confirm', 'Thank you! The complaint is now closed.')}
                >
                  <CheckCircle2 className="h-4 w-4" /> Yes, it's resolved
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-700">Nobody has started on it yet. Changed your mind?</p>
                <Button
                  variant="outline"
                  className="gap-1"
                  disabled={act.isPending}
                  onClick={() =>
                    window.confirm('Withdraw this complaint? It will be closed.') &&
                    run('/withdraw', 'Your complaint was withdrawn.')
                  }
                >
                  <Undo2 className="h-4 w-4" /> Withdraw complaint
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            <li className="ml-auto max-w-[90%] rounded-lg bg-blue-50 p-3 sm:max-w-[80%]">
              <p className="mb-1 text-xs text-slate-500">You · {new Date(c.createdAt).toLocaleString()}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.description}</p>
            </li>
            {c.comments.map((m) => (
              <li
                key={m.id}
                className={`max-w-[90%] rounded-lg p-3 sm:max-w-[80%] ${m.fromYou ? 'ml-auto bg-blue-50' : 'bg-slate-100'}`}
              >
                <p className="mb-1 text-xs text-slate-500">
                  {m.author} · {new Date(m.createdAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{m.body}</p>
              </li>
            ))}
          </ul>

          {a.canReply ? (
            <form
              className="mt-4 space-y-2 border-t border-slate-100 pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run('/comments', 'Reply sent.', { body: reply })) setReply('');
              }}
            >
              <Textarea
                aria-label="Your reply"
                rows={3}
                maxLength={10000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply..."
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={act.isPending || !reply.trim()}>
                  {act.isPending ? 'Sending...' : 'Send reply'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-4 space-y-2 rounded-md bg-slate-50 p-4 text-sm text-slate-600">
              <p>
                This complaint was closed{c.closeReason ? ` (${CLOSE_REASON_LABEL[c.closeReason].toLowerCase()})` : ''}
                {c.closedAt ? ` on ${new Date(c.closedAt).toLocaleDateString()}` : ''}. Replies are no longer possible.
              </p>
              {c.closeNote && (
                <p className="whitespace-pre-wrap">
                  Note from {c.organization.name}: {c.closeNote}
                </p>
              )}
              <Link to={`/o/${c.organization.slug}/submit`}>
                <Button variant="outline" size="sm">
                  Submit a new complaint
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  );
};
