import { SCALE, parseDecimal } from '../domain/decimal.js';
import { AppError } from '../domain/errors.js';
import type { ExchangeRate, PaymentProvider } from '../providers/types.js';

/**
 * Market prices of every currency in USD (scaled decimals), derived from the provider's
 * rate table and cached briefly. Fiat crosses go through USDT: USD→RUB = (USDT→RUB) / (USDT→USD).
 */
export function buildUsdPrices(rates: ExchangeRate[]): Map<string, bigint> {
  const table = new Map<string, bigint>();
  for (const r of rates) {
    try {
      const v = parseDecimal(r.rate);
      if (v > 0n) table.set(`${r.source}>${r.target}`, v);
    } catch {
      /* skip malformed rows */
    }
  }
  const prices = new Map<string, bigint>([['USD', SCALE]]);
  const usdPerUsdt = table.get('USDT>USD') ?? SCALE;
  prices.set('USDT', usdPerUsdt);
  for (const [key, rate] of table) {
    const [source, target] = key.split('>') as [string, string];
    if (source === 'USDT' && target !== 'USD') prices.set(target, (usdPerUsdt * SCALE) / rate);
    else if (target === 'USD' && source !== 'USDT') prices.set(source, rate);
  }
  return prices;
}

export class RatesService {
  private cache: { at: number; prices: Map<string, bigint> } | null = null;
  private inflight: Promise<Map<string, bigint>> | null = null;

  constructor(
    private readonly provider: PaymentProvider,
    private readonly ttlMs = 30_000,
  ) {}

  async prices(): Promise<Map<string, bigint>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.prices;
    this.inflight ??= this.provider
      .getRates()
      .then((rates) => {
        const prices = buildUsdPrices(rates);
        this.cache = { at: Date.now(), prices };
        return prices;
      })
      .catch((err) => {
        // A slightly stale table is better than no exchange at all, but not for long.
        if (this.cache && Date.now() - this.cache.at < 10 * 60_000) return this.cache.prices;
        throw new AppError('RATES_UNAVAILABLE', 'Курсы временно недоступны. Попробуйте через минуту', {
          cause: String(err),
        });
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async price(code: string): Promise<bigint> {
    const p = (await this.prices()).get(code);
    if (!p) throw new AppError('RATES_UNAVAILABLE', `Нет курса для ${code}`);
    return p;
  }
}
