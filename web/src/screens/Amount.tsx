import { type CSSProperties, useRef, useState } from 'react';
import { Keypad } from '../components/Keypad';
import { SlideToConfirm } from '../components/SlideToConfirm';
import { useToast } from '../components/Toast';
import { ApiError, type AssetInfo, api, type Me, newIdempotencyKey } from '../lib/api';
import { fmt } from '../lib/format';
import { checkAmount, floorToInput } from '../lib/limits';
import { applyKey, formatDisplay, fromUnits, normalize } from '../lib/money';
import { type Mode, useNav } from '../lib/nav';
import { useMe, useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';

/** Typed amounts survive a round-trip to the confirmation screen and back. */
const drafts = new Map<string, string>();

export function AmountScreen({ mode, asset: initialAsset }: { mode: Mode; asset: string }) {
  const me = useMe();
  if (!me.data) return null;
  return <AmountForm me={me.data} mode={mode} initialAsset={initialAsset} />;
}

function AmountForm({ me, mode, initialAsset }: { me: Me; mode: Mode; initialAsset: string }) {
  const nav = useNav();
  const toast = useToast();
  const refresh = useRefreshWallet();
  const [assetCode, setAssetCode] = useState(initialAsset);
  const asset = me.assets.find((a) => a.code === assetCode) ?? me.assets[0]!;
  const draftKey = `${mode}:${asset.code}`;
  const [value, setValueState] = useState(() => drafts.get(draftKey) ?? '');
  const [busy, setBusy] = useState(false);
  const idemKey = useRef<string | null>(null);

  const setValue = (v: string) => {
    drafts.set(draftKey, v);
    idemKey.current = null; // a different amount is a different operation
    setValueState(v);
  };

  const check = checkAmount(me, asset, mode, value);
  const valid = value !== '' && check.units > 0n && !check.error;
  const units = (v: bigint) => fromUnits(v, asset.decimals);

  const presets =
    mode === 'deposit'
      ? [5n, 10n, 50n, 100n]
          .map((k) => check.min * k)
          .filter((v) => v <= check.max)
          .map((v) => ({ label: fmt(units(v), asset).replace(/\.0+$/, ''), value: v }))
      : check.max >= check.min
        ? [
            { label: '25%', value: floorToInput((check.max * 25n) / 100n, asset) },
            { label: '50%', value: floorToInput((check.max * 50n) / 100n, asset) },
            { label: 'Всё', value: floorToInput(check.max, asset) },
          ]
        : [];

  const startDeposit = async () => {
    setBusy(true);
    telegram.guardClosing(true);
    try {
      idemKey.current ??= newIdempotencyKey();
      const dep = await api.createDeposit(asset.code, normalize(value), idemKey.current);
      idemKey.current = null;
      drafts.delete(draftKey);
      refresh();
      if (dep.payUrl) telegram.openPayment(dep.payUrl);
      nav.replace({ name: 'operation', kind: 'deposit', id: dep.id });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code !== 'NETWORK') idemKey.current = null; // safe to retry with the same key only if unsure
      telegram.haptic.notify('error');
      toast(err?.message ?? 'Не удалось создать счёт', 'error');
    } finally {
      telegram.guardClosing(false);
      setBusy(false);
    }
  };

  const display = value === '' ? '0' : value;
  const [intPart = '0', fracPart] = display.split('.');
  const shown = formatDisplay(intPart, 0) + (fracPart !== undefined ? `.${fracPart}` : '');

  return (
    <>
      <div className="head">
        <div>
          <div className="label">{mode === 'deposit' ? 'Пополнение' : 'Вывод в CryptoBot'}</div>
          <div className="head__title">{mode === 'deposit' ? 'Сколько внести?' : 'Сколько вывести?'}</div>
        </div>
        {me.assets.length > 1 && (
          <div className="tabs" role="tablist" aria-label="Актив">
            {me.assets.map((a: AssetInfo) => (
              <button
                key={a.code}
                role="tab"
                className="tab"
                aria-selected={a.code === asset.code}
                onClick={() => {
                  telegram.haptic.select();
                  setAssetCode(a.code);
                  setValueState(drafts.get(`${mode}:${a.code}`) ?? '');
                  idemKey.current = null;
                }}
              >
                {a.code}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="amount">
        <div
          className={`amount__value${value === '' ? ' amount__value--empty' : ''}`}
          style={{ '--len': shown.length + 2 } as CSSProperties}
          aria-live="polite"
        >
          <span className="amount__digits">
            {shown}
            <span className="caret" aria-hidden="true" />
          </span>
          <span className="amount__asset">{asset.code}</span>
        </div>
        <div key={check.error ?? 'ok'} className={`amount__hint${check.error ? ' amount__hint--error' : ''}`}>
          {check.error ?? check.hint}
        </div>
      </div>

      {presets.length > 0 && (
        <div className="chips">
          {presets.map((p) => (
            <button
              key={p.label}
              className="chip"
              onClick={() => {
                telegram.haptic.select();
                setValue(units(p.value));
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'withdraw' && (
        <div className="lines" aria-label="Расчёт">
          <div className="line">
            Получите <span className="line__leader" />
            <b>
              {fmt(units(check.units), asset)} {asset.code}
            </b>
          </div>
          <div className="line">
            Комиссия <span className="line__leader" />
            <b>
              {fmt(units(check.fee), asset)} {asset.code}
            </b>
          </div>
          <div className="line">
            Спишется <span className="line__leader" />
            <b>
              {fmt(units(check.units + check.fee), asset)} {asset.code}
            </b>
          </div>
        </div>
      )}

      <Keypad onKey={(k) => setValue(applyKey(value, k, asset.inputDecimals))} allowDot={asset.inputDecimals > 0} />

      {mode === 'deposit' ? (
        <button className="btn btn--lime" disabled={!valid || busy} onClick={() => void startDeposit()}>
          {busy ? <span className="spinner" /> : 'Перейти к оплате'}
        </button>
      ) : (
        <SlideToConfirm
          key={`${asset.code}:${value}`}
          label={valid ? 'Проведите для вывода' : 'Введите сумму'}
          disabled={!valid}
          onConfirm={() => nav.push({ name: 'withdraw-confirm', asset: asset.code, amount: normalize(value) })}
        />
      )}
    </>
  );
}

export function clearDraft(mode: Mode, asset: string) {
  drafts.delete(`${mode}:${asset}`);
}
