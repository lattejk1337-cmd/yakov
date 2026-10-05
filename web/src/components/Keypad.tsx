import { telegram } from '../lib/telegram';
import { Icon } from './Icon';

const LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

/**
 * Glass number pad. `pin` mimics the iOS passcode screen (round keys with letters);
 * `amount` is a compact pad with a decimal comma.
 */
export function Keypad({
  onKey,
  variant = 'amount',
  allowDot = true,
  disabled = false,
}: {
  onKey: (key: string) => void;
  variant?: 'pin' | 'amount';
  allowDot?: boolean;
  disabled?: boolean;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', variant === 'pin' || !allowDot ? '' : '.', '0', 'back'];
  return (
    <div className={`keypad keypad--${variant}`} role="group" aria-label="Цифровая клавиатура">
      {keys.map((k, i) => {
        if (!k) return <span key={`gap${i}`} />;
        const isBack = k === 'back';
        return (
          <button
            key={k}
            type="button"
            className={`key${isBack ? ' key--ghost' : ''}`}
            disabled={disabled}
            aria-label={isBack ? 'Стереть' : k === '.' ? 'Запятая' : k}
            onClick={() => {
              telegram.haptic.tap(isBack ? 'soft' : 'light');
              onKey(k);
            }}
          >
            {isBack ? (
              <Icon name="backspace" size={26} stroke={1.7} />
            ) : (
              <>
                <span className="key__digit">{k === '.' ? ',' : k}</span>
                {variant === 'pin' && <span className="key__letters">{LETTERS[k] ?? ''}</span>}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
