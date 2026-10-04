import type { AssetInfo } from './api';
import { formatDisplay } from './money';

export function fmt(value: string, asset: AssetInfo | undefined): string {
  return formatDisplay(value, asset?.inputDecimals ?? 2);
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
