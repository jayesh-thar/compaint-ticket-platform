import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/card';
import { orgKeys, useWorkspaceOrg, type OrgDetails } from '../org-api';

export const OrgSettingsPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [portalIntro, setPortalIntro] = useState(org.portalIntro ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ organization: OrgDetails }>(`/orgs/${org.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, portalIntro: portalIntro.trim() || null }),
      }),
    onSuccess: async () => {
      setMessage({ kind: 'ok', text: 'Settings saved.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgKeys.org(org.slug) }),
        queryClient.invalidateQueries({ queryKey: orgKeys.myOrgs }),
      ]);
    },
    onError: (err: unknown) =>
      setMessage({ kind: 'error', text: err instanceof ClientApiError ? err.message : 'Could not save settings.' }),
  });

  if (org.myRole !== 'ADMIN') {
    return <p className="text-sm text-slate-600">Only Admins can change organization settings.</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Basic details of {org.name}.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>
            The slug <code className="text-blue-600">{org.slug}</code> is permanent so links keep working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              save.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="portal-intro">Complaint portal intro (optional)</Label>
              <textarea
                id="portal-intro"
                rows={4}
                maxLength={2000}
                value={portalIntro}
                onChange={(e) => setPortalIntro(e.target.value)}
                placeholder="Shown at the top of your public complaint page."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-500">Shown at the top of your public complaint page.</p>
            </div>
            {message && (
              <p role="status" className={`text-sm ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {message.text}
              </p>
            )}
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {save.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PortalCard org={org} />
    </div>
  );
};

/** Complaint link on/off (README 0.4): customers use /o/:slug without an account. */
const PortalCard: React.FC<{ org: OrgDetails }> = ({ org }) => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const portalUrl = `${window.location.origin}/o/${org.slug}`;

  const toggle = useMutation({
    mutationFn: (portalEnabled: boolean) =>
      apiFetch<{ organization: OrgDetails }>(`/orgs/${org.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ portalEnabled }),
      }),
    onSuccess: async (res) => {
      setMessage({
        kind: 'ok',
        text: res.organization.portalEnabled ? 'The portal is open.' : 'The portal is closed.',
      });
      await queryClient.invalidateQueries({ queryKey: orgKeys.org(org.slug) });
    },
    onError: (err: unknown) =>
      setMessage({ kind: 'error', text: err instanceof ClientApiError ? err.message : 'Could not change the portal.' }),
  });

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Complaint portal</CardTitle>
        <CardDescription>
          A public page where customers or students submit complaints (they need a verified account).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Status:{' '}
          <strong className={org.portalEnabled ? 'text-emerald-700' : 'text-slate-600'}>
            {org.portalEnabled ? 'Open - accepting complaints' : 'Closed'}
          </strong>
        </p>
        {org.portalEnabled && (
          <p className="break-all rounded-md bg-slate-100 p-2 text-xs">
            Share this link:{' '}
            <a className="text-blue-600 hover:underline" href={portalUrl} target="_blank" rel="noreferrer">
              {portalUrl}
            </a>
          </p>
        )}
        {message && (
          <p role="status" className={`text-sm ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
        <Button
          variant={org.portalEnabled ? 'outline' : 'default'}
          disabled={toggle.isPending}
          onClick={() => {
            setMessage(null);
            toggle.mutate(!org.portalEnabled);
          }}
        >
          {org.portalEnabled ? 'Close the portal' : 'Open the portal'}
        </Button>
        {!org.portalEnabled && (
          <p className="text-xs text-slate-500">
            When open, share the link with customers (website, QR code, email). Every complaint waits for Admin
            approval.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
