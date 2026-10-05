import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { type PinFeedback, PinEntry } from '../components/PinEntry';
import { useToast } from '../components/Toast';
import { ApiError, api, type AuthState } from '../lib/api';
import { keys } from '../lib/queries';
import { session } from '../lib/session';

function isWeak(pin: string): boolean {
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  return d.every((x) => x === d[0]) || (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step));
}

function useCountdown(until: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return setLeft(0);
    const tick = () => setLeft(Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return left;
}

/** Entry gate: create a 4-digit PIN on first launch, then enter it on every launch. */
export function Lock({ state }: { state: AuthState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const creating = !state.hasPin;
  const [step, setStep] = useState<'enter' | 'new' | 'repeat'>(creating ? 'new' : 'enter');
  const [first, setFirst] = useState('');
  const [feedback, setFeedback] = useState<PinFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(state.pinLockedUntil);
  const [leaving, setLeaving] = useState(false);
  const left = useCountdown(lockedUntil);
  const name = state.user.firstName || state.user.username || 'друг';

  useEffect(() => {
    if (lockedUntil && left === 0) setLockedUntil(null);
  }, [left, lockedUntil]);

  const fail = (message: string) => setFeedback({ kind: 'error', message, seq: Date.now() });

  const finish = (s: { session: string; expiresAt: string }) => {
    setFeedback({ kind: 'success', seq: Date.now() });
    setLeaving(true);
    window.setTimeout(() => {
      session.set(s.session, s.expiresAt);
      void qc.invalidateQueries({ queryKey: keys.auth });
    }, 520);
  };

  const submit = async (pin: string) => {
    if (step === 'new') {
      if (isWeak(pin)) return fail('Слишком простой код');
      setFirst(pin);
      setFeedback(null);
      return setStep('repeat');
    }
    if (step === 'repeat' && pin !== first) {
      setStep('new');
      return fail('Коды не совпали');
    }
    setBusy(true);
    try {
      finish(step === 'repeat' ? await api.setupPin(pin) : await api.unlock(pin));
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'PIN_INVALID') {
        const n = Number(err.details?.attemptsLeft ?? 0);
        fail(`Неверный код · ${n === 1 ? 'последняя попытка' : `осталось попыток: ${n}`}`);
      } else if (err?.code === 'PIN_LOCKED') {
        setLockedUntil(String(err.details?.lockedUntil ?? new Date(Date.now() + 15 * 60_000).toISOString()));
        fail('Слишком много попыток');
      } else {
        fail(err?.message ?? 'Не удалось проверить код');
      }
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    enter: { title: `${name}, введите код`, sub: 'Tonum Wallet защищён код-паролем' },
    new: { title: 'Придумайте код-пароль', sub: 'Четыре цифры — для входа и подтверждения выводов' },
    repeat: { title: 'Повторите код', sub: 'Чтобы точно не ошибиться' },
  }[step];

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className={`lock${leaving ? ' is-leaving' : ''}`}>
      <div className="lock__top">
        <Avatar name={name} photoUrl={state.user.photoUrl} size={84} ring />
      </div>
      <PinEntry
        key={step}
        length={state.pinLength}
        title={titles.title}
        subtitle={titles.sub}
        feedback={feedback}
        busy={busy}
        disabled={left > 0}
        hint={left > 0 ? `Вход заблокирован · ${mm}:${ss}` : undefined}
        onComplete={(pin) => void submit(pin)}
      />
      {step === 'enter' && (
        <button
          className="link-btn"
          onClick={() => toast('Сбросить код можно только через поддержку — так никто, кроме вас, не войдёт в кошелёк')}
        >
          Забыли код?
        </button>
      )}
    </div>
  );
}
