// Tiny DSL for authoring maps as character grids.
import { mulberry32 } from '../../engine/math.js';

export class GridBuilder {
  constructor(w, h, fill = '#', seed = 1) {
    this.w = w;
    this.h = h;
    this.g = Array.from({ length: h }, () => Array(w).fill(fill));
    this.rnd = mulberry32(seed);
  }
  inside(x, z) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  get(x, z) {
    return this.inside(x, z) ? this.g[z][x] : '#';
  }
  put(x, z, ch) {
    if (this.inside(x, z)) this.g[z][x] = ch;
    return this;
  }
  puts(list, ch) {
    for (const [x, z] of list) this.put(x, z, ch);
    return this;
  }
  fill(x0, z0, x1, z1, ch) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.put(x, z, ch);
    return this;
  }
  // room with walls on the border and floor inside
  room(x0, z0, x1, z1, floor = '.', wall = '#') {
    this.fill(x0, z0, x1, z1, wall);
    this.fill(x0 + 1, z0 + 1, x1 - 1, z1 - 1, floor);
    return this;
  }
  hline(x0, x1, z, ch) {
    return this.fill(Math.min(x0, x1), z, Math.max(x0, x1), z, ch);
  }
  vline(x, z0, z1, ch) {
    return this.fill(x, Math.min(z0, z1), x, Math.max(z0, z1), ch);
  }
  // place `ch` on `count` random cells inside rect whose current char is in `on`
  scatter(x0, z0, x1, z1, ch, count, on = '.') {
    const cells = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (on.includes(this.get(x, z))) cells.push([x, z]);
    this.rnd.shuffle(cells);
    for (let i = 0; i < Math.min(count, cells.length); i++) this.put(cells[i][0], cells[i][1], ch);
    return this;
  }
  // put ch on cells along walls (adjacent to a solid) inside rect
  scatterWall(x0, z0, x1, z1, ch, count, on = '.', solids = '#BWY') {
    const cells = [];
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!on.includes(this.get(x, z))) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => solids.includes(this.get(x + dx, z + dz)))) cells.push([x, z]);
      }
    this.rnd.shuffle(cells);
    for (let i = 0; i < Math.min(count, cells.length); i++) this.put(cells[i][0], cells[i][1], ch);
    return this;
  }
  rows() {
    return this.g.map((r) => r.join(''));
  }
}

const PASS_BLOCK = '#BWYT';
// Carve walls until every passable cell is reachable from `start`.
GridBuilder.prototype.ensureConnected = function (start, isWall = (c) => PASS_BLOCK.includes(c), canCarve = () => true) {
  for (let guard = 0; guard < 500; guard++) {
    const seen = Array.from({ length: this.h }, () => Array(this.w).fill(false));
    const q = [start];
    seen[start[1]][start[0]] = true;
    while (q.length) {
      const [x, z] = q.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!this.inside(nx, nz) || seen[nz][nx] || isWall(this.get(nx, nz))) continue;
        seen[nz][nx] = true;
        q.push([nx, nz]);
      }
    }
    // find a wall cell separating reached and unreached passable cells
    let carved = false;
    const cand = [];
    for (let z = 1; z < this.h - 1 && !carved; z++) {
      for (let x = 1; x < this.w - 1; x++) {
        if (!isWall(this.get(x, z)) || !canCarve(x, z)) continue;
        const pairs = [[[x - 1, z], [x + 1, z]], [[x, z - 1], [x, z + 1]]];
        for (const [a, b] of pairs) {
          const ca = this.get(a[0], a[1]), cb = this.get(b[0], b[1]);
          if (isWall(ca) || isWall(cb)) continue;
          if (seen[a[1]][a[0]] !== seen[b[1]][b[0]]) cand.push([x, z]);
        }
      }
    }
    if (!cand.length) return this;
    const [x, z] = cand[Math.floor(this.rnd() * cand.length)];
    this.put(x, z, '.');
  }
  return this;
};
