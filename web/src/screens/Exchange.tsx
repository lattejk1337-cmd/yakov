import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { CurrencyIcon } from '../components/CurrencyIcon';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { Icon } from '../components/Icon';
import { Keypad } from '../components/Keypad';
import { Success } from '../components/Success';
import { useToast } from '../components/Toast';
import { ApiError, api, type Me, newIdempotencyKey, type Quote } from '../lib/api';
import { symbolOf } from '../lib/currencies';
import { money } from '../lib/format';
import { applyKey, floorTo, formatNumber, fromUnits, normalize, toUnits } from '../lib/money';
import { useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';

interface QuoteState {
  quote: Quote | null;
  error: string | null;
  loading: boolean;
}

export function ExchangeScreen({ me, initialFrom, onCurrency }: { me: Me; initialFrom: string; onCurrency: (c: string) => void }) {
  const toast = useToast();
  const refresh = useRefreshWallet();
  const codes = me.assets.map((a) => a.code);
  const [from, setFrom] = useState(codes.includes(initialFrom) ? initialFrom : codes[0]!);
  const [to, setTo] = useState(() => codes.find((c) => c !== from && c === 'RUB') ?? codes.find((c) => c !== from)!);
  const [amount, setAmount] = useState('');
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [q, setQ] = useState<QuoteState>({ quote: null, error: null, loading: false });
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ from: string; to: string } | null>(null);
  const [spin, setSpin] = useState(0);
  const keyFor = useRef(new Map<string, string>());

  const fromAsset = me.assets.find((a) => a.code === from)!;
  const toAsset = me.assets.find((a) => a.code === to)!;
  const balance = me.balances[from] ?? '0';
  const units = toUnits(normalize(amount), fromAsset.decimals);
  const tooMuch = units > toUnits(balance, fromAsset.decimals);
  const tooLittle = amount !== '' && units < toUnits(fromAsset.minExchange, fromAsset.decimals);

  useEffect(() => onCurrency(from), [from, onCurrency]);

  // Fetch a locked quote shortly after the user stops typing; refresh it when it expires.
  useEffect(() => {
    if (amount === '' || units === 0n || tooLittle) {
      setQ({ quote: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setQ((s) => ({ ...s, loading: true, error: null }));
    const t = window.setTimeout(async () => {
      try {
        const quote = await api.quote(from, to, normalize(amount));
        if (!cancelled) setQ({ quote, error: null, loading: false });
      } catch (e) {
        if (!cancelled) setQ({ quote: null, error: e instanceof ApiError ? e.message : 'Курс недоступен', loading: false });
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [from, to, amount, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!q.quote) return;
    const ms = Date.parse(q.quote.expiresAt) - Date.now() - 1500;
    const t = window.setTimeout(() => setRefreshTick((n) => n + 1), Math.max(1000, ms));
    return () => window.clearTimeout(t);
  }, [q.quote]);

  const swap = () => {
    telegram.haptic.tap('medium');
    setSpin((s) => s + 1);
    setFrom(to);
    setTo(from);
    setAmount('');
  };

  const pick = (code: string) => {
    if (picking === 'from') {
      if (code === to) setTo(from);
      setFrom(code);
      setAmount('');
    } else if (picking === 'to') {
      if (code === from) setFrom(to);
      setTo(code);
    }
    setPicking(null);
  };

  const execute = async () => {
    if (!q.quote) return;
    // The app may have slept in the background past the quote's lifetime: re-quote first.
    if (Date.parse(q.quote.expiresAt) - Date.now() < 1500) {
      setRefreshTick((n) => n + 1);
      toast('Курс обновился — проверьте сумму');
      return;
    }
    setBusy(true);
    const token = q.quote.quoteToken;
    const key = keyFor.current.get(token) ?? newIdempotencyKey();
    keyFor.current.set(token, key);
    try {
      const ex = await api.exchange(token, key);
      telegram.haptic.notify('success');
      setDone({ from: money(ex.fromAmount, ex.fromAsset, fromAsset), to: money(ex.toAmount, ex.toAsset, toAsset) });
      setAmount('');
      refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      telegram.haptic.notify('error');
      if (err?.code === 'QUOTE_EXPIRED') setRefreshTick((n) => n + 1);
      toast(err?.message ?? 'Не удалось выполнить обмен', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="page page--center">
        <Success />
        <h2 className="result__title">Обмен выполнен</h2>
        <p className="result__sub">
          {done.from} → <b>{done.to}</b>
        </p>
        <button className="btn btn--primary" onClick={() => setDone(null)}>
          Готово
        </button>
      </div>
    );
  }

  const rateText = q.quote
    ? `1 ${symbolOf(from)} = ${formatNumber(q.quote.rate, 2, 6)} ${symbolOf(to)}`
    : null;
  const secondsLeft = q.quote ? Math.max(0, (Date.parse(q.quote.expiresAt) - Date.now()) / 1000) : 0;
  const hint = tooMuch
    ? 'Недостаточно средств'
    : tooLittle
      ? `Минимум ${money(fromAsset.minExchange, from, fromAsset)}`
      : q.error;

  return (
    <div className="page page--exchange">
      <h1 className="page__title">Обмен</h1>

      <div className="fx">
        <div className="fx__panel glass">
          <div className="fx__row">
            <span className="caption">Отдаю</span>
            <button
              className="link-btn"
              onClick={() =>
                // Whole balance, rounded down to what can be typed (crypto may carry more decimals).
                setAmount(fromUnits(floorTo(toUnits(balance, fromAsset.decimals), fromAsset.decimals, fromAsset.inputDecimals), fromAsset.decimals))
              }
            >
              Баланс: {money(balance, from, fromAsset)}
            </button>
          </div>
          <div className="fx__row">
            <button className="cur-select glass press" onClick={() => setPicking('from')}>
              <CurrencyIcon code={from} size={30} />
              <b>{from}</b>
              <Icon name="chevronDown" size={16} />
            </button>
            <span className={`fx__amount${amount === '' ? ' is-empty' : ''}${tooMuch ? ' is-error' : ''}`}>
              {amount === '' ? '0' : formatNumber(amount.replace(/\.$/, ''), 0, 9) + (amount.endsWith('.') ? ',' : '')}
              <span className="caret" />
            </span>
          </div>
        </div>

        <button
          className="fx__swap glass press"
          onClick={swap}
          aria-label="Поменять местами"
          style={{ '--spin': `${spin * 180}deg` } as CSSProperties}
        >
          <Icon name="swapV" size={20} stroke={2.2} />
        </button>

        <div className="fx__panel glass">
          <div className="fx__row">
            <span className="caption">Получаю</span>
            {q.quote && <span className="caption">комиссия {q.quote.feePercent}%</span>}
          </div>
          <div className="fx__row">
            <button className="cur-select glass press" onClick={() => setPicking('to')}>
              <CurrencyIcon code={to} size={30} />
              <b>{to}</b>
              <Icon name="chevronDown" size={16} />
            </button>
            <span className={`fx__amount fx__amount--out${q.loading ? ' is-loading' : ''}`}>
              {q.quote ? formatNumber(q.quote.toAmount, 2, toAsset.inputDecimals) : '0'}
            </span>
          </div>
        </div>
      </div>

      <div className="fx__meta">
        {hint ? (
          <span className="fx__hint is-error">{hint}</span>
        ) : rateText ? (
          <span className="fx__rate">
            <svg className="ring" viewBox="0 0 20 20" key={q.quote!.quoteToken} aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="8" className="ring__bar" style={{ animationDuration: `${secondsLeft}s` }} />
            </svg>
            {rateText}
            <span className="fx__fee">· комиссия {money(q.quote!.fee, to, toAsset)}</span>
          </span>
        ) : (
          <span className="fx__hint">Курс фиксируется на 30 секунд</span>
        )}
      </div>

      <Keypad onKey={(k) => setAmount((v) => applyKey(v, k, fromAsset.inputDecimals))} allowDot={fromAsset.inputDecimals > 0} />

      <button className="btn btn--primary" disabled={!q.quote || q.loading || tooMuch || busy} onClick={() => void execute()}>
        {busy ? <span className="spinner" /> : q.quote ? `Обменять на ${money(q.quote.toAmount, to, toAsset)}` : 'Обменять'}
      </button>

      {picking && (
        <div className="popover-layer" onClick={() => setPicking(null)}>
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <div className="popover__title">{picking === 'from' ? 'Отдаю' : 'Получаю'}</div>
            <CurrencyPicker
              assets={me.assets}
              balances={me.balances}
              selected={picking === 'from' ? from : to}
              onPick={pick}
            />
          </div>
        </div>
      )}
    </div>
  );
}
