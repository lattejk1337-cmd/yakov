import { telegram } from '../lib/telegram';
import { Icon } from './Icon';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

/** Big tactile number pad: no OS keyboard, no invalid characters, haptics on every press. */
export function Keypad({
  onKey,
  allowDot = true,
  disabled = false,
}: {
  onKey: (key: string) => void;
  allowDot?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="keypad" role="group" aria-label="Цифровая клавиатура">
      {KEYS.map((k) => {
        if (k === '.' && !allowDot) return <span key={k} />;
        return (
          <button
            key={k}
            type="button"
            className="key"
            disabled={disabled}
            aria-label={k === 'back' ? 'Стереть' : k === '.' ? 'Точка' : k}
            onClick={() => {
              telegram.haptic.tap(k === 'back' ? 'soft' : 'light');
              onKey(k);
            }}
          >
            {k === 'back' ? <Icon name="backspace" size={26} stroke={1.8} /> : k}
          </button>
        );
      })}
    </div>
  );
}
