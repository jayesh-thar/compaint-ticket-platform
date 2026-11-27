import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { ErrorState, Spinner } from '../../../components/states';

interface Tracked {
  reference: string;
  organization: string;
  subject: string;
  category: string;
  stage: string;
  status: string;
  detail: string | null;
  step: number;
  rejectionReason: string | null;
  submittedAt: string;
  updatedAt: string;
}

const STEPS = ['Received', 'Being worked on', 'Final checks', 'Finished'];

/** `/track#token=...`: the customer's private status page (no login, D-22). */
export const TrackPage: React.FC = () => {
  // The token stays in the # part: browsers never send it to a server in the URL,
  // and the customer can bookmark the page.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const { data, isLoading, error } = useQuery({
    queryKey: ['track', token],
    queryFn: () =>
      apiFetch<{ complaint: Tracked }>('/public/track', { method: 'POST', body: JSON.stringify({ token }) }),
    enabled: !!token,
    retry: false,
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-4">
        {!token && (
          <ErrorState message="This tracking link is incomplete. Open the full link from your confirmation email." />
        )}
        {isLoading && <Spinner />}
        {error && <ErrorState message="This tracking link is not valid." />}
        {data && (
          <Card>
            <CardHeader>
              <CardDescription>
                {data.complaint.organization} · {data.complaint.reference} · {data.complaint.category}
              </CardDescription>
              <CardTitle>{data.complaint.subject}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-lg font-semibold text-slate-900">{data.complaint.status}</p>
              <ol className="flex items-center gap-2">
                {STEPS.map((s, i) => {
                  const reached = data.complaint.step > i;
                  return (
                    <li key={s} className="flex flex-1 flex-col items-center gap-1 text-center">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                          reached ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {reached ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                      <span className="text-[11px] text-slate-500">{s}</span>
                    </li>
                  );
                })}
              </ol>
              {data.complaint.rejectionReason && (
                <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-700">
                  Reason: {data.complaint.rejectionReason}
                </p>
              )}
              <p className="text-xs text-slate-500">
                Submitted {new Date(data.complaint.submittedAt).toLocaleString()} · last update{' '}
                {new Date(data.complaint.updatedAt).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
