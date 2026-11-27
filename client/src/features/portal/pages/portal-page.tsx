import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ImageOff, MessageSquareWarning } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, Spinner } from '../../../components/states';

interface Portal {
  name: string;
  slug: string;
  intro: string | null;
  accepting: boolean;
  categories: { id: string; name: string }[];
}

const COUNTRY_CODES = [
  ['+91', 'India'],
  ['+1', 'USA / Canada'],
  ['+44', 'United Kingdom'],
  ['+971', 'UAE'],
  ['+966', 'Saudi Arabia'],
  ['+61', 'Australia'],
  ['+49', 'Germany'],
  ['+33', 'France'],
  ['+65', 'Singapore'],
  ['+81', 'Japan'],
  ['+86', 'China'],
  ['+92', 'Pakistan'],
  ['+880', 'Bangladesh'],
  ['+977', 'Nepal'],
  ['+94', 'Sri Lanka'],
  ['+27', 'South Africa'],
  ['+55', 'Brazil'],
];

/** Public complaint page `/o/:slug` (README 0.4, D-22): no account needed. */
export const PortalPage: React.FC = () => {
  const { slug = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-portal', slug],
    queryFn: () => apiFetch<{ portal: Portal }>(`/public/portals/${slug}`),
    retry: false,
  });
  const [form, setForm] = useState({
    name: '',
    email: '',
    phoneCode: '+91',
    phone: '',
    categoryId: '',
    subject: '',
    description: '',
    website: '',
  });
  const [result, setResult] = useState<{ reference: string; trackingToken: string | null } | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = submitError instanceof ClientApiError ? (submitError.fields ?? {}) : {};
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<{ reference: string; trackingToken: string | null }>(
        `/public/portals/${slug}/complaints`,
        {
          method: 'POST',
          body: JSON.stringify({ ...form, categoryId: form.categoryId || null }),
        }
      );
      setResult(res);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-4">{children}</div>
    </div>
  );

  if (isLoading) return shell(<Spinner />);
  if (error || !data)
    return shell(<ErrorState message="This complaint page is not available. Check the link you were given." />);
  const p = data.portal;

  if (result) {
    const trackUrl = result.trackingToken ? `${window.location.origin}/track#token=${result.trackingToken}` : null;
    return shell(
      <Card className="text-center">
        <CardHeader>
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <CardTitle>Complaint registered</CardTitle>
          <CardDescription>
            Thank you. {p.name} received your complaint. Your reference is{' '}
            <strong className="text-slate-900">{result.reference}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-slate-600">A confirmation was sent to {form.email}. It is reviewed by the team first.</p>
          {trackUrl && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-left">
              <p className="font-medium text-slate-800">Your private tracking link (keep it safe):</p>
              <p className="break-all text-xs text-slate-600">{trackUrl}</p>
              <a href={trackUrl}>
                <Button size="sm" variant="outline">
                  Open tracking page
                </Button>
              </a>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setResult(null);
              setForm({ ...form, subject: '', description: '' });
            }}
          >
            Submit another complaint
          </Button>
        </CardContent>
      </Card>
    );
  }

  return shell(
    <>
      <div className="text-center">
        <MessageSquareWarning className="mx-auto h-10 w-10 text-blue-600" />
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{p.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{p.intro ?? 'Tell us about your problem. No account needed.'}</p>
      </div>
      {!p.accepting ? (
        <ErrorState message={`${p.name} is not accepting complaints right now. Please try again later.`} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              {submitError != null && <ErrorState error={submitError} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={form.name} onChange={set('name')} required autoComplete="name" />
                  <FieldError message={fields.name} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    required
                    autoComplete="email"
                  />
                  <FieldError message={fields.email} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone number</Label>
                <div className="flex gap-2">
                  <Select className="w-40" value={form.phoneCode} onChange={set('phoneCode')} aria-label="Country code">
                    {COUNTRY_CODES.map(([code, country]) => (
                      <option key={code} value={code}>
                        {code} {country}
                      </option>
                    ))}
                  </Select>
                  <Input
                    id="phone"
                    type="tel"
                    value={form.phone}
                    onChange={set('phone')}
                    required
                    autoComplete="tel-national"
                  />
                </div>
                <FieldError message={fields.phone ?? fields.phoneCode} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="category">Category</Label>
                <Select id="category" value={form.categoryId} onChange={set('categoryId')}>
                  {p.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="">Other / not sure</option>
                </Select>
                <FieldError message={fields.categoryId} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={form.subject} onChange={set('subject')} required />
                <FieldError message={fields.subject} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="description">What is the problem?</Label>
                <Textarea id="description" rows={6} value={form.description} onChange={set('description')} required />
                <FieldError message={fields.description} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="image" className="text-slate-400">
                  Image (optional)
                </Label>
                <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-400">
                  <ImageOff className="h-4 w-4" /> Image upload is coming soon.
                  <input id="image" type="file" disabled className="hidden" />
                </div>
              </div>
              {/* Honeypot: hidden from people, bots fill it in. */}
              <input
                type="text"
                name="website"
                value={form.website}
                onChange={set('website')}
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending...' : 'Submit complaint'}
              </Button>
              <p className="text-center text-xs text-slate-500">
                Your contact details are only visible to {p.name}'s staff.{' '}
                <Link to="/" className="underline">
                  About this service
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
};
