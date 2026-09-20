'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformSettings } from '@relaxgo/shared';
import { api, ApiClientError } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { Button, Card, ErrorState, Field, Input, Select, Spinner } from '@/components/ui';

/**
 * Typed editor over the platform-settings document. Each card patches only its own section;
 * the API validates against the shared schema, bumps the version and audits every changed path.
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: PlatformSettings; version: number }>('/admin/settings') });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: (input: { patch: unknown; reason?: string }) => api<{ version: number; changes: number }>('/admin/settings', { method: 'PATCH', body: input }),
    onSuccess: (r) => {
      setError(null);
      setMessage(r.changes ? `Saved — ${r.changes} value${r.changes > 1 ? 's' : ''} changed (config v${r.version}).` : 'No changes to save.');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => {
      setMessage(null);
      setError(e instanceof ApiClientError ? e.message : 'Save failed');
    },
  });

  if (q.isPending) return <Spinner label="Loading settings…" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const s = q.data.settings;

  return (
    <>
      <PageHeader title="Platform settings" sub={`Configuration version ${q.data.version}. Every change is recorded in the audit log with old and new values.`} />
      {message ? <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionForm
          title="Driver discovery"
          fields={[
            { path: 'discovery.defaultRadiusKm', label: 'Default radius (km)', value: s.discovery.defaultRadiusKm, type: 'number' },
            { path: 'discovery.maxRadiusKm', label: 'Maximum radius (km) — hard cap', value: s.discovery.maxRadiusKm, type: 'number' },
            { path: 'discovery.minRadiusKm', label: 'Minimum radius (km)', value: s.discovery.minRadiusKm, type: 'number' },
            { path: 'discovery.maxDrivers', label: 'Max drivers shown', value: s.discovery.maxDrivers, type: 'number' },
            { path: 'discovery.locationFreshnessSeconds', label: 'Location freshness (seconds)', value: s.discovery.locationFreshnessSeconds, type: 'number' },
            { path: 'discovery.sortMode', label: 'Sorting', value: s.discovery.sortMode, type: 'select', options: ['distance', 'rating', 'distance_then_rating'] },
            { path: 'discovery.distanceMode', label: 'Distance mode', value: s.discovery.distanceMode, type: 'select', options: ['straight_line', 'road'] },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Calls & free credits"
          fields={[
            { path: 'calls.basePricePaise', label: 'Base call price (paise; 200 = ₹2)', value: s.calls.basePricePaise, type: 'number' },
            { path: 'calls.freeCreditsOnApproval', label: 'Free credits on approval', value: s.calls.freeCreditsOnApproval, type: 'number' },
            { path: 'calls.freeCallsPerDay', label: 'Free calls per day (0 = off)', value: s.calls.freeCallsPerDay, type: 'number' },
            { path: 'calls.freeCallsPerWeek', label: 'Free calls per week (0 = off)', value: s.calls.freeCallsPerWeek, type: 'number' },
            { path: 'calls.freeCallsPerMonth', label: 'Free calls per month (0 = off)', value: s.calls.freeCallsPerMonth, type: 'number' },
            { path: 'calls.duplicateCallWindowMinutes', label: 'Repeat-call free window (minutes)', value: s.calls.duplicateCallWindowMinutes, type: 'number' },
            { path: 'calls.minWalletBalancePaise', label: 'Minimum wallet balance (paise)', value: s.calls.minWalletBalancePaise, type: 'number' },
            { path: 'calls.chargeOnlyConnected', label: 'Charge only connected calls', value: s.calls.chargeOnlyConnected, type: 'boolean' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Leads"
          fields={[
            { path: 'leads.expiryMinutes', label: 'Lead expiry (minutes)', value: s.leads.expiryMinutes, type: 'number' },
            { path: 'leads.maxActivePerCustomer', label: 'Max open requests per customer', value: s.leads.maxActivePerCustomer, type: 'number' },
            { path: 'leads.duplicateWindowMinutes', label: 'Duplicate-request window (minutes)', value: s.leads.duplicateWindowMinutes, type: 'number' },
            { path: 'leads.destinationRequired', label: 'Destination required', value: s.leads.destinationRequired, type: 'boolean' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Wallet & payments"
          fields={[
            { path: 'wallet.minRechargePaise', label: 'Minimum recharge (paise)', value: s.wallet.minRechargePaise, type: 'number' },
            { path: 'wallet.maxRechargePaise', label: 'Maximum recharge (paise)', value: s.wallet.maxRechargePaise, type: 'number' },
            { path: 'wallet.paymentGateway', label: 'Payment gateway', value: s.wallet.paymentGateway, type: 'select', options: ['none', 'razorpay'] },
            { path: 'wallet.lowBalanceThresholdPaise', label: 'Low-balance alert (paise)', value: s.wallet.lowBalanceThresholdPaise, type: 'number' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Maps & routing"
          fields={[
            { path: 'maps.provider', label: 'Map provider', value: s.maps.provider, type: 'select', options: ['osm', 'google', 'mapbox'] },
            { path: 'maps.tileUrl', label: 'Tile URL template', value: s.maps.tileUrl, type: 'text' },
            { path: 'maps.geocodingProvider', label: 'Geocoding provider', value: s.maps.geocodingProvider, type: 'select', options: ['nominatim', 'google', 'mapbox'] },
            { path: 'maps.routingProvider', label: 'Routing provider', value: s.maps.routingProvider, type: 'select', options: ['osrm', 'google', 'mapbox'] },
            { path: 'maps.osrmUrl', label: 'OSRM URL', value: s.maps.osrmUrl, type: 'text' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Location pipeline"
          fields={[
            { path: 'location.foregroundIntervalSeconds', label: 'Foreground GPS interval (s)', value: s.location.foregroundIntervalSeconds, type: 'number' },
            { path: 'location.backgroundIntervalSeconds', label: 'Background GPS interval (s)', value: s.location.backgroundIntervalSeconds, type: 'number' },
            { path: 'location.maxAccuracyMeters', label: 'Reject accuracy worse than (m)', value: s.location.maxAccuracyMeters, type: 'number' },
            { path: 'location.maxPlausibleSpeedKmh', label: 'Max plausible speed (km/h)', value: s.location.maxPlausibleSpeedKmh, type: 'number' },
            { path: 'location.realtimeThrottleSeconds', label: 'Live-map throttle (s, 0 = every update)', value: s.location.realtimeThrottleSeconds, type: 'number' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Feature flags"
          fields={Object.entries(s.features).map(([key, value]) => ({ path: `features.${key}`, label: key, value, type: 'boolean' as const }))}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <SectionForm
          title="Brand & support contact"
          fields={[
            { path: 'brand.supportPhone', label: 'Support phone', value: s.brand.supportPhone, type: 'text' },
            { path: 'brand.supportAltPhone', label: 'Alternate phone', value: s.brand.supportAltPhone, type: 'text' },
            { path: 'brand.supportWhatsapp', label: 'WhatsApp', value: s.brand.supportWhatsapp, type: 'text' },
            { path: 'brand.supportEmail', label: 'Support email', value: s.brand.supportEmail, type: 'text' },
            { path: 'brand.headOfficeAddress', label: 'Head office address', value: s.brand.headOfficeAddress, type: 'text' },
            { path: 'brand.tagline', label: 'Tagline', value: s.brand.tagline, type: 'text' },
          ]}
          onSave={(p, reason) => patch.mutate({ patch: p, reason })}
          saving={patch.isPending}
        />
        <VehicleTypesCard current={s.vehicleTypes} onSave={(rows) => patch.mutate({ patch: { vehicleTypes: rows }, reason: 'Edited vehicle types in admin' })} saving={patch.isPending} />
        <DocumentsCard current={s.driverOnboarding.requiredDocuments} onSave={(rows) => patch.mutate({ patch: { driverOnboarding: { requiredDocuments: rows } }, reason: 'Edited required documents in admin' })} saving={patch.isPending} />
      </div>
      <p className="mt-4 text-[12px] text-slate-400">SOS numbers: {s.safety.sosNumbers.join(', ')} (editable via PATCH safety.sosNumbers).</p>
    </>
  );
}

type VehicleRow = PlatformSettings['vehicleTypes'][number];

function VehicleTypesCard({ current, onSave, saving }: { current: VehicleRow[]; onSave: (rows: VehicleRow[]) => void; saving: boolean }) {
  const [rows, setRows] = useState<VehicleRow[]>(current);
  const [dirty, setDirty] = useState(false);
  const update = (i: number, patch: Partial<VehicleRow>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const valid = rows.every((r) => /^[a-z0-9_]+$/.test(r.key) && r.label.trim().length > 0) && new Set(rows.map((r) => r.key)).size === rows.length;
  return (
    <Card
      title="Vehicle types"
      actions={<Button size="sm" disabled={!dirty || !valid || saving} onClick={() => { onSave(rows); setDirty(false); }}>Save</Button>}
    >
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label="Key" placeholder="key (e.g. e_rickshaw)" className="w-36 font-mono text-[12px]" value={row.key} onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            <Input aria-label="Label" placeholder="Label shown to customers" value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" checked={row.active} onChange={(e) => update(i, { active: e.target.checked })} /> active</label>
            <button className="text-[12px] text-red-600 hover:underline" onClick={() => { setRows((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}>Remove</button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => { setRows((r) => [...r, { key: '', label: '', active: true }]); setDirty(true); }}>Add vehicle type</Button>
        {!valid ? <p className="text-[12px] text-red-600">Keys must be unique lowercase snake_case and every row needs a label.</p> : (
          <p className="text-[12px] text-slate-400">Deactivating a type hides it from customers and blocks new registrations with it; existing drivers keep working.</p>
        )}
      </div>
    </Card>
  );
}

type DocRow = PlatformSettings['driverOnboarding']['requiredDocuments'][number];

function DocumentsCard({ current, onSave, saving }: { current: DocRow[]; onSave: (rows: DocRow[]) => void; saving: boolean }) {
  const [rows, setRows] = useState<DocRow[]>(current);
  const [dirty, setDirty] = useState(false);
  const update = (i: number, patch: Partial<DocRow>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const valid = rows.every((r) => /^[a-z0-9_]+$/.test(r.key) && r.label.trim().length > 0) && new Set(rows.map((r) => r.key)).size === rows.length;
  return (
    <Card
      title="Driver onboarding documents"
      actions={<Button size="sm" disabled={!dirty || !valid || saving} onClick={() => { onSave(rows); setDirty(false); }}>Save</Button>}
      className="lg:col-span-2"
    >
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label="Key" className="w-36 font-mono text-[12px]" value={row.key} onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            <Input aria-label="Label" className="max-w-64" value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" checked={row.required} onChange={(e) => update(i, { required: e.target.checked })} /> required</label>
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" checked={row.expiryTracked} onChange={(e) => update(i, { expiryTracked: e.target.checked })} /> tracks expiry</label>
            <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" checked={row.blocksEligibilityWhenInvalid} onChange={(e) => update(i, { blocksEligibilityWhenInvalid: e.target.checked })} /> blocks when invalid</label>
            <button className="text-[12px] text-red-600 hover:underline" onClick={() => { setRows((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}>Remove</button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => { setRows((r) => [...r, { key: '', label: '', required: true, expiryTracked: false, blocksEligibilityWhenInvalid: true }]); setDirty(true); }}>Add document</Button>
        {!valid ? <p className="text-[12px] text-red-600">Keys must be unique lowercase snake_case and every row needs a label.</p> : (
          <p className="text-[12px] text-slate-400">Changes apply to NEW submissions immediately; drivers already approved are not retroactively blocked unless a tracked document expires.</p>
        )}
      </div>
    </Card>
  );
}

type FieldDef =
  | { path: string; label: string; value: number; type: 'number' }
  | { path: string; label: string; value: string; type: 'text' }
  | { path: string; label: string; value: boolean; type: 'boolean' }
  | { path: string; label: string; value: string; type: 'select'; options: string[] };

function setDeep(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    node[key] = (node[key] as Record<string, unknown>) ?? {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}

function SectionForm({ title, fields, onSave, saving }: { title: string; fields: FieldDef[]; onSave: (patch: unknown, reason?: string) => void; saving: boolean }) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const dirty = Object.keys(draft).length > 0;
  const current = (f: FieldDef) => (f.path in draft ? draft[f.path] : f.value);

  return (
    <Card
      title={title}
      actions={
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            const patch: Record<string, unknown> = {};
            for (const [path, value] of Object.entries(draft)) setDeep(patch, path, value);
            onSave(patch, `Edited ${title} in admin`);
            setDraft({});
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.path}>
            {f.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <input type="checkbox" checked={current(f) as boolean} onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.checked }))} />
                {f.label}
              </label>
            ) : f.type === 'select' ? (
              <Field label={f.label}>
                <Select className="w-full" value={current(f) as string} onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label={f.label}>
                <Input
                  type={f.type}
                  value={String(current(f))}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.path]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
                />
              </Field>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
