import { useRef, useState } from 'react';
import { type PinError, PinPad } from '../components/PinPad';
import { useToast } from '../components/Toast';
import { ApiError, api, newIdempotencyKey } from '../lib/api';
import { fmt } from '../lib/format';
import { useNav } from '../lib/nav';
import { useMe, useRefreshWallet } from '../lib/queries';
import { telegram } from '../lib/telegram';
import { clearDraft } from './Amount';

export function WithdrawConfirm({ asset: code, amount }: { asset: string; amount: string }) {
  const me = useMe();
  const nav = useNav();
  const toast = useToast();
  const refresh = useRefreshWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PinError | null>(null);
  // One key per confirmation screen: a retry after a network error can't withdraw twice.
  const idemKey = useRef(newIdempotencyKey());

  const asset = me.data?.assets.find((a) => a.code === code);
  const locked = me.data?.security.pinLockedUntil;

  const submit = async (pin: string) => {
    setBusy(true);
    telegram.guardClosing(true);
    try {
      const w = await api.createWithdrawal(code, amount, pin, idemKey.current);
      clearDraft('withdraw', code);
      refresh();
      telegram.haptic.notify(w.status === 'failed' ? 'error' : 'success');
      nav.replace({ name: 'operation', kind: 'withdrawal', id: w.id });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'INTERNAL', 'Что-то пошло не так');
      if (err.code === 'PIN_INVALID') {
        const left = err.details?.attemptsLeft;
        setError({ message: `Неверный PIN-код. Осталось попыток: ${left}`, seq: Date.now() });
      } else if (err.code === 'NETWORK') {
        setError({ message: err.message, seq: Date.now() });
      } else {
        // Business errors (limits, balance, lock): go back to the amount with an explanation.
        refresh();
        toast(err.message, 'error');
        telegram.haptic.notify('error');
        nav.back();
      }
    } finally {
      telegram.guardClosing(false);
      setBusy(false);
    }
  };

  const lockedUntil = locked ? new Date(locked) : null;
  return (
    <PinPad
      title="Подтвердите вывод"
      subtitle={`${asset ? fmt(amount, asset) : amount} ${code} поступят на ваш счёт в @CryptoBot`}
      error={error}
      busy={busy}
      disabled={Boolean(lockedUntil)}
      hint={
        lockedUntil
          ? `PIN заблокирован до ${lockedUntil.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : 'Введите PIN-код'
      }
      onComplete={(pin) => void submit(pin)}
    />
  );
}
