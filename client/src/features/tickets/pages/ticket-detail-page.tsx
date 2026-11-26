import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CornerDownRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/form-controls';
import { ErrorState, Spinner } from '../../../components/states';
import { ClientApiError } from '../../../lib/api';
import { useWorkspaceOrg } from '../../orgs/org-api';
import { useTicket, type TicketDetail } from '../tickets-api';
import { PriorityBadge, StatusBadge } from '../components/ticket-badges';
import { TicketControls } from '../components/ticket-controls';
import { SubticketsPanel } from '../components/subtickets-panel';
import { TicketTimeline } from '../components/ticket-timeline';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-1.5 text-sm">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-right font-medium text-slate-800">{children}</dd>
  </div>
);

export const TicketDetailPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const number = Number(useParams().number);
  const query = useTicket(org.slug, number);

  if (query.isLoading) return <Spinner />;
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ClientApiError && query.error.status === 404;
    return (
      <div className="space-y-3">
        <BackLink slug={org.slug} />
        {notFound ? (
          <Card>
            <CardHeader>
              <CardTitle>Ticket not found</CardTitle>
              <p className="text-sm text-slate-500">It does not exist, or you do not have access to it.</p>
            </CardHeader>
          </Card>
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </div>
    );
  }

  const t: TicketDetail = query.data.ticket;

  return (
    <div className="space-y-4">
      <BackLink slug={org.slug} />

      <div className="space-y-2">
        {t.parent && (
          <Link
            to={`/w/${org.slug}/tickets/${t.parent.number}`}
            className="flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-blue-600"
          >
            <CornerDownRight className="h-3 w-3" /> Sub-ticket of {t.parent.reference}: {t.parent.subject}
          </Link>
        )}
        <h1 className="text-2xl font-bold text-slate-900">
          <span className="mr-2 font-mono text-lg text-slate-400">{t.reference}</span>
          {t.subject}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={t.status} closeReason={t.closeReason} />
          <PriorityBadge priority={t.priority} />
          {t.source === 'PORTAL' && <Badge tone="green">Portal complaint</Badge>}
          {t.overdue && (
            <Badge tone="red">
              <AlertTriangle className="h-3 w-3" /> Overdue
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              {/* Plain text only: rendered as text, never as HTML. */}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{t.description}</p>
              {t.status === 'CLOSED' && t.closeNote && (
                <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                  <strong>Close note:</strong> {t.closeNote}
                </p>
              )}
            </CardContent>
          </Card>

          {!t.parent && <SubticketsPanel ticket={t} />}
          <TicketTimeline ticket={t} />
        </div>

        <div className="space-y-4">
          <TicketControls ticket={t} />
          <Card className="shadow-sm">
            <CardContent className="pt-4">
              <dl className="divide-y divide-slate-100">
                <Row label="Team">{t.team ? `${t.team.name}${t.team.archived ? ' (archived)' : ''}` : 'No team'}</Row>
                <Row label="Assignee">{t.assignee?.name ?? 'Unassigned'}</Row>
                <Row label="Category">{t.category?.name ?? '-'}</Row>
                <Row label="Due date">{t.dueDate ?? '-'}</Row>
                {t.requester && (
                  <Row label="Requester">
                    {t.requester.name}
                    <br />
                    <span className="text-xs font-normal text-slate-500">{t.requester.email}</span>
                  </Row>
                )}
                <Row label="Created by">{t.createdBy?.name ?? (t.source === 'PORTAL' ? 'Portal' : '-')}</Row>
                <Row label="Created">{new Date(t.createdAt).toLocaleString()}</Row>
                {t.resolvedAt && <Row label="Resolved">{new Date(t.resolvedAt).toLocaleString()}</Row>}
                {t.closedAt && <Row label="Closed">{new Date(t.closedAt).toLocaleString()}</Row>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

const BackLink: React.FC<{ slug: string }> = ({ slug }) => (
  <Link to={`/w/${slug}/tickets`} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
    <ArrowLeft className="h-4 w-4" /> Back to tickets
  </Link>
);
