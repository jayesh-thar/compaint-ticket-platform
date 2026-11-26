import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/form-controls';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../../components/states';
import { PortalShell } from '../../portal/pages/portal-page';
import { REQUESTER_STATUS, useMyComplaints } from '../../portal/portal-api';
import type { TicketStatus } from '../../tickets/tickets-api';

const TONE: Record<TicketStatus, 'blue' | 'purple' | 'amber' | 'green' | 'slate'> = {
  OPEN: 'blue',
  IN_PROGRESS: 'purple',
  WAITING_ON_REQUESTER: 'amber',
  RESOLVED: 'green',
  CLOSED: 'slate',
};

export const RequesterStatusBadge: React.FC<{ status: TicketStatus }> = ({ status }) => (
  <Badge tone={TONE[status]}>{REQUESTER_STATUS[status].label}</Badge>
);

export const MyComplaintsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useMyComplaints(page);
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <PortalShell title="My complaints">
      <Link to="/" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Home
      </Link>
      <PageHeader title="My complaints" description="Complaints you submitted to any organization." />
      <Card className="overflow-hidden shadow-sm">
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : !data || data.complaints.length === 0 ? (
          <EmptyState
            title="You have not submitted any complaints"
            hint="Use the complaint link of your college, shop or company (it looks like /o/name)."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.complaints.map((c) => (
              <li key={`${c.organization.slug}-${c.number}`}>
                <Link
                  to={`/my/complaints/${c.organization.slug}/${c.number}`}
                  className="block px-4 py-3 hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{c.reference}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{c.subject}</span>
                    <RequesterStatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {c.organization.name}
                    {c.category ? ` · ${c.category}` : ''} · updated {new Date(c.updatedAt).toLocaleDateString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && pages > 1 && (
        <div className="flex justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setParams({ page: String(page - 1) })}
          >
            Previous
          </Button>
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setParams({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </PortalShell>
  );
};
