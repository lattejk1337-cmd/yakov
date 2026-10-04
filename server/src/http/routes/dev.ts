import type { FastifyPluginAsync } from 'fastify';
import { MockProvider } from '../../providers/mock.js';
import type { AppDeps } from '../app.js';

const page = (title: string, body: string) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f0d;color:#f2efe6;font:16px/1.5 system-ui,sans-serif}
  .card{width:min(360px,90vw);padding:28px;border:1px dashed #d8ff3d55;border-radius:24px;text-align:center}
  b{font-size:32px;display:block;margin:8px 0 20px;color:#d8ff3d}
  button{width:100%;padding:16px;border:0;border-radius:16px;background:#d8ff3d;color:#0f0f0d;font-weight:700;font-size:16px}
  small{display:block;margin-top:16px;opacity:.5}
</style></head><body><div class="card">${body}</div></body></html>`;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Local-only fake checkout for the mock provider. Never registered in production. */
export function devRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    const provider = deps.provider;
    if (!(provider instanceof MockProvider)) return;
    // The fake checkout form posts urlencoded data; its body is not needed.
    app.addContentTypeParser('application/x-www-form-urlencoded', (_req, _payload, done) => done(null, {}));

    app.get<{ Params: { id: string } }>('/mock-pay/:id', async (req, reply) => {
      const inv = provider.getInvoice(req.params.id);
      reply.type('text/html');
      if (!inv) return page('Счёт', '<p>Счёт не найден</p>');
      if (inv.status !== 'active') return page('Счёт', '<p>Счёт уже оплачен ✅</p><small>Вернитесь в приложение</small>');
      return page(
        'Тестовая оплата',
        `<p>Тестовая оплата</p><b>${escape(inv.amount)} ${escape(inv.asset)}</b>
         <form method="post"><button type="submit">Оплатить</button></form>
         <small>Mock-провайдер · только для разработки</small>`,
      );
    });

    app.post<{ Params: { id: string } }>('/mock-pay/:id', async (req, reply) => {
      const inv = provider.markPaid(req.params.id);
      reply.type('text/html');
      if (!inv) return page('Счёт', '<p>Счёт не найден</p>');
      await deps.wallet.creditDeposit(inv);
      return page('Оплачено', '<p>Оплачено ✅</p><small>Можно вернуться в приложение</small>');
    });
  };
}
