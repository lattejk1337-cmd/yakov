import type { ReactNode } from 'react';
import { telegram } from '../lib/telegram';
import { Icon } from './Icon';

/** Full-height modal sheet sliding up over the tabs (iOS card style). */
export function Sheet({
  title,
  closing,
  onClose,
  children,
  depth,
}: {
  title?: string;
  closing: boolean;
  onClose: () => void;
  children: ReactNode;
  depth: number;
}) {
  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`} style={{ zIndex: 20 + depth }}>
      <div className="sheet-backdrop" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grabber" aria-hidden="true" />
        <header className="sheet__head">
          {!telegram.backButton.available && (
            <button className="icon-btn glass" onClick={onClose} aria-label="Назад">
              <Icon name="back" size={20} />
            </button>
          )}
          <div className="sheet__title">{title}</div>
          <button className="icon-btn glass" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </section>
    </div>
  );
}
