import { session } from './session';
import { telegram } from './telegram';

export interface AssetInfo {
  code: string;
  name: string;
  symbol: string;
  kind: 'fiat' | 'crypto';
  decimals: number;
  inputDecimals: number;
  payoutAsset: string;
  minDeposit: string;
  maxDeposit: string;
  minWithdraw: string;
  maxWithdraw: string;
  withdrawFee: string;
  dailyWithdrawLimit: string;
  minExchange: string;
}

export interface TgProfile {
  id: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
}

export interface AuthState {
  user: TgProfile;
  hasPin: boolean;
  pinLength: number;
  pinLockedUntil: string | null;
}

export interface Me {
  user: TgProfile;
  security: { hasPin: boolean; pinLockedUntil: string | null };
  assets: AssetInfo[];
  balances: Record<string, string>;
  withdrawnToday: Record<string, string>;
  /** USD price of 1 unit of each currency (display only), null while rates are unavailable. */
  prices: Record<string, string> | null;
  exchangeFeePercent: string;
}

export type DepositStatus = 'created' | 'pending' | 'paid' | 'expired' | 'failed';

export interface Deposit {
  id: string;
  type: 'deposit';
  asset: string;
  amount: string;
  status: DepositStatus;
  payUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface Withdrawal {
  id: string;
  type: 'withdrawal';
  asset: string;
  amount: string;
  fee: string;
  total: string;
  payoutAsset: string;
  payoutAmount: string;
  status: 'processing' | 'completed' | 'failed';
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Exchange {
  id: string;
  type: 'exchange';
  status: 'completed';
  fromAsset: string;
  fromAmount: string;
  toAsset: string;
  toAmount: string;
  fee: string;
  rate: string;
  createdAt: string;
}

export type Operation = Deposit | Withdrawal | Exchange;

export interface Quote {
  quoteToken: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  fee: string;
  feePercent: string;
  rate: string;
  expiresAt: string;
}

export interface Session {
  session: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `tma ${telegram.initData}` };
  const token = session.token;
  if (token) headers['x-wallet-session'] = token;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет соединения. Проверьте интернет');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    const err = new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? 'Что-то пошло не так', e?.details ?? null);
    if (err.code === 'LOCKED') session.lock();
    throw err;
  }
  return data as T;
}

export const api = {
  authState: () => request<AuthState>('GET', '/api/auth/state'),
  setupPin: (pin: string) => request<Session>('POST', '/api/auth/setup', { body: { pin } }),
  unlock: (pin: string) => request<Session>('POST', '/api/auth/unlock', { body: { pin } }),
  changePin: (oldPin: string, newPin: string) => request<void>('POST', '/api/pin/change', { body: { oldPin, newPin } }),

  me: () => request<Me>('GET', '/api/me'),
  history: (cursor?: string) =>
    request<{ items: Operation[]; nextCursor: string | null }>(
      'GET',
      `/api/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  createDeposit: (asset: string, amount: string, key: string) =>
    request<Deposit>('POST', '/api/deposits', { body: { asset, amount }, idempotencyKey: key }),
  deposit: (id: string) => request<Deposit>('GET', `/api/deposits/${id}`),

  createWithdrawal: (asset: string, amount: string, pin: string, key: string) =>
    request<Withdrawal>('POST', '/api/withdrawals', { body: { asset, amount, pin }, idempotencyKey: key }),
  withdrawal: (id: string) => request<Withdrawal>('GET', `/api/withdrawals/${id}`),

  quote: (from: string, to: string, amount: string) =>
    request<Quote>('POST', '/api/exchange/quote', { body: { from, to, amount } }),
  exchange: (quoteToken: string, key: string) =>
    request<Exchange>('POST', '/api/exchange', { body: { quoteToken }, idempotencyKey: key }),
  exchangeById: (id: string) => request<Exchange>('GET', `/api/exchanges/${id}`),
};

/** Random UUID v4; falls back to getRandomValues on WebViews without crypto.randomUUID. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
