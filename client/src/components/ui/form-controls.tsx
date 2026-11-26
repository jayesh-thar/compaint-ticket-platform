import * as React from 'react';
import { cn } from '../../lib/utils';

const fieldBase =
  'w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

/** Native <select> styled like the Input component (accessible, works on phones). */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, 'py-2', className)} {...props} />
);
Textarea.displayName = 'Textarea';

export const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="text-xs text-red-600">{message}</p> : null;

const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export const Badge: React.FC<{ tone?: BadgeTone; className?: string; children: React.ReactNode; title?: string }> = ({
  tone = 'slate',
  className,
  children,
  title,
}) => (
  <span
    title={title}
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
      BADGE_TONES[tone],
      className
    )}
  >
    {children}
  </span>
);
