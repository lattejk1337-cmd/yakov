import { useState } from 'react';
import { type PinFeedback, PinEntry } from '../components/PinEntry';
import { useToast } from '../components/Toast';
import { ApiError, api } from '../lib/api';
import { useNav } from '../lib/nav';

export function PinChange() {
  const nav = useNav();
  const toast = useToast();
  const [step, setStep] = useState<'old' | 'new' | 'repeat'>('old');
  const [oldPin, setOldPin] = useState('');
  const [first, setFirst] = useState('');
  const [feedback, setFeedback] = useState<PinFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (message: string) => setFeedback({ kind: 'error', message, seq: Date.now() });

  const submit = async (pin: string) => {
    if (step === 'old') {
      setOldPin(pin);
      setFeedback(null);
      return setStep('new');
    }
    if (step === 'new') {
      setFirst(pin);
      setFeedback(null);
      return setStep('repeat');
    }
    if (pin !== first) {
      setStep('new');
      return fail('Коды не совпали');
    }
    setBusy(true);
    try {
      await api.changePin(oldPin, pin);
      setFeedback({ kind: 'success', seq: Date.now() });
      toast('Код-пароль изменён');
      window.setTimeout(nav.close, 450);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setStep(err?.code === 'PIN_INVALID' || err?.code === 'PIN_LOCKED' ? 'old' : 'new');
      fail(err?.message ?? 'Не удалось изменить код');
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    old: 'Текущий код-пароль',
    new: 'Новый код-пароль',
    repeat: 'Повторите новый код',
  }[step];

  return (
    <div className="flow flow--pin">
      <PinEntry key={step} length={4} title={copy} feedback={feedback} busy={busy} onComplete={(p) => void submit(p)} />
    </div>
  );
}
