import { randomUUID } from 'node:crypto';
import type { TokenSigner } from '../auth/tokens.js';
import { type Db, isUniqueViolation, type Queryable, withTx } from '../db/pool.js';
import type { AssetConfig, AssetRegistry } from '../domain/assets.js';
import { convertUnits, formatDecimal, SCALE } from '../domain/decimal.js';
import { AppError } from '../domain/errors.js';
import { formatAmount, InvalidAmountError, parseAmount } from '../domain/money.js';
import {
  type PaymentProvider,
  type ProviderInvoice,
  ProviderRejectedError,
  type ProviderTransfer,
} from '../providers/types.js';
import { getOrCreateSystemAccount, getOrCreateUserAccount, postTransaction, SYSTEM } from './ledger.js';
import { verifyPin } from './pin.js';
import type { RatesService } from './rates.js';

export interface Notifier {
  notify(userId: number, text: string): Promise<void>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const DEPOSIT_TTL_SEC = 60 * 60;
export const MAX_OPEN_DEPOSITS = 5;
export const WITHDRAW_MAX_ATTEMPTS = 5;
export const QUOTE_TTL_SEC = 30;

/** Exchange settings: market rates, the signer for locked quotes, and the spread in basis points. */
export interface FxOptions {
  rates: RatesService;
  signer: TokenSigner;
  feeBps: number;
}

type DepositStatus = 'created' | 'pending' | 'paid' | 'expired' | 'failed';
type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'review';

interface DepositRow {
  id: string;
  user_id: string;
  asset: string;
  amount: string;
  status: DepositStatus;
  provider_invoice_id: string | null;
  pay_url: string | null;
  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  asset: string;
  amount: string;
  fee: string;
  status: WithdrawalStatus;
  payout_asset: string;
  payout_amount: string;
  failure_reason: string | null;
  attempts: number;
  completed_at: Date | null;
  created_at: Date;
}

interface ExchangeRow {
  id: string;
  user_id: string;
  from_asset: string;
  to_asset: string;
  from_amount: string;
  to_amount: string;
  fee: string;
  rate: string;
  created_at: Date;
}

interface QuotePayload {
  q: string; // quote id
  u: number;
  f: string;
  t: string;
  a: string; // from amount, minor units
  g: string; // gross to amount
  n: string; // net to amount (credited)
  r: string; // display rate
}

export interface DepositView {
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

export interface WithdrawalView {
  id: string;
  type: 'withdrawal';
  asset: string;
  amount: string;
  fee: string;
  total: string;
  /** What the user receives in @CryptoBot (fiat is paid out in crypto at the market rate). */
  payoutAsset: string;
  payoutAmount: string;
  /** Public status: 'review' is an internal state and is shown as 'processing'. */
  status: Exclude<WithdrawalStatus, 'review' | 'pending'>;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ExchangeView {
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

export interface ExchangeQuote {
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

export type HistoryItem = DepositView | WithdrawalView | ExchangeView;

const USER_FACING_FAILURES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Сервис временно не может провести вывод. Средства возвращены на баланс',
  USER_NOT_FOUND: 'Сначала запустите @CryptoBot — на него поступят средства',
};

export class WalletService {
  constructor(
    private readonly db: Db,
    private readonly assets: AssetRegistry,
    private readonly provider: PaymentProvider,
    private readonly notifier: Notifier,
    private readonly log: Logger,
    private readonly fx: FxOptions,
  ) {}

  // ───────────────────────────── helpers ─────────────────────────────

  private asset(code: string): AssetConfig {
    const a = this.assets.get(code);
    if (!a) throw new AppError('UNKNOWN_ASSET', 'Неизвестный актив');
    return a;
  }

  private parse(a: AssetConfig, amount: string): bigint {
    try {
      const v = parseAmount(amount, a.decimals, a.inputDecimals);
      if (v <= 0n) throw new InvalidAmountError('must be positive');
      return v;
    } catch (err) {
      if (err instanceof InvalidAmountError) throw new AppError('INVALID_AMOUNT', 'Некорректная сумма');
      throw err;
    }
  }

  private checkBounds(a: AssetConfig, v: bigint, min: bigint, max: bigint): void {
    if (v < min) {
      throw new AppError('AMOUNT_TOO_SMALL', `Минимальная сумма — ${formatAmount(min, a.decimals)} ${a.code}`, {
        min: formatAmount(min, a.decimals),
      });
    }
    if (v > max) {
      throw new AppError('AMOUNT_TOO_LARGE', `Максимальная сумма — ${formatAmount(max, a.decimals)} ${a.code}`, {
        max: formatAmount(max, a.decimals),
      });
    }
  }

  private fmt(asset: string, v: string | bigint): string {
    return this.assets.format(asset, BigInt(v));
  }

  /** "1250.5 ₽" for messages. */
  private money(asset: string, v: string | bigint): string {
    const a = this.assets.catalog(asset);
    return `${this.fmt(asset, v)} ${a?.symbol ?? asset}`;
  }

  private depositView(r: DepositRow): DepositView {
    return {
      id: r.id,
      type: 'deposit',
      asset: r.asset,
      amount: this.fmt(r.asset, r.amount),
      status: r.status,
      payUrl: r.status === 'pending' ? r.pay_url : null,
      expiresAt: r.expires_at.toISOString(),
      paidAt: r.paid_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    };
  }

  private withdrawalView(r: WithdrawalRow): WithdrawalView {
    const amount = BigInt(r.amount);
    const fee = BigInt(r.fee);
    return {
      id: r.id,
      type: 'withdrawal',
      asset: r.asset,
      amount: this.fmt(r.asset, amount),
      fee: this.fmt(r.asset, fee),
      total: this.fmt(r.asset, amount + fee),
      payoutAsset: r.payout_asset,
      payoutAmount: this.fmt(r.payout_asset, r.payout_amount),
      status: r.status === 'review' || r.status === 'pending' ? 'processing' : r.status,
      failureReason: r.status === 'failed' ? (r.failure_reason ?? 'Вывод отклонён') : null,
      completedAt: r.completed_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    };
  }

  // ───────────────────────────── deposits ─────────────────────────────

  async createDeposit(userId: number, assetCode: string, amountStr: string, idempotencyKey: string): Promise<DepositView> {
    const a = this.asset(assetCode);
    const amount = this.parse(a, amountStr);
    this.checkBounds(a, amount, a.minDeposit, a.maxDeposit);

    const existing = await this.findDepositByKey(this.db, userId, idempotencyKey);
    if (existing) return this.replayDeposit(existing, a.code, amount);

    const open = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deposits
       WHERE user_id = $1 AND status IN ('created', 'pending') AND expires_at > now()`,
      [userId],
    );
    if (open.rows[0]!.n >= MAX_OPEN_DEPOSITS) {
      throw new AppError('TOO_MANY_PENDING', 'Слишком много неоплаченных счетов. Оплатите или дождитесь их истечения');
    }

    const id = randomUUID();
    const inserted = await this.db.query<DepositRow>(
      `INSERT INTO deposits (id, user_id, asset, amount, status, provider, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, 'created', $5, $6, now() + make_interval(secs => $7))
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [id, userId, a.code, amount.toString(), this.provider.name, idempotencyKey, DEPOSIT_TTL_SEC],
    );
    if (inserted.rowCount === 0) {
      // Lost a race with a concurrent request carrying the same key.
      const row = await this.findDepositByKey(this.db, userId, idempotencyKey);
      return this.replayDeposit(row!, a.code, amount);
    }

    let invoice: ProviderInvoice;
    try {
      invoice = await this.provider.createInvoice({
        asset: a.code,
        amount: formatAmount(amount, a.decimals),
        fiat: a.kind === 'fiat',
        acceptedAssets: a.kind === 'fiat' ? ['USDT', 'TON'] : undefined,
        payload: id,
        description: `Пополнение Tonum Wallet на ${this.money(a.code, amount)}`,
        expiresInSec: DEPOSIT_TTL_SEC,
      });
    } catch (err) {
      this.log.error({ err, depositId: id }, 'createInvoice failed');
      await this.db.query(`UPDATE deposits SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'created'`, [id]);
      throw new AppError('PROVIDER_ERROR', 'Платёжный сервис недоступен. Попробуйте позже');
    }

    const updated = await this.db.query<DepositRow>(
      `UPDATE deposits SET status = 'pending', provider_invoice_id = $2, pay_url = $3, updated_at = now()
       WHERE id = $1 AND status = 'created' RETURNING *`,
      [id, invoice.invoiceId, invoice.payUrl],
    );
    // If the webhook already credited it in the meantime, just return the current state.
    const row = updated.rows[0] ?? (await this.getDepositRow(this.db, id))!;
    return this.depositView(row);
  }

  private replayDeposit(row: DepositRow, asset: string, amount: bigint): DepositView {
    if (row.asset !== asset || BigInt(row.amount) !== amount) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Ключ идемпотентности уже использован с другими параметрами');
    }
    return this.depositView(row);
  }

  private async findDepositByKey(q: Queryable, userId: number, key: string): Promise<DepositRow | null> {
    const r = await q.query<DepositRow>(`SELECT * FROM deposits WHERE user_id = $1 AND idempotency_key = $2`, [userId, key]);
    return r.rows[0] ?? null;
  }

  private async getDepositRow(q: Queryable, id: string): Promise<DepositRow | null> {
    const r = await q.query<DepositRow>(`SELECT * FROM deposits WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async getDeposit(userId: number, id: string): Promise<DepositView> {
    const r = await this.db.query<DepositRow>(`SELECT * FROM deposits WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!r.rows[0]) throw new AppError('NOT_FOUND', 'Пополнение не найдено');
    return this.depositView(r.rows[0]);
  }

  /**
   * Credits a deposit for a paid invoice. Safe to call any number of times and from
   * both the webhook and the reconciler: the deposit row lock plus the unique ledger
   * reference guarantee a single credit.
   */
  async creditDeposit(invoice: ProviderInvoice): Promise<boolean> {
    if (invoice.status !== 'paid') return false;
    const depositId = invoice.payload ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(depositId)) {
      this.log.warn({ invoiceId: invoice.invoiceId }, 'paid invoice without a deposit payload');
      return false;
    }

    const credited = await withTx(this.db, async (c) => {
      const res = await c.query<DepositRow>(`SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [depositId]);
      const dep = res.rows[0];
      if (!dep) {
        this.log.warn({ depositId, invoiceId: invoice.invoiceId }, 'paid invoice for unknown deposit');
        return null;
      }
      if (dep.status === 'paid') return null;

      const a = this.asset(dep.asset);
      let paidAmount: bigint;
      try {
        paidAmount = parseAmount(invoice.amount, a.decimals);
      } catch {
        paidAmount = -1n;
      }
      const invoiceMismatch = dep.provider_invoice_id !== null && dep.provider_invoice_id !== invoice.invoiceId;
      if (invoiceMismatch || invoice.asset !== dep.asset || paidAmount !== BigInt(dep.amount)) {
        this.log.error({ depositId, invoice }, 'paid invoice does not match deposit — manual review required');
        return null;
      }

      await c.query(
        `UPDATE deposits SET status = 'paid', paid_at = now(), provider_invoice_id = $2, updated_at = now() WHERE id = $1`,
        [dep.id, invoice.invoiceId],
      );
      const userAcc = await getOrCreateUserAccount(c, Number(dep.user_id), dep.asset);
      const providerAcc = await getOrCreateSystemAccount(c, SYSTEM.provider(this.provider.name), dep.asset);
      const amount = BigInt(dep.amount);
      await postTransaction(c, 'deposit', dep.id, [
        { accountId: userAcc, amount },
        { accountId: providerAcc, amount: -amount, allowNegative: true },
      ]);
      return dep;
    });

    if (!credited) return false;
    this.log.info({ depositId: credited.id }, 'deposit credited');
    await this.safeNotify(
      Number(credited.user_id),
      `✅ Пополнение на ${this.money(credited.asset, credited.amount)} зачислено`,
    );
    return true;
  }

  /** Catches up on payments whose webhook was lost and expires stale invoices. */
  async reconcileDeposits(): Promise<void> {
    const open = await this.db.query<{ id: string; provider_invoice_id: string }>(
      `SELECT id, provider_invoice_id FROM deposits
       WHERE status = 'pending' AND provider = $1 AND provider_invoice_id IS NOT NULL
         AND created_at > now() - interval '3 days'
       ORDER BY created_at LIMIT 500`,
      [this.provider.name],
    );
    if (open.rows.length > 0) {
      const invoices = await this.provider.getInvoices(open.rows.map((r) => r.provider_invoice_id));
      for (const inv of invoices) {
        if (inv.status === 'paid') {
          await this.creditDeposit(inv);
        } else if (inv.status === 'expired') {
          await this.db.query(
            `UPDATE deposits SET status = 'expired', updated_at = now()
             WHERE provider = $1 AND provider_invoice_id = $2 AND status = 'pending'`,
            [this.provider.name, inv.invoiceId],
          );
        }
      }
    }
    await this.db.query(
      `UPDATE deposits SET status = 'expired', updated_at = now()
       WHERE status = 'created' AND expires_at < now()`,
    );
  }

  // ──────────────────────────── withdrawals ────────────────────────────

  async createWithdrawal(
    userId: number,
    assetCode: string,
    amountStr: string,
    pin: string,
    idempotencyKey: string,
  ): Promise<WithdrawalView> {
    const a = this.asset(assetCode);
    const amount = this.parse(a, amountStr);
    this.checkBounds(a, amount, a.minWithdraw, a.maxWithdraw);
    const fee = a.withdrawFee;
    const total = amount + fee;

    await verifyPin(this.db, userId, pin);

    const existing = await this.findWithdrawalByKey(this.db, userId, idempotencyKey);
    if (existing) return this.replayWithdrawal(existing, a.code, amount);

    const payout = await this.payoutFor(a, amount);

    const created = await withTx(this.db, async (c) => {
      const userAcc = await getOrCreateUserAccount(c, userId, a.code);
      // Row lock serializes this user's withdrawals so the daily limit check is exact.
      const acc = await c.query<{ balance: string }>(`SELECT balance FROM accounts WHERE id = $1 FOR UPDATE`, [userAcc]);
      const balance = BigInt(acc.rows[0]!.balance);

      const daily = await c.query<{ sum: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM withdrawals
         WHERE user_id = $1 AND asset = $2 AND status <> 'failed' AND created_at > now() - interval '24 hours'`,
        [userId, a.code],
      );
      const usedToday = BigInt(daily.rows[0]!.sum);
      if (usedToday + amount > a.dailyWithdrawLimit) {
        const left = a.dailyWithdrawLimit > usedToday ? a.dailyWithdrawLimit - usedToday : 0n;
        throw new AppError('DAILY_LIMIT_EXCEEDED', `Превышен суточный лимит. Доступно: ${formatAmount(left, a.decimals)} ${a.code}`, {
          available: formatAmount(left, a.decimals),
        });
      }
      if (balance < total) {
        throw new AppError('INSUFFICIENT_FUNDS', 'Недостаточно средств с учётом комиссии', {
          balance: formatAmount(balance, a.decimals),
        });
      }

      const id = randomUUID();
      const ins = await c.query<WithdrawalRow>(
        `INSERT INTO withdrawals (id, user_id, asset, amount, fee, status, provider, idempotency_key, payout_asset, payout_amount)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          id,
          userId,
          a.code,
          amount.toString(),
          fee.toString(),
          this.provider.name,
          idempotencyKey,
          payout.asset,
          payout.amount.toString(),
        ],
      );
      if (ins.rowCount === 0) return null;

      const providerAcc = await getOrCreateSystemAccount(c, SYSTEM.provider(this.provider.name), a.code);
      const postings = [
        { accountId: userAcc, amount: -total },
        { accountId: providerAcc, amount, allowNegative: true },
      ];
      if (fee > 0n) {
        postings.push({ accountId: await getOrCreateSystemAccount(c, SYSTEM.fees, a.code), amount: fee, allowNegative: true });
      }
      await postTransaction(c, 'withdrawal', id, postings);
      return ins.rows[0]!;
    });

    if (!created) {
      const row = await this.findWithdrawalByKey(this.db, userId, idempotencyKey);
      return this.replayWithdrawal(row!, a.code, amount);
    }

    this.log.info({ withdrawalId: created.id, userId, asset: a.code }, 'withdrawal created');
    await this.processWithdrawal(created.id);
    return this.withdrawalView((await this.getWithdrawalRow(this.db, created.id))!);
  }

  /**
   * What actually leaves through the provider. Crypto goes out as is; fiat is converted to its
   * payout asset (USDT) at the market rate minus the exchange spread, rounded down.
   */
  private async payoutFor(a: AssetConfig, amount: bigint): Promise<{ asset: string; amount: bigint }> {
    if (a.payoutAsset === a.code) return { asset: a.code, amount };
    const out = this.assets.catalog(a.payoutAsset)!;
    const [pa, po] = await Promise.all([this.fx.rates.price(a.code), this.fx.rates.price(out.code)]);
    const gross = convertUnits(amount, { decimals: a.decimals, price: pa }, { decimals: out.decimals, price: po });
    const step = 10n ** BigInt(out.decimals - out.inputDecimals);
    let net = gross - (gross * BigInt(this.fx.feeBps)) / 10_000n;
    net -= net % step;
    if (net <= 0n) throw new AppError('AMOUNT_TOO_SMALL', 'Сумма слишком мала для вывода');
    return { asset: out.code, amount: net };
  }

  private replayWithdrawal(row: WithdrawalRow, asset: string, amount: bigint): WithdrawalView {
    if (row.asset !== asset || BigInt(row.amount) !== amount) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Ключ идемпотентности уже использован с другими параметрами');
    }
    return this.withdrawalView(row);
  }

  private async findWithdrawalByKey(q: Queryable, userId: number, key: string): Promise<WithdrawalRow | null> {
    const r = await q.query<WithdrawalRow>(`SELECT * FROM withdrawals WHERE user_id = $1 AND idempotency_key = $2`, [userId, key]);
    return r.rows[0] ?? null;
  }

  private async getWithdrawalRow(q: Queryable, id: string): Promise<WithdrawalRow | null> {
    const r = await q.query<WithdrawalRow>(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async getWithdrawal(userId: number, id: string): Promise<WithdrawalView> {
    const r = await this.db.query<WithdrawalRow>(`SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!r.rows[0]) throw new AppError('NOT_FOUND', 'Вывод не найден');
    return this.withdrawalView(r.rows[0]);
  }

  /**
   * Sends a held withdrawal to the provider. The withdrawal id doubles as the provider's
   * idempotency key (spend_id), so a retry can never pay twice. Outcomes:
   *  - success            → completed
   *  - definite rejection → failed, funds returned to the user
   *  - unknown outcome    → stays processing and is retried later; after
   *                         WITHDRAW_MAX_ATTEMPTS it is parked in 'review' with funds held.
   */
  async processWithdrawal(id: string): Promise<void> {
    const claim = await this.db.query<WithdrawalRow>(
      `UPDATE withdrawals
       SET status = 'processing', attempts = attempts + 1, updated_at = now(),
           next_attempt_at = now() + make_interval(secs => LEAST(60 * (attempts + 1), 600))
       WHERE id = $1 AND status IN ('pending', 'processing') AND next_attempt_at <= now()
       RETURNING *`,
      [id],
    );
    const w = claim.rows[0];
    if (!w) return; // completed, failed, or claimed by another worker

    const out = this.assets.catalog(w.payout_asset)!;
    const transferInput = {
      telegramUserId: Number(w.user_id),
      asset: out.code,
      amount: formatAmount(BigInt(w.payout_amount), out.decimals),
      spendId: w.id,
      comment: 'Вывод из Tonum Wallet',
    };

    try {
      if (w.attempts > 1) {
        const prior = await this.provider.findTransfer(w.id, w.payout_asset);
        if (prior) return await this.completeWithdrawal(w, prior);
      }
      const transfer = await this.provider.transfer(transferInput);
      await this.completeWithdrawal(w, transfer);
    } catch (err) {
      if (err instanceof ProviderRejectedError) {
        try {
          // After an earlier unknown outcome the rejection may just mean "already sent".
          const prior = w.attempts > 1 ? await this.provider.findTransfer(w.id, w.payout_asset) : null;
          if (prior) return await this.completeWithdrawal(w, prior);
          await this.failWithdrawal(w, err.reason);
        } catch (lookupErr) {
          this.log.warn({ err: lookupErr, withdrawalId: w.id }, 'transfer lookup failed; will retry');
        }
        return;
      }
      this.log.warn({ err, withdrawalId: w.id, attempt: w.attempts }, 'transfer outcome unknown; will retry');
      if (w.attempts >= WITHDRAW_MAX_ATTEMPTS) {
        await this.db.query(
          `UPDATE withdrawals SET status = 'review', updated_at = now() WHERE id = $1 AND status = 'processing'`,
          [w.id],
        );
        this.log.error({ withdrawalId: w.id }, 'withdrawal moved to manual review');
      }
    }
  }

  private async completeWithdrawal(w: WithdrawalRow, t: ProviderTransfer): Promise<void> {
    const res = await this.db.query(
      `UPDATE withdrawals SET status = 'completed', provider_transfer_id = $2, completed_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('processing', 'review')`,
      [w.id, t.transferId],
    );
    if (res.rowCount === 0) return;
    this.log.info({ withdrawalId: w.id }, 'withdrawal completed');
    await this.safeNotify(Number(w.user_id), `💸 Вывод ${this.money(w.asset, w.amount)} выполнен — ${this.money(w.payout_asset, w.payout_amount)} в @CryptoBot`);
  }

  private async failWithdrawal(w: WithdrawalRow, reason: string): Promise<void> {
    const failed = await withTx(this.db, async (c) => {
      const res = await c.query<WithdrawalRow>(
        `UPDATE withdrawals SET status = 'failed', failure_reason = $2, updated_at = now()
         WHERE id = $1 AND status IN ('processing', 'review') RETURNING *`,
        [w.id, USER_FACING_FAILURES[reason] ?? 'Вывод отклонён платёжным сервисом. Средства возвращены на баланс'],
      );
      const row = res.rows[0];
      if (!row) return null;
      const amount = BigInt(row.amount);
      const fee = BigInt(row.fee);
      const userAcc = await getOrCreateUserAccount(c, Number(row.user_id), row.asset);
      const providerAcc = await getOrCreateSystemAccount(c, SYSTEM.provider(this.provider.name), row.asset);
      const postings = [
        { accountId: userAcc, amount: amount + fee },
        { accountId: providerAcc, amount: -amount, allowNegative: true },
      ];
      if (fee > 0n) {
        postings.push({ accountId: await getOrCreateSystemAccount(c, SYSTEM.fees, row.asset), amount: -fee, allowNegative: true });
      }
      await postTransaction(c, 'withdrawal_refund', row.id, postings);
      return row;
    });
    if (!failed) return;
    this.log.warn({ withdrawalId: w.id, reason }, 'withdrawal rejected and refunded');
    await this.safeNotify(
      Number(w.user_id),
      `↩️ Вывод ${this.money(w.asset, w.amount)} не выполнен. Средства возвращены на баланс`,
    );
  }

  /** Amount withdrawn per asset over the rolling 24h window used by the daily limit. */
  async withdrawnToday(userId: number): Promise<Map<string, bigint>> {
    const res = await this.db.query<{ asset: string; sum: string }>(
      `SELECT asset, SUM(amount)::text AS sum FROM withdrawals
       WHERE user_id = $1 AND status <> 'failed' AND created_at > now() - interval '24 hours'
       GROUP BY asset`,
      [userId],
    );
    return new Map(res.rows.map((r) => [r.asset, BigInt(r.sum)]));
  }

  /** Picks up withdrawals that are due (new ones and retries after unknown outcomes). */
  async processDueWithdrawals(limit = 20): Promise<void> {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM withdrawals
       WHERE status IN ('pending', 'processing') AND next_attempt_at <= now()
       ORDER BY next_attempt_at LIMIT $1`,
      [limit],
    );
    for (const { id } of due.rows) {
      await this.processWithdrawal(id).catch((err) => this.log.error({ err, withdrawalId: id }, 'processWithdrawal crashed'));
    }
  }

  // ─────────────────────────────── history ───────────────────────────────

  async history(userId: number, opts: { cursor?: string; limit: number }): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    let cursorTs: string | null = null;
    let cursorId: string | null = null;
    if (opts.cursor) {
      const decoded = Buffer.from(opts.cursor, 'base64url').toString('utf8');
      const sep = decoded.lastIndexOf('|');
      cursorTs = decoded.slice(0, sep);
      cursorId = decoded.slice(sep + 1);
      if (!cursorTs || !/^[0-9a-f-]{36}$/i.test(cursorId) || Number.isNaN(Date.parse(cursorTs))) {
        throw new AppError('VALIDATION_ERROR', 'Некорректный курсор');
      }
    }

    // Page over the ids of all three kinds of operations, then load the full rows.
    const page = await this.db.query<{ type: 'deposit' | 'withdrawal' | 'exchange'; id: string; ts: string }>(
      `SELECT type, id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts FROM (
         SELECT 'deposit' AS type, id, created_at FROM deposits WHERE user_id = $1 AND status = 'paid'
         UNION ALL
         SELECT 'withdrawal', id, created_at FROM withdrawals WHERE user_id = $1
         UNION ALL
         SELECT 'exchange', id, created_at FROM exchanges WHERE user_id = $1
       ) t
       WHERE $2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [userId, cursorTs, cursorId, opts.limit + 1],
    );
    const rows = page.rows.slice(0, opts.limit);
    const ids = (type: string) => rows.filter((r) => r.type === type).map((r) => r.id);
    const [deps, wds, exs] = await Promise.all([
      this.db.query<DepositRow>(`SELECT * FROM deposits WHERE id = ANY($1::uuid[])`, [ids('deposit')]),
      this.db.query<WithdrawalRow>(`SELECT * FROM withdrawals WHERE id = ANY($1::uuid[])`, [ids('withdrawal')]),
      this.db.query<ExchangeRow>(`SELECT * FROM exchanges WHERE id = ANY($1::uuid[])`, [ids('exchange')]),
    ]);
    const views = new Map<string, HistoryItem>();
    for (const r of deps.rows) views.set(r.id, this.depositView(r));
    for (const r of wds.rows) views.set(r.id, this.withdrawalView(r));
    for (const r of exs.rows) views.set(r.id, this.exchangeView(r));
    const items = rows.map((r) => views.get(r.id)).filter((v): v is HistoryItem => Boolean(v));

    const last = rows[rows.length - 1];
    // The cursor carries a microsecond-exact timestamp: JS Dates only keep milliseconds.
    const nextCursor =
      page.rows.length > opts.limit && last ? Buffer.from(`${last.ts}|${last.id}`).toString('base64url') : null;
    return { items, nextCursor };
  }

  // ─────────────────────────────── exchange ───────────────────────────────

  private exchangeView(r: ExchangeRow): ExchangeView {
    return {
      id: r.id,
      type: 'exchange',
      status: 'completed',
      fromAsset: r.from_asset,
      fromAmount: this.fmt(r.from_asset, r.from_amount),
      toAsset: r.to_asset,
      toAmount: this.fmt(r.to_asset, r.to_amount),
      fee: this.fmt(r.to_asset, r.fee),
      rate: r.rate,
      createdAt: r.created_at.toISOString(),
    };
  }

  /** Market prices in USD for every enabled currency, for display (total balance, rate hints). */
  async marketPrices(): Promise<Record<string, string>> {
    const prices = await this.fx.rates.prices();
    const out: Record<string, string> = {};
    // Payout assets (USDT) too, so the app can estimate what a fiat withdrawal pays out.
    const codes = new Set([...this.assets.list().map((a) => a.code), ...this.assets.list().map((a) => a.payoutAsset)]);
    for (const code of codes) {
      const p = prices.get(code);
      if (p) out[code] = formatDecimal(p, 10);
    }
    return out;
  }

  /**
   * Prices an exchange and locks it for QUOTE_TTL_SEC in a signed token, so the user confirms
   * exactly the numbers they saw. The spread is shown separately as a fee in the target currency.
   */
  async quoteExchange(userId: number, fromCode: string, toCode: string, amountStr: string): Promise<ExchangeQuote> {
    const from = this.asset(fromCode);
    const to = this.asset(toCode);
    if (from.code === to.code) throw new AppError('SAME_CURRENCY', 'Выберите разные валюты');
    const amount = this.parse(from, amountStr);
    if (amount < from.minExchange) {
      throw new AppError('AMOUNT_TOO_SMALL', `Минимум для обмена — ${this.money(from.code, from.minExchange)}`, {
        min: formatAmount(from.minExchange, from.decimals),
      });
    }

    const [pf, pt] = await Promise.all([this.fx.rates.price(from.code), this.fx.rates.price(to.code)]);
    const gross = convertUnits(amount, { decimals: from.decimals, price: pf }, { decimals: to.decimals, price: pt });
    const fee = (gross * BigInt(this.fx.feeBps) + 9_999n) / 10_000n; // rounded up: never undercharge
    const net = gross - fee;
    if (net <= 0n) throw new AppError('AMOUNT_TOO_SMALL', 'Сумма слишком мала для обмена');

    const rate = (pf * SCALE) / pt;
    const digits = rate >= 100n * SCALE ? 2 : rate >= SCALE ? 4 : 6;
    const payload: QuotePayload = {
      q: randomUUID(),
      u: userId,
      f: from.code,
      t: to.code,
      a: amount.toString(),
      g: gross.toString(),
      n: net.toString(),
      r: formatDecimal(rate, digits),
    };
    const token = this.fx.signer.sign('quote', payload, QUOTE_TTL_SEC);
    const exp = this.fx.signer.verify<QuotePayload>('quote', token)!.exp;
    return {
      quoteToken: token,
      fromAsset: from.code,
      toAsset: to.code,
      fromAmount: formatAmount(amount, from.decimals),
      toAmount: formatAmount(net, to.decimals),
      fee: formatAmount(fee, to.decimals),
      feePercent: formatDecimal((BigInt(this.fx.feeBps) * SCALE) / 100n, 2),
      rate: payload.r,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  /** Executes a quote atomically: both legs and the fee post in one balanced ledger transaction. */
  async executeExchange(userId: number, quoteToken: string, idempotencyKey: string): Promise<ExchangeView> {
    const existing = await this.db.query<ExchangeRow>(
      `SELECT * FROM exchanges WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (existing.rows[0]) return this.exchangeView(existing.rows[0]);

    const q = this.fx.signer.verify<QuotePayload>('quote', quoteToken);
    if (!q) throw new AppError('QUOTE_EXPIRED', 'Курс обновился — проверьте сумму и подтвердите ещё раз');
    if (q.u !== userId) throw new AppError('FORBIDDEN', 'Чужая котировка');
    const from = this.asset(q.f);
    const to = this.asset(q.t);
    const amount = BigInt(q.a);
    const gross = BigInt(q.g);
    const net = BigInt(q.n);
    const fee = gross - net;

    let row: ExchangeRow;
    try {
      row = await withTx(this.db, async (c) => {
        const userFrom = await getOrCreateUserAccount(c, userId, from.code);
        const userTo = await getOrCreateUserAccount(c, userId, to.code);
        const bal = await c.query<{ balance: string }>(`SELECT balance FROM accounts WHERE id = $1 FOR UPDATE`, [userFrom]);
        if (BigInt(bal.rows[0]!.balance) < amount) {
          throw new AppError('INSUFFICIENT_FUNDS', 'Недостаточно средств для обмена');
        }
        const id = randomUUID();
        const ins = await c.query<ExchangeRow>(
          `INSERT INTO exchanges (id, user_id, from_asset, to_asset, from_amount, to_amount, fee, rate, quote_id, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [id, userId, from.code, to.code, amount.toString(), net.toString(), fee.toString(), q.r, q.q, idempotencyKey],
        );
        const deskFrom = await getOrCreateSystemAccount(c, SYSTEM.exchange, from.code);
        const deskTo = await getOrCreateSystemAccount(c, SYSTEM.exchange, to.code);
        const postings = [
          { accountId: userFrom, amount: -amount },
          { accountId: deskFrom, amount, allowNegative: true },
          { accountId: deskTo, amount: -gross, allowNegative: true },
          { accountId: userTo, amount: net },
        ];
        if (fee > 0n) {
          postings.push({ accountId: await getOrCreateSystemAccount(c, SYSTEM.fees, to.code), amount: fee, allowNegative: true });
        }
        await postTransaction(c, 'exchange', id, postings);
        return ins.rows[0]!;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent request won the race. Which unique index fires first is up to Postgres,
      // so look up by idempotency key before deciding that the quote was reused.
      const again = await this.db.query<ExchangeRow>(
        `SELECT * FROM exchanges WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      if (again.rows[0]) return this.exchangeView(again.rows[0]);
      throw new AppError('QUOTE_EXPIRED', 'Этот обмен уже выполнен. Запросите новый курс');
    }
    this.log.info({ exchangeId: row.id, userId, from: from.code, to: to.code }, 'exchange completed');
    return this.exchangeView(row);
  }

  async getExchange(userId: number, id: string): Promise<ExchangeView> {
    const r = await this.db.query<ExchangeRow>(`SELECT * FROM exchanges WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!r.rows[0]) throw new AppError('NOT_FOUND', 'Обмен не найден');
    return this.exchangeView(r.rows[0]);
  }

  private async safeNotify(userId: number, text: string): Promise<void> {
    try {
      await this.notifier.notify(userId, text);
    } catch (err) {
      this.log.warn({ err, userId }, 'notification failed');
    }
  }
}
