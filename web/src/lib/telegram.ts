/**
 * Thin typed wrapper over window.Telegram.WebApp.
 * Every call degrades gracefully when the app runs outside Telegram (local dev)
 * or in an older client that lacks a feature.
 */

type Haptic = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type Notice = 'success' | 'warning' | 'error';

interface TgButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; photo_url?: string }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  BackButton: TgButton;
  HapticFeedback: {
    impactOccurred(style: Haptic): void;
    notificationOccurred(type: Notice): void;
    selectionChanged(): void;
  };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const tg: TgWebApp | undefined = window.Telegram?.WebApp;
const inTelegram = Boolean(tg && tg.initData);
const atLeast = (v: string) => Boolean(tg && inTelegram && tg.isVersionAtLeast(v));

export const telegram = {
  inTelegram,
  get initData(): string {
    if (inTelegram) return tg!.initData;
    return import.meta.env.DEV ? (import.meta.env.VITE_DEV_INIT_DATA ?? '') : '';
  },
  get colorScheme(): 'light' | 'dark' {
    if (inTelegram) return tg!.colorScheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  },
  get firstName(): string | undefined {
    return tg?.initDataUnsafe.user?.first_name;
  },
  get platform(): string {
    return tg?.platform ?? 'web';
  },

  init(colors: { bg: string }) {
    if (!inTelegram) return;
    tg!.ready();
    tg!.expand();
    this.paint(colors.bg);
    // Our slide-to-confirm and lists use vertical gestures; don't let them close the app.
    if (atLeast('7.7')) tg!.disableVerticalSwipes?.();
  },

  paint(bg: string) {
    if (!inTelegram || !atLeast('6.9')) return;
    tg!.setHeaderColor(bg);
    tg!.setBackgroundColor(bg);
    if (atLeast('7.10')) tg!.setBottomBarColor?.(bg);
  },

  onThemeChanged(cb: () => void): () => void {
    if (!inTelegram) return () => undefined;
    tg!.onEvent('themeChanged', cb);
    return () => tg!.offEvent('themeChanged', cb);
  },

  backButton: {
    available: atLeast('6.1'),
    show(cb: () => void) {
      if (!atLeast('6.1')) return () => undefined;
      tg!.BackButton.onClick(cb);
      tg!.BackButton.show();
      return () => {
        tg!.BackButton.offClick(cb);
        tg!.BackButton.hide();
      };
    },
  },

  haptic: {
    tap(style: Haptic = 'light') {
      if (atLeast('6.1')) tg!.HapticFeedback.impactOccurred(style);
    },
    select() {
      if (atLeast('6.1')) tg!.HapticFeedback.selectionChanged();
    },
    notify(type: Notice) {
      if (atLeast('6.1')) tg!.HapticFeedback.notificationOccurred(type);
    },
  },

  /** Asks for confirmation before the user swipes the app away mid-operation. */
  guardClosing(on: boolean) {
    if (!atLeast('6.2')) return;
    if (on) tg!.enableClosingConfirmation();
    else tg!.disableClosingConfirmation();
  },

  openPayment(url: string) {
    if (inTelegram && /^https:\/\/t\.me\//.test(url)) tg!.openTelegramLink(url);
    else if (inTelegram) tg!.openLink(url);
    else window.open(url, '_blank', 'noopener');
  },
};
