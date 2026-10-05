import type { CSSProperties } from 'react';

const COLORS = ['#30d158', '#0a84ff', '#ffd60a', '#ff375f', '#bf5af2', '#64d2ff'];

/** Animated check with a ring burst and a light confetti shower (pure CSS). */
export function Success({ kind = 'ok', confetti = true }: { kind?: 'ok' | 'wait' | 'fail'; confetti?: boolean }) {
  return (
    <div className={`success success--${kind}`} aria-hidden="true">
      {kind === 'ok' && confetti && (
        <div className="confetti">
          {Array.from({ length: 22 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  '--x': `${Math.cos((i / 22) * Math.PI * 2) * (90 + (i % 4) * 22)}px`,
                  '--y': `${Math.sin((i / 22) * Math.PI * 2) * (90 + (i % 3) * 26) - 40}px`,
                  '--r': `${(i * 47) % 360}deg`,
                  '--c': COLORS[i % COLORS.length],
                  '--d': `${(i % 5) * 40}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <span className="success__ring" />
      <svg className="success__icon" viewBox="0 0 52 52">
        <circle className="success__circle" cx="26" cy="26" r="24" />
        {kind === 'ok' && <path className="success__mark" d="M15 27l7 7 15-16" />}
        {kind === 'fail' && <path className="success__mark" d="M18 18l16 16M34 18 18 34" />}
        {kind === 'wait' && <path className="success__mark success__mark--clock" d="M26 15v12l7 5" />}
      </svg>
    </div>
  );
}
