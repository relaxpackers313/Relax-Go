'use client';

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect } from 'react';

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-600 hover:bg-slate-100',
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS; size?: 'sm' | 'md' }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[14px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[14px] outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[14px] outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('h-9 rounded-md border border-slate-300 bg-white px-2.5 text-[14px] outline-none focus:border-brand-500', className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[12px] text-slate-400">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[12px] text-red-600">{error}</span> : null}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[var(--radius-card)] border border-slate-200 bg-white', className)}>
      {title ? (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const BADGE_TONES: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  free: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  correction_required: 'bg-amber-50 text-amber-700 border-amber-200',
  stale: 'bg-amber-50 text-amber-700 border-amber-200',
  background: 'bg-sky-50 text-sky-700 border-sky-200',
  contacted: 'bg-sky-50 text-sky-700 border-sky-200',
  accepted: 'bg-sky-50 text-sky-700 border-sky-200',
  paid: 'bg-sky-50 text-sky-700 border-sky-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  offline: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function Badge({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[12px] font-medium', BADGE_TONES[value] ?? 'bg-slate-100 text-slate-600 border-slate-200', className)}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[14px] text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-[14px] font-medium text-slate-600">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="py-10 text-center">
      <p className="text-[14px] font-medium text-red-600">{message}</p>
      {retry ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-[12px] uppercase tracking-wide text-slate-400">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700 [&_td]:px-3 [&_td]:py-2.5">{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-[12px] text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
