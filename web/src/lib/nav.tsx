import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { telegram } from './telegram';

export type Mode = 'deposit' | 'withdraw';

export type Route =
  | { name: 'home' }
  | { name: 'amount'; mode: Mode; asset: string }
  | { name: 'withdraw-confirm'; asset: string; amount: string }
  | { name: 'pin-setup'; then?: Route }
  | { name: 'pin-change' }
  | { name: 'operation'; kind: 'deposit' | 'withdrawal'; id: string }
  | { name: 'security' };

interface Entry {
  key: number;
  route: Route;
}

interface Nav {
  route: Route;
  key: number;
  direction: 'forward' | 'back';
  canGoBack: boolean;
  push(route: Route): void;
  replace(route: Route): void;
  back(): void;
  home(): void;
}

const NavContext = createContext<Nav | null>(null);
let seq = 0;

/** A tiny stack router wired to Telegram's native BackButton. */
export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([{ key: seq++, route: { name: 'home' } }]);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const push = useCallback((route: Route) => {
    setDirection('forward');
    setStack((s) => [...s, { key: seq++, route }]);
  }, []);
  const replace = useCallback((route: Route) => {
    setDirection('forward');
    setStack((s) => [...s.slice(0, -1), { key: seq++, route }]);
  }, []);
  const back = useCallback(() => {
    setDirection('back');
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const home = useCallback(() => {
    setDirection('back');
    setStack((s) => s.slice(0, 1));
  }, []);

  const top = stack[stack.length - 1]!;
  const canGoBack = stack.length > 1;

  useEffect(() => {
    if (!canGoBack) return;
    return telegram.backButton.show(back);
  }, [canGoBack, back]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [top.key]);

  const value = useMemo<Nav>(
    () => ({ route: top.route, key: top.key, direction, canGoBack, push, replace, back, home }),
    [top, direction, canGoBack, push, replace, back, home],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
