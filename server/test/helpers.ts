import { randomUUID } from 'node:crypto';
import { signInitData } from '../src/auth/telegram.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';
import { AssetRegistry } from '../src/domain/assets.js';
import { buildApp } from '../src/http/app.js';
import {
  type CreateInvoiceInput,
  type PaymentProvider,
  type ProviderInvoice,
  ProviderRejectedError,
  type ProviderTransfer,
  ProviderUnavailableError,
  type TransferInput,
} from '../src/providers/types.js';
import { type Notifier, WalletService } from '../src/services/wallet.js';

export const BOT_TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
export const CRYPTOPAY_TOKEN = '1234:AAtesttoken';
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/wallet_test';

export const silentLog = { info() {}, warn() {}, error() {} };

/** Programmable provider: each test decides how transfers behave. */
export class FakeProvider implements PaymentProvider {
  readonly name = 'cryptopay';
  invoices = new Map<string, ProviderInvoice>();
  transfers = new Map<string, ProviderTransfer>();
  transferCalls: TransferInput[] = [];
  transferBehavior: (input: TransferInput) => 'ok' | 'reject' | 'timeout' | 'timeout-after-send' = () => 'ok';
  rejectReason = 'INSUFFICIENT_FUNDS';

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const invoiceId = String(this.invoices.size + 1000);
    const inv: ProviderInvoice = {
      invoiceId,
      status: 'active',
      asset: input.asset,
      amount: input.amount,
      payload: input.payload,
      payUrl: `https://t.me/CryptoTestnetBot/app?startapp=invoice-${invoiceId}`,
    };
    this.invoices.set(invoiceId, inv);
    return { ...inv };
  }

  async getInvoices(ids: string[]): Promise<ProviderInvoice[]> {
    return ids.flatMap((id) => (this.invoices.has(id) ? [{ ...this.invoices.get(id)! }] : []));
  }

  pay(invoiceId: string): ProviderInvoice {
    const inv = this.invoices.get(invoiceId)!;
    inv.status = 'paid';
    return { ...inv };
  }

  async transfer(input: TransferInput): Promise<ProviderTransfer> {
    this.transferCalls.push(input);
    const existing = this.transfers.get(input.spendId);
    if (existing) throw new ProviderRejectedError('SPEND_ID_ALREADY_USED');
    const behavior = this.transferBehavior(input);
    if (behavior === 'reject') throw new ProviderRejectedError(this.rejectReason);
    if (behavior === 'timeout') throw new ProviderUnavailableError('timeout');
    const t: ProviderTransfer = { transferId: randomUUID(), status: 'completed' };
    this.transfers.set(input.spendId, t);
    if (behavior === 'timeout-after-send') throw new ProviderUnavailableError('timeout');
    return t;
  }

  async findTransfer(spendId: string): Promise<ProviderTransfer | null> {
    return this.transfers.get(spendId) ?? null;
  }
}

export class RecordingNotifier implements Notifier {
  messages: Array<{ userId: number; text: string }> = [];
  async notify(userId: number, text: string) {
    this.messages.push({ userId, text });
  }
}

let sharedDb: Db | undefined;

export async function getTestDb(): Promise<Db> {
  if (!sharedDb) {
    sharedDb = createPool(DATABASE_URL, 20);
    await sharedDb.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(sharedDb);
  }
  return sharedDb;
}

export async function resetDb(db: Db): Promise<void> {
  await db.query(
    'TRUNCATE ledger_entries, ledger_transactions, accounts, deposits, withdrawals, users RESTART IDENTITY CASCADE',
  );
}

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL,
    BOT_TOKEN,
    BOT_MODE: 'off',
    PAYMENT_PROVIDER: 'cryptopay',
    CRYPTOPAY_TOKEN,
    WORKERS_ENABLED: 'false',
    SERVE_STATIC: 'false',
    RATE_LIMIT_SENSITIVE_PER_MIN: '1000',
    ...overrides,
  });
}

export async function createTestApp(db: Db, overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  const assets = new AssetRegistry(config.ASSETS);
  const provider = new FakeProvider();
  const notifier = new RecordingNotifier();
  const wallet = new WalletService(db, assets, provider, notifier, silentLog);
  const app = await buildApp({ config, db, assets, provider, wallet });
  return { app, wallet, provider, notifier, config };
}

export function initDataFor(userId: number, extra: Partial<{ authDate: number; firstName: string }> = {}): string {
  return signInitData(
    {
      auth_date: String(extra.authDate ?? Math.floor(Date.now() / 1000)),
      query_id: 'AAH' + userId,
      user: JSON.stringify({ id: userId, first_name: extra.firstName ?? 'Test', username: `user${userId}` }),
    },
    BOT_TOKEN,
  );
}

export function authHeaders(userId: number, idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `tma ${initDataFor(userId)}`,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}
