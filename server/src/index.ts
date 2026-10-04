import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { BotNotifier, configureBot, createBot } from './bot/bot.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { AssetRegistry } from './domain/assets.js';
import { buildApp } from './http/app.js';
import { CryptoPayProvider } from './providers/cryptopay.js';
import { MockProvider } from './providers/mock.js';
import type { PaymentProvider } from './providers/types.js';
import { WalletService } from './services/wallet.js';
import { every } from './workers/scheduler.js';

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["crypto-pay-api-signature"]',
      'req.headers["x-telegram-bot-api-secret-token"]',
    ],
    censor: '[redacted]',
  },
});
const db = createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);
const assets = new AssetRegistry(config.ASSETS);

const provider: PaymentProvider =
  config.PAYMENT_PROVIDER === 'cryptopay'
    ? new CryptoPayProvider(config.CRYPTOPAY_TOKEN!, config.CRYPTOPAY_NETWORK)
    : new MockProvider(config.PUBLIC_URL ?? `http://localhost:${config.PORT}`);

const bot = createBot(config, log);
const wallet = new WalletService(db, assets, provider, new BotNotifier(bot, config.WEBAPP_URL), log);

await migrate(db, (msg) => log.info(msg));

const app = await buildApp({
  config,
  db,
  assets,
  provider,
  wallet,
  logger: log,
  handleTelegramUpdate: (update) => bot.handleUpdate(update as never),
  staticDir: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
});

const stops: Array<() => void> = [];
if (config.WORKERS_ENABLED) {
  stops.push(every('withdrawals', 5_000, () => wallet.processDueWithdrawals(), log));
  stops.push(every('deposits', 30_000, () => wallet.reconcileDeposits(), log));
}

// Initialize the bot before accepting traffic so webhook updates can be handled right away.
if (config.BOT_MODE !== 'off') await bot.init();

await app.listen({ host: config.HOST, port: config.PORT });

if (config.BOT_MODE !== 'off') {
  await configureBot(bot, config, log);
  if (config.BOT_MODE === 'polling') {
    await bot.api.deleteWebhook();
    void bot.start({ drop_pending_updates: true, onStart: () => log.info('bot polling started') });
  } else {
    await bot.api.setWebhook(`${config.PUBLIC_URL!.replace(/\/$/, '')}/telegram/webhook`, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
    });
    log.info('bot webhook registered');
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');
  stops.forEach((stop) => stop());
  if (bot.isRunning()) await bot.stop();
  await app.close();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
