/** Visual identity of each currency: gradient, glyph and a word for UI copy. */
export interface CurrencyLook {
  from: string;
  to: string;
  glyph: string;
  /** Aurora tint used on the background while this currency is selected. */
  aurora: [string, string, string];
}

const LOOKS: Record<string, CurrencyLook> = {
  RUB: { from: '#3d7bff', to: '#7a5cff', glyph: '₽', aurora: ['#2f6bff', '#7a5cff', '#00c2ff'] },
  USD: { from: '#21c06a', to: '#0fa3a3', glyph: '$', aurora: ['#16b864', '#0fa3a3', '#9be15d'] },
  EUR: { from: '#5b6cff', to: '#b05cff', glyph: '€', aurora: ['#5b6cff', '#b05cff', '#ff7ac6'] },
  CNY: { from: '#ff4d4d', to: '#ffb02e', glyph: '¥', aurora: ['#ff4d4d', '#ffb02e', '#ff7a59'] },
  TON: { from: '#0098ea', to: '#45d0ff', glyph: '◆', aurora: ['#0098ea', '#45d0ff', '#6b7cff'] },
  USDT: { from: '#1fa27b', to: '#55d6a8', glyph: '₮', aurora: ['#1fa27b', '#55d6a8', '#2dd4bf'] },
};

const FALLBACK: CurrencyLook = { from: '#8e8e93', to: '#636366', glyph: '¤', aurora: ['#5e5ce6', '#64d2ff', '#bf5af2'] };

export const look = (code: string): CurrencyLook => LOOKS[code] ?? FALLBACK;

/** Currencies a user can choose to see their total balance in. */
export const DISPLAY_CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];

/** Short symbol for amounts: ₽ $ € ¥, crypto by ticker. */
export const symbolOf = (code: string): string => (code === 'TON' || code === 'USDT' ? code : look(code).glyph);
