import type { AssetInfo, Operation } from '../lib/api';
import { money, time } from '../lib/format';
import { CurrencyIcon } from './CurrencyIcon';
import { Icon } from './Icon';

export function OperationRow({
  op,
  assets,
  hidden,
  onClick,
}: {
  op: Operation;
  assets: Map<string, AssetInfo>;
  hidden?: boolean;
  onClick: () => void;
}) {
  const mask = (s: string) => (hidden ? '•••' : s);
  if (op.type === 'exchange') {
    return (
      <button className="op press" onClick={onClick}>
        <span className="op__icon op__icon--swap">
          <CurrencyIcon code={op.fromAsset} size={28} />
          <CurrencyIcon code={op.toAsset} size={28} />
        </span>
        <span className="op__body">
          <span className="op__title">
            Обмен {op.fromAsset} → {op.toAsset}
          </span>
          <span className="op__meta">{time(op.createdAt)}</span>
        </span>
        <span className="op__amount">
          <span className="is-plus">+{mask(money(op.toAmount, op.toAsset, assets.get(op.toAsset)))}</span>
          <small>−{mask(money(op.fromAmount, op.fromAsset, assets.get(op.fromAsset)))}</small>
        </span>
      </button>
    );
  }
  const isIn = op.type === 'deposit';
  const failed = op.type === 'withdrawal' && op.status === 'failed';
  const waiting = op.type === 'withdrawal' && op.status === 'processing';
  const a = assets.get(op.asset);
  return (
    <button className="op press" onClick={onClick}>
      <span className="op__icon">
        <CurrencyIcon code={op.asset} size={40} />
        <span className={`op__badge ${isIn ? 'is-in' : 'is-out'}`}>
          <Icon name={isIn ? 'down' : 'up'} size={11} stroke={3} />
        </span>
      </span>
      <span className="op__body">
        <span className="op__title">{isIn ? 'Пополнение' : 'Вывод'}</span>
        <span className="op__meta">
          {waiting && <span className="dot dot--wait" />}
          {failed && <span className="dot dot--bad" />}
          {time(op.createdAt)}
          {waiting && ' · в обработке'}
          {failed && ' · отменён, средства вернулись'}
        </span>
      </span>
      <span className={`op__amount${failed ? ' is-void' : ''}`}>
        <span className={isIn ? 'is-plus' : ''}>
          {isIn ? '+' : '−'}
          {mask(money(isIn ? op.amount : op.total, op.asset, a))}
        </span>
      </span>
    </button>
  );
}
