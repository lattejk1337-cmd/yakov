// End-to-end objective chains: completes every map through the real host logic
// (pickups, deliveries, levers, keypad, generator, radio, valves, symbols, exit).
import { createServer } from '../server/server.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const app = createServer({ static: true });
const port = await app.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error' && !/sdk\.js|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__app && window.__app.state === 'menu', null, { timeout: 120000 });

for (const map of ['prison', 'town', 'backrooms', 'hospital']) {
  await page.evaluate((m) => window.__app.startLocalMatch('solo', m), map);
  await page.waitForFunction(() => window.__app.state === 'match', null, { timeout: 60000 });
  const log = await page.evaluate(async () => {
    const a = window.__app, g = a.match, me = g.local, pz = g.puzzles;
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // keep the monster away so the test is deterministic
    g.monster.hostUpdate = () => {};
    g.monster.pos[0] = -50;
    const tp = (p) => { me.pos[0] = p[0]; me.pos[2] = p[2]; me.pos[1] = 0; };
    const pickupAll = (kind) => {
      for (const it of g.items.pickups) {
        if (it.kind !== kind || !g.items.isAvailable(it)) continue;
        tp(it.pos);
        g.request({ a: 'pickup', id: it.id });
      }
    };
    const anchor = (ch, i = 0) => g.world.anchors[ch][i];
    for (let guard = 0; guard < 40; guard++) {
      const active = pz.objectives.filter((o) => !pz.isDone(o.id) && pz.reqsDone(o) && o.type !== 'exit');
      if (!active.length) break;
      for (const o of active) {
        const st = pz.state.obj[o.id];
        switch (o.type) {
          case 'collect':
            pickupAll(o.item);
            if (o.deliver) {
              tp(anchor(o.deliver).pos);
              for (let k = 0; k < o.count; k++) g.request({ a: 'deliver', o: o.id });
            }
            break;
          case 'keypad':
            tp(anchor(o.keypad).pos);
            g.request({ a: 'code', o: o.id, code: '0000' === st.code ? '1111' : '0000' });
            g.request({ a: 'code', o: o.id, code: st.code });
            break;
          case 'levers':
            st.pattern.forEach((want, i) => { if (st.levers[i] !== want) { tp(anchor(o.anchor, i).pos); g.request({ a: 'lever', o: o.id, i }); } });
            break;
          case 'generator':
            me.repairing = o.id;
            for (let k = 0; k < 120 && !pz.isDone(o.id); k++) pz.hostUpdate(0.5);
            me.repairing = null;
            break;
          case 'radio':
            g.request({ a: 'radio', o: o.id, f: st.freq });
            break;
          case 'valves':
            st.valves.forEach((v, i) => { tp(anchor(o.anchor, i).pos); g.request({ a: 'valve', o: o.id, i }); });
            break;
          case 'symbols':
            tp(anchor(o.anchor).pos);
            g.request({ a: 'sym', o: o.id, i: (st.order[0] + 1) % st.order.length }); // wrong press resets
            for (const i of st.order) g.request({ a: 'sym', o: o.id, i });
            break;
        }
        out.push(`${o.id}:${pz.isDone(o.id) ? 'done' : 'pending'}`);
      }
      await sleep(50);
    }
    for (let k = 0; k < 100 && !g.exitOpen; k++) await sleep(100);
    await sleep(500);
    const locked = g.world.doors.filter((d) => d.locked).length;
    out.push('exitOpen=' + g.exitOpen, 'lockedDoors=' + locked);
    // walk into the exit
    const [ex, ez] = g.world.exitCells[0];
    tp(g.world.center(ex, ez));
    for (let k = 0; k < 100 && !me.escaped; k++) await sleep(100);
    out.push('escaped=' + me.escaped);
    return out;
  });
  console.log(map, log.join(' '));
  if (!log.includes('exitOpen=true') || !log.includes('escaped=true')) throw new Error(map + ' could not be completed');
  await page.waitForFunction(() => window.__app.state === 'results', null, { timeout: 20000 });
  const res = await page.evaluate(() => ({ xp: window.__app.results.xp, coins: window.__app.results.coins, level: window.__app.profile.data.level }));
  console.log('  results', JSON.stringify(res));
  await page.evaluate(() => window.__app.afterResults());
  await page.waitForTimeout(300);
}
await browser.close();
await app.close();
if (errors.length) { console.error([...new Set(errors)].join('\n')); process.exit(1); }
console.log('gameplay: OK');
