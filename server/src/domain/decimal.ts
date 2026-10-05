/**
 * Fixed-point decimals (bigint scaled by 10^18) for exchange rates and prices.
 * Rates never touch floats on the money path.
 */
export const SCALE = 10n ** 18n;
const SCALE_DIGITS = 18;

export function parseDecimal(input: string): bigint {
  let s = String(input).trim();
  if (/e/i.test(s)) s = Number(s).toFixed(SCALE_DIGITS); // providers occasionally send 1e-7
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid decimal: ${input}`);
  const frac = (m[2] ?? '').slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0');
  return BigInt(m[1]!) * SCALE + BigInt(frac);
}

/** Formats a scaled decimal with up to `digits` fractional digits (trailing zeros trimmed). */
export function formatDecimal(value: bigint, digits: number): string {
  const step = 10n ** BigInt(SCALE_DIGITS - digits);
  const rounded = (value + step / 2n) / step; // round half up for display only
  const base = 10n ** BigInt(digits);
  const frac = (rounded % base).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${rounded / base}${frac ? `.${frac}` : ''}`;
}

/**
 * Converts minor units between assets using their USD prices (scaled). Rounds down,
 * so the wallet never hands out more than the market value.
 */
export function convertUnits(
  units: bigint,
  from: { decimals: number; price: bigint },
  to: { decimals: number; price: bigint },
): bigint {
  return (units * from.price * 10n ** BigInt(to.decimals)) / (10n ** BigInt(from.decimals) * to.price);
}
