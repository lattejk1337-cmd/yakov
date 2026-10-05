import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN looks invalid'),
    BOT_MODE: z.enum(['polling', 'webhook', 'off']).default('polling'),
    TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{16,256}$/).optional(),
    /** Public HTTPS URL where the Mini App is served (used for bot buttons). */
    WEBAPP_URL: z.url().optional(),
    /** Max age of Telegram initData accepted by the API. */
    INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().min(60).max(7 * 86400).default(86400),

    PAYMENT_PROVIDER: z.enum(['cryptopay', 'mock']).default('mock'),
    CRYPTOPAY_TOKEN: z.string().optional(),
    CRYPTOPAY_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
    /** Base URL of this server, used by the mock provider for its fake pay page. */
    PUBLIC_URL: z.url().optional(),

    ASSETS: z
      .string()
      .default('RUB,USD,EUR,CNY,TON')
      .transform((s) =>
        s
          .split(',')
          .map((a) => a.trim().toUpperCase())
          .filter(Boolean),
      ),

    /** Spread on currency exchange and on fiat withdrawals paid out in crypto, in basis points (100 = 1%). */
    EXCHANGE_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(100),
    /** How long the app stays unlocked after the PIN is entered. */
    SESSION_TTL_SEC: z.coerce.number().int().min(60).max(86400).default(1800),

    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
    /** Limit for endpoints that move money or touch the PIN. */
    RATE_LIMIT_SENSITIVE_PER_MIN: z.coerce.number().int().min(1).default(10),

    WORKERS_ENABLED: bool.default(true),
    SERVE_STATIC: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'cryptopay' && !env.CRYPTOPAY_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['CRYPTOPAY_TOKEN'], message: 'required for cryptopay provider' });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock provider is not allowed in production' });
    }
    if (env.BOT_MODE === 'webhook' && (!env.TELEGRAM_WEBHOOK_SECRET || !env.PUBLIC_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOT_MODE'],
        message: 'webhook mode requires TELEGRAM_WEBHOOK_SECRET and PUBLIC_URL',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
