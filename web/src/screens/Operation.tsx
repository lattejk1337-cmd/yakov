import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { api, type AssetInfo, type Deposit, type Operation as Op, type Withdrawal } from '../lib/api';
import { dateTime, fmt, shortId } from '../lib/format';
import { useNav } from '../lib/nav';
import { keys, useMe, useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';

/** Refetches immediately when the user comes back from the payment bot. */
function useRefetchOnReturn(refetch: () => void) {
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refetch();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refetch]);
}

export function OperationScreen({ kind, id }: { kind: 'deposit' | 'withdrawal'; id: string }) {
  const me = useMe();
  const refresh = useRefreshWallet();
  const query = useQuery<Op>({
    queryKey: kind === 'deposit' ? keys.deposit(id) : keys.withdrawal(id),
    queryFn: () => (kind === 'deposit' ? api.deposit(id) : api.withdrawal(id)),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'pending' || s === 'created' || s === 'processing' ? 3000 : false;
    },
  });
  useRefetchOnReturn(query.refetch);

  // Celebrate (and refresh the balance) when a pending operation settles while we watch.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = query.data?.status;
    const was = prevStatus.current;
    prevStatus.current = s;
    if (!was || was === s) return;
    if (s === 'paid' || s === 'completed') telegram.haptic.notify('success');
    if (s === 'failed') telegram.haptic.notify('error');
    refresh();
  }, [query.data?.status, refresh]);

  const op = query.data;
  const asset = me.data?.assets.find((a) => a.code === op?.asset);

  if (query.isError) {
    return (
      <div className="receipt-wrap center">
        <div className="pin__title">Операция не найдена</div>
        <p className="muted">{query.error.message}</p>
      </div>
    );
  }
  if (!op) {
    return (
      <div className="receipt-wrap">
        <div className="skel" style={{ height: 320, borderRadius: 28 }} />
      </div>
    );
  }

  if (op.type === 'deposit' && (op.status === 'pending' || op.status === 'created')) {
    return <AwaitingPayment deposit={op} asset={asset} />;
  }
  return <Receipt op={op} asset={asset} />;
}

function AwaitingPayment({ deposit, asset }: { deposit: Deposit; asset?: AssetInfo }) {
  const nav = useNav();
  return (
    <div className="receipt-wrap">
      <div className="radar" aria-hidden="true">
        <i />
        <i />
        <i />
        <div className="radar__core">
          <Icon name="bolt" size={40} stroke={1.8} />
        </div>
      </div>
      <div className="center">
        <div className="label">Ожидаем оплату</div>
        <div className="receipt__amount">
          {fmt(deposit.amount, asset)} <small>{deposit.asset}</small>
        </div>
        <p className="muted" style={{ margin: '4px auto 26px', maxWidth: 300 }}>
          Оплатите счёт в @CryptoBot — баланс обновится автоматически, как только платёж пройдёт
        </p>
      </div>
      {deposit.payUrl && (
        <button className="btn btn--lime" onClick={() => telegram.openPayment(deposit.payUrl!)}>
          Открыть счёт
        </button>
      )}
      <button className="btn btn--ghost" onClick={nav.home}>
        На главную
      </button>
    </div>
  );
}

const STAMP: Record<string, { text: string; cls: string }> = {
  paid: { text: 'Зачислено', cls: '' },
  completed: { text: 'Выполнено', cls: '' },
  processing: { text: 'В пути', cls: 'stamp--wait' },
  failed: { text: 'Отклонено', cls: 'stamp--bad' },
  expired: { text: 'Истёк', cls: 'stamp--bad' },
};

function Receipt({ op, asset }: { op: Op; asset?: AssetInfo }) {
  const nav = useNav();
  const toast = useToast();
  const stamp = STAMP[op.status] ?? { text: op.status, cls: 'stamp--wait' };
  const isIn = op.type === 'deposit';
  const w = op.type === 'withdrawal' ? (op as Withdrawal) : null;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(op.id);
      telegram.haptic.tap();
      toast('ID операции скопирован');
    } catch {
      toast(op.id);
    }
  };

  return (
    <div className="receipt-wrap">
      <article className="receipt" aria-label="Квитанция">
        <span className={`stamp ${stamp.cls}`}>{stamp.text}</span>
        <div className="label">{isIn ? 'Пополнение' : 'Вывод'}</div>
        <div className="receipt__amount">
          {isIn ? '+' : '−'}
          {fmt(w ? w.amount : op.amount, asset)} <small>{op.asset}</small>
        </div>
        <div className="muted">{isIn ? 'из @CryptoBot' : 'в @CryptoBot'}</div>

        <dl className="receipt__rows">
          {w && (
            <>
              <dt>Комиссия</dt>
              <dd>
                {fmt(w.fee, asset)} {op.asset}
              </dd>
              <dt>Списано</dt>
              <dd>
                {fmt(w.total, asset)} {op.asset}
              </dd>
            </>
          )}
          <dt>Создано</dt>
          <dd>{dateTime(op.createdAt)}</dd>
          {op.type === 'deposit' && op.paidAt && (
            <>
              <dt>Зачислено</dt>
              <dd>{dateTime(op.paidAt)}</dd>
            </>
          )}
          {w?.completedAt && (
            <>
              <dt>Выполнено</dt>
              <dd>{dateTime(w.completedAt)}</dd>
            </>
          )}
          <dt>ID</dt>
          <dd>
            <button className="copy" onClick={() => void copyId()} aria-label="Скопировать ID операции">
              {shortId(op.id)} <Icon name="copy" size={14} />
            </button>
          </dd>
        </dl>

        {w?.status === 'processing' && (
          <div className="receipt__note">
            Перевод обрабатывается. Обычно это занимает несколько секунд — мы пришлём уведомление в чат.
          </div>
        )}
        {w?.status === 'failed' && <div className="receipt__note">{w.failureReason}</div>}
        {op.type === 'deposit' && op.status === 'expired' && (
          <div className="receipt__note">Счёт не был оплачен вовремя. Создайте новое пополнение.</div>
        )}
        <div className="barcode" aria-hidden="true" />
      </article>

      <button className="btn btn--lime" onClick={nav.home}>
        Готово
      </button>
    </div>
  );
}
