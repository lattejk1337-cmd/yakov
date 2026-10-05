export function PinDots({ length, filled, state }: { length: number; filled: number; state: 'idle' | 'error' | 'success' }) {
  return (
    <div className={`pin-dots pin-dots--${state}`} aria-label={`Введено ${filled} из ${length}`}>
      {Array.from({ length }, (_, i) => (
        <span key={i} className={`pin-dot${i < filled ? ' pin-dot--on' : ''}`} style={{ transitionDelay: `${i * 30}ms` }} />
      ))}
    </div>
  );
}
