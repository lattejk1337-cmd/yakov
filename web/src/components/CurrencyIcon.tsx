import type { CSSProperties } from 'react';
import { look } from '../lib/currencies';

export function CurrencyIcon({ code, size = 40 }: { code: string; size?: number }) {
  const l = look(code);
  return (
    <span
      className="cur-icon"
      style={{ width: size, height: size, fontSize: size * 0.48, '--c1': l.from, '--c2': l.to } as CSSProperties}
      aria-hidden="true"
    >
      {l.glyph}
    </span>
  );
}
