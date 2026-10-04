// Grid A* with octile moves (no corner cutting) and line-of-sight path smoothing.
import { CONFIG } from './config.js';

const CELL = CONFIG.CELL;

export class NavGrid {
  constructor(world, walkFn) {
    this.world = world;
    this.w = world.w;
    this.h = world.h;
    this.walkFn = walkFn;
    const n = this.w * this.h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.cur = 1;
    this.heap = [];
  }
  walkable(x, z) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h && this.walkFn(x, z);
  }
  // returns list of world points or null
  find(from, to, maxIter = 6000) {
    const W = this.w;
    let [sx, sz] = this.world.cellOf(from);
    let [tx, tz] = this.world.cellOf(to);
    if (!this.walkable(tx, tz)) {
      const alt = this.nearestWalkable(tx, tz);
      if (!alt) return null;
      [tx, tz] = alt;
    }
    if (!this.walkable(sx, sz)) {
      const alt = this.nearestWalkable(sx, sz);
      if (!alt) return null;
      [sx, sz] = alt;
    }
    const stampId = ++this.cur;
    const start = sz * W + sx, goal = tz * W + tx;
    const heap = this.heap;
    heap.length = 0;
    const h = (i) => {
      const dx = Math.abs((i % W) - tx), dz = Math.abs(((i / W) | 0) - tz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    this.stamp[start] = stampId;
    this.g[start] = 0;
    this.f[start] = h(start);
    this.parent[start] = -1;
    heap.push(start);
    let iter = 0;
    while (heap.length && iter++ < maxIter) {
      // pop min f (binary heap)
      const cur = this.pop();
      if (cur === goal) return this.build(goal, from, to);
      if (this.closed[cur] === stampId) continue;
      this.closed[cur] = stampId;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.walkable(nx, nz)) continue;
          if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz))) continue;
          const ni = nz * W + nx;
          if (this.closed[ni] === stampId) continue;
          const ng = this.g[cur] + (dx && dz ? 1.414 : 1);
          if (this.stamp[ni] !== stampId || ng < this.g[ni]) {
            this.stamp[ni] = stampId;
            this.g[ni] = ng;
            this.f[ni] = ng + h(ni);
            this.parent[ni] = cur;
            this.push(ni);
          }
        }
      }
    }
    return null;
  }
  push(i) {
    const heap = this.heap, f = this.f;
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  }
  pop() {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  }
  build(goal, from, to) {
    const W = this.w;
    const cells = [];
    for (let i = goal; i !== -1; i = this.parent[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => [((i % W) + 0.5) * CELL, 0, (((i / W) | 0) + 0.5) * CELL]);
    if (pts.length) pts[pts.length - 1] = [to[0], 0, to[2]];
    // string pulling over walkable cells
    const out = [];
    let anchor = [from[0], 0, from[2]];
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
  clearLine(a, b) {
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.ceil(d / (CELL * 0.25));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      // check a small square around the line point (monster width)
      for (const [ox, oz] of [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) {
        if (!this.walkable(Math.floor((x + ox) / CELL), Math.floor((z + oz) / CELL))) return false;
      }
    }
    return true;
  }
  nearestWalkable(x, z) {
    for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (this.walkable(x + dx, z + dz)) return [x + dx, z + dz];
    }
    return null;
  }
}
