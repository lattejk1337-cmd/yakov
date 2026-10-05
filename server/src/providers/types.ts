/**
 * A payment provider moves real money in and out of the wallet.
 * Amounts cross this boundary as decimal strings in whole coins ("12.5").
 */

export interface CreateInvoiceInput {
  /** Invoice currency: a crypto asset, or a fiat code when `fiat` is set. */
  asset: string;
  amount: string;
  /** Fiat-denominated invoice: the payer pays the equivalent in one of `acceptedAssets`. */
  fiat?: boolean;
  acceptedAssets?: string[];
  /** Our deposit id; echoed back by the provider so we can match payments. */
  payload: string;
  description: string;
  expiresInSec: number;
}

export interface ProviderInvoice {
  invoiceId: string;
  status: 'active' | 'paid' | 'expired';
  /** Invoice currency (fiat code for fiat invoices). */
  asset: string;
  amount: string;
  payload?: string;
  /** URL that opens the payment UI inside Telegram. */
  payUrl: string;
}

export interface TransferInput {
  telegramUserId: number;
  asset: string;
  amount: string;
  /** Idempotency key; the provider accepts a given spendId at most once. */
  spendId: string;
  comment?: string;
}

export interface ProviderTransfer {
  transferId: string;
  status: 'completed';
}

/** The provider processed the request and definitively refused it — no money moved. */
export class ProviderRejectedError extends Error {
  constructor(
    readonly reason: string,
    message = reason,
  ) {
    super(message);
  }
}

/** Network error, timeout or 5xx: the outcome is unknown and must be reconciled. */
export class ProviderUnavailableError extends Error {}

/** 1 `source` = `rate` `target`, e.g. USDT → RUB = 92.5 */
export interface ExchangeRate {
  source: string;
  target: string;
  rate: string;
}

export interface PaymentProvider {
  readonly name: string;
  createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice>;
  getInvoices(invoiceIds: string[]): Promise<ProviderInvoice[]>;
  transfer(input: TransferInput): Promise<ProviderTransfer>;
  /** Looks up a transfer by idempotency key; null if the provider never executed it. */
  findTransfer(spendId: string, asset: string): Promise<ProviderTransfer | null>;
  getRates(): Promise<ExchangeRate[]>;
}
