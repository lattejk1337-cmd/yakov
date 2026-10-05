import { randomUUID } from 'node:crypto';
import type {
  CreateInvoiceInput,
  ExchangeRate,
  PaymentProvider,
  ProviderInvoice,
  ProviderTransfer,
  TransferInput,
} from './types.js';

/**
 * In-memory provider for local development: invoices are "paid" through a fake page
 * served by the dev routes. Never enabled in production (enforced by config).
 */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly invoices = new Map<string, ProviderInvoice>();
  private readonly transfers = new Map<string, ProviderTransfer>();

  constructor(private readonly publicUrl: string) {}

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const invoiceId = randomUUID();
    const invoice: ProviderInvoice = {
      invoiceId,
      status: 'active',
      asset: input.asset,
      amount: input.amount,
      payload: input.payload,
      payUrl: `${this.publicUrl.replace(/\/$/, '')}/api/dev/mock-pay/${invoiceId}`,
    };
    this.invoices.set(invoiceId, invoice);
    return { ...invoice };
  }

  async getInvoices(invoiceIds: string[]): Promise<ProviderInvoice[]> {
    return invoiceIds.flatMap((id) => {
      const i = this.invoices.get(id);
      return i ? [{ ...i }] : [];
    });
  }

  getInvoice(invoiceId: string): ProviderInvoice | undefined {
    return this.invoices.get(invoiceId);
  }

  markPaid(invoiceId: string): ProviderInvoice | undefined {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.status !== 'active') return inv;
    inv.status = 'paid';
    return { ...inv };
  }

  async transfer(input: TransferInput): Promise<ProviderTransfer> {
    const existing = this.transfers.get(input.spendId);
    if (existing) return existing;
    const t: ProviderTransfer = { transferId: randomUUID(), status: 'completed' };
    this.transfers.set(input.spendId, t);
    return t;
  }

  async findTransfer(spendId: string): Promise<ProviderTransfer | null> {
    return this.transfers.get(spendId) ?? null;
  }

  /** Plausible fixed market rates for local development. */
  async getRates(): Promise<ExchangeRate[]> {
    return MOCK_RATES.map((r) => ({ ...r }));
  }
}

export const MOCK_RATES: ExchangeRate[] = [
  { source: 'USDT', target: 'USD', rate: '1' },
  { source: 'USDT', target: 'EUR', rate: '0.92' },
  { source: 'USDT', target: 'RUB', rate: '92.5' },
  { source: 'USDT', target: 'CNY', rate: '7.25' },
  { source: 'TON', target: 'USD', rate: '5.2' },
];
