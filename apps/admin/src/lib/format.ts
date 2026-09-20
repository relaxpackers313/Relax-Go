export { formatMoney } from '@relaxgo/shared';

export const formatDateTime = (value: string | Date | null | undefined): string =>
  value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const formatDate = (value: string | Date | null | undefined): string =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const timeAgo = (value: string | Date): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const titleCase = (v: string): string => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
