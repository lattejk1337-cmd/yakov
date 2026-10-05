import { type CSSProperties, type PointerEvent, useRef, useState } from 'react';
import { telegram } from '../lib/telegram';
import { Icon } from './Icon';

const THRESHOLD = 0.86;

/** Drag the knob to the end to confirm — harder to trigger by accident than a button. Keyboard: Enter. */
export function SlideToConfirm({ label, onConfirm, disabled = false }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; max: number } | null>(null);
  const passedHalf = useRef(false);
  const [x, setX] = useState(0);
  const [snapping, setSnapping] = useState(false);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX - x, max: (trackRef.current?.clientWidth ?? 0) - 64 };
    passedHalf.current = false;
    setSnapping(false);
    telegram.haptic.tap('soft');
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = Math.max(0, Math.min(start.current.max, e.clientX - start.current.px));
    const half = next > start.current.max / 2;
    if (half !== passedHalf.current) {
      passedHalf.current = half;
      telegram.haptic.select();
    }
    setX(next);
  };

  const onUp = () => {
    if (!start.current) return;
    const { max } = start.current;
    start.current = null;
    setSnapping(true);
    if (max > 0 && x / max >= THRESHOLD) {
      setX(max);
      telegram.haptic.notify('success');
      onConfirm();
    } else {
      setX(0);
    }
  };

  return (
    <div
      ref={trackRef}
      className={`slider glass${snapping ? ' slider--snap' : ''}`}
      style={{ '--x': `${x}px` } as CSSProperties}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <div className="slider__fill" />
      <div className="slider__label">{label}</div>
      <div className="slider__knob">
        <Icon name="chevronRight" size={26} stroke={2.6} />
      </div>
    </div>
  );
}
