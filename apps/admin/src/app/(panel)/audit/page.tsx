'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState, ErrorState, Input, Spinner, Table } from '@/components/ui';

interface AuditRow {
  _id: string;
  actor: { kind: string; name?: string; id?: string };
  action: string;
  target?: { kind?: string; id?: string };
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: string;
}

const compact = (v: unknown) => {
  if (v == null) return '—';
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

export default function AuditPage() {
  const [action, setAction] = useState('');
  const q = useQuery({
    queryKey: ['audit', action],
    queryFn: () => api<{ items: AuditRow[] }>(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`),
  });

  return (
    <>
      <PageHeader title="Audit log" sub="Sensitive actions with actor, target and old → new values. This log is append-only." />
      <Card>
        <div className="mb-3">
          <Input placeholder="Filter by action, e.g. settings.update or driver.approve" className="max-w-sm" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <Table headers={['When', 'Actor', 'Action', 'Target', 'Before', 'After', 'Reason']}>
            {q.data.items.map((a) => (
              <tr key={a._id}>
                <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                <td>{a.actor.name ?? a.actor.kind}</td>
                <td className="font-mono text-[12px]">{a.action}</td>
                <td className="font-mono text-[11px]">{a.target?.kind ? `${a.target.kind}:${(a.target.id ?? '').slice(-6)}` : '—'}</td>
                <td className="max-w-48 truncate font-mono text-[11px] text-slate-500" title={compact(a.before)}>{compact(a.before)}</td>
                <td className="max-w-48 truncate font-mono text-[11px] text-slate-500" title={compact(a.after)}>{compact(a.after)}</td>
                <td className="max-w-40 truncate">{a.reason ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
