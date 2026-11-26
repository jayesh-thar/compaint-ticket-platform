import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessageSquarePlus, ShieldCheck, Tag } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { ErrorState, FullPageSpinner } from '../../../components/states';
import { ClientApiError } from '../../../lib/api';
import { useAuth } from '../../auth/auth-context';
import { usePortal } from '../portal-api';

export const PortalShell: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <span className="truncate font-semibold text-slate-900">{title ?? 'Complaint portal'}</span>
          {user ? (
            <Link to="/my/complaints" className="shrink-0 text-sm font-medium text-blue-600 hover:underline">
              My complaints
            </Link>
          ) : (
            <Link to="/login" className="shrink-0 text-sm font-medium text-blue-600 hover:underline">
              Log in
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">{children}</main>
    </div>
  );
};

/** Shown for unknown slugs and switched-off portals alike (no existence leak). */
export const PortalUnavailable: React.FC = () => (
  <PortalShell>
    <Card>
      <CardHeader>
        <CardTitle>This complaint portal is not available</CardTitle>
        <CardDescription>Check the link you were given, or contact the organization directly.</CardDescription>
      </CardHeader>
    </Card>
  </PortalShell>
);

export const PortalPage: React.FC = () => {
  const { slug = '' } = useParams();
  const query = usePortal(slug);

  if (query.isLoading) return <FullPageSpinner />;
  if (query.error instanceof ClientApiError && query.error.status === 404) return <PortalUnavailable />;
  if (query.isError || !query.data) {
    return (
      <PortalShell>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </PortalShell>
    );
  }

  const p = query.data.portal;
  return (
    <PortalShell title={p.name}>
      <div className="space-y-2 pt-2">
        <h1 className="text-3xl font-extrabold text-slate-900">{p.name}</h1>
        <p className="whitespace-pre-wrap text-slate-600">
          {p.intro ??
            'Tell us what went wrong. We will route your complaint to the right team and keep you updated by email.'}
        </p>
      </div>

      {p.acceptingComplaints ? (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">What you can report</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {p.categories.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                  >
                    <Tag className="h-3.5 w-3.5" /> {c.name}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Link to={`/o/${p.slug}/submit`} className="block">
            <Button size="lg" className="w-full gap-2 sm:w-auto">
              <MessageSquarePlus className="h-5 w-5" /> Submit a complaint
            </Button>
          </Link>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Not accepting complaints right now</CardTitle>
            <CardDescription>
              {p.name} is not accepting new complaints at the moment. You can still follow your existing complaints
              under{' '}
              <Link to="/my/complaints" className="text-blue-600 hover:underline">
                My complaints
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Privacy: you need a verified account to submit. Only {p.name}&apos;s staff can read your complaint; you will see
        their replies here and by email. Other people never see your complaint.
      </p>
    </PortalShell>
  );
};
