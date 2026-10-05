import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreateInvoiceInput,
  type ExchangeRate,
  type PaymentProvider,
  type ProviderInvoice,
  type ProviderTransfer,
  ProviderRejectedError,
  ProviderUnavailableError,
  type TransferInput,
} from './types.js';

/** Crypto Pay API (@CryptoBot): https://help.crypt.bot/crypto-pay-api */

export interface CpInvoice {
  invoice_id: number;
  status: 'active' | 'paid' | 'expired';
  currency_type?: 'crypto' | 'fiat';
  asset?: string;
  fiat?: string;
  amount: string;
  payload?: string;
  bot_invoice_url?: string;
  mini_app_invoice_url?: string;
  pay_url?: string;
}

interface CpTransfer {
  transfer_id: number;
  spend_id: string;
  status: 'completed';
}

type CpResponse<T> = { ok: true; result: T } | { ok: false; error: { code: number; name: string } };

const BASE_URLS = {
  mainnet: 'https://pay.crypt.bot/api/',
  testnet: 'https://testnet-pay.crypt.bot/api/',
} as const;

export function toProviderInvoice(i: CpInvoice): ProviderInvoice {
  return {
    invoiceId: String(i.invoice_id),
    status: i.status,
    asset: (i.currency_type === 'fiat' ? i.fiat : i.asset) ?? '',
    amount: i.amount,
    payload: i.payload,
    payUrl: i.mini_app_invoice_url ?? i.bot_invoice_url ?? i.pay_url ?? '',
  };
}

export class CryptoPayProvider implements PaymentProvider {
  readonly name = 'cryptopay';
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    network: keyof typeof BASE_URLS,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    this.baseUrl = BASE_URLS[network];
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + method, {
        method: 'POST',
        headers: { 'Crypto-Pay-API-Token': this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderUnavailableError(`Crypto Pay ${method}: ${(err as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderUnavailableError(`Crypto Pay ${method}: HTTP ${res.status}`);
    }
    let body: CpResponse<T>;
    try {
      body = (await res.json()) as CpResponse<T>;
    } catch {
      throw new ProviderUnavailableError(`Crypto Pay ${method}: malformed response (HTTP ${res.status})`);
    }
    if (!body.ok) {
      throw new ProviderRejectedError(body.error?.name ?? `HTTP_${res.status}`, `Crypto Pay ${method}: ${body.error?.name}`);
    }
    return body.result;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const currency = input.fiat
      ? { currency_type: 'fiat', fiat: input.asset, accepted_assets: (input.acceptedAssets ?? ['USDT', 'TON']).join(',') }
      : { currency_type: 'crypto', asset: input.asset };
    const inv = await this.call<CpInvoice>('createInvoice', {
      ...currency,
      amount: input.amount,
      description: input.description.slice(0, 1024),
      payload: input.payload,
      allow_comments: false,
      allow_anonymous: false,
      expires_in: input.expiresInSec,
    });
    return toProviderInvoice(inv);
  }

  async getInvoices(invoiceIds: string[]): Promise<ProviderInvoice[]> {
    if (invoiceIds.length === 0) return [];
    const res = await this.call<{ items: CpInvoice[] }>('getInvoices', {
      invoice_ids: invoiceIds.join(','),
      count: Math.min(invoiceIds.length, 1000),
    });
    return res.items.map(toProviderInvoice);
  }

  async transfer(input: TransferInput): Promise<ProviderTransfer> {
    const t = await this.call<CpTransfer>('transfer', {
      user_id: input.telegramUserId,
      asset: input.asset,
      amount: input.amount,
      spend_id: input.spendId,
      comment: input.comment?.slice(0, 1024),
    });
    return { transferId: String(t.transfer_id), status: 'completed' };
  }

  async getRates(): Promise<ExchangeRate[]> {
    const items = await this.call<Array<{ is_valid: boolean; source: string; target: string; rate: string }>>(
      'getExchangeRates',
      {},
    );
    return items.filter((r) => r.is_valid).map((r) => ({ source: r.source, target: r.target, rate: r.rate }));
  }

  async findTransfer(spendId: string, asset: string): Promise<ProviderTransfer | null> {
    const res = await this.call<{ items: CpTransfer[] }>('getTransfers', { asset, spend_id: spendId, count: 1 });
    const t = res.items.find((i) => i.spend_id === spendId);
    return t ? { transferId: String(t.transfer_id), status: 'completed' } : null;
  }
}

/** Verifies the `crypto-pay-api-signature` header of a webhook request. */
export function verifyCryptoPaySignature(rawBody: Buffer, signature: string | undefined, token: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const secret = createHash('sha256').update(token).digest();
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface CryptoPayWebhookUpdate {
  update_id: number;
  update_type: string;
  request_date: string;
  payload: CpInvoice;
}
