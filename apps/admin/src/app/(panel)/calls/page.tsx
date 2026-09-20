'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Spinner, Table } from '@/components/ui';

interface CallRow {
  _id: string;
  driverId: string;
  status: string;
  durationSeconds?: number;
  initiatedAt: string;
  billing: { classification: string; amountPaise: number; freeSource?: string; settled: boolean };
}

export default function CallsPage() {
  const [classification, setClassification] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['calls', classification, page],
    queryFn: () => api<{ items: CallRow[]; total: number; limit: number }>(`/admin/calls?page=${page}${classification ? `&classification=${classification}` : ''}`),
  });

  return (
    <>
      <PageHeader title="Calls" sub="Every tracked customer contact and how it was billed." />
      <Card>
        <div className="mb-3">
          <Select value={classification} onChange={(e) => { setClassification(e.target.value); setPage(1); }} aria-label="Filter by billing">
            <option value="">All billing types</option>
            <option value="free">Free</option>
            <option value="promo">Promo</option>
            <option value="paid">Paid</option>
            <option value="unbilled">Unbilled</option>
          </Select>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No calls yet" hint="Calls are recorded when a driver contacts a customer through the app." />
        ) : (
          <>
            <Table headers={['Initiated', 'Outcome', 'Duration', 'Billing', 'Charge', 'Source']}>
              {q.data.items.map((c) => (
                <tr key={c._id}>
                  <td>{formatDateTime(c.initiatedAt)}</td>
                  <td><Badge value={c.status} /></td>
                  <td>{c.durationSeconds != null ? `${c.durationSeconds}s` : '—'}</td>
                  <td><Badge value={c.billing.classification} /></td>
                  <td>{c.billing.amountPaise ? formatMoney(c.billing.amountPaise) : '—'}</td>
                  <td>{c.billing.freeSource ?? '—'}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
              <span>{q.data.total} calls</span>
              <span className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page * q.data.limit >= q.data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
