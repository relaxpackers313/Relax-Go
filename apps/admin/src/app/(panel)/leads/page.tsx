'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LEAD_STATUSES } from '@relaxgo/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Spinner, Table } from '@/components/ui';

interface LeadRow {
  _id: string;
  driverId: string;
  vehicleType: string;
  distanceKm: number;
  status: string;
  pickup: { address?: string };
  createdAt: string;
  contactedAt?: string;
  callIds: string[];
}

export default function LeadsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['leads', status, page],
    queryFn: () => api<{ items: LeadRow[]; total: number; limit: number }>(`/admin/leads?page=${page}${status ? `&status=${status}` : ''}`),
  });

  return (
    <>
      <PageHeader title="Leads" sub="Every customer request pointed at a driver, with its full status trail." />
      <Card>
        <div className="mb-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No leads yet" hint="Leads appear when a customer requests a driver from the app." />
        ) : (
          <>
            <Table headers={['Created', 'Pickup', 'Vehicle', 'Driver distance', 'Calls', 'Status']}>
              {q.data.items.map((l) => (
                <tr key={l._id}>
                  <td>{formatDateTime(l.createdAt)}</td>
                  <td className="max-w-56 truncate">{l.pickup?.address ?? '—'}</td>
                  <td>{l.vehicleType}</td>
                  <td>{l.distanceKm ? `${l.distanceKm} km` : '—'}</td>
                  <td>{l.callIds?.length ?? 0}</td>
                  <td><Badge value={l.status} /></td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
              <span>{q.data.total} leads</span>
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
