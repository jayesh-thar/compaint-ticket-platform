import React, { useState } from 'react';
import { useAuth } from '../auth-context';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/card';
import { Mail, CheckCircle2, AlertCircle } from 'lucide-react';

export const RequireVerified: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading, logout } = useAuth();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!user?.emailVerified) {
    const handleResend = async () => {
      setIsSending(true);
      setMessage(null);
      setError(null);
      try {
        await apiFetch('/auth/resend-verification', {
          method: 'POST',
          body: JSON.stringify({ email: user?.email }),
        });
        setMessage('A new verification email has been sent. Please check your inbox.');
      } catch (err: unknown) {
        if (err instanceof ClientApiError) {
          setError(err.message);
        } else {
          setError('Failed to resend verification email.');
        }
      } finally {
        setIsSending(false);
      }
    };

    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <Mail className="h-6 w-6" />
            </div>
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              We sent a verification link to <strong className="text-slate-800">{user?.email}</strong>. Please check
              your email to activate your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && (
              <div className="flex items-center gap-2 p-3 text-sm text-emerald-800 bg-emerald-50 rounded-md border border-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{message}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-800 bg-red-50 rounded-md border border-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={handleResend} disabled={isSending}>
                {isSending ? 'Sending link...' : 'Resend verification link'}
              </Button>
              <Button variant="outline" onClick={logout}>
                Log out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
