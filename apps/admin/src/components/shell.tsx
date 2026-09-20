'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { clearSession, getAdmin, getToken, type AdminUser } from '@/lib/api';
import { cn } from '@/components/ui';

const NAV: { label: string; href: string; group?: string }[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Live map', href: '/map' },
  { label: 'Drivers', href: '/drivers', group: 'People' },
  { label: 'Customers', href: '/customers', group: 'People' },
  { label: 'Leads', href: '/leads', group: 'Business' },
  { label: 'Calls', href: '/calls', group: 'Business' },
  { label: 'Pricing rules', href: '/pricing', group: 'Business' },
  { label: 'Reports', href: '/reports', group: 'Business' },
  { label: 'Support', href: '/support', group: 'Operations' },
  { label: 'Service areas', href: '/service-areas', group: 'Operations' },
  { label: 'Audit log', href: '/audit', group: 'Operations' },
  { label: 'Settings', href: '/settings', group: 'Platform' },
  { label: 'Admin users', href: '/admins', group: 'Platform' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setAdmin(getAdmin());
    setReady(true);
  }, [router]);

  if (!ready) return null;

  let lastGroup: string | undefined;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-ink-950 text-slate-300">
        <div className="border-b border-white/10 px-4 py-4">
          <p className="text-[16px] font-semibold text-white">
            Relax <span className="text-accent-500">Go</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Operations console</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          {NAV.map((item) => {
            const groupHeader =
              item.group && item.group !== lastGroup ? (
                <p key={`g-${item.group}`} className="mb-1 mt-4 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {item.group}
                </p>
              ) : null;
            lastGroup = item.group ?? lastGroup;
            const active = pathname.startsWith(item.href);
            return (
              <div key={item.href}>
                {groupHeader}
                <Link
                  href={item.href}
                  className={cn(
                    'mb-0.5 block rounded-md px-2 py-1.5 text-[13px] transition-colors',
                    active ? 'bg-brand-600 font-medium text-white' : 'hover:bg-white/5 hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-[13px] text-white">{admin?.name}</p>
          <p className="truncate text-[11px] text-slate-400">
            {admin?.email} · {admin?.role}
          </p>
          <button
            onClick={() => {
              clearSession();
              router.replace('/login');
            }}
            className="mt-2 text-[12px] text-slate-400 underline-offset-2 hover:text-white hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {sub ? <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p> : null}
      </div>
      {actions}
    </div>
  );
}
