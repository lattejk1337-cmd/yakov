import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { telegram } from './telegram';

export type Tab = 'home' | 'exchange' | 'history' | 'profile';

export type Overlay =
  | { name: 'deposit'; asset: string }
  | { name: 'withdraw'; asset: string }
  | { name: 'operation'; kind: 'deposit' | 'withdrawal' | 'exchange'; id: string }
  | { name: 'pin-change' }
  | { name: 'about' };

interface Entry {
  key: number;
  overlay: Overlay;
  closing: boolean;
}

interface Nav {
  tab: Tab;
  setTab(tab: Tab): void;
  overlays: Entry[];
  open(o: Overlay): void;
  replace(o: Overlay): void;
  close(): void;
  closeAll(): void;
}

const NavContext = createContext<Nav | null>(null);
let seq = 0;
const CLOSE_MS = 320;

/**
 * Tabs at the bottom, flows as sheets sliding over them (iOS modal style).
 * Telegram's native BackButton closes the top sheet.
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>('home');
  const [overlays, setOverlays] = useState<Entry[]>([]);

  const setTab = useCallback((t: Tab) => {
    telegram.haptic.select();
    setTabState(t);
  }, []);

  const open = useCallback((overlay: Overlay) => {
    setOverlays((s) => [...s, { key: seq++, overlay, closing: false }]);
  }, []);

  const replace = useCallback((overlay: Overlay) => {
    setOverlays((s) => [...s.slice(0, -1), { key: seq++, overlay, closing: false }]);
  }, []);

  const close = useCallback(() => {
    setOverlays((s) => {
      const top = s[s.length - 1];
      if (!top || top.closing) return s;
      const key = top.key;
      window.setTimeout(() => setOverlays((cur) => cur.filter((e) => e.key !== key)), CLOSE_MS);
      return [...s.slice(0, -1), { ...top, closing: true }];
    });
  }, []);

  const closeAll = useCallback(() => {
    setOverlays((s) => s.map((e) => ({ ...e, closing: true })));
    window.setTimeout(() => setOverlays([]), CLOSE_MS);
  }, []);

  const hasOverlay = overlays.some((o) => !o.closing);
  // Telegram's Back closes the top sheet, otherwise returns from another tab to Home.
  useEffect(() => {
    if (hasOverlay) return telegram.backButton.show(close);
    if (tab !== 'home') return telegram.backButton.show(() => setTabState('home'));
  }, [hasOverlay, close, tab]);

  const value = useMemo<Nav>(
    () => ({ tab, setTab, overlays, open, replace, close, closeAll }),
    [tab, setTab, overlays, open, replace, close, closeAll],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
