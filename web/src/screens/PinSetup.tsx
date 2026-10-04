import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type PinError, PinPad } from '../components/PinPad';
import { useToast } from '../components/Toast';
import { ApiError, api } from '../lib/api';
import { type Route, useNav } from '../lib/nav';
import { keys } from '../lib/queries';
import { telegram } from '../lib/telegram';

type Step = 'old' | 'new' | 'repeat';

/** Creates a PIN (new → repeat) or changes it (old → new → repeat). */
export function PinSetup({ change = false, then }: { change?: boolean; then?: Route }) {
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<Step>(change ? 'old' : 'new');
  const [oldPin, setOldPin] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<PinError | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (message: string) => setError({ message, seq: Date.now() });

  const submit = async (pin: string) => {
    if (step === 'old') {
      setOldPin(pin);
      setError(null);
      return setStep('new');
    }
    if (step === 'new') {
      if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        return fail('Слишком простой код — выберите другой');
      }
      setFirst(pin);
      setError(null);
      return setStep('repeat');
    }
    if (pin !== first) {
      setStep('new');
      setFirst('');
      return fail('Коды не совпали. Попробуйте ещё раз');
    }
    setBusy(true);
    try {
      if (change) await api.changePin(oldPin, pin);
      else await api.setPin(pin);
      telegram.haptic.notify('success');
      await qc.invalidateQueries({ queryKey: keys.me });
      toast(change ? 'PIN-код изменён' : 'PIN-код установлен');
      if (then) nav.replace(then);
      else nav.back();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (change && (err?.code === 'PIN_INVALID' || err?.code === 'PIN_LOCKED')) {
        setStep('old');
      } else {
        setStep('new');
      }
      setFirst('');
      fail(err?.message ?? 'Не удалось сохранить PIN-код');
    } finally {
      setBusy(false);
    }
  };

  const copy: Record<Step, { title: string; sub: string }> = {
    old: { title: 'Текущий PIN-код', sub: 'Подтвердите, что это вы' },
    new: {
      title: change ? 'Новый PIN-код' : 'Придумайте PIN-код',
      sub: 'Он понадобится для каждого вывода средств. Никому его не сообщайте',
    },
    repeat: { title: 'Повторите PIN-код', sub: 'Чтобы точно не ошибиться' },
  };

  return (
    <PinPad
      key={step}
      title={copy[step].title}
      subtitle={copy[step].sub}
      error={error}
      busy={busy}
      onComplete={(pin) => void submit(pin)}
    />
  );
}
