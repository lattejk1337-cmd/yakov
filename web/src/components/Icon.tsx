const paths = {
  down: 'M12 4v15m0 0-6-6m6 6 6-6',
  up: 'M12 20V5m0 0-6 6m6-6 6 6',
  arrowRight: 'M4 12h15m0 0-6-6m6 6-6 6',
  back: 'M20 12H5m0 0 6-6m-6 6 6 6',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Zm-3.5 9 2.5 2.5 4.5-5',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  backspace: 'M9 5h11v14H9l-6-7 6-7Zm3 4.5 5 5m0-5-5 5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  x: 'M6 6l12 12M18 6 6 18',
  key: 'M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM13.4 12.4 20 19m-3-3 2-2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5.5M12 7.6v.4',
  bolt: 'M13 2.5 5 13.5h6.5L10.5 21.5 19 10h-6.5L13 2.5Z',
  wallet: 'M3.5 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Zm0 0 12-4v4M16 14h1.5',
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
