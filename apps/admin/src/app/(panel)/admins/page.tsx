'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Dialog, ErrorState, Field, Input, Select, Spinner, Table } from '@/components/ui';

interface AdminRow {
  _id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt?: string;
}

const EMPTY = { name: '', email: '', password: '', role: 'operations' };

export default function AdminsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admins'], queryFn: () => api<{ items: AdminRow[] }>('/admin/admins') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api('/admin/admins', { method: 'POST', body: form }),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admins'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed'),
  });

  const toggle = useMutation({
    mutationFn: (a: AdminRow) => api(`/admin/admins/${a._id}/active`, { method: 'POST', body: { active: !a.active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] }),
    onError: (e) => window.alert(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <>
      <PageHeader
        title="Admin users"
        sub="Roles: superadmin (everything), operations (drivers/leads/map), finance (money), support (tickets). Live-location visibility is permission-gated."
        actions={<Button onClick={() => setOpen(true)}>Add admin</Button>}
      />
      <Card>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : (
          <Table headers={['Name', 'Email', 'Role', 'Last sign-in', 'Status', '']}>
            {q.data.items.map((a) => (
              <tr key={a._id}>
                <td className="font-medium text-slate-900">{a.name}</td>
                <td>{a.email}</td>
                <td className="capitalize">{a.role}</td>
                <td>{formatDateTime(a.lastLoginAt)}</td>
                <td><Badge value={a.active ? 'active' : 'blocked'} /></td>
                <td><button className="text-[12px] font-medium text-brand-600 hover:underline" onClick={() => toggle.mutate(a)}>{a.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add admin user">
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Password" hint="At least 10 characters; share it over a secure channel and ask them to change it.">
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select className="w-full" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {['superadmin', 'operations', 'finance', 'support'].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.name || !form.email || form.password.length < 10 || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
