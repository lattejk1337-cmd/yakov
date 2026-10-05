import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import type { TelegramUser } from '../auth/telegram.js';
import type { TokenSigner } from '../auth/tokens.js';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { AssetRegistry } from '../domain/assets.js';
import { AppError } from '../domain/errors.js';
import type { PaymentProvider } from '../providers/types.js';
import type { UserRow } from '../services/users.js';
import type { WalletService } from '../services/wallet.js';
import { apiRoutes } from './routes/api.js';
import { devRoutes } from './routes/dev.js';
import { webhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    tgUser: TelegramUser | null;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  assets: AssetRegistry;
  provider: PaymentProvider;
  wallet: WalletService;
  signer: TokenSigner;
  /** Telegram bot update handler, mounted as a webhook when BOT_MODE=webhook. */
  handleTelegramUpdate?: (update: unknown) => Promise<void>;
  staticDir?: string;
  /** Shared application logger; logging is disabled when omitted (tests). */
  logger?: FastifyBaseLogger;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest('user', null);
  app.decorateRequest('tgUser', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Telegram profile photos redirect from t.me to changing CDN hosts.
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        // Telegram Web clients embed Mini Apps in an iframe.
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    frameguard: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError('RATE_LIMITED', 'Слишком много запросов. Подождите немного', { retryAfterMs: ctx.ttl });
      return err;
    },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    }
    const e = err as { statusCode?: number; validation?: unknown; code?: string; message: string };
    if (e.validation || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || (e.statusCode === 400)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный запрос', details: null } });
    }
    if (e.statusCode === 413) {
      return reply.status(413).send({ error: { code: 'VALIDATION_ERROR', message: 'Слишком большой запрос', details: null } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка. Попробуйте позже', details: null } });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  await app.register(apiRoutes(deps), { prefix: '/api' });
  await app.register(webhookRoutes(deps));
  if (config.PAYMENT_PROVIDER === 'mock' && config.NODE_ENV !== 'production') {
    await app.register(devRoutes(deps), { prefix: '/api/dev' });
  }

  const staticDir = deps.staticDir;
  if (config.SERVE_STATIC && staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      setHeaders: (res, path) => {
        res.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено', details: null } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено', details: null } }),
    );
  }

  return app;
}
