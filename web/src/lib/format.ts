import type { AssetInfo } from './api';
import { symbolOf } from './currencies';
import { formatNumber, NBSP } from './money';

/** Fraction digits shown for a currency: cents for fiat, up to 3 for crypto. */
function fracFor(code: string, a?: Pick<AssetInfo, 'kind' | 'inputDecimals'>): [number, number] {
  if (a?.kind === 'crypto' || code === 'TON' || code === 'USDT') return [2, a?.inputDecimals ?? 3];
  return [2, 2];
}

/** "1 248,50 ₽", "12,5 TON". */
export function money(value: string, code: string, a?: Pick<AssetInfo, 'kind' | 'inputDecimals' | 'symbol'>): string {
  const [min, max] = fracFor(code, a);
  const symbol = a?.symbol ?? symbolOf(code);
  return `${formatNumber(value, min, max)}${NBSP}${symbol}`;
}

/** Converts for display only (total balance, hints). Not used for anything that moves money. */
export function approx(value: string, from: string, to: string, prices: Record<string, string> | null): number | null {
  if (!prices) return null;
  const pf = Number(prices[from]);
  const pt = Number(prices[to]);
  if (!pf || !pt) return null;
  return (Number(value) * pf) / pt;
}

export function approxString(n: number, decimals = 2): string {
  return (Math.floor(n * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return dayFmt.format(d);
}

export const time = (iso: string) => timeFmt.format(new Date(iso));
export const dateTime = (iso: string) => fullFmt.format(new Date(iso));

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}
