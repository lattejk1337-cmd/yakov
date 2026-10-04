// Headless browser smoke test: loads the game, checks for errors, plays each map briefly
// and saves screenshots to tests/screenshots.
import { createServer } from '../server/server.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const outDir = path.resolve('tests/screenshots');
fs.mkdirSync(outDir, { recursive: true });
const app = createServer({ matchmakingTimeout: 2 });
const port = await app.listen(0);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' && !/sdk\.js|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__app && window.__app.state === 'menu', null, { timeout: 120000 });
// software rendering in CI is slow: use the medium preset for the run
await page.evaluate(() => { const a = window.__app; a.profile.data.settings.quality = 'medium'; a.profile.data.settings.volumetric = false; a.applySettings(true); });
await page.mouse.click(640, 360);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, 'menu.png') });
const maps = (process.env.MAPS || 'prison,town,backrooms,hospital').split(',');
for (const map of maps) {
  await page.evaluate((m) => window.__app.startLocalMatch('squad', m), map);
  await page.waitForFunction(() => window.__app.state === 'match', null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  // walk forward a little and look around
  await page.evaluate(() => { const a = window.__app; a.input.enabled = true; a.input.downSet.add('up'); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const a = window.__app; a.input.downSet.delete('up'); });
  await page.screenshot({ path: path.join(outDir, `match-${map}.png`), timeout: 90000 });
  const info = await page.evaluate(() => {
    const m = window.__app.match;
    return { draws: window.__app.renderer.stats.draws, fps: Math.round(window.__app.fpsAvg), pos: m.local.pos.map((v) => +v.toFixed(2)), objectives: m.puzzles.hudLines().map((l) => l.text), monster: m.monster.state, lamps: m.world.lamps.length, doors: m.world.doors.length, items: m.items.pickups.length };
  });
  console.log(map, JSON.stringify(info));
  await page.evaluate(() => window.__app.leaveMatch());
  await page.waitForTimeout(500);
}
await page.screenshot({ path: path.join(outDir, 'lobby.png') });
await browser.close();
await app.close();
if (errors.length) {
  console.error('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exit(1);
}
console.log('smoke: OK');
