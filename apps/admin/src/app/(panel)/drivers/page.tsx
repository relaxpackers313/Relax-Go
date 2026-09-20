'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Spinner, Table } from '@/components/ui';

interface DriverRow {
  _id: string;
  fullName?: string;
  phone: string;
  city?: string;
  status: string;
  vehicleType?: string;
  registrationNumber?: string;
  rating?: { average: number | null; count: number };
  createdAt: string;
}

function DriversInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['drivers', status, search, page],
    queryFn: () =>
      api<{ items: DriverRow[]; total: number; limit: number }>(
        `/admin/drivers?page=${page}${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <>
      <PageHeader title="Drivers" sub="Search, review and manage every registered driver." />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Search name, phone or vehicle number…" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {['pending', 'approved', 'rejected', 'correction_required', 'suspended', 'blocked'].map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No drivers match" hint="Drivers appear here as soon as they sign in with their phone number." />
        ) : (
          <>
            <Table headers={['Driver', 'Phone', 'City', 'Vehicle', 'Rating', 'Status', 'Registered', '']}>
              {q.data.items.map((d) => (
                <tr key={d._id} className="hover:bg-slate-50">
                  <td className="font-medium text-slate-900">{d.fullName ?? <span className="text-slate-400">Not submitted</span>}</td>
                  <td>{d.phone}</td>
                  <td>{d.city ?? '—'}</td>
                  <td>{d.vehicleType ? `${d.vehicleType} · ${d.registrationNumber ?? ''}` : '—'}</td>
                  <td>{d.rating?.count ? `${d.rating.average} ★ (${d.rating.count})` : '—'}</td>
                  <td><Badge value={d.status} /></td>
                  <td>{formatDateTime(d.createdAt)}</td>
                  <td>
                    <Link href={`/drivers/${d._id}`} className="font-medium text-brand-600 hover:underline">Open</Link>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
              <span>{q.data.total} drivers</span>
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

export default function DriversPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DriversInner />
    </Suspense>
  );
}
