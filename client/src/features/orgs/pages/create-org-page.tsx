import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../components/ui/card';
import { AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { orgKeys, SLUG_PATTERN, slugFromName } from '../org-api';

export const CreateOrgPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Once the user edits the slug by hand, typing in the name stops overwriting it.
  const [slugTouched, setSlugTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const slugValid = SLUG_PATTERN.test(slug);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (!slugTouched) setSlug(slugFromName(e.target.value));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugTouched(true);
    setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
    setFieldErrors((prev) => ({ ...prev, slug: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const res = await apiFetch<{ organization: { slug: string } }>('/orgs', {
        method: 'POST',
        body: JSON.stringify({ name, slug }),
      });
      await queryClient.invalidateQueries({ queryKey: orgKeys.myOrgs });
      navigate(`/w/${res.organization.slug}`);
    } catch (err: unknown) {
      if (err instanceof ClientApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Failed to create organization.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-md">
        <CardHeader>
          <Link to="/start" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-2 w-fit">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <CardTitle className="text-2xl font-bold">Create organization</CardTitle>
          <CardDescription>
            Set up a workspace for your college, company, or support team. You will be its first <strong>Admin</strong>.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 text-sm text-red-800 bg-red-50 rounded-md border border-red-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                placeholder="e.g. City College IT or Acme Logistics"
                value={name}
                onChange={handleNameChange}
                maxLength={100}
                required
              />
              {fieldErrors.name && <p className="text-xs text-red-600">{fieldErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-slug">URL slug</Label>
              <Input
                id="org-slug"
                placeholder="e.g. city-college"
                value={slug}
                onChange={handleSlugChange}
                maxLength={40}
                aria-invalid={slug.length > 0 && !slugValid}
                required
              />
              {fieldErrors.slug ? (
                <p className="text-xs text-red-600">{fieldErrors.slug}</p>
              ) : slug && !slugValid ? (
                <p className="text-xs text-amber-700">
                  3-40 characters: lowercase letters, numbers and hyphens; must start and end with a letter or number.
                </p>
              ) : slug ? (
                <p className="text-xs text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Looks good
                </p>
              ) : null}

              <div className="p-3 bg-slate-100 rounded-md text-xs text-slate-600 space-y-1">
                <p>
                  Workspace: <code className="text-blue-600">/w/{slug || '<slug>'}</code>
                </p>
                <p>
                  Complaint portal (enabled later): <code className="text-emerald-600">/o/{slug || '<slug>'}</code>
                </p>
                <p className="text-slate-500 text-[11px] pt-1">
                  The slug cannot be changed later, so links keep working. The name can.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-2">
            <Link to="/start">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting || name.trim().length < 2 || !slugValid}>
              {isSubmitting ? 'Creating...' : 'Create workspace'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
