import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '../../../components/ui/card';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export const VerifyEmailPage: React.FC = () => {
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email address...');

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/#token=([a-zA-Z0-9_-]+)/);

    // Immediately remove token from browser address bar
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (!match || !match[1]) {
      setStatus('error');
      setMessage('No verification token found in URL.');
      return;
    }

    const token = match[1];

    apiFetch<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        setStatus('success');
        setMessage(res.message);
      })
      .catch((err) => {
        setStatus('error');
        if (err instanceof ClientApiError) {
          setMessage(err.message);
        } else {
          setMessage('Email verification failed or token has expired.');
        }
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <Card className="w-full max-w-md text-center shadow-md">
        <CardHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full">
            {status === 'verifying' && <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />}
            {status === 'success' && (
              <div className="bg-emerald-100 text-emerald-600 p-2 rounded-full">
                <CheckCircle2 className="h-8 w-8" />
              </div>
            )}
            {status === 'error' && (
              <div className="bg-red-100 text-red-600 p-2 rounded-full">
                <AlertCircle className="h-8 w-8" />
              </div>
            )}
          </div>
          <CardTitle>
            {status === 'verifying' && 'Verifying Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center gap-3">
          {status === 'success' && (
            <Link to="/login">
              <Button>Proceed to Sign In</Button>
            </Link>
          )}
          {status === 'error' && (
            <Link to="/resend-verification">
              <Button variant="outline">Request New Link</Button>
            </Link>
          )}
        </CardFooter>
      </Card>
    </div>
  );
};
