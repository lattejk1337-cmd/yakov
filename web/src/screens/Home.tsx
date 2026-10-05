import type { CSSProperties } from 'react';
import { Avatar } from '../components/Avatar';
import { CountUp } from '../components/CountUp';
import { CurrencyIcon } from '../components/CurrencyIcon';
import { Icon, type IconName } from '../components/Icon';
import { OperationRow } from '../components/OperationRow';
import type { AssetInfo, Me } from '../lib/api';
import { look } from '../lib/currencies';
import { approx, greeting, money } from '../lib/format';
import { formatNumber, NBSP } from '../lib/money';
import { useNav } from '../lib/nav';
import { useHistory } from '../lib/queries';
import { telegram } from '../lib/telegram';

export function Home({
  me,
  selected,
  onSelect,
  displayCurrency,
  hidden,
  onToggleHidden,
}: {
  me: Me;
  selected: string;
  onSelect: (code: string) => void;
  displayCurrency: string;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const nav = useNav();
  const asset = me.assets.find((a) => a.code === selected) ?? me.assets[0]!;
  const name = me.user.firstName || me.user.username || '';

  // Total in the display currency: market-rate estimate, display only. Empty accounts never
  // need a rate; a non-empty one without a rate makes the total unknown rather than wrong.
  let total: number | null = 0;
  for (const a of me.assets) {
    const bal = me.balances[a.code] ?? '0';
    if (Number(bal) === 0) continue;
    const v = a.code === displayCurrency ? Number(bal) : approx(bal, a.code, displayCurrency, me.prices);
    if (v === null) {
      total = null;
      break;
    }
    total += v;
  }
  const dispSymbol = look(displayCurrency).glyph;

  const actions: Array<{ label: string; icon: IconName; onClick: () => void; accent?: boolean }> = [
    { label: 'Пополнить', icon: 'plus', accent: true, onClick: () => nav.open({ name: 'deposit', asset: asset.code }) },
    { label: 'Вывести', icon: 'up', onClick: () => nav.open({ name: 'withdraw', asset: asset.code }) },
    { label: 'Обменять', icon: 'swap', onClick: () => nav.setTab('exchange') },
  ];

  return (
    <div className="page">
      <header className="home-head">
        <button className="home-head__user press" onClick={() => nav.setTab('profile')}>
          <Avatar name={name} photoUrl={me.user.photoUrl} size={44} />
          <span>
            <span className="caption">{greeting()}</span>
            <span className="home-head__name">{name}</span>
          </span>
        </button>
        <button className="icon-btn glass press" onClick={onToggleHidden} aria-label={hidden ? 'Показать балансы' : 'Скрыть балансы'}>
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </header>

      <section className="total glass glass--strong" aria-label="Общий баланс">
        <span className="caption">Общий баланс</span>
        <div className="total__value">
          {hidden ? (
            <span className="masked">•••••</span>
          ) : total === null ? (
            <span className="total__na">Курсы обновляются…</span>
          ) : (
            <>
              <span className="total__approx">≈</span>
              <CountUp value={total} format={(n) => `${formatNumber(n.toFixed(2), 2)}${NBSP}${dispSymbol}`} />
            </>
          )}
        </div>
        <span className="total__hint caption">
          {me.assets.length} {me.assets.length === 1 ? 'валюта' : 'валюты'} · по курсу CryptoBot
        </span>
      </section>

      <div className="cards" role="listbox" aria-label="Счета">
        {me.assets.map((a, i) => (
          <CurrencyCard
            key={a.code}
            asset={a}
            balance={me.balances[a.code] ?? '0'}
            selected={a.code === asset.code}
            hidden={hidden}
            index={i}
            onClick={() => {
              telegram.haptic.select();
              onSelect(a.code);
            }}
          />
        ))}
      </div>

      <div className="actions">
        {actions.map((a) => (
          <button key={a.label} className={`action glass press${a.accent ? ' action--accent' : ''}`} onClick={a.onClick}>
            <span className="action__icon">
              <Icon name={a.icon} size={22} stroke={2.2} />
            </span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <Recent me={me} hidden={hidden} />
    </div>
  );
}

function CurrencyCard({
  asset,
  balance,
  selected,
  hidden,
  index,
  onClick,
}: {
  asset: AssetInfo;
  balance: string;
  selected: boolean;
  hidden: boolean;
  index: number;
  onClick: () => void;
}) {
  const l = look(asset.code);
  return (
    <button
      role="option"
      aria-selected={selected}
      className={`card glass press${selected ? ' is-selected' : ''}`}
      style={{ '--c1': l.from, '--c2': l.to, animationDelay: `${index * 60}ms` } as CSSProperties}
      onClick={onClick}
    >
      <span className="card__glow" aria-hidden="true" />
      <span className="card__top">
        <CurrencyIcon code={asset.code} size={36} />
        <span className="card__code">{asset.code}</span>
      </span>
      <span className="card__name">{asset.name}</span>
      <span className="card__balance">{hidden ? '•••' : money(balance, asset.code, asset)}</span>
    </button>
  );
}

function Recent({ me, hidden }: { me: Me; hidden: boolean }) {
  const nav = useNav();
  const history = useHistory();
  const items = (history.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 5);
  const assets = new Map(me.assets.map((a) => [a.code, a]));

  return (
    <section className="section">
      <div className="section__head">
        <span className="section__title">Последние операции</span>
        {items.length > 0 && (
          <button className="link-btn" onClick={() => nav.setTab('history')}>
            Все
          </button>
        )}
      </div>
      {history.isPending ? (
        <div className="list glass">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel-row">
              <span className="skel skel--circle" />
              <span className="skel skel--line" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty glass">
          <span className="empty__icon">
            <Icon name="sparkle" size={28} />
          </span>
          <b>Здесь появятся операции</b>
          <span>Пополните любой счёт — это займёт минуту</span>
        </div>
      ) : (
        <div className="list glass">
          {items.map((op) => (
            <OperationRow
              key={op.id}
              op={op}
              assets={assets}
              hidden={hidden}
              onClick={() => nav.open({ name: 'operation', kind: op.type, id: op.id })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
