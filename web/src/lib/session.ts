/**
 * The unlocked session lives only in memory: every new launch of the Mini App asks for the PIN,
 * and the app locks itself again after a while in the background or when the session expires.
 */
const AUTO_LOCK_AFTER_MS = 2 * 60_000;

let token: string | null = null;
let expiryTimer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const session = {
  /** Pure read, safe to call during render. */
  get token(): string | null {
    return token;
  },
  set(t: string, expiresIso: string) {
    token = t;
    window.clearTimeout(expiryTimer);
    const ms = Math.max(0, (Date.parse(expiresIso) || Date.now() + 15 * 60_000) - Date.now() - 5_000);
    expiryTimer = window.setTimeout(() => session.lock(), ms);
    emit();
  },
  lock() {
    window.clearTimeout(expiryTimer);
    if (!token) return;
    token = null;
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_AFTER_MS) session.lock();
});
