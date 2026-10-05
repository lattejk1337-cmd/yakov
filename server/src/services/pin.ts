import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { type Db, withTx } from '../db/pool.js';
import { AppError } from '../domain/errors.js';

const scrypt = (pwd: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pwd, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

export const PIN_LENGTH = 4;
const PIN_RE = /^\d{4}$/;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pin, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return timingSafeEqual(key, expected);
}

/** Rejects malformed and trivially guessable PINs. */
export function assertPinStrength(pin: string): void {
  if (!PIN_RE.test(pin)) throw new AppError('VALIDATION_ERROR', `PIN должен состоять из ${PIN_LENGTH} цифр`);
  const digits = [...pin].map(Number);
  const allSame = digits.every((d) => d === digits[0]);
  const step = digits[1]! - digits[0]!;
  const sequential = Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step);
  if (allSame || sequential) throw new AppError('PIN_TOO_WEAK', 'Слишком простой PIN-код');
}

export async function setPin(db: Db, userId: number, pin: string): Promise<void> {
  assertPinStrength(pin);
  const hash = await hashPin(pin);
  const res = await db.query(
    `UPDATE users SET pin_hash = $2, pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = now()
     WHERE id = $1 AND pin_hash IS NULL`,
    [userId, hash],
  );
  if (res.rowCount === 0) throw new AppError('PIN_ALREADY_SET', 'PIN-код уже установлен');
}

export async function changePin(db: Db, userId: number, oldPin: string, newPin: string): Promise<void> {
  assertPinStrength(newPin);
  await verifyPin(db, userId, oldPin);
  const hash = await hashPin(newPin);
  await db.query(`UPDATE users SET pin_hash = $2, updated_at = now() WHERE id = $1`, [userId, hash]);
}

/**
 * Checks the PIN with brute-force protection. The user row is locked while checking,
 * so parallel guesses are serialized and every failure is counted.
 * After PIN_MAX_ATTEMPTS failures the PIN is locked for PIN_LOCK_MINUTES.
 */
export async function verifyPin(db: Db, userId: number, pin: string): Promise<void> {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    throw new AppError('PIN_REQUIRED', 'Введите PIN-код');
  }
  const outcome = await withTx(db, async (c) => {
    const res = await c.query<{ pin_hash: string | null; pin_failed_attempts: number; locked: boolean; locked_until: Date | null }>(
      `SELECT pin_hash, pin_failed_attempts, pin_locked_until AS locked_until,
              (pin_locked_until IS NOT NULL AND pin_locked_until > now()) AS locked
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const u = res.rows[0];
    if (!u) return { kind: 'not_set' as const };
    if (!u.pin_hash) return { kind: 'not_set' as const };
    if (u.locked) return { kind: 'locked' as const, until: u.locked_until! };

    if (await verifyPinHash(pin, u.pin_hash)) {
      await c.query(`UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`, [userId]);
      return { kind: 'ok' as const };
    }

    const attempts = u.pin_failed_attempts + 1;
    if (attempts >= PIN_MAX_ATTEMPTS) {
      const upd = await c.query<{ pin_locked_until: Date }>(
        `UPDATE users SET pin_failed_attempts = 0,
                pin_locked_until = now() + make_interval(mins => $2)
         WHERE id = $1 RETURNING pin_locked_until`,
        [userId, PIN_LOCK_MINUTES],
      );
      return { kind: 'locked' as const, until: upd.rows[0]!.pin_locked_until };
    }
    await c.query(`UPDATE users SET pin_failed_attempts = $2 WHERE id = $1`, [userId, attempts]);
    return { kind: 'invalid' as const, attemptsLeft: PIN_MAX_ATTEMPTS - attempts };
  });

  switch (outcome.kind) {
    case 'ok':
      return;
    case 'not_set':
      throw new AppError('PIN_NOT_SET', 'Сначала установите PIN-код');
    case 'locked':
      throw new AppError('PIN_LOCKED', 'Слишком много попыток. Попробуйте позже', {
        lockedUntil: outcome.until.toISOString(),
      });
    case 'invalid':
      throw new AppError('PIN_INVALID', 'Неверный PIN-код', { attemptsLeft: outcome.attemptsLeft });
  }
}
