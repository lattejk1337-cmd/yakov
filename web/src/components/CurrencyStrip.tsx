import type { AssetInfo } from '../lib/api';
import { telegram } from '../lib/telegram';
import { CurrencyIcon } from './CurrencyIcon';

/** Horizontal glass chips to switch the currency of a flow. */
export function CurrencyStrip({ assets, value, onChange }: { assets: AssetInfo[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="strip" role="tablist">
      {assets.map((a) => (
        <button
          key={a.code}
          role="tab"
          aria-selected={a.code === value}
          className={`strip__chip glass press${a.code === value ? ' is-active' : ''}`}
          onClick={() => {
            telegram.haptic.select();
            onChange(a.code);
          }}
        >
          <CurrencyIcon code={a.code} size={24} />
          {a.code}
        </button>
      ))}
    </div>
  );
}
