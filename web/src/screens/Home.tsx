import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { Odometer } from '../components/Odometer';
import type { AssetInfo, Me, Operation } from '../lib/api';
import { dayLabel, fmt, greeting, time } from '../lib/format';
import { splitDisplay, toUnits } from '../lib/money';
import { useNav } from '../lib/nav';
import { usePref } from '../lib/prefs';
import { useHistory, useMe } from '../lib/queries';
import { telegram } from '../lib/telegram';

const TICKS = 36;

export function Home() {
  const me = useMe();
  const [hidden, setHidden] = usePref('hideBalance', false);
  const [selected, setSelected] = usePref<string | null>('asset', null);

  if (!me.data) return <HomeSkeleton />;
  const data = me.data;
  const asset = data.assets.find((a) => a.code === selected) ?? data.assets[0]!;

  return (
    <>
      <TopBar me={data} />

      <div className="tabs" role="tablist" aria-label="Актив">
        {data.assets.map((a) => (
          <button
            key={a.code}
            role="tab"
            className="tab"
            aria-selected={a.code === asset.code}
            onClick={() => {
              telegram.haptic.select();
              setSelected(a.code);
            }}
          >
            {a.code}
          </button>
        ))}
      </div>

      <BalanceTicket
        asset={asset}
        balance={data.balances[asset.code] ?? '0'}
        withdrawn={data.withdrawnToday[asset.code] ?? '0'}
        hidden={hidden}
        onToggleHidden={() => {
          telegram.haptic.tap();
          setHidden(!hidden);
        }}
      />

      <Actions me={data} asset={asset} />
      <Feed assets={data.assets} />
    </>
  );
}

function TopBar({ me }: { me: Me }) {
  const nav = useNav();
  const initial = (me.user.firstName || me.user.username || '?').trim().charAt(0).toUpperCase();
  return (
    <header className="topbar">
      <div className="avatar" aria-hidden="true">
        {me.user.photoUrl ? <img src={me.user.photoUrl} alt="" referrerPolicy="no-referrer" /> : initial}
      </div>
      <div className="topbar__hello">
        <div className="label">{greeting()}</div>
        <div className="topbar__name">{me.user.firstName || me.user.username}</div>
      </div>
      <button className="icon-btn" aria-label="Безопасность" onClick={() => nav.push({ name: 'security' })}>
        <Icon name="shield" />
        {!me.security.hasPin && <span className="icon-btn__badge" aria-label="PIN не установлен" />}
      </button>
    </header>
  );
}

function BalanceTicket({
  asset,
  balance,
  withdrawn,
  hidden,
  onToggleHidden,
}: {
  asset: AssetInfo;
  balance: string;
  withdrawn: string;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const { int, frac } = splitDisplay(balance, asset.inputDecimals);
  const limit = toUnits(asset.dailyWithdrawLimit, asset.decimals);
  const used = toUnits(withdrawn, asset.decimals);
  const left = limit > used ? limit - used : 0n;
  const lit = limit > 0n ? Number((left * BigInt(TICKS)) / limit) : 0;
  const leftStr = splitDisplay((left / 10n ** BigInt(asset.decimals)).toString(), 0).int;

  return (
    <section className="ticket" aria-label={`Баланс ${asset.code}`}>
      <div className="ticket__main">
        <div className="ticket__row">
          <span className="label">Баланс</span>
          <button className="eye" onClick={onToggleHidden} aria-label={hidden ? 'Показать баланс' : 'Скрыть баланс'}>
            <Icon name={hidden ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>

        <div className="balance" style={{ '--len': int.length + 2 } as CSSProperties}>
          {hidden ? (
            <span className="balance__hidden">••••</span>
          ) : (
            <>
              <Odometer value={int} />
              {frac && (
                <span className="balance__frac">
                  .<Odometer value={frac} />
                </span>
              )}
            </>
          )}
        </div>

        <div className="ruler" aria-hidden="true">
          {Array.from({ length: TICKS }, (_, i) => (
            <i key={i} className={i < lit ? 'on' : undefined} />
          ))}
        </div>
        <div className="ruler-caption">
          <span className="label">Лимит / 24ч</span>
          <span className="label">
            {hidden ? '••' : leftStr} / {splitDisplay(asset.dailyWithdrawLimit, 0).int}
          </span>
        </div>
      </div>

      <div className="ticket__stub" aria-hidden="true">
        <span className="ticket__serial">№ {asset.name.toUpperCase()}</span>
        <span className="ticket__code">{asset.code}</span>
      </div>
    </section>
  );
}

function Actions({ me, asset }: { me: Me; asset: AssetInfo }) {
  const nav = useNav();
  const withdraw = () => {
    const target = { name: 'amount', mode: 'withdraw', asset: asset.code } as const;
    nav.push(me.security.hasPin ? target : { name: 'pin-setup', then: target });
  };
  return (
    <div className="actions">
      <button className="action action--in" onClick={() => nav.push({ name: 'amount', mode: 'deposit', asset: asset.code })}>
        <span className="action__icon">
          <Icon name="down" />
        </span>
        <span>
          <div className="action__title">Пополнить</div>
          <div className="action__hint">через CryptoBot</div>
        </span>
      </button>
      <button className="action action--out" onClick={withdraw}>
        <span className="action__icon">
          <Icon name="up" />
        </span>
        <span>
          <div className="action__title">Вывести</div>
          <div className="action__hint">
            комиссия {fmt(asset.withdrawFee, asset)} {asset.code}
          </div>
        </span>
      </button>
    </div>
  );
}

function Feed({ assets }: { assets: AssetInfo[] }) {
  const history = useHistory();
  const nav = useNav();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const byCode = new Map(assets.map((a) => [a.code, a]));

  let lastDay = '';
  return (
    <section className="feed" aria-label="История операций">
      <div className="label">Движение средств</div>

      {history.isPending && (
        <div style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 52, marginBottom: 10 }} />
          ))}
        </div>
      )}

      {history.isSuccess && items.length === 0 && (
        <div className="empty">
          <div className="empty__art" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="label">Пока пусто</div>
          <div style={{ marginTop: 6 }}>Пополните кошелёк — операции появятся здесь</div>
        </div>
      )}

      {items.map((op) => {
        const day = dayLabel(op.createdAt);
        const header = day !== lastDay ? day : null;
        lastDay = day;
        return (
          <div key={op.id}>
            {header && <div className="label feed__day">{header}</div>}
            <OperationRow
              op={op}
              asset={byCode.get(op.asset)}
              onClick={() => nav.push({ name: 'operation', kind: op.type, id: op.id })}
            />
          </div>
        );
      })}

      {history.hasNextPage && (
        <button className="more" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
          {history.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
}

function OperationRow({ op, asset, onClick }: { op: Operation; asset?: AssetInfo; onClick: () => void }) {
  const isIn = op.type === 'deposit';
  const failed = op.type === 'withdrawal' && op.status === 'failed';
  const waiting = op.type === 'withdrawal' && op.status === 'processing';
  const amount = isIn ? op.amount : op.total;

  return (
    <button className="op" onClick={onClick}>
      <span className={`op__icon ${isIn ? 'op__icon--in' : 'op__icon--out'}`}>
        <Icon name={isIn ? 'down' : 'up'} size={20} />
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="op__title">{isIn ? 'Пополнение' : 'Вывод'}</div>
        <div className="op__meta">
          {waiting && <span className="dot dot--wait" />}
          {failed && <span className="dot dot--bad" />}
          {time(op.createdAt)}
          {waiting && ' · в обработке'}
          {failed && ' · возвращено'}
          {!waiting && !failed && ' · CryptoBot'}
        </div>
      </span>
      <span className={`op__amount${isIn ? ' op__amount--plus' : ''}${failed ? ' op__amount--void' : ''}`}>
        {isIn ? '+' : '−'}
        {fmt(amount, asset)}
        <small>{op.asset}</small>
      </span>
    </button>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      <div className="topbar">
        <div className="skel" style={{ width: 42, height: 42, borderRadius: 14 }} />
        <div style={{ flex: 1 }}>
          <div className="skel" style={{ width: 90, height: 10, marginBottom: 8 }} />
          <div className="skel" style={{ width: 140, height: 16 }} />
        </div>
      </div>
      <div className="skel" style={{ width: 130, height: 38, borderRadius: 999 }} />
      <div className="skel" style={{ height: 190, borderRadius: 28, marginTop: 14 }} />
      <div className="actions">
        <div className="skel" style={{ height: 116, borderRadius: 28 }} />
        <div className="skel" style={{ height: 116, borderRadius: 28 }} />
      </div>
    </div>
  );
}
