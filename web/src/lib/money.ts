/**
 * Exact decimal arithmetic for the UI. Amounts travel as strings ("12.5")
 * and are compared/added as bigint minor units — never as floats.
 */

export function toUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return 0n;
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

export function fromUnits(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / base}${frac ? `.${frac}` : ''}`;
}

const NNBSP = ' ';

/** "1248.5" → { int: "1 248", frac: "50" } with a fixed number of fraction digits. */
export function splitDisplay(value: string, fractionDigits: number): { int: string; frac: string } {
  const [i = '0', f = ''] = value.replace(/^-/, '').split('.');
  const int = i.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return { int, frac: f.padEnd(fractionDigits, '0').slice(0, fractionDigits) };
}

export function formatDisplay(value: string, fractionDigits: number): string {
  const { int, frac } = splitDisplay(value, fractionDigits);
  return `${value.startsWith('-') ? '−' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Applies a keypad key to the typed amount, enforcing a sane format. */
export function applyKey(current: string, key: string, maxFraction: number, maxInt = 9): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') {
    if (maxFraction === 0 || current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }
  if (!/^\d$/.test(key)) return current;
  const [int = '', frac] = current.split('.');
  if (frac !== undefined) return frac.length >= maxFraction ? current : current + key;
  if (int === '0') return key; // replace a lone leading zero
  if (int.length >= maxInt) return current;
  return current + key;
}

/** Trims a typed value for submission: "12." → "12", "" → "0". */
export function normalize(value: string): string {
  const v = value.replace(/\.$/, '');
  return v === '' ? '0' : v;
}
