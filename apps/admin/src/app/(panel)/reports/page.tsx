'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Card, ErrorState, Input, Spinner, Stat } from '@/components/ui';

interface Summary {
  range: { from: string; to: string };
  leads: Record<string, number>;
  calls: { status: string; classification: string; n: number }[];
  revenue: { callChargesPaise: number; chargedCalls: number; rechargesPaise: number; rechargeCount: number };
  creditsConsumed: Record<string, number>;
  driverRegistrations: Record<string, number>;
  geography: { leadsByCity: { city: string; n: number }[]; leadsByVehicleType: Record<string, number> };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="w-32 shrink-0 truncate text-slate-600">{label}</span>
      <span className="h-3 rounded bg-brand-500/80" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 2}%` }} aria-hidden />
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function ReportsPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 24 * 3600_000)));
  const [to, setTo] = useState(iso(new Date()));
  const q = useQuery({
    queryKey: ['report', from, to],
    queryFn: () => api<Summary>(`/admin/reports/summary?from=${from}&to=${to}T23:59:59.999Z`),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Lead funnel, call outcomes, revenue and geography for the selected period."
        actions={
          <div className="flex items-center gap-2 text-[13px]">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From" />
            <span className="text-slate-400">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To" />
          </div>
        }
      />
      {q.isPending ? (
        <Spinner label="Crunching numbers…" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        (() => {
          const r = q.data;
          const leadMax = Math.max(...Object.values(r.leads), 1);
          const cityMax = Math.max(...r.geography.leadsByCity.map((c) => c.n), 1);
          const totalCalls = r.calls.reduce((a, c) => a + c.n, 0);
          const byClassification = r.calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.classification]: (acc[c.classification] ?? 0) + c.n }), {});
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Call revenue" value={formatMoney(r.revenue.callChargesPaise)} sub={`${r.revenue.chargedCalls} charged calls`} />
                <Stat label="Wallet recharges" value={formatMoney(r.revenue.rechargesPaise)} sub={`${r.revenue.rechargeCount} payments`} />
                <Stat label="Total calls" value={totalCalls} sub={Object.entries(byClassification).map(([k, v]) => `${v} ${k}`).join(' · ') || '—'} />
                <Stat label="Credits consumed" value={(r.creditsConsumed.free_credit_consume ?? 0) + (r.creditsConsumed.promo_credit_consume ?? 0)} sub={`${r.creditsConsumed.free_credit_consume ?? 0} free · ${r.creditsConsumed.promo_credit_consume ?? 0} promo`} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card title="Lead funnel">
                  {Object.keys(r.leads).length ? (
                    <div className="space-y-2">
                      {['created', 'shown', 'viewed', 'accepted', 'contacted', 'converted', 'rejected', 'expired', 'cancelled']
                        .filter((s) => r.leads[s])
                        .map((s) => <Bar key={s} label={titleCase(s)} value={r.leads[s]!} max={leadMax} />)}
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-400">No leads in this period.</p>
                  )}
                </Card>
                <Card title="Leads by city (driver's city)">
                  {r.geography.leadsByCity.length ? (
                    <div className="space-y-2">
                      {r.geography.leadsByCity.map((c) => <Bar key={c.city} label={c.city} value={c.n} max={cityMax} />)}
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-400">No data.</p>
                  )}
                </Card>
                <Card title="Leads by vehicle type">
                  {Object.keys(r.geography.leadsByVehicleType).length ? (
                    <div className="space-y-2">
                      {Object.entries(r.geography.leadsByVehicleType).map(([k, v]) => (
                        <Bar key={k} label={titleCase(k)} value={v} max={Math.max(...Object.values(r.geography.leadsByVehicleType))} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-400">No data.</p>
                  )}
                </Card>
                <Card title="Driver registrations in period">
                  {Object.keys(r.driverRegistrations).length ? (
                    <div className="space-y-2">
                      {Object.entries(r.driverRegistrations).map(([k, v]) => (
                        <Bar key={k} label={titleCase(k)} value={v} max={Math.max(...Object.values(r.driverRegistrations))} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-slate-400">No registrations in this period.</p>
                  )}
                </Card>
              </div>
            </>
          );
        })()
      )}
    </>
  );
}
