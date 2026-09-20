'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Card, ErrorState, Spinner, Stat } from '@/components/ui';

interface Dashboard {
  drivers: Record<string, number>;
  onlineDrivers: number;
  customers: number;
  leads: { today: number; total: number };
  callsToday: number;
  revenue: { callChargesTodayPaise: number; rechargesTotalPaise: number };
  walletFloatPaise: number;
  openTickets: number;
  activeTrips: number;
}

interface Usage {
  days: string[];
  rows: { day: string; kind: string; count: number }[];
  activeCustomersToday: number;
  note: string;
}

const sumKinds = (rows: Usage['rows'], day: string, prefix: string) =>
  rows.filter((r) => r.day === day && r.kind.startsWith(prefix)).reduce((n, r) => n + r.count, 0);

function UsageCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/admin/usage'), refetchInterval: 60_000 });
  if (q.isPending) return <Card title="Maps & server usage"><Spinner label="Loading usage…" /></Card>;
  if (q.isError) return <Card title="Maps & server usage"><ErrorState error={q.error} retry={() => q.refetch()} /></Card>;
  const u = q.data;
  const today = u.days[u.days.length - 1]!;
  const googleToday = sumKinds(u.rows, today, 'maps.google.');
  const cacheToday = sumKinds(u.rows, today, 'maps.cache.');
  const freeToday = sumKinds(u.rows, today, 'maps.free.');
  const hitRate = googleToday + cacheToday > 0 ? Math.round((cacheToday / (googleToday + cacheToday)) * 100) : 0;
  const apiToday = sumKinds(u.rows, today, 'api.requests');
  const searchesToday = sumKinds(u.rows, today, 'discovery.search');
  return (
    <Card title="Maps & server usage (today)">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Billable Google calls" value={googleToday} sub="Places + Routes (server-side)" />
        <Stat label="Served from cache" value={cacheToday} sub={`${hitRate}% of map lookups — ₹0`} />
        <Stat label="Free OSM calls" value={freeToday} sub="Nominatim fallback" />
        <Stat label="API requests" value={apiToday} />
        <Stat label="Driver searches" value={searchesToday} sub="Customer discovery queries" />
        <Stat label="Active customers" value={u.activeCustomersToday} sub="Sessions seen today" />
      </div>
      <table className="mt-4 w-full text-[12px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 font-medium">Day</th>
            <th className="py-1 text-right font-medium">Google (billable)</th>
            <th className="py-1 text-right font-medium">Cache hits</th>
            <th className="py-1 text-right font-medium">API requests</th>
          </tr>
        </thead>
        <tbody>
          {u.days.map((day) => (
            <tr key={day} className="border-t border-slate-100">
              <td className="py-1 text-slate-600">{day}</td>
              <td className="py-1 text-right font-semibold">{sumKinds(u.rows, day, 'maps.google.')}</td>
              <td className="py-1 text-right text-emerald-700">{sumKinds(u.rows, day, 'maps.cache.')}</td>
              <td className="py-1 text-right">{sumKinds(u.rows, day, 'api.requests')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-slate-500">{u.note}</p>
    </Card>
  );
}

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 30_000 });

  if (q.isPending) return <Spinner label="Loading dashboard…" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const pending = d.drivers.pending ?? 0;

  return (
    <>
      {/* Platform brand banner */}
      <div className="mb-5 flex items-center justify-between rounded-[var(--radius-card)] bg-[#0b1220] px-5 py-4 text-white">
        <div>
          <div className="text-[22px] font-black tracking-tight">
            Relax <span className="text-emerald-400">Go</span>
          </div>
          <div className="text-[12px] text-slate-300">Operations console · a ChefoTech product, operated by Relax Group</div>
        </div>
        <span className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
          Live
        </span>
      </div>
      <PageHeader title="Dashboard" sub="Live overview of the platform. Refreshes every 30 seconds." />
      {pending > 0 ? (
        <Link href="/drivers?status=pending" className="mb-5 block rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-800 hover:bg-amber-100">
          <b>{pending}</b> driver registration{pending > 1 ? 's' : ''} waiting for review →
        </Link>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Online drivers" value={d.onlineDrivers} sub={`${d.drivers.approved ?? 0} approved in total`} />
        <Stat label="Leads today" value={d.leads.today} sub={`${d.leads.total} all-time`} />
        <Stat label="Calls today" value={d.callsToday} sub={`${formatMoney(d.revenue.callChargesTodayPaise)} charged`} />
        <Stat label="Active trips" value={d.activeTrips} />
        <Stat label="Customers (sessions)" value={d.customers} />
        <Stat label="Wallet float" value={formatMoney(d.walletFloatPaise)} sub="Total driver balances held" />
        <Stat label="Recharges (all-time)" value={formatMoney(d.revenue.rechargesTotalPaise)} />
        <Stat label="Open support tickets" value={d.openTickets} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Drivers by status">
          <ul className="space-y-1.5 text-[14px]">
            {Object.entries(d.drivers).map(([status, n]) => (
              <li key={status} className="flex justify-between">
                <span className="capitalize text-slate-600">{status.replace(/_/g, ' ')}</span>
                <b>{n}</b>
              </li>
            ))}
            {!Object.keys(d.drivers).length ? <li className="text-slate-400">No drivers yet</li> : null}
          </ul>
        </Card>
        <UsageCard />
        <Card title="Quick actions">
          <div className="flex flex-wrap gap-2 text-[14px]">
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/drivers?status=pending">Review registrations</Link>
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/map">Open live map</Link>
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/pricing">Call pricing</Link>
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/settings">Platform settings</Link>
            <Link className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/reports">Reports</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
