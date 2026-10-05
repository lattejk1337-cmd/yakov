import type { CSSProperties } from 'react';
import type { Tab } from '../lib/nav';
import { Icon, type IconName } from './Icon';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'exchange', label: 'Обмен', icon: 'swap' },
  { id: 'history', label: 'История', icon: 'clock' },
  { id: 'profile', label: 'Профиль', icon: 'person' },
];

/** Floating glass tab bar with a liquid indicator that slides between tabs. */
export function TabBar({ tab, onChange, behind = false }: { tab: Tab; onChange: (t: Tab) => void; behind?: boolean }) {
  const index = TABS.findIndex((t) => t.id === tab);
  return (
    <nav className={`tabbar glass${behind ? ' is-behind' : ''}`} style={{ '--i': index } as CSSProperties} aria-label="Разделы">
      <span className="tabbar__pill" aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tabbar__item${t.id === tab ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
          aria-current={t.id === tab ? 'page' : undefined}
        >
          <Icon name={t.icon} size={22} stroke={t.id === tab ? 2.2 : 1.8} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
