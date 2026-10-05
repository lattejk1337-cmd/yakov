import { useEffect, useRef, useState } from 'react';
import { AmountField } from '../components/AmountField';
import { CurrencyStrip } from '../components/CurrencyStrip';
import { Keypad } from '../components/Keypad';
import { type PinFeedback, PinEntry } from '../components/PinEntry';
import { SlideToConfirm } from '../components/SlideToConfirm';
import { useToast } from '../components/Toast';
import { ApiError, api, type Me, newIdempotencyKey } from '../lib/api';
import { symbolOf } from '../lib/currencies';
import { approx, approxString, money } from '../lib/format';
import { applyKey, floorTo, formatNumber, fromUnits, normalize, toUnits } from '../lib/money';
import { useNav } from '../lib/nav';
import { useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';

export function WithdrawFlow({ me, asset: initial, onCurrency }: { me: Me; asset: string; onCurrency: (c: string) => void }) {
  const nav = useNav();
  const toast = useToast();
  const refresh = useRefreshWallet();
  const [code, setCode] = useState(initial);
  const [value, setValue] = useState('');
  const [stage, setStage] = useState<'amount' | 'pin'>('amount');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<PinFeedback | null>(null);
  const key = useRef<string | null>(null);
  const a = me.assets.find((x) => x.code === code) ?? me.assets[0]!;

  useEffect(() => onCurrency(code), [code, onCurrency]);

  const u = (s: string) => toUnits(s, a.decimals);
  const units = u(normalize(value));
  const fee = u(a.withdrawFee);
  const balance = u(me.balances[code] ?? '0');
  const dailyLeft = u(a.dailyWithdrawLimit) - u(me.withdrawnToday[code] ?? '0');
  let max = u(a.maxWithdraw);
  if (balance - fee < max) max = balance - fee;
  if (dailyLeft < max) max = dailyLeft;
  if (max < 0n) max = 0n;
  max = floorTo(max, a.decimals, a.inputDecimals);

  const error =
    value === ''
      ? null
      : units < u(a.minWithdraw)
        ? `Минимум ${money(a.minWithdraw, code, a)}`
        : units + fee > balance
          ? 'Недостаточно средств с учётом комиссии'
          : units > dailyLeft
            ? 'Превышен суточный лимит'
            : units > u(a.maxWithdraw)
              ? `Максимум за раз ${money(a.maxWithdraw, code, a)}`
              : null;
  const valid = value !== '' && units > 0n && !error;

  // What arrives in @CryptoBot: fiat is paid out in USDT at the market rate minus the spread.
  let payout: string | null = null;
  if (valid) {
    if (a.payoutAsset === code) payout = money(fromUnits(units, a.decimals), code, a);
    else {
      const est = approx(fromUnits(units, a.decimals), code, a.payoutAsset, me.prices);
      if (est !== null) {
        payout = `≈ ${formatNumber(approxString(est * (1 - Number(me.exchangeFeePercent) / 100)), 2)} ${a.payoutAsset}`;
      }
    }
  }

  const submit = async (pin: string) => {
    setBusy(true);
    telegram.guardClosing(true);
    try {
      key.current ??= newIdempotencyKey();
      const w = await api.createWithdrawal(code, normalize(value), pin, key.current);
      refresh();
      nav.replace({ name: 'operation', kind: 'withdrawal', id: w.id });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'PIN_INVALID') {
        setFeedback({ kind: 'error', message: `Неверный код · осталось попыток: ${err.details?.attemptsLeft}`, seq: Date.now() });
      } else if (err?.code === 'NETWORK') {
        setFeedback({ kind: 'error', message: err.message, seq: Date.now() });
      } else {
        key.current = null;
        toast(err?.message ?? 'Не удалось создать вывод', 'error');
        setStage('amount');
        refresh();
      }
    } finally {
      telegram.guardClosing(false);
      setBusy(false);
    }
  };

  if (stage === 'pin') {
    return (
      <div className="flow flow--pin">
        <PinEntry
          length={4}
          title="Подтвердите вывод"
          subtitle={`${money(fromUnits(units, a.decimals), code, a)} → @CryptoBot`}
          feedback={feedback}
          busy={busy}
          onComplete={(pin) => void submit(pin)}
        />
        <button className="link-btn" onClick={() => setStage('amount')}>
          Изменить сумму
        </button>
      </div>
    );
  }

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
          {error ?? (
            <button className="link-btn" onClick={() => setValue(fromUnits(max, a.decimals))}>
              Доступно {money(fromUnits(max, a.decimals), code, a)}
            </button>
          )}
        </div>
      </div>

      <div className="summary glass">
        <div className="summary__row">
          <span>Комиссия</span>
          <b>{money(a.withdrawFee, code, a)}</b>
        </div>
        <div className="summary__row">
          <span>Спишется</span>
          <b>{money(fromUnits(units + fee, a.decimals), code, a)}</b>
        </div>
        <div className="summary__row summary__row--accent">
          <span>Получите в @CryptoBot</span>
          <b>{payout ?? '—'}</b>
        </div>
      </div>

      <Keypad
        onKey={(k) => {
          setValue((v) => applyKey(v, k, a.inputDecimals));
          key.current = null;
        }}
        allowDot={a.inputDecimals > 0}
      />
      <SlideToConfirm
        key={`${code}:${value}`}
        label={valid ? 'Проведите для вывода' : 'Введите сумму'}
        disabled={!valid}
        onConfirm={() => {
          setFeedback(null);
          setStage('pin');
        }}
      />
    </div>
  );
}
