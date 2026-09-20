'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Spinner, Table } from '@/components/ui';

interface Area {
  _id: string;
  name: string;
  city: string;
  kind: 'polygon' | 'circle';
  center?: { lat: number; lng: number };
  radiusKm?: number;
  active: boolean;
}

const EMPTY = { name: '', city: '', lat: '', lng: '', radiusKm: '' };

export default function ServiceAreasPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['service-areas'], queryFn: () => api<{ items: Area[] }>('/admin/service-areas') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api('/admin/service-areas', {
        method: 'POST',
        body: { name: form.name, city: form.city, kind: 'circle', center: { lat: Number(form.lat), lng: Number(form.lng) }, radiusKm: Number(form.radiusKm), active: true },
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['service-areas'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Save failed'),
  });

  const toggle = useMutation({
    mutationFn: (a: Area) => api(`/admin/service-areas/${a._id}`, { method: 'PUT', body: { active: !a.active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['service-areas'] }),
  });

  return (
    <>
      <PageHeader
        title="Service areas"
        sub="Cities and zones where Relax Go operates. Circle zones here; polygon zones can be posted via the API (map-drawing editor on the roadmap)."
        actions={<Button onClick={() => setOpen(true)}>New circle zone</Button>}
      />
      <Card>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No service areas defined" hint="Without zones the platform serves every location; add zones to restrict or price by area." />
        ) : (
          <Table headers={['Name', 'City', 'Kind', 'Geometry', 'Status', '']}>
            {q.data.items.map((a) => (
              <tr key={a._id}>
                <td className="font-medium text-slate-900">{a.name}</td>
                <td>{a.city}</td>
                <td>{a.kind}</td>
                <td className="text-[12px] text-slate-500">{a.kind === 'circle' && a.center ? `${a.center.lat.toFixed(4)}, ${a.center.lng.toFixed(4)} · ${a.radiusKm} km` : 'polygon'}</td>
                <td><Badge value={a.active ? 'active' : 'cancelled'} /></td>
                <td><button className="text-[12px] font-medium text-brand-600 hover:underline" onClick={() => toggle.mutate(a)}>{a.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="New circle zone">
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="City"><Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Center lat"><Input type="number" step="0.0001" value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} /></Field>
            <Field label="Center lng"><Input type="number" step="0.0001" value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} /></Field>
            <Field label="Radius (km)"><Input type="number" step="0.5" value={form.radiusKm} onChange={(e) => setForm((f) => ({ ...f, radiusKm: e.target.value }))} /></Field>
          </div>
          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.name || !form.city || !form.lat || !form.lng || !form.radiusKm || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
