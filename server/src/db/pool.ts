import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guards against runaway queries / lock waits holding connections forever.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  return pool;
}

/**
 * Runs `fn` inside a transaction. Serialization failures and deadlocks are retried,
 * because they are an expected outcome of concurrent money movements.
 */
export async function withTx<T>(db: Db, fn: (client: DbClient) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      if ((code === '40001' || code === '40P01') && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
