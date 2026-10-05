import { useEffect, useState } from 'react';
import { telegram } from '../lib/telegram';
import { Keypad } from './Keypad';
import { PinDots } from './PinDots';

export interface PinFeedback {
  kind: 'error' | 'success';
  message?: string;
  /** Bump to re-trigger the animation for consecutive identical results. */
  seq: number;
}

/** Dots + glass keypad. Calls onComplete when all digits are in; the parent reports the outcome. */
export function PinEntry({
  length,
  title,
  subtitle,
  hint,
  feedback,
  busy = false,
  disabled = false,
  onComplete,
}: {
  length: number;
  title: string;
  subtitle?: string;
  hint?: string;
  feedback?: PinFeedback | null;
  busy?: boolean;
  disabled?: boolean;
  onComplete: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'idle' | 'error' | 'success'>('idle');

  useEffect(() => {
    if (!feedback) return;
    setState(feedback.kind);
    if (feedback.kind === 'error') {
      telegram.haptic.notify('error');
      const t = window.setTimeout(() => {
        setPin('');
        setState('idle');
      }, 520);
      return () => window.clearTimeout(t);
    }
    telegram.haptic.notify('success');
  }, [feedback]);

  const press = (key: string) => {
    if (busy || disabled || state !== 'idle') return;
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    if (!/^\d$/.test(key) || pin.length >= length) return;
    const next = pin + key;
    setPin(next);
    if (next.length === length) window.setTimeout(() => onComplete(next), 140);
  };

  return (
    <div className="pin-entry">
      <div className="pin-entry__head">
        <div className="pin-entry__title">{title}</div>
        {subtitle && <div className="pin-entry__sub">{subtitle}</div>}
        <PinDots length={length} filled={state === 'success' ? length : pin.length} state={state} />
        <div className={`pin-entry__msg${feedback?.kind === 'error' && state !== 'idle' ? ' is-error' : ''}`} role="alert">
          {busy ? <span className="spinner" /> : feedback?.kind === 'error' && state !== 'idle' ? feedback.message : (hint ?? '')}
        </div>
      </div>
      <Keypad variant="pin" onKey={press} disabled={busy || disabled} />
    </div>
  );
}
