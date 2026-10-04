import { useEffect, useState } from 'react';
import { telegram } from '../lib/telegram';
import { Icon } from './Icon';
import { Keypad } from './Keypad';

export const PIN_LENGTH = 6;

export interface PinError {
  message: string;
  /** Bump to re-trigger the shake for consecutive errors with the same text. */
  seq: number;
}

/** Six-dot PIN entry on the shared keypad. Calls onComplete once all digits are in. */
export function PinPad({
  title,
  subtitle,
  error,
  hint,
  busy = false,
  disabled = false,
  onComplete,
}: {
  title: string;
  subtitle?: string;
  error?: PinError | null;
  hint?: string;
  busy?: boolean;
  disabled?: boolean;
  onComplete: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!error) return;
    setPin('');
    setShaking(true);
    telegram.haptic.notify('error');
    const t = window.setTimeout(() => setShaking(false), 450);
    return () => window.clearTimeout(t);
  }, [error]);

  const press = (key: string) => {
    if (busy || disabled) return;
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    if (!/^\d$/.test(key) || pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      // Let the last dot render before handing off.
      window.setTimeout(() => onComplete(next), 120);
    }
  };

  return (
    <>
      <div className="pin">
        <div className="pin__lock">{busy ? <span className="spinner" /> : <Icon name="lock" size={28} />}</div>
        <div className="pin__title">{title}</div>
        {subtitle && <div className="pin__sub">{subtitle}</div>}
        <div className={`pin__dots${shaking ? ' pin__dots--error' : ''}`} aria-label={`Введено ${pin.length} из ${PIN_LENGTH}`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={`pin__dot${i < pin.length ? ' pin__dot--on' : ''}`} />
          ))}
        </div>
        <div className={`pin__msg${error ? ' pin__msg--error' : ''}`} role="alert">
          {error?.message ?? hint ?? ''}
        </div>
      </div>
      <Keypad onKey={press} allowDot={false} disabled={busy || disabled} />
    </>
  );
}
