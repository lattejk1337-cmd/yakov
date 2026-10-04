import type { TelegramUser } from '../auth/telegram.js';
import type { Queryable } from '../db/pool.js';

export interface UserRow {
  id: number;
  username: string | null;
  firstName: string;
  isBlocked: boolean;
  hasPin: boolean;
  pinLockedUntil: Date | null;
}

/** Creates the user on first visit and keeps the profile in sync with Telegram. */
export async function upsertUser(q: Queryable, tg: TelegramUser): Promise<UserRow> {
  await q.query(
    `INSERT INTO users (id, username, first_name, last_name, language_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       updated_at = now()
     WHERE (users.username, users.first_name, users.last_name, users.language_code)
       IS DISTINCT FROM (EXCLUDED.username, EXCLUDED.first_name, EXCLUDED.last_name, EXCLUDED.language_code)`,
    [tg.id, tg.username ?? null, tg.first_name, tg.last_name ?? null, tg.language_code ?? null],
  );
  return (await getUser(q, tg.id))!;
}

export async function getUser(q: Queryable, id: number): Promise<UserRow | null> {
  const res = await q.query<{
    id: string;
    username: string | null;
    first_name: string;
    is_blocked: boolean;
    has_pin: boolean;
    pin_locked_until: Date | null;
  }>(
    `SELECT id, username, first_name, is_blocked, pin_hash IS NOT NULL AS has_pin,
            CASE WHEN pin_locked_until > now() THEN pin_locked_until END AS pin_locked_until
     FROM users WHERE id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    username: r.username,
    firstName: r.first_name,
    isBlocked: r.is_blocked,
    hasPin: r.has_pin,
    pinLockedUntil: r.pin_locked_until,
  };
}
