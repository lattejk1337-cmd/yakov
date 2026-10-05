import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import type { WalletService } from '../src/services/wallet.js';
import {
  authHeaders,
  createTestApp,
  CRYPTOPAY_TOKEN,
  type FakeProvider,
  getTestDb,
  initDataFor,
  type RecordingNotifier,
  resetDb,
  sessionFor,
  testSigner,
  tgHeaders,
} from './helpers.js';

const ALICE = 1001;
const BOB = 1002;
const PIN = '2749';

let db: Db;
let app: FastifyInstance;
let wallet: WalletService;
let provider: FakeProvider;
let notifier: RecordingNotifier;

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetDb(db);
  ({ app, wallet, provider, notifier } = await createTestApp(db));
});

afterAll(async () => {
  await app?.close();
  await db.end();
});

// ───────────────────────────── helpers ─────────────────────────────

async function me(userId: number) {
  const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeaders(userId) });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function signedWebhook(body: object) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', createHash('sha256').update(CRYPTOPAY_TOKEN).digest()).update(raw).digest('hex');
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/cryptopay',
    headers: { 'content-type': 'application/json', 'crypto-pay-api-signature': sig },
    payload: raw,
  });
}

function createDeposit(userId: number, amount: string, asset = 'USDT', key = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: '/api/deposits',
    headers: authHeaders(userId, key),
    payload: { asset, amount },
  });
}

async function fund(userId: number, amount: string, asset = 'USDT') {
  const res = await createDeposit(userId, amount, asset);
  expect(res.statusCode).toBe(201);
  const dep = res.json();
  const invoiceId = [...provider.invoices.values()].find((i) => i.payload === dep.id)!.invoiceId;
  const paid = provider.pay(invoiceId);
  const hook = await signedWebhook({
    update_id: 1,
    update_type: 'invoice_paid',
    request_date: new Date().toISOString(),
    payload: { invoice_id: Number(invoiceId), status: 'paid', asset: paid.asset, amount: paid.amount, payload: paid.payload },
  });
  expect(hook.statusCode).toBe(200);
  return dep.id as string;
}

async function setPin(userId: number, pin = PIN) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: tgHeaders(userId), payload: { pin } });
  expect(res.statusCode).toBe(200);
  return res.json().session as string;
}

function quote(userId: number, from: string, to: string, amount: string) {
  return app.inject({
    method: 'POST',
    url: '/api/exchange/quote',
    headers: authHeaders(userId),
    payload: { from, to, amount },
  });
}

function exchange(userId: number, quoteToken: string, key = randomUUID()) {
  return app.inject({ method: 'POST', url: '/api/exchange', headers: authHeaders(userId, key), payload: { quoteToken } });
}

function withdraw(userId: number, amount: string, opts: { pin?: string; key?: string; asset?: string } = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/withdrawals',
    headers: authHeaders(userId, opts.key ?? randomUUID()),
    payload: { asset: opts.asset ?? 'USDT', amount, pin: opts.pin ?? PIN },
  });
}

/** Ledger invariants: every transaction balances and cached balances equal the journal. */
async function assertLedgerConsistent() {
  const unbalanced = await db.query(
    `SELECT e.tx_id FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
     GROUP BY e.tx_id, a.asset HAVING SUM(e.amount) <> 0`,
  );
  expect(unbalanced.rowCount).toBe(0);
  const drift = await db.query(
    `SELECT a.id FROM accounts a
     LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) e ON e.account_id = a.id
     WHERE a.balance <> COALESCE(e.s, 0)`,
  );
  expect(drift.rowCount).toBe(0);
}

// ───────────────────────────── auth ─────────────────────────────

describe('auth', () => {
  it('rejects requests without valid initData', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const forged = initDataFor(ALICE).replace(/hash=[a-f0-9]+/, 'hash=' + 'a'.repeat(64));
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `tma ${forged}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects expired initData', async () => {
    const old = initDataFor(ALICE, { authDate: Math.floor(Date.now() / 1000) - 2 * 86400 });
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `tma ${old}` } });
    expect(res.statusCode).toBe(401);
  });

  it('creates the user on first visit with zero balances', async () => {
    const body = await me(ALICE);
    expect(body.user).toMatchObject({ id: ALICE, firstName: 'Test' });
    expect(body.balances).toEqual({ USDT: '0', TON: '0', RUB: '0', USD: '0' });
    expect(body.security.hasPin).toBe(false);
    expect(body.assets.map((a: { code: string }) => a.code)).toEqual(['USDT', 'TON', 'RUB', 'USD']);
    expect(body.assets.find((a: { code: string }) => a.code === 'RUB')).toMatchObject({ kind: 'fiat', symbol: '₽' });
    expect(Number(body.prices.RUB)).toBeCloseTo(1 / 92.5, 6);
  });

  it('blocks banned users', async () => {
    await me(ALICE);
    await db.query('UPDATE users SET is_blocked = true WHERE id = $1', [ALICE]);
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeaders(ALICE) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('USER_BLOCKED');
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeaders(ALICE) });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ───────────────────────────── deposits ─────────────────────────────

describe('deposits', () => {
  it('creates an invoice and credits it once on webhook', async () => {
    const res = await createDeposit(ALICE, '25.5');
    expect(res.statusCode).toBe(201);
    const dep = res.json();
    expect(dep).toMatchObject({ status: 'pending', asset: 'USDT', amount: '25.5' });
    expect(dep.payUrl).toMatch(/^https:\/\/t\.me\//);

    const invoice = [...provider.invoices.values()][0]!;
    provider.pay(invoice.invoiceId);
    const update = {
      update_id: 5,
      update_type: 'invoice_paid',
      request_date: new Date().toISOString(),
      payload: { invoice_id: Number(invoice.invoiceId), status: 'paid', asset: 'USDT', amount: '25.5', payload: dep.id },
    };
    expect((await signedWebhook(update)).statusCode).toBe(200);
    expect((await signedWebhook(update)).statusCode).toBe(200); // duplicate delivery

    expect((await me(ALICE)).balances.USDT).toBe('25.5');
    const status = await app.inject({ method: 'GET', url: `/api/deposits/${dep.id}`, headers: authHeaders(ALICE) });
    expect(status.json().status).toBe('paid');
    expect(notifier.messages).toHaveLength(1);
    await assertLedgerConsistent();
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/cryptopay',
      headers: { 'content-type': 'application/json', 'crypto-pay-api-signature': 'f'.repeat(64) },
      payload: JSON.stringify({ update_type: 'invoice_paid', payload: {} }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not credit an invoice whose amount differs from the deposit', async () => {
    const dep = (await createDeposit(ALICE, '10')).json();
    const invoice = [...provider.invoices.values()][0]!;
    await signedWebhook({
      update_id: 1,
      update_type: 'invoice_paid',
      request_date: new Date().toISOString(),
      payload: { invoice_id: Number(invoice.invoiceId), status: 'paid', asset: 'USDT', amount: '1000', payload: dep.id },
    });
    expect((await me(ALICE)).balances.USDT).toBe('0');
  });

  it('reconciler credits paid invoices when the webhook was lost', async () => {
    const dep = (await createDeposit(ALICE, '3')).json();
    provider.pay([...provider.invoices.values()][0]!.invoiceId);
    await wallet.reconcileDeposits();
    await wallet.reconcileDeposits();
    expect((await me(ALICE)).balances.USDT).toBe('3');
    expect((await wallet.getDeposit(ALICE, dep.id)).status).toBe('paid');
  });

  it('is idempotent per Idempotency-Key and rejects key reuse with other params', async () => {
    const key = randomUUID();
    const a = await createDeposit(ALICE, '5', 'USDT', key);
    const b = await createDeposit(ALICE, '5', 'USDT', key);
    expect(b.json().id).toBe(a.json().id);
    expect(provider.invoices.size).toBe(1);
    const c = await createDeposit(ALICE, '6', 'USDT', key);
    expect(c.statusCode).toBe(409);
  });

  it('validates amounts and limits', async () => {
    expect((await createDeposit(ALICE, '0.5')).json().error.code).toBe('AMOUNT_TOO_SMALL');
    expect((await createDeposit(ALICE, '10001')).json().error.code).toBe('AMOUNT_TOO_LARGE');
    expect((await createDeposit(ALICE, '1.001')).json().error.code).toBe('INVALID_AMOUNT');
    expect((await createDeposit(ALICE, '-5')).json().error.code).toBe('INVALID_AMOUNT');
    expect((await createDeposit(ALICE, '5', 'DOGE')).json().error.code).toBe('UNKNOWN_ASSET');
    const noKey = await app.inject({
      method: 'POST',
      url: '/api/deposits',
      headers: authHeaders(ALICE),
      payload: { asset: 'USDT', amount: '5' },
    });
    expect(noKey.statusCode).toBe(400);
  });

  it('limits the number of open invoices', async () => {
    for (let i = 0; i < 5; i++) expect((await createDeposit(ALICE, '1')).statusCode).toBe(201);
    expect((await createDeposit(ALICE, '1')).json().error.code).toBe('TOO_MANY_PENDING');
  });

  it("does not expose other users' deposits", async () => {
    const dep = (await createDeposit(ALICE, '5')).json();
    const res = await app.inject({ method: 'GET', url: `/api/deposits/${dep.id}`, headers: authHeaders(BOB) });
    expect(res.statusCode).toBe(404);
  });
});

// ───────────────────────────── PIN ─────────────────────────────

describe('pin', () => {
  it('requires a PIN for withdrawals and locks after 5 wrong attempts', async () => {
    await fund(ALICE, '50');
    expect((await withdraw(ALICE, '5')).json().error.code).toBe('PIN_NOT_SET');
    await setPin(ALICE);

    for (let i = 4; i >= 1; i--) {
      const res = await withdraw(ALICE, '5', { pin: '1112' });
      expect(res.json().error).toMatchObject({ code: 'PIN_INVALID', details: { attemptsLeft: i } });
    }
    expect((await withdraw(ALICE, '5', { pin: '1112' })).json().error.code).toBe('PIN_LOCKED');
    // Even the correct PIN is refused while locked.
    expect((await withdraw(ALICE, '5')).json().error.code).toBe('PIN_LOCKED');
    expect((await me(ALICE)).security.pinLockedUntil).not.toBeNull();
    expect((await me(ALICE)).balances.USDT).toBe('50');
  });

  it('rejects weak PINs and a second setup; allows change with the old PIN', async () => {
    for (const pin of ['1234', '0000', '9876']) {
      const weak = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: tgHeaders(ALICE), payload: { pin } });
      expect(weak.json().error.code).toBe('PIN_TOO_WEAK');
    }
    const short = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: tgHeaders(ALICE), payload: { pin: '274913' } });
    expect(short.json().error.code).toBe('VALIDATION_ERROR');
    await setPin(ALICE);
    const again = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: tgHeaders(ALICE), payload: { pin: '5829' } });
    expect(again.statusCode).toBe(409);

    const wrongOld = await app.inject({
      method: 'POST',
      url: '/api/pin/change',
      headers: authHeaders(ALICE),
      payload: { oldPin: '0001', newPin: '5829' },
    });
    expect(wrongOld.json().error.code).toBe('PIN_INVALID');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/pin/change',
      headers: authHeaders(ALICE),
      payload: { oldPin: PIN, newPin: '5829' },
    });
    expect(ok.statusCode).toBe(204);
  });
});

// ──────────────────────────── withdrawals ────────────────────────────

describe('withdrawals', () => {
  beforeEach(async () => {
    await setPin(ALICE);
  });

  it('debits amount + fee and completes the transfer', async () => {
    await fund(ALICE, '20');
    const res = await withdraw(ALICE, '10');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'completed',
      amount: '10',
      fee: '0.1',
      total: '10.1',
      payoutAsset: 'USDT',
      payoutAmount: '10',
    });
    const after = await me(ALICE);
    expect(after.balances.USDT).toBe('9.9');
    expect(after.withdrawnToday).toMatchObject({ USDT: '10', TON: '0' });
    expect(provider.transferCalls).toHaveLength(1);
    expect(provider.transferCalls[0]).toMatchObject({ telegramUserId: ALICE, asset: 'USDT', amount: '10' });
    await assertLedgerConsistent();

    const fees = await db.query(`SELECT balance FROM accounts WHERE kind = 'system' AND code = 'fees' AND asset = 'USDT'`);
    expect(fees.rows[0].balance).toBe('100000');
  });

  it('refuses to overdraw, counting the fee', async () => {
    await fund(ALICE, '10');
    const res = await withdraw(ALICE, '10');
    expect(res.json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect(provider.transferCalls).toHaveLength(0);
  });

  it('never overdraws under concurrent withdrawals', async () => {
    await fund(ALICE, '30');
    // 30 USDT allows at most two 10-USDT withdrawals (10.1 each with fee).
    const results = await Promise.all(Array.from({ length: 8 }, () => withdraw(ALICE, '10')));
    const ok = results.filter((r) => r.statusCode === 201);
    const failed = results.filter((r) => r.statusCode !== 201);
    expect(ok).toHaveLength(2);
    for (const r of failed) expect(r.json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await me(ALICE)).balances.USDT).toBe('9.8');
    expect(provider.transferCalls).toHaveLength(2);
    await assertLedgerConsistent();
  });

  it('replays the same withdrawal for a repeated Idempotency-Key', async () => {
    await fund(ALICE, '30');
    const key = randomUUID();
    const [a, b] = await Promise.all([withdraw(ALICE, '5', { key }), withdraw(ALICE, '5', { key })]);
    expect(a.json().id).toBe(b.json().id);
    const c = await withdraw(ALICE, '5', { key });
    expect(c.json().id).toBe(a.json().id);
    expect((await me(ALICE)).balances.USDT).toBe('24.9');
    expect(provider.transferCalls).toHaveLength(1);
  });

  it('refunds amount and fee when the provider rejects the transfer', async () => {
    await fund(ALICE, '20');
    provider.transferBehavior = () => 'reject';
    const res = await withdraw(ALICE, '10');
    expect(res.json()).toMatchObject({ status: 'failed' });
    expect(res.json().failureReason).toBeTruthy();
    expect((await me(ALICE)).balances.USDT).toBe('20');
    await assertLedgerConsistent();
    expect(notifier.messages.at(-1)!.text).toMatch(/возвращены/);
  });

  it('keeps funds held on an unknown outcome and reconciles without paying twice', async () => {
    await fund(ALICE, '20');
    provider.transferBehavior = () => 'timeout-after-send';
    const res = await withdraw(ALICE, '10');
    expect(res.json().status).toBe('processing');
    expect((await me(ALICE)).balances.USDT).toBe('9.9');

    // Make the retry due now and run the worker: it finds the transfer instead of resending.
    await db.query(`UPDATE withdrawals SET next_attempt_at = now()`);
    await wallet.processDueWithdrawals();
    expect((await wallet.getWithdrawal(ALICE, res.json().id)).status).toBe('completed');
    expect(provider.transferCalls).toHaveLength(1);
    expect(provider.transfers.size).toBe(1);
    await assertLedgerConsistent();
  });

  it('retries a transfer that never reached the provider', async () => {
    await fund(ALICE, '20');
    let calls = 0;
    provider.transferBehavior = () => (++calls === 1 ? 'timeout' : 'ok');
    const res = await withdraw(ALICE, '10');
    expect(res.json().status).toBe('processing');
    await db.query(`UPDATE withdrawals SET next_attempt_at = now()`);
    await wallet.processDueWithdrawals();
    expect((await wallet.getWithdrawal(ALICE, res.json().id)).status).toBe('completed');
    expect(provider.transfers.size).toBe(1);
  });

  it('parks a withdrawal for manual review after repeated unknown outcomes', async () => {
    await fund(ALICE, '20');
    provider.transferBehavior = () => 'timeout';
    const res = await withdraw(ALICE, '10');
    for (let i = 0; i < 6; i++) {
      await db.query(`UPDATE withdrawals SET next_attempt_at = now()`);
      await wallet.processDueWithdrawals();
    }
    const row = await db.query(`SELECT status, attempts FROM withdrawals WHERE id = $1`, [res.json().id]);
    expect(row.rows[0]).toMatchObject({ status: 'review', attempts: 5 });
    // Funds stay held — never refunded on an unknown outcome.
    expect((await me(ALICE)).balances.USDT).toBe('9.9');
  });

  it('enforces the daily withdrawal limit', async () => {
    await fund(ALICE, '10000');
    await fund(ALICE, '10000');
    expect((await withdraw(ALICE, '5000')).statusCode).toBe(201);
    expect((await withdraw(ALICE, '5000')).statusCode).toBe(201);
    const res = await withdraw(ALICE, '2');
    expect(res.json().error).toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED', details: { available: '0' } });
  });

  it('validates withdrawal amounts', async () => {
    await fund(ALICE, '20');
    expect((await withdraw(ALICE, '1')).json().error.code).toBe('AMOUNT_TOO_SMALL');
    expect((await withdraw(ALICE, '5001')).json().error.code).toBe('AMOUNT_TOO_LARGE');
    expect((await withdraw(ALICE, 'abc')).json().error.code).toBe('INVALID_AMOUNT');
  });
});


// ───────────────────────────── lock screen ─────────────────────────────

describe('lock screen', () => {
  it('keeps the wallet locked until the PIN is entered', async () => {
    const locked = await app.inject({ method: 'GET', url: '/api/me', headers: tgHeaders(ALICE) });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.code).toBe('LOCKED');

    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: tgHeaders(ALICE) });
    expect(state.json()).toMatchObject({ hasPin: false, pinLength: 4, user: { id: ALICE } });

    const session = await setPin(ALICE);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { ...tgHeaders(ALICE), 'x-wallet-session': session },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('unlocks only with the right PIN and counts failures', async () => {
    await setPin(ALICE);
    const unlock = (pin: string) =>
      app.inject({ method: 'POST', url: '/api/auth/unlock', headers: tgHeaders(ALICE), payload: { pin } });
    expect((await unlock('1112')).json().error).toMatchObject({ code: 'PIN_INVALID', details: { attemptsLeft: 4 } });
    const good = await unlock(PIN);
    expect(good.statusCode).toBe(200);
    expect(good.json().session).toBeTruthy();
    expect(Date.parse(good.json().expiresAt)).toBeGreaterThan(Date.now());
  });

  it("rejects someone else's, forged and expired sessions", async () => {
    const as = (session: string) =>
      app.inject({ method: 'GET', url: '/api/me', headers: { ...tgHeaders(ALICE), 'x-wallet-session': session } });
    expect((await as(sessionFor(BOB))).json().error.code).toBe('LOCKED');
    const real = sessionFor(ALICE);
    const flip = (c: string) => (c === 'A' ? 'B' : 'A');
    const forged = real.slice(0, -5) + flip(real.at(-5)!) + real.slice(-4); // a full-6-bit character of the MAC
    expect((await as(forged)).json().error.code).toBe('LOCKED');
    // A non-canonical spelling of the very same MAC bytes is refused as well.
    const last = real.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(last) ^ 1]!;
    expect((await as(real.slice(0, -1) + sibling)).json().error.code).toBe('LOCKED');
    expect((await as(testSigner.sign('session', { u: ALICE }, -1))).json().error.code).toBe('LOCKED');
    // A token signed for another purpose (an exchange quote) is not a session.
    expect((await as(testSigner.sign('quote', { u: ALICE }, 600))).json().error.code).toBe('LOCKED');
  });
});

// ─────────────────────────── multi-currency ───────────────────────────

describe('fiat deposits', () => {
  it('bills fiat as a fiat invoice payable in crypto and credits the fiat amount', async () => {
    await fund(ALICE, '1500', 'RUB');
    expect(provider.invoiceInputs[0]).toMatchObject({ asset: 'RUB', amount: '1500', fiat: true, acceptedAssets: ['USDT', 'TON'] });
    expect((await me(ALICE)).balances.RUB).toBe('1500');
    expect(notifier.messages[0]!.text).toContain('1500 ₽');
    await assertLedgerConsistent();
  });
});

describe('exchange', () => {
  beforeEach(async () => {
    await setPin(ALICE);
    await fund(ALICE, '100', 'USD');
  });

  it('quotes at the market rate with a visible 1% fee and executes atomically', async () => {
    const q = await quote(ALICE, 'USD', 'RUB', '10');
    expect(q.statusCode).toBe(200);
    // 10 USD × 92.5 = 925 RUB; 1% fee = 9.25 RUB.
    expect(q.json()).toMatchObject({ fromAmount: '10', toAmount: '915.75', fee: '9.25', rate: '92.5', feePercent: '1' });

    const ex = await exchange(ALICE, q.json().quoteToken);
    expect(ex.statusCode).toBe(201);
    expect(ex.json()).toMatchObject({ type: 'exchange', fromAsset: 'USD', toAsset: 'RUB', toAmount: '915.75' });
    const after = await me(ALICE);
    expect(after.balances).toMatchObject({ USD: '90', RUB: '915.75' });
    await assertLedgerConsistent();

    const fees = await db.query(`SELECT balance FROM accounts WHERE kind = 'system' AND code = 'fees' AND asset = 'RUB'`);
    expect(fees.rows[0].balance).toBe('925');
  });

  it('converts in both directions without floating-point drift', async () => {
    const q = await quote(ALICE, 'USD', 'TON', '52');
    // 52 USD / 5.2 = 10 TON, minus 1% = 9.9 TON (9 decimals).
    expect(q.json()).toMatchObject({ toAmount: '9.9', fee: '0.1' });
    await exchange(ALICE, q.json().quoteToken);
    const back = await quote(ALICE, 'TON', 'USD', '9.9');
    // 9.9 TON × 5.2 = 51.48 USD; fee rounded up to the cent: 0.52.
    expect(back.json()).toMatchObject({ toAmount: '50.96', fee: '0.52' });
  });

  it('executes a quote once: same key replays, another key is refused', async () => {
    const q = (await quote(ALICE, 'USD', 'RUB', '10')).json();
    const key = randomUUID();
    const [a, b] = await Promise.all([exchange(ALICE, q.quoteToken, key), exchange(ALICE, q.quoteToken, key)]);
    expect(a.json().id).toBe(b.json().id);
    const again = await exchange(ALICE, q.quoteToken);
    expect(again.json().error.code).toBe('QUOTE_EXPIRED');
    expect((await me(ALICE)).balances.USD).toBe('90');
  });

  it('refuses expired, foreign and tampered quotes', async () => {
    const q = (await quote(ALICE, 'USD', 'RUB', '10')).json();
    expect((await exchange(BOB, q.quoteToken)).json().error.code).toBe('FORBIDDEN');
    const [body] = q.quoteToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), n: '99999999' }),
    ).toString('base64url');
    expect((await exchange(ALICE, `${forged}.${q.quoteToken.split('.')[1]}`)).json().error.code).toBe('QUOTE_EXPIRED');
    const stale = testSigner.sign('quote', JSON.parse(Buffer.from(body, 'base64url').toString()), -1);
    expect((await exchange(ALICE, stale)).json().error.code).toBe('QUOTE_EXPIRED');
  });

  it('checks balance at execution time and validates input', async () => {
    const q = (await quote(ALICE, 'USD', 'RUB', '100')).json();
    await exchange(ALICE, (await quote(ALICE, 'USD', 'RUB', '50')).json().quoteToken);
    expect((await exchange(ALICE, q.quoteToken)).json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await quote(ALICE, 'USD', 'USD', '1')).json().error.code).toBe('SAME_CURRENCY');
    expect((await quote(ALICE, 'USD', 'RUB', '0.01')).json().error.code).toBe('AMOUNT_TOO_SMALL');
    expect((await quote(ALICE, 'USD', 'EUR', '1')).json().error.code).toBe('UNKNOWN_ASSET'); // EUR not enabled here
    await assertLedgerConsistent();
  });

  it('reports unavailable rates instead of guessing', async () => {
    provider.ratesDown = true;
    const res = await quote(ALICE, 'USD', 'RUB', '10');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('RATES_UNAVAILABLE');
  });

  it('shows exchanges in the history', async () => {
    await exchange(ALICE, (await quote(ALICE, 'USD', 'RUB', '10')).json().quoteToken);
    const res = await app.inject({ method: 'GET', url: '/api/history', headers: authHeaders(ALICE) });
    expect(res.json().items.map((i: { type: string }) => i.type)).toEqual(['exchange', 'deposit']);
    expect(res.json().items[0]).toMatchObject({ fromAsset: 'USD', toAsset: 'RUB', fromAmount: '10' });
  });
});

describe('fiat withdrawals', () => {
  it('pays fiat out in USDT at the market rate minus the spread', async () => {
    await setPin(ALICE);
    await fund(ALICE, '1000', 'RUB');
    const res = await withdraw(ALICE, '500', { asset: 'RUB' });
    expect(res.statusCode).toBe(201);
    // 500 RUB / 92.5 = 5.4054 USDT; −1% = 5.3513 → rounded down to cents: 5.35 USDT.
    expect(res.json()).toMatchObject({ status: 'completed', amount: '500', fee: '50', payoutAsset: 'USDT', payoutAmount: '5.35' });
    expect(provider.transferCalls[0]).toMatchObject({ asset: 'USDT', amount: '5.35' });
    expect((await me(ALICE)).balances.RUB).toBe('450');
    await assertLedgerConsistent();
  });
});

// ───────────────────────────── history ─────────────────────────────

describe('history', () => {
  it('lists paid deposits and withdrawals newest first with stable pagination', async () => {
    await setPin(ALICE);
    await fund(ALICE, '50');
    await createDeposit(ALICE, '7'); // unpaid: not shown
    for (let i = 0; i < 4; i++) expect((await withdraw(ALICE, '2')).statusCode).toBe(201);
    await fund(BOB, '5'); // someone else's

    const seen: Array<{ id: string; type: string }> = [];
    let cursor: string | null = null;
    do {
      const res: { statusCode: number; json(): { items: typeof seen; nextCursor: string | null } } = await app.inject({
        method: 'GET',
        url: `/api/history?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        headers: authHeaders(ALICE),
      });
      expect(res.statusCode).toBe(200);
      const page = res.json();
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen.map((i) => i.type)).toEqual(['withdrawal', 'withdrawal', 'withdrawal', 'withdrawal', 'deposit']);
    expect(new Set(seen.map((i) => i.id)).size).toBe(5);
  });

  it('rejects malformed cursors', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history?cursor=zzz', headers: authHeaders(ALICE) });
    expect(res.statusCode).toBe(400);
  });
});

describe('rate limiting', () => {
  it('throttles money-moving endpoints per user', async () => {
    const strict = await createTestApp(db, { RATE_LIMIT_SENSITIVE_PER_MIN: '3' });
    const call = (userId: number) =>
      strict.app.inject({
        method: 'POST',
        url: '/api/deposits',
        headers: authHeaders(userId, randomUUID()),
        payload: { asset: 'USDT', amount: '1' },
      });
    for (let i = 0; i < 3; i++) expect((await call(ALICE)).statusCode).toBe(201);
    const limited = await call(ALICE);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect((await call(BOB)).statusCode).toBe(201);
    await strict.app.close();
  });
});

describe('database guards', () => {
  it('forbids negative user balances and ledger mutation at the database level', async () => {
    await fund(ALICE, '5');
    await expect(db.query(`UPDATE accounts SET balance = -1 WHERE kind = 'user'`)).rejects.toThrow(/accounts_non_negative_chk/);
    await expect(db.query(`UPDATE ledger_entries SET amount = 1`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM ledger_entries`)).rejects.toThrow(/append-only/);
  });

  it('rejects a ledger transaction that balances only across different currencies', async () => {
    await fund(ALICE, '5', 'USD');
    await fund(ALICE, '500', 'RUB');
    const accs = await db.query<{ id: string; asset: string }>(
      `SELECT id, asset FROM accounts WHERE kind = 'user' AND asset IN ('USD', 'RUB')`,
    );
    const usd = accs.rows.find((r) => r.asset === 'USD')!.id;
    const rub = accs.rows.find((r) => r.asset === 'RUB')!.id;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const tx = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (kind, ref_id) VALUES ('exchange', gen_random_uuid()) RETURNING id`,
      );
      await client.query(`INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES ($1, $2, -100, 0)`, [tx.rows[0]!.id, usd]);
      await client.query(`INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES ($1, $2, 100, 0)`, [tx.rows[0]!.id, rub]);
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced in/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
