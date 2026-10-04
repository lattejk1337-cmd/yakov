import { telegram } from './telegram';

export interface AssetInfo {
  code: string;
  name: string;
  decimals: number;
  inputDecimals: number;
  minDeposit: string;
  maxDeposit: string;
  minWithdraw: string;
  maxWithdraw: string;
  withdrawFee: string;
  dailyWithdrawLimit: string;
}

export interface Me {
  user: { id: number; firstName: string; username: string | null; photoUrl: string | null };
  security: { hasPin: boolean; pinLockedUntil: string | null };
  assets: AssetInfo[];
  balances: Record<string, string>;
  withdrawnToday: Record<string, string>;
}

export type DepositStatus = 'created' | 'pending' | 'paid' | 'expired' | 'failed';
export type WithdrawalStatus = 'processing' | 'completed' | 'failed';

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
  status: WithdrawalStatus;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type Operation = Deposit | Withdrawal;

export interface HistoryPage {
  items: Operation[];
  nextCursor: string | null;
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
    throw new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? 'Что-то пошло не так', e?.details ?? null);
  }
  return data as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  history: (cursor?: string) =>
    request<HistoryPage>('GET', `/api/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  createDeposit: (asset: string, amount: string, idempotencyKey: string) =>
    request<Deposit>('POST', '/api/deposits', { body: { asset, amount }, idempotencyKey }),
  deposit: (id: string) => request<Deposit>('GET', `/api/deposits/${id}`),
  createWithdrawal: (asset: string, amount: string, pin: string, idempotencyKey: string) =>
    request<Withdrawal>('POST', '/api/withdrawals', { body: { asset, amount, pin }, idempotencyKey }),
  withdrawal: (id: string) => request<Withdrawal>('GET', `/api/withdrawals/${id}`),
  setPin: (pin: string) => request<void>('POST', '/api/pin', { body: { pin } }),
  changePin: (oldPin: string, newPin: string) => request<void>('POST', '/api/pin/change', { body: { oldPin, newPin } }),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
