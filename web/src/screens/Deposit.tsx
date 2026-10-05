import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AmountField } from '../components/AmountField';
import { CurrencyStrip } from '../components/CurrencyStrip';
import { Keypad } from '../components/Keypad';
import { Success } from '../components/Success';
import { useToast } from '../components/Toast';
import { ApiError, api, type Deposit, type Me, newIdempotencyKey } from '../lib/api';
import { symbolOf } from '../lib/currencies';
import { money } from '../lib/format';
import { applyKey, formatNumber, fromUnits, normalize, toUnits } from '../lib/money';
import { useNav } from '../lib/nav';
import { keys, useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';

export function DepositFlow({ me, asset: initial, onCurrency }: { me: Me; asset: string; onCurrency: (c: string) => void }) {
  const toast = useToast();
  const refresh = useRefreshWallet();
  const [code, setCode] = useState(initial);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const key = useRef<string | null>(null);
  const a = me.assets.find((x) => x.code === code) ?? me.assets[0]!;

  useEffect(() => onCurrency(code), [code, onCurrency]);

  if (deposit) return <AwaitPayment deposit={deposit} me={me} onPaid={refresh} />;

  const units = toUnits(normalize(value), a.decimals);
  const min = toUnits(a.minDeposit, a.decimals);
  const max = toUnits(a.maxDeposit, a.decimals);
  const error = value !== '' && units < min ? `Минимум ${money(a.minDeposit, code, a)}` : units > max ? `Максимум ${money(a.maxDeposit, code, a)}` : null;
  const presets = [5n, 10n, 50n, 100n].map((k) => min * k).filter((v) => v <= max);

  const start = async () => {
    setBusy(true);
    telegram.guardClosing(true);
    try {
      key.current ??= newIdempotencyKey();
      const dep = await api.createDeposit(code, normalize(value), key.current);
      key.current = null;
      if (dep.payUrl) telegram.openPayment(dep.payUrl);
      setDeposit(dep);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code !== 'NETWORK') key.current = null;
      toast(err?.message ?? 'Не удалось создать счёт', 'error');
    } finally {
      telegram.guardClosing(false);
      setBusy(false);
    }
  };

  return (
    <div className="flow">
      <CurrencyStrip
        assets={me.assets}
        value={code}
        onChange={(c) => {
          setCode(c);
          setValue('');
          key.current = null;
        }}
      />
      <div className="flow__amount">
        <AmountField value={value} symbol={symbolOf(code)} error={Boolean(error)} />
        <div className={`flow__hint${error ? ' is-error' : ''}`}>
          {error ?? (a.kind === 'fiat' ? 'Оплата в USDT или TON по курсу CryptoBot' : `от ${money(a.minDeposit, code, a)}`)}
        </div>
      </div>
      <div className="chips">
        {presets.map((p) => (
          <button
            key={p.toString()}
            className="chip glass press"
            onClick={() => {
              telegram.haptic.select();
              setValue(fromUnits(p, a.decimals));
              key.current = null;
            }}
          >
            {formatNumber(fromUnits(p, a.decimals), 0, a.inputDecimals)} {symbolOf(code)}
          </button>
        ))}
      </div>
      <Keypad
        onKey={(k) => {
          setValue((v) => applyKey(v, k, a.inputDecimals));
          key.current = null;
        }}
        allowDot={a.inputDecimals > 0}
      />
      <button className="btn btn--primary" disabled={value === '' || units === 0n || Boolean(error) || busy} onClick={() => void start()}>
        {busy ? <span className="spinner" /> : 'Оплатить через CryptoBot'}
      </button>
    </div>
  );
}

/** Watches an invoice until it is paid; refetches as soon as the user returns from @CryptoBot. */
export function AwaitPayment({ deposit, me, onPaid }: { deposit: Deposit; me: Me; onPaid?: () => void }) {
  const nav = useNav();
  const a = me.assets.find((x) => x.code === deposit.asset);
  const q = useQuery({
    queryKey: keys.op('deposit', deposit.id),
    queryFn: () => api.deposit(deposit.id),
    initialData: deposit,
    refetchInterval: (s) => (s.state.data?.status === 'pending' || s.state.data?.status === 'created' ? 3000 : false),
  });
  const status = q.data.status;

  const { refetch } = q;
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refetch();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);

  useEffect(() => {
    if (status === 'paid') {
      telegram.haptic.notify('success');
      onPaid?.();
    }
  }, [status, onPaid]);

  if (status === 'paid') {
    return (
      <div className="flow flow--center">
        <Success />
        <h2 className="result__title">Зачислено</h2>
        <p className="result__amount">+{money(q.data.amount, q.data.asset, a)}</p>
        <button className="btn btn--primary" onClick={nav.closeAll}>
          Готово
        </button>
      </div>
    );
  }
  if (status === 'expired' || status === 'failed') {
    return (
      <div className="flow flow--center">
        <Success kind="fail" />
        <h2 className="result__title">{status === 'expired' ? 'Счёт истёк' : 'Счёт не создан'}</h2>
        <p className="result__sub">Создайте новое пополнение</p>
        <button className="btn btn--primary" onClick={nav.close}>
          Понятно
        </button>
      </div>
    );
  }
  return (
    <div className="flow flow--center">
      <div className="pulse" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="pulse__core glass">{symbolOf(q.data.asset)}</span>
      </div>
      <h2 className="result__title">Ждём оплату</h2>
      <p className="result__amount">{money(q.data.amount, q.data.asset, a)}</p>
      <p className="result__sub">Оплатите счёт в @CryptoBot — баланс обновится сам, как только платёж пройдёт</p>
      {q.data.payUrl && (
        <button className="btn btn--primary" onClick={() => telegram.openPayment(q.data.payUrl!)}>
          Открыть счёт
        </button>
      )}
      <button className="btn btn--ghost glass" onClick={nav.closeAll}>
        На главную
      </button>
    </div>
  );
}
