import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().max(256).default(''),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  is_bot: z.boolean().optional(),
  photo_url: z.string().optional(),
});

export type TelegramUser = z.infer<typeof TelegramUserSchema>;

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
}

export class InitDataError extends Error {}

export function secretKeyFromBotToken(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/**
 * Validates Telegram Mini App initData as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  raw: string,
  botToken: string,
  opts: { maxAgeSec: number; now?: Date },
): InitData {
  if (!raw || raw.length > 8192) throw new InitDataError('initData is missing or too long');

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError('hash is missing');

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const expected = createHmac('sha256', secretKeyFromBotToken(botToken)).update(dataCheckString).digest();
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InitDataError('signature mismatch');
  }

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isInteger(authDateSec) || authDateSec <= 0) throw new InitDataError('auth_date is invalid');
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (nowSec - authDateSec > opts.maxAgeSec) throw new InitDataError('initData expired');
  if (authDateSec - nowSec > 60) throw new InitDataError('auth_date is in the future');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('user is missing');
  let userJson: unknown;
  try {
    userJson = JSON.parse(userRaw);
  } catch {
    throw new InitDataError('user is not valid JSON');
  }
  const user = TelegramUserSchema.safeParse(userJson);
  if (!user.success) throw new InitDataError('user is invalid');
  if (user.data.is_bot) throw new InitDataError('bots are not allowed');

  return { user: user.data, authDate: new Date(authDateSec * 1000), queryId: params.get('query_id') ?? undefined };
}

/** Builds a correctly signed initData string. Used by tests and the local dev helper. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const hash = createHmac('sha256', secretKeyFromBotToken(botToken)).update(pairs.join('\n')).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
