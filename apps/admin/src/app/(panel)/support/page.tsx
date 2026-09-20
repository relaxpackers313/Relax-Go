'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Select, Spinner, Table, Textarea } from '@/components/ui';

interface Ticket {
  _id: string;
  raisedBy: { kind: string; id: string };
  category: string;
  subject: string;
  status: string;
  messages: { from: { kind: string }; body: string; at: string }[];
  updatedAt: string;
}

export default function SupportPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');

  const q = useQuery({
    queryKey: ['tickets', status],
    queryFn: () => api<{ items: Ticket[] }>(`/admin/support${status ? `?status=${status}` : ''}`),
  });

  const act = useMutation({
    mutationFn: (input: { id: string; reply?: string; status?: string; assign?: boolean }) =>
      api(`/admin/support/${input.id}`, { method: 'POST', body: input }),
    onSuccess: () => {
      setReply('');
      setOpenTicket(null);
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return (
    <>
      <PageHeader title="Support" sub="Tickets from drivers and customers. Replies land in their in-app inbox." />
      <Card>
        <div className="mb-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {['open', 'assigned', 'escalated', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No tickets" hint="New driver and customer issues will appear here." />
        ) : (
          <Table headers={['Updated', 'From', 'Category', 'Subject', 'Messages', 'Status', '']}>
            {q.data.items.map((t) => (
              <tr key={t._id}>
                <td>{formatDateTime(t.updatedAt)}</td>
                <td className="capitalize">{t.raisedBy.kind}</td>
                <td>{titleCase(t.category)}</td>
                <td className="max-w-56 truncate font-medium text-slate-900">{t.subject}</td>
                <td>{t.messages.length}</td>
                <td><Badge value={t.status} /></td>
                <td><button className="text-[12px] font-medium text-brand-600 hover:underline" onClick={() => setOpenTicket(t)}>Open</button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={!!openTicket} onClose={() => setOpenTicket(null)} title={openTicket?.subject ?? ''}>
        {openTicket ? (
          <div className="space-y-3">
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
              {openTicket.messages.map((m, i) => (
                <div key={i} className={m.from.kind === 'admin' ? 'text-right' : ''}>
                  <p className={`inline-block max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] ${m.from.kind === 'admin' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{m.body}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{m.from.kind} · {formatDateTime(m.at)}</p>
                </div>
              ))}
            </div>
            <Textarea rows={3} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => act.mutate({ id: openTicket._id, assign: true })}>Assign to me</Button>
              <Button variant="secondary" size="sm" onClick={() => act.mutate({ id: openTicket._id, status: 'escalated' })}>Escalate</Button>
              <Button variant="secondary" size="sm" onClick={() => act.mutate({ id: openTicket._id, status: 'resolved', reply: reply || undefined })}>Resolve</Button>
              <Button size="sm" disabled={!reply.trim() || act.isPending} onClick={() => act.mutate({ id: openTicket._id, reply })}>Send reply</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
