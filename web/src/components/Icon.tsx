const paths = {
  plus: 'M12 5v14M5 12h14',
  down: 'M12 4v15m0 0-6-6m6 6 6-6',
  up: 'M12 20V5m0 0-6 6m6-6 6 6',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4m4 4H7',
  swapV: 'M8 3 4 7l4 4M4 7h13M16 21l4-4-4-4m4 4H7',
  home: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-9.5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  person: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM4 21c.8-4 4.1-6.5 8-6.5s7.2 2.5 8 6.5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5',
  unlock: 'M7 10.5V8a5 5 0 0 1 9.6-2M5.5 10.5h13v10h-13zM12 14.5v2.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  backspace: 'M9 5h11v14H9l-6-7 6-7Zm3 4.5 5 5m0-5-5 5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  x: 'M6 6l12 12M18 6 6 18',
  key: 'M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM13.4 12.4 20 19m-3-3 2-2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5.5M12 7.6v.4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z',
  gauge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9 4-4M7 12h1M12 7v1M16 12h1',
  wallet: 'M3.5 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Zm0 0 12-4v4M16 14h1.5',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
