import type { CSSProperties } from 'react';
import { formatNumber } from '../lib/money';

/** Big typed amount with a blinking caret and the currency symbol. */
export function AmountField({ value, symbol, error }: { value: string; symbol: string; error?: boolean }) {
  const shown = value === '' ? '0' : formatNumber(value.replace(/\.$/, ''), 0, 9) + (value.endsWith('.') ? ',' : '');
  return (
    <div
      className={`amount-field${value === '' ? ' is-empty' : ''}${error ? ' is-error' : ''}`}
      style={{ '--len': shown.length + symbol.length } as CSSProperties}
      aria-live="polite"
    >
      <span className="amount-field__num">
        {shown}
        <span className="caret" />
      </span>
      <span className="amount-field__sym">{symbol}</span>
    </div>
  );
}
