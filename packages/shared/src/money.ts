/**
 * Money is ALWAYS integer paise (minor units of INR). Rupee values exist only at the
 * display/input boundary. Percentages, when they appear, are basis points (bps).
 */

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

export const paiseToRupees = (paise: number): number => paise / 100;

export function assertPaise(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be integer paise, got ${value}`);
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** "₹2", "₹2.50", "₹1,20,000" — for app screens and emails. */
export function formatMoney(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}₹${inr.format(rupees)}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`;
}

/** Same as formatMoney but without the currency symbol (documents/CSV). */
export function formatMoneyPlain(paise: number): string {
  return formatMoney(paise).replace('₹', '');
}

export function applyBps(paise: number, bps: number): number {
  assertPaise(paise);
  return Math.round((paise * bps) / 10_000);
}
