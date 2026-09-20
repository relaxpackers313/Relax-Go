'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Select, Spinner, Table } from '@/components/ui';

interface Rule {
  _id: string;
  name: string;
  active: boolean;
  priority: number;
  pricePaise: number;
  match: { vehicleType?: string; city?: string; driverCategory?: string; hourFrom?: number; hourTo?: number };
}

interface PublicConfig {
  vehicleTypes: { key: string; label: string }[];
}

const EMPTY = { name: '', priority: '10', priceRupees: '', vehicleType: '', city: '', hourFrom: '', hourTo: '', active: true };

export default function PricingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pricing-rules'], queryFn: () => api<{ items: Rule[] }>('/admin/pricing-rules') });
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => api<PublicConfig>('/config') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({
    name: form.name,
    active: form.active,
    priority: Number(form.priority) || 0,
    pricePaise: Math.round(Number(form.priceRupees) * 100),
    match: {
      ...(form.vehicleType ? { vehicleType: form.vehicleType } : {}),
      ...(form.city ? { city: form.city } : {}),
      ...(form.hourFrom !== '' && form.hourTo !== '' ? { hourFrom: Number(form.hourFrom), hourTo: Number(form.hourTo) } : {}),
    },
  });

  const save = useMutation({
    mutationFn: () => (editing ? api(`/admin/pricing-rules/${editing}`, { method: 'PUT', body: body() }) : api('/admin/pricing-rules', { method: 'POST', body: body() })),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      setEditing(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['pricing-rules'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Save failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/pricing-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pricing-rules'] }),
  });

  const startEdit = (r: Rule) => {
    setEditing(r._id);
    setForm({
      name: r.name,
      priority: String(r.priority),
      priceRupees: String(r.pricePaise / 100),
      vehicleType: r.match.vehicleType ?? '',
      city: r.match.city ?? '',
      hourFrom: r.match.hourFrom != null ? String(r.match.hourFrom) : '',
      hourTo: r.match.hourTo != null ? String(r.match.hourTo) : '',
      active: r.active,
    });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Call pricing rules"
        sub="Highest priority active rule that matches a call wins; the base price in Settings is the fallback. Every change is audited."
        actions={<Button onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}>New rule</Button>}
      />
      <Card>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No pricing rules" hint='Without rules every paid call costs the base price from Settings. Example rule: "Auto leads ₹5".' />
        ) : (
          <Table headers={['Rule', 'Matches', 'Price / call', 'Priority', 'Status', '']}>
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <td className="font-medium text-slate-900">{r.name}</td>
                <td className="text-[12px] text-slate-500">
                  {[
                    r.match.vehicleType && `vehicle: ${r.match.vehicleType}`,
                    r.match.city && `city: ${r.match.city}`,
                    r.match.hourFrom != null && `hours ${r.match.hourFrom}–${r.match.hourTo}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'everything'}
                </td>
                <td className="font-semibold">{formatMoney(r.pricePaise)}</td>
                <td>{r.priority}</td>
                <td><Badge value={r.active ? 'active' : 'cancelled'} /></td>
                <td className="space-x-2">
                  <button className="text-[12px] font-medium text-brand-600 hover:underline" onClick={() => startEdit(r)}>Edit</button>
                  <button
                    className="text-[12px] font-medium text-red-600 hover:underline"
                    onClick={() => window.confirm(`Delete rule "${r.name}"?`) && remove.mutate(r._id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit pricing rule' : 'New pricing rule'}>
        <div className="space-y-3">
          <Field label="Name" hint='e.g. "Auto leads ₹5" or "Night calls in Cuttack"'>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price per call (₹)">
              <Input type="number" step="0.5" min="0" value={form.priceRupees} onChange={(e) => setForm((f) => ({ ...f, priceRupees: e.target.value }))} />
            </Field>
            <Field label="Priority" hint="Higher wins">
              <Input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vehicle type (optional)">
              <Select value={form.vehicleType} onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))} className="w-full">
                <option value="">Any</option>
                {cfg.data?.vehicleTypes.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Select>
            </Field>
            <Field label="City (optional)">
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hour from (0–23, optional)">
              <Input type="number" min="0" max="23" value={form.hourFrom} onChange={(e) => setForm((f) => ({ ...f, hourFrom: e.target.value }))} />
            </Field>
            <Field label="Hour to (1–24)">
              <Input type="number" min="1" max="24" value={form.hourTo} onChange={(e) => setForm((f) => ({ ...f, hourTo: e.target.value }))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active
          </label>
          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.name || form.priceRupees === '' || save.isPending} onClick={() => save.mutate()}>
              {editing ? 'Save changes' : 'Create rule'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
