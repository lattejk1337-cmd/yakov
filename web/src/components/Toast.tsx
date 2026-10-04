import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon';

interface ToastState {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const ToastContext = createContext<(text: string, kind?: ToastState['kind']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, kind: ToastState['kind'] = 'info') => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, kind });
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast${toast.kind === 'error' ? ' toast--error' : ''}`} role="status" aria-live="polite">
          <Icon name={toast.kind === 'error' ? 'info' : 'check'} size={20} />
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
