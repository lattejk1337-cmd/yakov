// Monsters must path through every unlocked doorway on every map without getting stuck.
import { createServer } from '../server/server.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const app = createServer({});
const port = await app.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__app && window.__app.state === 'menu', null, { timeout: 120000 });
let failed = 0;
for (const map of ['prison', 'town', 'backrooms', 'hospital']) {
  await page.evaluate((m) => window.__app.startLocalMatch('solo', m), map);
  await page.waitForFunction(() => window.__app.state === 'match', null, { timeout: 60000 });
  const res = await page.evaluate(() => {
    const a = window.__app, g = a.match, w = g.world, m = g.monster;
    a.paused = true; // freeze the normal loop; we step the AI manually
    g.local.pos[0] = -100; // keep the player out of the way
    const out = [];
    for (const d of w.doors) {
      if (d.locked || d.kind === 'gate') continue;
      const along = d.axis === 'x' ? [0, 1] : [1, 0];
      for (const dir of [1, -1]) {
        const start = [d.pos[0] - along[0] * 3 * dir, 0, d.pos[2] - along[1] * 3 * dir];
        const goal = [d.pos[0] + along[0] * 3 * dir, 0, d.pos[2] + along[1] * 3 * dir];
        const cs = w.cellOf(start), cg = w.cellOf(goal);
        if (!w.navWalk[cs[1]]?.[cs[0]] || !w.navWalk[cg[1]]?.[cg[0]]) continue;
        d.open = 0; d.target = 0; w.updateDoorTransform(d); d.collider.enabled = true;
        m.pos[0] = start[0]; m.pos[1] = 0; m.pos[2] = start[2];
        m.state = 'investigate'; m.goal = goal; m.path = null; m.stun = 0; m.doorWait = 0; m.speed = 0; m.sidestep = 0;
        g.noises.length = 0;
        let ok = false;
        for (let i = 0; i < 600 && !ok; i++) {
          m.state = 'investigate';
          m.goal = goal;
          m.move(1 / 30);
          w.update(1 / 30, i / 30);
          if (Math.hypot(m.pos[0] - goal[0], m.pos[2] - goal[2]) < 1.2) ok = true;
        }
        if (!ok) out.push({ door: d.id, cell: [d.x, d.z], axis: d.axis, dir, at: m.pos.map((v) => +v.toFixed(2)) });
      }
    }
    a.paused = false;
    return { total: w.doors.length, stuck: out };
  });
  console.log(map, 'doors:', res.total, 'stuck:', JSON.stringify(res.stuck));
  failed += res.stuck.length;
  await page.evaluate(() => window.__app.leaveMatch());
}
await browser.close();
await app.close();
if (failed) { console.error('monsters got stuck at', failed, 'doorways'); process.exit(1); }
console.log('doors: OK');
