'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner, Table } from '@/components/ui';

interface CustomerRow {
  _id: string;
  phone?: string;
  name?: string;
  blocked: boolean;
  blockedReason?: string;
  deviceInfo?: { platform?: string; appVersion?: string };
  lastSeenAt: string;
  createdAt: string;
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['customers', page],
    queryFn: () => api<{ items: CustomerRow[]; total: number; limit: number }>(`/admin/customers?page=${page}`),
  });
  const block = useMutation({
    mutationFn: (input: { id: string; blocked: boolean; reason?: string }) =>
      api(`/admin/customers/${input.id}/block`, { method: 'POST', body: { blocked: input.blocked, reason: input.reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  return (
    <>
      <PageHeader title="Customers" sub="Anonymous customer sessions — no signup required, so identity is device + optional phone." />
      <Card>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No customers yet" hint="A session is created the first time someone opens the customer app." />
        ) : (
          <>
            <Table headers={['Session', 'Phone', 'Platform', 'Last seen', 'Status', '']}>
              {q.data.items.map((c) => (
                <tr key={c._id}>
                  <td className="font-mono text-[12px]">{c._id.slice(-8)}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{c.deviceInfo?.platform ?? '—'}{c.deviceInfo?.appVersion ? ` · ${c.deviceInfo.appVersion}` : ''}</td>
                  <td>{formatDateTime(c.lastSeenAt)}</td>
                  <td>{c.blocked ? <Badge value="blocked" /> : <Badge value="active" />}</td>
                  <td>
                    {c.blocked ? (
                      <Button size="sm" variant="secondary" onClick={() => block.mutate({ id: c._id, blocked: false })}>Unblock</Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          const reason = window.prompt('Reason for blocking this customer:');
                          if (reason) block.mutate({ id: c._id, blocked: true, reason });
                        }}
                      >
                        Block
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
              <span>{q.data.total} sessions</span>
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
