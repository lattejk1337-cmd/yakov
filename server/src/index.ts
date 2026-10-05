import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { BotNotifier, BotNotReadyError, configureBot, createBot } from './bot/bot.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { AssetRegistry } from './domain/assets.js';
import { buildApp } from './http/app.js';
import { CryptoPayProvider } from './providers/cryptopay.js';
import { MockProvider } from './providers/mock.js';
import type { PaymentProvider } from './providers/types.js';
import { TokenSigner } from './auth/tokens.js';
import { RatesService } from './services/rates.js';
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
const signer = new TokenSigner(config.BOT_TOKEN);
const wallet = new WalletService(db, assets, provider, new BotNotifier(bot, config.WEBAPP_URL), log, {
  rates: new RatesService(provider),
  signer,
  feeBps: config.EXCHANGE_FEE_BPS,
});

await migrate(db, (msg) => log.info(msg));

const app = await buildApp({
  config,
  db,
  assets,
  provider,
  wallet,
  signer,
  logger: log,
  handleTelegramUpdate: async (update) => {
    // Until the bot has connected, ask Telegram to redeliver instead of dropping the update.
    if (!bot.isInited()) throw new BotNotReadyError();
    await bot.handleUpdate(update as never);
  },
  staticDir: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
});

let shuttingDown = false;
const stops: Array<() => void> = [];
if (config.WORKERS_ENABLED) {
  stops.push(every('withdrawals', 5_000, () => wallet.processDueWithdrawals(), log));
  stops.push(every('deposits', 30_000, () => wallet.reconcileDeposits(), log));
}

await app.listen({ host: config.HOST, port: config.PORT });

/**
 * The wallet must work even when Telegram's API is slow or unreachable, so the bot
 * starts in the background and keeps retrying instead of blocking or crashing the server.
 */
async function startBot(): Promise<void> {
  for (let attempt = 1; !shuttingDown; attempt++) {
    try {
      // grammY retries network errors during init forever and silently, so say what is going on.
      const waiting = setInterval(
        () => log.warn('cannot reach api.telegram.org yet; the bot keeps trying (wallet API is up)'),
        20_000,
      );
      try {
        await bot.init();
      } finally {
        clearInterval(waiting);
      }
      log.info({ username: bot.botInfo.username }, 'connected to Telegram');
      await configureBot(bot, config, log);
      if (config.BOT_MODE === 'polling') {
        await bot.api.deleteWebhook();
        log.info('bot polling started');
        // Resolves when polling stops; rejects on a fatal polling error.
        await bot.start({ drop_pending_updates: true });
        if (shuttingDown) return;
        throw new Error('polling stopped unexpectedly');
      }
      await bot.api.setWebhook(`${config.PUBLIC_URL!.replace(/\/$/, '')}/telegram/webhook`, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message'],
      });
      log.info('bot webhook registered');
      return;
    } catch (err) {
      if (shuttingDown) return;
      const delay = Math.min(60, 5 * attempt);
      log.error({ err, attempt }, `telegram bot is not reachable; retrying in ${delay}s`);
      await new Promise((r) => setTimeout(r, delay * 1000).unref());
    }
  }
}
if (config.BOT_MODE !== 'off') void startBot();

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
