'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, Dialog, ErrorState, Field, Input, Select, Spinner, Table, Textarea } from '@/components/ui';

interface Detail {
  driver: {
    _id: string; fullName?: string; phone: string; email?: string; status: string; statusReason?: string; city?: string;
    address?: string; vehicleType?: string; vehicleModel?: string; registrationNumber?: string;
    rating?: { average: number | null; count: number }; flags?: string[]; approvedAt?: string; createdAt: string;
    emergencyContact?: { name?: string; phone?: string };
  };
  documents: { _id: string; type: string; status: string; fileUrl: string; number?: string; expiresAt?: string; rejectionReason?: string; supersededBy?: string; createdAt: string }[];
  wallet: { balancePaise: number; freeCredits: number; promoCredits: number } | null;
  registration: { status: string; readyForReview: boolean; documents: { type: string; label: string; required: boolean; status: string }[] };
}

const DECISIONS = [
  { action: 'approve', label: 'Approve', variant: 'primary' as const, needsReason: false },
  { action: 'request_correction', label: 'Request correction', variant: 'secondary' as const, needsReason: true },
  { action: 'reject', label: 'Reject', variant: 'danger' as const, needsReason: true },
  { action: 'suspend', label: 'Suspend', variant: 'danger' as const, needsReason: true },
  { action: 'reactivate', label: 'Reactivate', variant: 'primary' as const, needsReason: false },
  { action: 'block', label: 'Block', variant: 'danger' as const, needsReason: true },
];

export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['driver', id], queryFn: () => api<Detail>(`/admin/drivers/${id}`) });
  const walletQ = useQuery({
    queryKey: ['driver-wallet', id],
    queryFn: () => api<{ transactions: { _id: string; kind: string; amountPaise: number; credits: number; note?: string; createdAt: string }[] }>(`/admin/wallets/${id}`),
    retry: false,
  });

  const [decision, setDecision] = useState<{ action: string; label: string; needsReason: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState({ kind: 'balance', amount: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (input: { action: string; reason?: string }) => api(`/admin/drivers/${id}/decision`, { method: 'POST', body: input }),
    onSuccess: () => {
      setDecision(null);
      setReason('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['driver', id] });
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed'),
  });

  const reviewDoc = useMutation({
    mutationFn: (input: { documentId: string; decision: 'verified' | 'rejected'; reason?: string }) =>
      api(`/admin/drivers/documents/${input.documentId}/review`, { method: 'POST', body: { decision: input.decision, reason: input.reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['driver', id] }),
  });

  const doAdjust = useMutation({
    mutationFn: () =>
      api(`/admin/wallets/${id}/adjust`, {
        method: 'POST',
        body: { kind: adjust.kind, amount: adjust.kind === 'balance' ? Math.round(Number(adjust.amount) * 100) : Math.round(Number(adjust.amount)), reason: adjust.reason },
      }),
    onSuccess: () => {
      setAdjustOpen(false);
      setAdjust({ kind: 'balance', amount: '', reason: '' });
      void qc.invalidateQueries({ queryKey: ['driver', id] });
      void qc.invalidateQueries({ queryKey: ['driver-wallet', id] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Adjustment failed'),
  });

  if (q.isPending) return <Spinner label="Loading driver…" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { driver, documents, wallet, registration } = q.data;
  const activeDocs = documents.filter((d) => !d.supersededBy);

  return (
    <>
      <PageHeader
        title={driver.fullName ?? driver.phone}
        sub={`${driver.phone}${driver.email ? ` · ${driver.email}` : ''} · joined ${formatDate(driver.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {DECISIONS.filter((d) => {
              if (d.action === 'approve') return ['pending', 'correction_required'].includes(driver.status);
              if (d.action === 'reactivate') return driver.status === 'suspended';
              if (d.action === 'request_correction' || d.action === 'reject') return ['pending', 'correction_required'].includes(driver.status);
              if (d.action === 'suspend') return driver.status === 'approved';
              if (d.action === 'block') return driver.status !== 'blocked';
              return false;
            }).map((d) => (
              <Button key={d.action} size="sm" variant={d.variant} onClick={() => (d.needsReason ? setDecision(d) : decide.mutate({ action: d.action }))} disabled={decide.isPending}>
                {d.label}
              </Button>
            ))}
          </div>
        }
      />
      {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}
      {driver.status !== 'approved' && !registration.readyForReview ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          Not ready for approval: required documents are missing or rejected.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-2 text-[13px]">
            <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><Badge value={driver.status} /></dd></div>
            {driver.statusReason ? <div className="flex justify-between gap-4"><dt className="text-slate-500">Reason</dt><dd className="text-right">{driver.statusReason}</dd></div> : null}
            <div className="flex justify-between"><dt className="text-slate-500">City</dt><dd>{driver.city ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Address</dt><dd className="text-right">{driver.address ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Vehicle</dt><dd>{driver.vehicleType ? `${driver.vehicleType} · ${driver.vehicleModel ?? ''} · ${driver.registrationNumber}` : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Rating</dt><dd>{driver.rating?.count ? `${driver.rating.average} ★ (${driver.rating.count})` : 'No ratings yet'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Emergency contact</dt><dd>{driver.emergencyContact?.name ? `${driver.emergencyContact.name} (${driver.emergencyContact.phone})` : '—'}</dd></div>
            {driver.flags?.length ? <div className="flex justify-between"><dt className="text-slate-500">Flags</dt><dd>{driver.flags.map((f) => <Badge key={f} value={f} className="ml-1" />)}</dd></div> : null}
          </dl>
        </Card>

        <Card
          title="Wallet"
          actions={<Button size="sm" variant="secondary" onClick={() => setAdjustOpen(true)}>Adjust</Button>}
        >
          {wallet ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between"><dt className="text-slate-500">Balance</dt><dd className="font-semibold">{formatMoney(wallet.balancePaise)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Free credits</dt><dd>{wallet.freeCredits}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Promo credits</dt><dd>{wallet.promoCredits}</dd></div>
            </dl>
          ) : (
            <p className="text-[13px] text-slate-400">No wallet yet.</p>
          )}
          <h3 className="mb-1 mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Recent transactions</h3>
          {walletQ.data?.transactions?.length ? (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto text-[12px]">
              {walletQ.data.transactions.slice(0, 20).map((t) => (
                <li key={t._id} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                  <span className="text-slate-600">{titleCase(t.kind)}{t.note ? ` — ${t.note}` : ''}</span>
                  <span className="shrink-0 font-medium">{t.amountPaise ? formatMoney(t.amountPaise) : `${t.credits > 0 ? '+' : ''}${t.credits} cr`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-slate-400">No transactions.</p>
          )}
        </Card>

        <Card title="Documents">
          {activeDocs.length === 0 ? (
            <p className="text-[13px] text-slate-400">Nothing uploaded yet.</p>
          ) : (
            <ul className="space-y-3">
              {activeDocs.map((doc) => (
                <li key={doc._id} className="rounded-md border border-slate-200 p-2.5 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{titleCase(doc.type)}</span>
                    <Badge value={doc.status} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    {doc.number ? `No. ${doc.number} · ` : ''}
                    {doc.expiresAt ? `expires ${formatDate(doc.expiresAt)} · ` : ''}
                    uploaded {formatDateTime(doc.createdAt)}
                  </p>
                  {doc.rejectionReason ? <p className="text-[12px] text-red-600">Rejected: {doc.rejectionReason}</p> : null}
                  <div className="mt-1.5 flex gap-2">
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium text-brand-600 hover:underline">View file</a>
                    {doc.status === 'pending' ? (
                      <>
                        <button className="text-[12px] font-medium text-emerald-600 hover:underline" onClick={() => reviewDoc.mutate({ documentId: doc._id, decision: 'verified' })}>Verify</button>
                        <button
                          className="text-[12px] font-medium text-red-600 hover:underline"
                          onClick={() => {
                            const r = window.prompt('Reason for rejecting this document:');
                            if (r) reviewDoc.mutate({ documentId: doc._id, decision: 'rejected', reason: r });
                          }}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={!!decision} onClose={() => setDecision(null)} title={decision?.label ?? ''}>
        <Field label="Reason (shown to the driver)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim() || decide.isPending} onClick={() => decision && decide.mutate({ action: decision.action, reason })}>
            Confirm {decision?.label.toLowerCase()}
          </Button>
        </div>
      </Dialog>

      <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Adjust wallet">
        <div className="space-y-3">
          <Field label="What to adjust">
            <Select value={adjust.kind} onChange={(e) => setAdjust((a) => ({ ...a, kind: e.target.value }))} className="w-full">
              <option value="balance">Balance (₹)</option>
              <option value="free_credits">Free credits</option>
              <option value="promo_credits">Promo credits</option>
            </Select>
          </Field>
          <Field label={adjust.kind === 'balance' ? 'Amount in rupees (negative to deduct)' : 'Credits (negative to deduct)'}>
            <Input type="number" step={adjust.kind === 'balance' ? '0.01' : '1'} value={adjust.amount} onChange={(e) => setAdjust((a) => ({ ...a, amount: e.target.value }))} />
          </Field>
          <Field label="Reason (required, goes to the audit log)">
            <Input value={adjust.reason} onChange={(e) => setAdjust((a) => ({ ...a, reason: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button disabled={!adjust.amount || !adjust.reason.trim() || doAdjust.isPending} onClick={() => doAdjust.mutate()}>Apply</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
