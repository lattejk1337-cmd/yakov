import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { type CryptoPayWebhookUpdate, toProviderInvoice, verifyCryptoPaySignature } from '../../providers/cryptopay.js';
import { BotNotReadyError } from '../../bot/bot.js';
import type { AppDeps } from '../app.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function webhookRoutes(deps: AppDeps): FastifyPluginAsync {
  const { config, wallet } = deps;

  return async (app) => {
    // Signatures are computed over the exact bytes, so keep the raw body.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    if (config.PAYMENT_PROVIDER === 'cryptopay' && config.CRYPTOPAY_TOKEN) {
      const token = config.CRYPTOPAY_TOKEN;
      app.post('/api/webhooks/cryptopay', { config: { rateLimit: false } }, async (req, reply) => {
        const raw = req.body as Buffer;
        const signature = req.headers['crypto-pay-api-signature'];
        if (!Buffer.isBuffer(raw) || !verifyCryptoPaySignature(raw, typeof signature === 'string' ? signature : undefined, token)) {
          req.log.warn('rejected Crypto Pay webhook with invalid signature');
          return reply.status(401).send({ ok: false });
        }
        let update: CryptoPayWebhookUpdate;
        try {
          update = JSON.parse(raw.toString('utf8')) as CryptoPayWebhookUpdate;
        } catch {
          return reply.status(400).send({ ok: false });
        }
        if (update.update_type === 'invoice_paid' && update.payload) {
          await wallet.creditDeposit(toProviderInvoice(update.payload));
        }
        return { ok: true };
      });
    }

    if (config.BOT_MODE === 'webhook' && deps.handleTelegramUpdate && config.TELEGRAM_WEBHOOK_SECRET) {
      const secret = config.TELEGRAM_WEBHOOK_SECRET;
      const handle = deps.handleTelegramUpdate;
      app.post('/telegram/webhook', { config: { rateLimit: false } }, async (req, reply) => {
        const got = req.headers['x-telegram-bot-api-secret-token'];
        if (typeof got !== 'string' || !safeEqual(got, secret)) return reply.status(401).send();
        let update: unknown;
        try {
          update = JSON.parse((req.body as Buffer).toString('utf8'));
        } catch {
          return reply.status(400).send();
        }
        try {
          await handle(update);
        } catch (err) {
          // Not connected to Telegram yet: a 503 makes Telegram retry the update later.
          if (err instanceof BotNotReadyError) return reply.status(503).send();
          // Acknowledge anyway: Telegram would otherwise redeliver a poison update forever.
          req.log.error({ err }, 'telegram update handling failed');
        }
        return reply.status(200).send();
      });
    }
  };
}
