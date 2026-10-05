import { formatAmount, parseAmount } from './money.js';

export type AssetKind = 'fiat' | 'crypto';

export interface AssetConfig {
  code: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  /** Precision of the ledger (minor units per 1 unit = 10^decimals). */
  decimals: number;
  /** How many fractional digits a user may type. */
  inputDecimals: number;
  /**
   * Crypto asset that actually moves through the payment provider. Fiat balances are funded
   * by paying a fiat-denominated invoice in crypto and withdrawn as this asset at the market rate.
   */
  payoutAsset: string;
  minDeposit: bigint;
  maxDeposit: bigint;
  minWithdraw: bigint;
  maxWithdraw: bigint;
  withdrawFee: bigint;
  /** Rolling 24h withdrawal cap per user. */
  dailyWithdrawLimit: bigint;
  minExchange: bigint;
}

type Limits = Record<
  'minDeposit' | 'maxDeposit' | 'minWithdraw' | 'maxWithdraw' | 'withdrawFee' | 'dailyWithdrawLimit' | 'minExchange',
  string
>;

function asset(
  base: Pick<AssetConfig, 'code' | 'name' | 'symbol' | 'kind' | 'decimals' | 'inputDecimals' | 'payoutAsset'>,
  v: Limits,
): AssetConfig {
  const p = (s: string) => parseAmount(s, base.decimals);
  return {
    ...base,
    minDeposit: p(v.minDeposit),
    maxDeposit: p(v.maxDeposit),
    minWithdraw: p(v.minWithdraw),
    maxWithdraw: p(v.maxWithdraw),
    withdrawFee: p(v.withdrawFee),
    dailyWithdrawLimit: p(v.dailyWithdrawLimit),
    minExchange: p(v.minExchange),
  };
}

const fiat = (code: string, name: string, symbol: string, v: Limits) =>
  asset({ code, name, symbol, kind: 'fiat', decimals: 2, inputDecimals: 2, payoutAsset: 'USDT' }, v);

/** Currencies the wallet can hold. Limits and fees are business settings — tune them here. */
export const ASSET_CATALOG: Record<string, AssetConfig> = {
  RUB: fiat('RUB', 'Рубль', '₽', {
    minDeposit: '100',
    maxDeposit: '1000000',
    minWithdraw: '300',
    maxWithdraw: '500000',
    withdrawFee: '50',
    dailyWithdrawLimit: '1000000',
    minExchange: '10',
  }),
  USD: fiat('USD', 'Доллар', '$', {
    minDeposit: '2',
    maxDeposit: '10000',
    minWithdraw: '5',
    maxWithdraw: '5000',
    withdrawFee: '0.5',
    dailyWithdrawLimit: '10000',
    minExchange: '0.1',
  }),
  EUR: fiat('EUR', 'Евро', '€', {
    minDeposit: '2',
    maxDeposit: '10000',
    minWithdraw: '5',
    maxWithdraw: '5000',
    withdrawFee: '0.5',
    dailyWithdrawLimit: '10000',
    minExchange: '0.1',
  }),
  CNY: fiat('CNY', 'Юань', '¥', {
    minDeposit: '15',
    maxDeposit: '70000',
    minWithdraw: '40',
    maxWithdraw: '35000',
    withdrawFee: '4',
    dailyWithdrawLimit: '70000',
    minExchange: '1',
  }),
  TON: asset(
    { code: 'TON', name: 'Toncoin', symbol: 'TON', kind: 'crypto', decimals: 9, inputDecimals: 3, payoutAsset: 'TON' },
    {
      minDeposit: '0.5',
      maxDeposit: '5000',
      minWithdraw: '1',
      maxWithdraw: '2000',
      withdrawFee: '0.02',
      dailyWithdrawLimit: '4000',
      minExchange: '0.05',
    },
  ),
  USDT: asset(
    { code: 'USDT', name: 'Tether', symbol: 'USDT', kind: 'crypto', decimals: 6, inputDecimals: 2, payoutAsset: 'USDT' },
    {
      minDeposit: '1',
      maxDeposit: '10000',
      minWithdraw: '2',
      maxWithdraw: '5000',
      withdrawFee: '0.1',
      dailyWithdrawLimit: '10000',
      minExchange: '0.1',
    },
  ),
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

  /** Any catalog asset, enabled or not (payout assets such as USDT need not be user-facing). */
  catalog(code: string): AssetConfig | undefined {
    return ASSET_CATALOG[code];
  }

  list(): AssetConfig[] {
    return [...this.assets.values()];
  }

  format(code: string, value: bigint): string {
    const a = ASSET_CATALOG[code];
    if (!a) throw new Error(`Unknown asset ${code}`);
    return formatAmount(value, a.decimals);
  }

  /** Public, JSON-safe view of an asset for the client. */
  toPublic(a: AssetConfig) {
    const f = (v: bigint) => formatAmount(v, a.decimals);
    return {
      code: a.code,
      name: a.name,
      symbol: a.symbol,
      kind: a.kind,
      decimals: a.decimals,
      inputDecimals: a.inputDecimals,
      payoutAsset: a.payoutAsset,
      minDeposit: f(a.minDeposit),
      maxDeposit: f(a.maxDeposit),
      minWithdraw: f(a.minWithdraw),
      maxWithdraw: f(a.maxWithdraw),
      withdrawFee: f(a.withdrawFee),
      dailyWithdrawLimit: f(a.dailyWithdrawLimit),
      minExchange: f(a.minExchange),
    };
  }
}
