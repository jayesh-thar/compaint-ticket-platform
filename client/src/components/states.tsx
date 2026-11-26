import React from 'react';
import { AlertCircle, CheckCircle2, Inbox } from 'lucide-react';
import { Button } from './ui/button';
import { ClientApiError } from '../lib/api';

/** Loading / empty / error / success building blocks used by every screen. */

export const Spinner: React.FC<{ className?: string; label?: string }> = ({ className = 'py-10', label }) => (
  <div className={`flex flex-col items-center justify-center gap-2 ${className}`} role="status" aria-live="polite">
    <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    <span className="sr-only">{label ?? 'Loading'}</span>
    {label && <span className="text-sm text-slate-500">{label}</span>}
  </div>
);

export const FullPageSpinner: React.FC = () => <Spinner className="h-screen" />;

export const errorMessage = (err: unknown, fallback = 'Something went wrong. Please try again.') =>
  err instanceof ClientApiError ? err.message : fallback;

export const ErrorState: React.FC<{ error?: unknown; message?: string; onRetry?: () => void }> = ({
  error,
  message,
  onRetry,
}) => (
  <div
    role="alert"
    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
  >
    <span className="flex items-center gap-2">
      <AlertCircle className="h-4 w-4 shrink-0" /> {message ?? errorMessage(error)}
    </span>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  hint,
  action,
}) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <Inbox className="h-8 w-8 text-slate-300" />
    <p className="text-sm font-medium text-slate-700">{title}</p>
    {hint && <p className="max-w-sm text-xs text-slate-500">{hint}</p>}
    {action}
  </div>
);

export const Notice: React.FC<{ kind: 'ok' | 'error'; children: React.ReactNode }> = ({ kind, children }) => (
  <p
    role={kind === 'error' ? 'alert' : 'status'}
    className={`flex items-center gap-1.5 text-sm ${kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
  >
    {kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
    {children}
  </p>
);

export const PageHeader: React.FC<{ title: string; description?: React.ReactNode; actions?: React.ReactNode }> = ({
  title,
  description,
  actions,
}) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
    {actions}
  </div>
);
