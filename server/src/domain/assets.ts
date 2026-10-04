import { formatAmount, parseAmount } from './money.js';

export interface AssetConfig {
  code: string;
  name: string;
  /** Precision of the ledger (minor units per 1 coin = 10^decimals). */
  decimals: number;
  /** How many fractional digits a user may type. */
  inputDecimals: number;
  minDeposit: bigint;
  maxDeposit: bigint;
  minWithdraw: bigint;
  maxWithdraw: bigint;
  withdrawFee: bigint;
  /** Rolling 24h withdrawal cap per user. */
  dailyWithdrawLimit: bigint;
}

function asset(
  code: string,
  name: string,
  decimals: number,
  inputDecimals: number,
  v: Record<'minDeposit' | 'maxDeposit' | 'minWithdraw' | 'maxWithdraw' | 'withdrawFee' | 'dailyWithdrawLimit', string>,
): AssetConfig {
  const p = (s: string) => parseAmount(s, decimals);
  return {
    code,
    name,
    decimals,
    inputDecimals,
    minDeposit: p(v.minDeposit),
    maxDeposit: p(v.maxDeposit),
    minWithdraw: p(v.minWithdraw),
    maxWithdraw: p(v.maxWithdraw),
    withdrawFee: p(v.withdrawFee),
    dailyWithdrawLimit: p(v.dailyWithdrawLimit),
  };
}

/** Assets supported by the wallet. Limits are business settings — tune them here. */
export const ASSET_CATALOG: Record<string, AssetConfig> = {
  USDT: asset('USDT', 'Tether', 6, 2, {
    minDeposit: '1',
    maxDeposit: '10000',
    minWithdraw: '2',
    maxWithdraw: '5000',
    withdrawFee: '0.1',
    dailyWithdrawLimit: '10000',
  }),
  TON: asset('TON', 'Toncoin', 9, 3, {
    minDeposit: '0.5',
    maxDeposit: '5000',
    minWithdraw: '1',
    maxWithdraw: '2000',
    withdrawFee: '0.02',
    dailyWithdrawLimit: '4000',
  }),
};

export class AssetRegistry {
  private readonly assets: Map<string, AssetConfig>;

  constructor(codes: string[]) {
    this.assets = new Map();
    for (const code of codes) {
      const cfg = ASSET_CATALOG[code];
      if (!cfg) throw new Error(`Unknown asset "${code}". Known: ${Object.keys(ASSET_CATALOG).join(', ')}`);
      this.assets.set(code, cfg);
    }
    if (this.assets.size === 0) throw new Error('At least one asset must be enabled');
  }

  get(code: string): AssetConfig | undefined {
    return this.assets.get(code);
  }

  list(): AssetConfig[] {
    return [...this.assets.values()];
  }

  format(code: string, value: bigint): string {
    const a = this.assets.get(code);
    if (!a) throw new Error(`Unknown asset ${code}`);
    return formatAmount(value, a.decimals);
  }

  /** Public, JSON-safe view of an asset for the client. */
  toPublic(a: AssetConfig) {
    const f = (v: bigint) => formatAmount(v, a.decimals);
    return {
      code: a.code,
      name: a.name,
      decimals: a.decimals,
      inputDecimals: a.inputDecimals,
      minDeposit: f(a.minDeposit),
      maxDeposit: f(a.maxDeposit),
      minWithdraw: f(a.minWithdraw),
      maxWithdraw: f(a.maxWithdraw),
      withdrawFee: f(a.withdrawFee),
      dailyWithdrawLimit: f(a.dailyWithdrawLimit),
    };
  }
}
