import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../components/ui/card';
import { CheckCircle2, AlertCircle, Loader2, Building2, Mail } from 'lucide-react';
import { orgKeys } from '../../orgs/org-api';

interface AcceptResult {
  organization: { name: string; slug: string };
  role: string;
}

// The token is kept in sessionStorage (this tab only, gone when the tab closes)
// so a visitor who must log in first does not lose it on the way.
const STORAGE_KEY = 'pendingInviteToken';

const readToken = (): string | null => {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    // Remove the token from the address bar right away (history, screenshots, sharing).
    window.history.replaceState(null, '', window.location.pathname);
    try {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
    } catch {
      /* storage blocked: we still have the token in memory */
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const forgetToken = () => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <Card className="w-full max-w-md shadow-md">{children}</Card>
  </div>
);

export const AcceptInvitePage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  // Read once on first render (useState initializer), before StrictMode's double effects.
  const [token] = useState(readToken);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sent = useRef(false);

  const canAccept = !!token && !!user?.emailVerified;

  // Log out, then come straight back here after logging in with the right account.
  const switchAccount = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    window.location.href = `/login?returnTo=${encodeURIComponent('/invite')}`;
  };

  useEffect(() => {
    if (!canAccept || sent.current) return;
    sent.current = true; // guard: React StrictMode runs effects twice in dev

    apiFetch<AcceptResult>('/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) })
      .then(async (data) => {
        forgetToken();
        setResult(data);
        await queryClient.invalidateQueries({ queryKey: orgKeys.myOrgs });
      })
      .catch((err: unknown) => {
        // A wrong-account error keeps the token so the user can switch accounts and retry.
        const wrongAccount = err instanceof ClientApiError && err.status === 403;
        if (!wrongAccount) forgetToken();
        setErrorMessage(err instanceof ClientApiError ? err.message : 'Something went wrong. Please try again.');
      });
  }, [canAccept, token, queryClient]);

  if (!token) {
    return (
      <Shell>
        <CardHeader>
          <AlertCircle className="h-5 w-5 text-amber-500 mb-1" />
          <CardTitle>Invitation link incomplete</CardTitle>
          <CardDescription>Open the full link from your invitation email.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={() => navigate('/')}>
            Go to home
          </Button>
        </CardFooter>
      </Shell>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    const returnTo = encodeURIComponent('/invite');
    return (
      <Shell>
        <CardHeader>
          <Mail className="h-6 w-6 text-blue-600 mb-1" />
          <CardTitle>You have been invited</CardTitle>
          <CardDescription>
            Log in (or create an account) with the email address the invitation was sent to. You will come back here
            automatically.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-2">
          <Link to={`/login?returnTo=${returnTo}`} className="flex-1">
            <Button className="w-full">Log in</Button>
          </Link>
          <Link to="/register" className="flex-1">
            <Button variant="outline" className="w-full">
              Create account
            </Button>
          </Link>
        </CardFooter>
        <p className="px-6 pb-6 text-xs text-slate-500">
          New account? Verify your email first, then open the invitation link again.
        </p>
      </Shell>
    );
  }

  if (!user.emailVerified) {
    return (
      <Shell>
        <CardHeader>
          <AlertCircle className="h-5 w-5 text-amber-500 mb-1" />
          <CardTitle>Verify your email first</CardTitle>
          <CardDescription>
            Check your inbox for the verification link for <strong>{user.email}</strong>, then open the invitation link
            again.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link to="/resend-verification">
            <Button variant="outline">Resend verification email</Button>
          </Link>
        </CardFooter>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell>
        <CardHeader>
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <CheckCircle2 className="h-6 w-6" />
            <span className="text-sm font-semibold uppercase tracking-wider">Invitation accepted</span>
          </div>
          <CardTitle className="text-2xl">Welcome aboard!</CardTitle>
          <CardDescription>
            You are now a member of <strong>{result.organization.name}</strong> as <strong>{result.role}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <Building2 className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900">{result.organization.name}</p>
              <p className="text-xs text-slate-500">/w/{result.organization.slug}</p>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={() => navigate(`/w/${result.organization.slug}`)}>
            Go to workspace
          </Button>
        </CardFooter>
      </Shell>
    );
  }

  if (errorMessage) {
    return (
      <Shell>
        <CardHeader>
          <AlertCircle className="h-5 w-5 text-red-500 mb-1" />
          <CardTitle>Could not accept the invitation</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-slate-500">
          You are logged in as <strong>{user.email}</strong>.
        </CardContent>
        <CardFooter className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={switchAccount}>
            Log in with another account
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Home
          </Button>
        </CardFooter>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <p className="text-sm text-slate-500">Accepting your invitation...</p>
    </div>
  );
};
