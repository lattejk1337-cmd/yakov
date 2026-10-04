// Two real browser clients: party by invite code, ready-up, matchmaking (duo), state sync.
import { createServer } from '../server/server.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const app = createServer({ matchmakingTimeout: 3 });
const port = await app.listen(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + String(e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/sdk\.js|Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__app && window.__app.state === 'menu' && window.__app.net.online && window.__app.net.party, null, { timeout: 120000 });
  return page;
}
const host = await player('host');
const guest = await player('guest');
const code = await host.evaluate(() => { window.__app.openLobby(); window.__app.net.setParty({ mode: 'duo', map: 'prison' }); return window.__app.net.party.code; });
console.log('party code', code);
await guest.evaluate((c) => { window.__app.openLobby(); window.__app.net.joinParty(c); }, code);
await host.waitForFunction(() => window.__app.net.party.members.length === 2, null, { timeout: 10000 });
await guest.evaluate(() => window.__app.net.setReady(true));
await host.waitForFunction(() => window.__app.net.party.members.every((m) => m.ready || m.id === window.__app.net.party.leader), null, { timeout: 10000 });
await host.evaluate(() => window.__app.net.startSearch());
await host.waitForFunction(() => window.__app.state === 'match', null, { timeout: 30000 });
await guest.waitForFunction(() => window.__app.state === 'match', null, { timeout: 30000 });
const ids = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ host: window.__app.match.isHost, map: window.__app.match.def.id, n: window.__app.match.survivors.length, seed: window.__app.match.seed }))));
console.log('match', JSON.stringify(ids));
if (!ids[0].host || ids[1].host || ids[0].seed !== ids[1].seed || ids[0].n !== 2) throw new Error('bad match setup');

// host opens a door; guest must see it, guest's position must reach the host
await host.evaluate(() => { const g = window.__app.match; const d = g.world.doors.find((x) => !x.locked); g.hostSetDoor(d, 1); window.__doorId = d.id; });
const doorId = await host.evaluate(() => window.__doorId);
await guest.waitForFunction((id) => window.__app.match.world.doors[id].target === 1, doorId, { timeout: 15000 });
await guest.evaluate(() => { const me = window.__app.match.local; me.pos[0] += 1.0; });
const gid = await guest.evaluate(() => window.__app.match.local.id);
await host.waitForFunction((id) => { const s = window.__app.match.survivorById(id); return s && s.net.has; }, gid, { timeout: 15000 });
await host.evaluate(() => { const ses = window.__app.match.session; const orig = ses.handlers.get('rq'); window.__rq = []; ses.handlers.set('rq', (d, from) => { window.__rq.push([d, from]); orig(d, from); }); });
// guest requests a pickup via the host
const picked = await guest.evaluate(async () => {
  const g = window.__app.match; const it = g.items.pickups.find((p) => p.kind === 'fuse');
  g.local.pos[0] = it.pos[0]; g.local.pos[2] = it.pos[2];
  await new Promise((r) => setTimeout(r, 1500)); // let the host receive the new position
  g.request({ a: 'pickup', id: it.id });
  return it.id;
});
try {
  await host.waitForFunction((id) => window.__app.match.items.byId.get(id).taken && window.__app.match.puzzles.state.team.fuse === 1, picked, { timeout: 15000 });
} catch (e) {
  console.log(await host.evaluate(([id, gid]) => { const g = window.__app.match; const s = g.survivorById(gid); return JSON.stringify({ item: g.items.byId.get(id).pos, guest: s.pos, net: s.net.pos, fps: window.__app.fpsAvg }); }, [picked, gid]));
  console.log(await guest.evaluate(() => JSON.stringify({ pos: window.__app.match.local.pos, fps: window.__app.fpsAvg, hostId: window.__app.match.session.hostId, off: window.__app.match.session.offline })));
  console.log(await host.evaluate(() => JSON.stringify({ rq: window.__rq, me: window.__app.net.id })));
  throw e;
}
await guest.waitForFunction(() => window.__app.match.puzzles.state.team.fuse === 1, null, { timeout: 15000 });
// monster snapshot replication
await guest.waitForFunction(() => window.__app.match.monster.hasNet, null, { timeout: 15000 });
console.log('sync: door, position, pickup, monster OK');
// host leaves -> guest becomes host
await host.evaluate(() => window.__app.leaveMatch());
await guest.waitForFunction(() => window.__app.match && window.__app.match.isHost, null, { timeout: 15000 });
console.log('host migration OK');
await browser.close();
await app.close();
if (errors.length) { console.error([...new Set(errors)].join('\n')); process.exit(1); }
console.log('multiplayer: OK');
