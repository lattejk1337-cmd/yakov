import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { InitDataError, validateInitData } from '../../auth/telegram.js';
import { AppError } from '../../domain/errors.js';
import { getBalances } from '../../services/ledger.js';
import { changePin, PIN_LENGTH, setPin, verifyPin } from '../../services/pin.js';
import { upsertUser } from '../../services/users.js';
import type { AppDeps } from '../app.js';

const Uuid = z.uuid();
const AmountBody = z.object({
  asset: z.string().regex(/^[A-Z]{2,10}$/),
  amount: z.string().max(32),
});
const WithdrawBody = AmountBody.extend({ pin: z.string().max(16) });
const QuoteBody = z.object({
  from: z.string().regex(/^[A-Z]{2,10}$/),
  to: z.string().regex(/^[A-Z]{2,10}$/),
  amount: z.string().max(32),
});
const ExchangeBody = z.object({ quoteToken: z.string().min(10).max(2048) });
const PinBody = z.object({ pin: z.string().max(16) });
const ChangePinBody = z.object({ oldPin: z.string().max(16), newPin: z.string().max(16) });
const HistoryQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('VALIDATION_ERROR', 'Некорректный запрос');
  return r.data;
}

function idempotencyKey(req: FastifyRequest): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[\w-]{8,64}$/.test(key)) {
    throw new AppError('VALIDATION_ERROR', 'Требуется заголовок Idempotency-Key');
  }
  return key;
}

function currentUser(req: FastifyRequest) {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация');
  return req.user;
}

export const SESSION_HEADER = 'x-wallet-session';

export function apiRoutes(deps: AppDeps): FastifyPluginAsync {
  const { config, db, assets, wallet, signer } = deps;
  /** Stricter limits for endpoints that move money or touch the PIN. */
  const strict = { max: config.RATE_LIMIT_SENSITIVE_PER_MIN, timeWindow: '1 minute' };
  const sensitive = { config: { rateLimit: strict } };
  /** Routes reachable before the PIN is entered (lock screen). */
  const unlocked = { config: { public: true } };
  const unlockedSensitive = { config: { public: true, rateLimit: strict } };

  const issueSession = (userId: number) => {
    const session = signer.sign('session', { u: userId }, config.SESSION_TTL_SEC);
    return { session, expiresAt: new Date(Date.now() + config.SESSION_TTL_SEC * 1000).toISOString() };
  };

  return async (app) => {
    // Every /api route (except health & dev, registered elsewhere) requires Telegram auth.
    app.addHook('onRequest', async (req) => {
      const header = req.headers.authorization ?? '';
      const [scheme, initData] = header.split(' ');
      if (scheme !== 'tma' || !initData) throw new AppError('UNAUTHORIZED', 'Откройте приложение из Telegram');
      try {
        const data = validateInitData(initData, config.BOT_TOKEN, { maxAgeSec: config.INIT_DATA_MAX_AGE_SEC });
        req.tgUser = data.user;
      } catch (err) {
        if (err instanceof InitDataError) {
          throw new AppError('UNAUTHORIZED', 'Сессия устарела. Перезапустите приложение');
        }
        throw err;
      }
      const user = await upsertUser(db, req.tgUser);
      if (user.isBlocked) throw new AppError('USER_BLOCKED', 'Аккаунт заблокирован. Обратитесь в поддержку');
      req.user = user;

      // Everything except the lock screen requires a session obtained by entering the PIN.
      if ((req.routeOptions.config as { public?: boolean } | undefined)?.public) return;
      const sessionHeader = req.headers[SESSION_HEADER];
      const session = signer.verify<{ u: number }>(
        'session',
        typeof sessionHeader === 'string' ? sessionHeader : undefined,
      );
      if (!session || session.u !== user.id) throw new AppError('LOCKED', 'Введите PIN-код');
    });

    // ───────────── lock screen ─────────────

    app.get('/auth/state', unlocked, async (req) => {
      const user = currentUser(req);
      return {
        user: {
          id: user.id,
          firstName: user.firstName,
          username: user.username,
          photoUrl: req.tgUser?.photo_url ?? null,
        },
        hasPin: user.hasPin,
        pinLength: PIN_LENGTH,
        pinLockedUntil: user.pinLockedUntil?.toISOString() ?? null,
      };
    });

    app.post('/auth/setup', unlockedSensitive, async (req) => {
      const user = currentUser(req);
      const body = parse(PinBody, req.body);
      await setPin(db, user.id, body.pin);
      return issueSession(user.id);
    });

    app.post('/auth/unlock', unlockedSensitive, async (req) => {
      const user = currentUser(req);
      const body = parse(PinBody, req.body);
      await verifyPin(db, user.id, body.pin);
      return issueSession(user.id);
    });

    // ───────────── wallet (unlocked) ─────────────

    app.get('/me', async (req) => {
      const user = currentUser(req);
      const [balances, withdrawn] = await Promise.all([getBalances(db, user.id), wallet.withdrawnToday(user.id)]);
      const perAsset = (m: Map<string, bigint>) =>
        Object.fromEntries(assets.list().map((a) => [a.code, assets.format(a.code, m.get(a.code) ?? 0n)]));
      return {
        user: {
          id: user.id,
          firstName: user.firstName,
          username: user.username,
          photoUrl: req.tgUser?.photo_url ?? null,
        },
        security: {
          hasPin: user.hasPin,
          pinLockedUntil: user.pinLockedUntil?.toISOString() ?? null,
        },
        assets: assets.list().map((a) => assets.toPublic(a)),
        balances: perAsset(balances),
        withdrawnToday: perAsset(withdrawn),
        // Display only (total balance, rate hints); null while rates are unavailable.
        prices: await wallet.marketPrices().catch(() => null),
        exchangeFeePercent: (config.EXCHANGE_FEE_BPS / 100).toString(),
      };
    });

    app.get('/history', async (req) => {
      const user = currentUser(req);
      const q = parse(HistoryQuery, req.query);
      return wallet.history(user.id, q);
    });

    app.post('/deposits', sensitive, async (req, reply) => {
      const user = currentUser(req);
      const body = parse(AmountBody, req.body);
      const deposit = await wallet.createDeposit(user.id, body.asset, body.amount, idempotencyKey(req));
      return reply.status(201).send(deposit);
    });

    app.get<{ Params: { id: string } }>('/deposits/:id', async (req) => {
      const user = currentUser(req);
      return wallet.getDeposit(user.id, parse(Uuid, req.params.id));
    });

    app.post('/withdrawals', sensitive, async (req, reply) => {
      const user = currentUser(req);
      const body = parse(WithdrawBody, req.body);
      const w = await wallet.createWithdrawal(user.id, body.asset, body.amount, body.pin, idempotencyKey(req));
      return reply.status(201).send(w);
    });

    app.get<{ Params: { id: string } }>('/withdrawals/:id', async (req) => {
      const user = currentUser(req);
      return wallet.getWithdrawal(user.id, parse(Uuid, req.params.id));
    });

    app.get('/rates', async () => ({ prices: await wallet.marketPrices() }));

    app.post('/exchange/quote', async (req) => {
      const user = currentUser(req);
      const body = parse(QuoteBody, req.body);
      return wallet.quoteExchange(user.id, body.from, body.to, body.amount);
    });

    app.post('/exchange', sensitive, async (req, reply) => {
      const user = currentUser(req);
      const body = parse(ExchangeBody, req.body);
      const ex = await wallet.executeExchange(user.id, body.quoteToken, idempotencyKey(req));
      return reply.status(201).send(ex);
    });

    app.get<{ Params: { id: string } }>('/exchanges/:id', async (req) => {
      const user = currentUser(req);
      return wallet.getExchange(user.id, parse(Uuid, req.params.id));
    });

    app.post('/pin/change', sensitive, async (req, reply) => {
      const user = currentUser(req);
      const body = parse(ChangePinBody, req.body);
      await changePin(db, user.id, body.oldPin, body.newPin);
      return reply.status(204).send();
    });
  };
}
