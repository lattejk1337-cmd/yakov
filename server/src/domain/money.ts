/**
 * Money is always an integer number of minor units (bigint). Floats never touch balances.
 */

export class InvalidAmountError extends Error {}

/** Parses a user-supplied decimal string ("12.5") into minor units. */
export function parseAmount(input: string, decimals: number, maxFractionDigits = decimals): bigint {
  if (typeof input !== 'string') throw new InvalidAmountError('amount must be a string');
  const s = input.trim();
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(s);
  if (!m) throw new InvalidAmountError('invalid amount format');
  const [, intPart, fracPart = ''] = m;
  if (fracPart.length > maxFractionDigits) {
    throw new InvalidAmountError(`too many fractional digits (max ${maxFractionDigits})`);
  }
  const value = BigInt(intPart!) * 10n ** BigInt(decimals) + BigInt(fracPart.padEnd(decimals, '0') || '0');
  return value;
}

/** Formats minor units as a plain decimal string without trailing zeros ("12.5"). */
export function formatAmount(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}
