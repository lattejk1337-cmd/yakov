import type { CSSProperties } from 'react';
import { look } from '../lib/currencies';

/**
 * Slowly drifting colour fields behind the glass. The tint follows the selected currency,
 * so frosted surfaces pick up its colour (that is what makes glass read as glass).
 */
export function Aurora({ currency = 'RUB' }: { currency?: string }) {
  const [a, b, c] = look(currency).aurora;
  return (
    <div className="aurora" aria-hidden="true" style={{ '--a1': a, '--a2': b, '--a3': c } as CSSProperties}>
      <i className="aurora__blob aurora__blob--1" />
      <i className="aurora__blob aurora__blob--2" />
      <i className="aurora__blob aurora__blob--3" />
      <i className="aurora__grain" />
    </div>
  );
}
