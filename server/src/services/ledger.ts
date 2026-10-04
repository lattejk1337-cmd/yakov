import type { DbClient, Queryable } from '../db/pool.js';

export type LedgerKind = 'deposit' | 'withdrawal' | 'withdrawal_refund';

export interface Posting {
  accountId: string;
  amount: bigint;
  /** If false, the posting may not take the account below zero (user accounts). */
  allowNegative?: boolean;
}

export class InsufficientFundsError extends Error {}

async function getOrCreateAccount(q: Queryable, where: string, insert: string, params: unknown[]): Promise<string> {
  const select = () => q.query<{ id: string }>(`SELECT id FROM accounts WHERE ${where}`, params);
  let res = await select();
  if (res.rows[0]) return res.rows[0].id;
  await q.query(`${insert} ON CONFLICT DO NOTHING`, params);
  res = await select();
  return res.rows[0]!.id;
}

export function getOrCreateUserAccount(q: Queryable, userId: number, asset: string): Promise<string> {
  return getOrCreateAccount(
    q,
    `kind = 'user' AND user_id = $1 AND asset = $2`,
    `INSERT INTO accounts (kind, user_id, asset) VALUES ('user', $1, $2)`,
    [userId, asset],
  );
}

export function getOrCreateSystemAccount(q: Queryable, code: string, asset: string): Promise<string> {
  return getOrCreateAccount(
    q,
    `kind = 'system' AND code = $1 AND asset = $2`,
    `INSERT INTO accounts (kind, code, asset) VALUES ('system', $1, $2)`,
    [code, asset],
  );
}

/**
 * Posts a balanced set of entries atomically. Must run inside a transaction.
 * Debits use a conditional UPDATE, so concurrent withdrawals can never overdraw an account:
 * Postgres re-evaluates `balance + amount >= 0` against the latest committed row.
 * Returns false (and posts nothing) if this (kind, refId) was already posted.
 */
export async function postTransaction(
  client: DbClient,
  kind: LedgerKind,
  refId: string,
  postings: Posting[],
): Promise<boolean> {
  const sum = postings.reduce((acc, p) => acc + p.amount, 0n);
  if (sum !== 0n) throw new Error(`Unbalanced ledger transaction: sum=${sum}`);
  if (postings.some((p) => p.amount === 0n)) throw new Error('Zero-amount posting');

  const tx = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (kind, ref_id) VALUES ($1, $2)
     ON CONFLICT (kind, ref_id) DO NOTHING RETURNING id`,
    [kind, refId],
  );
  if (tx.rowCount === 0) return false;
  const txId = tx.rows[0]!.id;

  // Lock accounts in a stable order to avoid deadlocks between concurrent postings.
  const ordered = [...postings].sort((a, b) => (BigInt(a.accountId) < BigInt(b.accountId) ? -1 : 1));
  for (const p of ordered) {
    const upd = await client.query<{ balance: string }>(
      `UPDATE accounts SET balance = balance + $2
       WHERE id = $1 AND ($3::boolean OR balance + $2 >= 0)
       RETURNING balance`,
      [p.accountId, p.amount.toString(), p.allowNegative ?? false],
    );
    if (upd.rowCount === 0) throw new InsufficientFundsError(`Insufficient funds on account ${p.accountId}`);
    await client.query(
      `INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES ($1, $2, $3, $4)`,
      [txId, p.accountId, p.amount.toString(), upd.rows[0]!.balance],
    );
  }
  return true;
}

export async function getBalances(q: Queryable, userId: number): Promise<Map<string, bigint>> {
  const res = await q.query<{ asset: string; balance: string }>(
    `SELECT asset, balance FROM accounts WHERE kind = 'user' AND user_id = $1`,
    [userId],
  );
  return new Map(res.rows.map((r) => [r.asset, BigInt(r.balance)]));
}

/** System account codes. */
export const SYSTEM = {
  provider: (name: string) => `provider:${name}`,
  fees: 'fees',
} as const;
