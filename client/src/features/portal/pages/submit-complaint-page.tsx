import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, FullPageSpinner, errorMessage } from '../../../components/states';
import { usePortal } from '../portal-api';
import { PortalShell, PortalUnavailable } from './portal-page';

interface Submitted {
  reference: string;
  number: number;
  organization: { name: string; slug: string };
}

/** Behind RequireAuth + RequireVerified (router), so we land back here after login. */
export const SubmitComplaintPage: React.FC = () => {
  const { slug = '' } = useParams();
  const query = usePortal(slug);
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ complaint: Submitted }>(`/portals/${slug}/complaints`, {
        method: 'POST',
        body: JSON.stringify({ categoryId, subject, description }),
      }),
    onSuccess: ({ complaint }) => {
      setDone(complaint);
      queryClient.invalidateQueries({ queryKey: ['me', 'complaints'] });
    },
    onError: (err) => {
      setError(errorMessage(err, 'Could not submit your complaint. Please try again.'));
      if (err instanceof ClientApiError && err.fields) setFieldErrors(err.fields);
    },
  });

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

  if (done) {
    return (
      <PortalShell title={p.name}>
        <Card className="text-center shadow-md">
          <CardHeader>
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
            <CardTitle className="text-2xl">Complaint received</CardTitle>
            <CardDescription>
              Your reference is <strong className="font-mono text-slate-900">{done.reference}</strong>. We have emailed
              you a confirmation.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap justify-center gap-2">
            <Link to={`/my/complaints/${done.organization.slug}/${done.number}`}>
              <Button>Follow this complaint</Button>
            </Link>
            <Link to={`/o/${p.slug}`}>
              <Button variant="outline">Back to {p.name}</Button>
            </Link>
          </CardFooter>
        </Card>
      </PortalShell>
    );
  }

  if (!p.acceptingComplaints) {
    return (
      <PortalShell title={p.name}>
        <Card>
          <CardHeader>
            <CardTitle>Not accepting complaints right now</CardTitle>
          </CardHeader>
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell title={p.name}>
      <Link to={`/o/${p.slug}`} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Submit a complaint to {p.name}</CardTitle>
          <CardDescription>Describe the problem; staff will reply here and by email.</CardDescription>
        </CardHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            submit.mutate();
          }}
        >
          <CardContent className="space-y-4">
            {error && <ErrorState message={error} />}
            <div className="space-y-1">
              <Label htmlFor="c-category">Category</Label>
              <Select id="c-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose a category...</option>
                {p.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.categoryId} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-subject">Subject</Label>
              <Input
                id="c-subject"
                value={subject}
                maxLength={200}
                placeholder="e.g. Wi-Fi not working in Block C"
                onChange={(e) => setSubject(e.target.value)}
              />
              <FieldError message={fieldErrors.subject} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-description">What happened?</Label>
              <Textarea
                id="c-description"
                rows={6}
                maxLength={10000}
                value={description}
                placeholder="Where, when, and what you already tried (at least 10 characters)."
                onChange={(e) => setDescription(e.target.value)}
              />
              <FieldError message={fieldErrors.description} />
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            {/* Disabled while sending, so a double click cannot submit twice. */}
            <Button
              type="submit"
              disabled={submit.isPending || !categoryId || subject.trim().length < 3 || description.trim().length < 10}
            >
              {submit.isPending ? 'Submitting...' : 'Submit complaint'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </PortalShell>
  );
};
