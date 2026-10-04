// Validates map grids: spawns exist, every objective anchor and exit is reachable.
import assert from 'node:assert/strict';
import { MAPS } from '../client/src/game/maps/index.js';

const SOLID = '#BWYT';
for (const [id, m] of Object.entries(MAPS)) {
  const g = m.grid;
  const h = g.length, w = g[0].length;
  assert.ok(g.every((r) => r.length === w), `${id}: ragged rows`);
  const find = (ch) => { const out = []; g.forEach((r, z) => [...r].forEach((c, x) => c === ch && out.push([x, z]))); return out; };
  const spawns = find('P');
  assert.ok(spawns.length >= 4, `${id}: needs 4 spawns`);
  assert.ok(find('X').length > 0, `${id}: needs exit cells`);
  assert.ok(find('M').length > 0, `${id}: needs monster spawn`);
  // flood fill from first spawn; doors/locked doors are passable (they open during play)
  const seen = Array.from({ length: h }, () => Array(w).fill(false));
  const passable = (c) => !SOLID.includes(c) && c !== '|' && c !== 'f';
  const q = [spawns[0]];
  seen[spawns[0][1]][spawns[0][0]] = true;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h || seen[nz][nx] || !passable(g[nz][nx])) continue;
      seen[nz][nx] = true;
      q.push([nx, nz]);
    }
  }
  const must = new Set(['X', 'M', 'F', 'n', ...Object.keys(m.objects || {})]);
  for (const ch of must) {
    for (const [x, z] of find(ch)) {
      // wall-mounted objects may sit next to walls; require the cell itself to be reachable
      assert.ok(seen[z][x], `${id}: '${ch}' at ${x},${z} unreachable`);
    }
  }
  // objectives reference existing anchors
  for (const o of m.objectives) {
    for (const key of ['spawn', 'deliver', 'keypad', 'anchor', 'board', 'clue']) {
      if (o[key]) assert.ok(find(o[key]).length > 0, `${id}: objective ${o.id} anchor '${o[key]}' missing`);
    }
    if (o.type === 'collect') assert.ok(find(o.spawn).length >= (o.late ? o.count - 1 : o.count), `${id}: not enough '${o.spawn}' spawns for ${o.id}`);
    for (const r of o.requires || []) assert.ok(m.objectives.some((x) => x.id === r), `${id}: unknown requirement ${r}`);
  }
  console.log(`map ${id}: ${w}x${h} OK`);
}
