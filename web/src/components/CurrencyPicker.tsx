import type { AssetInfo } from '../lib/api';
import { money } from '../lib/format';
import { telegram } from '../lib/telegram';
import { CurrencyIcon } from './CurrencyIcon';

/** Inline glass list of currencies (used inside a popover). */
export function CurrencyPicker({
  assets,
  balances,
  selected,
  exclude,
  onPick,
}: {
  assets: AssetInfo[];
  balances: Record<string, string>;
  selected: string;
  exclude?: string;
  onPick: (code: string) => void;
}) {
  return (
    <div className="picker glass" role="listbox">
      {assets
        .filter((a) => a.code !== exclude)
        .map((a) => (
          <button
            key={a.code}
            role="option"
            aria-selected={a.code === selected}
            className={`picker__row${a.code === selected ? ' is-selected' : ''}`}
            onClick={() => {
              telegram.haptic.select();
              onPick(a.code);
            }}
          >
            <CurrencyIcon code={a.code} size={34} />
            <span className="picker__name">
              {a.name}
              <small>{a.code}</small>
            </span>
            <span className="picker__bal">{money(balances[a.code] ?? '0', a.code, a)}</span>
          </button>
        ))}
    </div>
  );
}
