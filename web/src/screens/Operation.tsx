import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { CurrencyIcon } from '../components/CurrencyIcon';
import { Icon } from '../components/Icon';
import { Success } from '../components/Success';
import { useToast } from '../components/Toast';
import { api, type Me, type Operation } from '../lib/api';
import { symbolOf } from '../lib/currencies';
import { dateTime, money, shortId } from '../lib/format';
import { formatNumber } from '../lib/money';
import { useNav } from '../lib/nav';
import { keys, useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';
import { AwaitPayment } from './Deposit';

export function OperationView({ me, kind, id }: { me: Me; kind: 'deposit' | 'withdrawal' | 'exchange'; id: string }) {
  const refresh = useRefreshWallet();
  const q = useQuery<Operation>({
    queryKey: keys.op(kind, id),
    queryFn: () => (kind === 'deposit' ? api.deposit(id) : kind === 'withdrawal' ? api.withdrawal(id) : api.exchangeById(id)),
    refetchInterval: (s) => (s.state.data?.status === 'processing' ? 3000 : false),
  });

  // Refresh balances and buzz when a pending withdrawal settles while the receipt is open.
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = q.data?.status;
    if (prev.current && prev.current !== s) {
      telegram.haptic.notify(s === 'failed' ? 'error' : 'success');
      refresh();
    }
    prev.current = s;
  }, [q.data?.status, refresh]);

  if (q.isError) {
    return (
      <div className="flow flow--center">
        <Success kind="fail" />
        <h2 className="result__title">Операция не найдена</h2>
      </div>
    );
  }
  if (!q.data) return <div className="flow flow--center"><span className="spinner spinner--big" /></div>;
  const op = q.data;
  if (op.type === 'deposit' && (op.status === 'pending' || op.status === 'created')) return <AwaitPayment deposit={op} me={me} />;
  return <Receipt op={op} me={me} />;
}

function Receipt({ op, me }: { op: Operation; me: Me }) {
  const nav = useNav();
  const toast = useToast();
  const asset = (c: string) => me.assets.find((a) => a.code === c);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(op.id);
      toast('Номер операции скопирован');
    } catch {
      toast(op.id);
    }
  };

  let kind: 'ok' | 'wait' | 'fail' = 'ok';
  let title = '';
  let amount = '';
  const rows: Array<[string, string]> = [];

  if (op.type === 'deposit') {
    kind = op.status === 'paid' ? 'ok' : 'fail';
    title = op.status === 'paid' ? 'Пополнение зачислено' : 'Счёт не оплачен';
    amount = `+${money(op.amount, op.asset, asset(op.asset))}`;
    rows.push(['Способ', '@CryptoBot']);
    if (op.paidAt) rows.push(['Зачислено', dateTime(op.paidAt)]);
  } else if (op.type === 'withdrawal') {
    kind = op.status === 'completed' ? 'ok' : op.status === 'failed' ? 'fail' : 'wait';
    title = op.status === 'completed' ? 'Вывод выполнен' : op.status === 'failed' ? 'Вывод отменён' : 'Вывод в обработке';
    amount = `−${money(op.amount, op.asset, asset(op.asset))}`;
    rows.push(['Получено в @CryptoBot', money(op.payoutAmount, op.payoutAsset)]);
    rows.push(['Комиссия', money(op.fee, op.asset, asset(op.asset))]);
    rows.push(['Списано всего', money(op.total, op.asset, asset(op.asset))]);
    if (op.completedAt) rows.push(['Выполнено', dateTime(op.completedAt)]);
  } else {
    title = 'Обмен выполнен';
    amount = `+${money(op.toAmount, op.toAsset, asset(op.toAsset))}`;
    rows.push(['Отдано', money(op.fromAmount, op.fromAsset, asset(op.fromAsset))]);
    rows.push(['Курс', `1 ${symbolOf(op.fromAsset)} = ${formatNumber(op.rate, 2, 6)} ${symbolOf(op.toAsset)}`]);
    rows.push(['Комиссия', money(op.fee, op.toAsset, asset(op.toAsset))]);
  }
  rows.push(['Создано', dateTime(op.createdAt)]);

  return (
    <div className="flow">
      <div className="receipt glass glass--strong">
        <Success kind={kind} confetti={false} />
        <div className="receipt__title">{title}</div>
        <div className="receipt__amount">
          {op.type === 'exchange' ? (
            <span className="receipt__pair">
              <CurrencyIcon code={op.fromAsset} size={26} />
              <Icon name="chevronRight" size={16} />
              <CurrencyIcon code={op.toAsset} size={26} />
            </span>
          ) : (
            <CurrencyIcon code={op.asset} size={26} />
          )}
          {amount}
        </div>
        <dl className="receipt__rows">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Номер</dt>
            <dd>
              <button className="copy" onClick={() => void copy()}>
                {shortId(op.id)} <Icon name="copy" size={14} />
              </button>
            </dd>
          </div>
        </dl>
        {op.type === 'withdrawal' && op.status === 'processing' && (
          <p className="receipt__note">Перевод обрабатывается — обычно это несколько секунд. Мы пришлём уведомление в чат.</p>
        )}
        {op.type === 'withdrawal' && op.status === 'failed' && <p className="receipt__note">{op.failureReason}</p>}
      </div>
      <button className="btn btn--primary" onClick={nav.closeAll}>
        Готово
      </button>
    </div>
  );
}
