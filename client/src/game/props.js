// Modelling kit + library of detailed prop prefabs (built from primitives with vertex colours
// and merged into static chunk meshes, so a fully dressed map costs only a few draw calls).
import { cubeBuilder, cylinderBuilder, sphereBuilder, capsuleBuilder, torusBuilder } from '../engine/mesh.js';
import { MAT } from '../engine/textures.js';
import { m4 } from '../engine/math.js';

export const PRIM = {
  cube: cubeBuilder(),
  cyl: cylinderBuilder(0, 12),
  cyl6: cylinderBuilder(0, 6),
  cylOpen: cylinderBuilder(0, 12, false),
  cone: cylinderBuilder(0, 12, true, 0, 0.5),
  sphere: sphereBuilder(0, 12, 9),
  sphereLo: sphereBuilder(0, 7, 5),
  capsule: capsuleBuilder(0, 0.5, 2, 10, 4),
  torus: torusBuilder(0, 0.4, 0.1, 16, 8),
};

const tmp = m4.create();
const TORI = new Map();

export class Kit {
  constructor(builder, base = null, opts = {}) {
    this.b = builder;
    this.m = m4.create();
    if (base) m4.copy(this.m, base);
    this.stack = [];
    this.sky = opts.sky ?? 0;
  }
  push() {
    this.stack.push(new Float32Array(this.m));
    return this;
  }
  pop() {
    this.m = this.stack.pop();
    return this;
  }
  t(x, y, z) {
    m4.translate(this.m, this.m, x, y, z);
    return this;
  }
  rx(a) {
    m4.rotateX(this.m, this.m, a);
    return this;
  }
  ry(a) {
    m4.rotateY(this.m, this.m, a);
    return this;
  }
  rz(a) {
    m4.rotateZ(this.m, this.m, a);
    return this;
  }
  shape(prim, mat, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    m4.translate(tmp, this.m, x, y, z);
    if (ry) m4.rotateY(tmp, tmp, ry);
    if (rx) m4.rotateX(tmp, tmp, rx);
    if (rz) m4.rotateZ(tmp, tmp, rz);
    m4.scale(tmp, tmp, sx, sy, sz);
    this.b.color(color);
    this.b.append(prim, tmp, { mat, sky: this.sky });
    this.b.color(null);
    return this;
  }
  box(mat, c, x, y, z, sx, sy, sz, rx, ry, rz) {
    return this.shape(PRIM.cube, mat, c, x, y, z, sx, sy, sz, rx, ry, rz);
  }
  cyl(mat, c, x, y, z, r, h, rx, ry, rz, lo = false) {
    return this.shape(lo ? PRIM.cyl6 : PRIM.cyl, mat, c, x, y, z, r * 2, h, r * 2, rx, ry, rz);
  }
  tube(mat, c, x, y, z, r, h, rx, ry, rz) {
    return this.shape(PRIM.cylOpen, mat, c, x, y, z, r * 2, h, r * 2, rx, ry, rz);
  }
  cone(mat, c, x, y, z, r, h, rx, ry, rz) {
    return this.shape(PRIM.cone, mat, c, x, y, z, r * 2, h, r * 2, rx, ry, rz);
  }
  ball(mat, c, x, y, z, sx, sy, sz, rx, ry, rz, lo = false) {
    return this.shape(lo ? PRIM.sphereLo : PRIM.sphere, mat, c, x, y, z, sx, sy, sz, rx, ry, rz);
  }
  caps(mat, c, x, y, z, sx, sy, sz, rx, ry, rz) {
    return this.shape(PRIM.capsule, mat, c, x, y, z, sx, sy / 2, sz, rx, ry, rz);
  }
  ring(mat, c, x, y, z, R, r, rx, ry, rz) {
    const key = R.toFixed(3) + ',' + r.toFixed(3);
    let tb = TORI.get(key);
    if (!tb) TORI.set(key, (tb = torusBuilder(0, R, r, R > 0.2 ? 18 : 12, 6)));
    return this.shape(tb, mat, c, x, y, z, 1, 1, 1, rx, ry, rz);
  }
  // segment between two points (limbs, pipes, branches)
  seg(mat, c, a, b, r, lo = false) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    m4.translate(tmp, this.m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    // rotate +Y onto the segment direction
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    m4.rotateY(tmp, tmp, yaw);
    m4.rotateX(tmp, tmp, pitch);
    m4.scale(tmp, tmp, r * 2, len, r * 2);
    this.b.color(c);
    this.b.append(lo ? PRIM.cyl6 : PRIM.cyl, tmp, { mat, sky: this.sky });
    this.b.color(null);
    return this;
  }
}

// ------------------------------------------------------------------ colours
const C = {
  rust: [0.55, 0.42, 0.36], steel: [0.62, 0.64, 0.66], dark: [0.12, 0.12, 0.13], black: [0.05, 0.05, 0.05],
  white: [0.86, 0.86, 0.84], cream: [0.8, 0.76, 0.66], wood: [0.75, 0.62, 0.5], darkWood: [0.45, 0.35, 0.28],
  red: [0.6, 0.1, 0.08], green: [0.2, 0.35, 0.25], blue: [0.2, 0.3, 0.5], yellow: [0.85, 0.65, 0.12],
  card: [0.62, 0.48, 0.32], paper: [0.92, 0.9, 0.84], grey: [0.45, 0.45, 0.46], orange: [0.85, 0.4, 0.08],
};
export { C as COLORS };

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// Each prefab: fn(kit, rnd) builds facing +Z with its back at z = -depth/2 (against a wall).
// Returns collider half-extents {w, d, h} (0 = no collider) in prefab space.
export const PREFABS = {
  barrel(k, rnd) {
    const col = pick(rnd, [[0.3, 0.35, 0.45], [0.55, 0.15, 0.1], [0.3, 0.38, 0.25], [0.6, 0.55, 0.2]]);
    k.cyl(MAT.PAINTED_METAL, col, 0, 0.45, 0, 0.29, 0.9);
    for (const y of [0.05, 0.3, 0.6, 0.86]) k.ring(MAT.RUST_METAL, C.rust, 0, y, 0, 0.29, 0.015);
    k.cyl(MAT.RUST_METAL, C.dark, 0.12, 0.905, 0.08, 0.04, 0.02);
    return { w: 0.3, d: 0.3, h: 0.92 };
  },
  barrels(k, rnd) {
    k.push().t(-0.32, 0, 0);
    PREFABS.barrel(k, rnd);
    k.pop().push().t(0.3, 0, 0.05);
    PREFABS.barrel(k, rnd);
    k.pop().push().t(0, 0.0, 0.0).t(0.02, 0, 0.45).rz(Math.PI / 2).t(-0.29, 0, 0);
    if (rnd() < 0.5) PREFABS.barrel(k, rnd);
    k.pop();
    return { w: 0.62, d: 0.32, h: 0.92 };
  },
  crate(k, rnd) {
    const s = 0.3 + rnd() * 0.15;
    k.box(MAT.WOOD, C.wood, 0, s, 0, s * 2, s * 2, s * 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(MAT.WOOD, C.darkWood, sx * (s - 0.03), s, sz * (s + 0.005), 0.06, s * 2, 0.02);
    k.box(MAT.WOOD, C.darkWood, 0, s, s + 0.005, s * 2.6, 0.06, 0.02, 0, 0, Math.PI / 4);
    if (rnd() < 0.5) k.box(MAT.WOOD, C.wood, 0.05, s * 2 + 0.2, -0.02, s * 1.3, 0.4, s * 1.3, 0, 0.4, 0);
    return { w: s, d: s, h: s * 2 };
  },
  boxes(k, rnd) {
    let y = 0;
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const w = 0.25 + rnd() * 0.15, h = 0.18 + rnd() * 0.18, d = 0.22 + rnd() * 0.12;
      const c = C.card.map((v) => v * (0.8 + rnd() * 0.3));
      k.box(MAT.PAPER, c, (rnd() - 0.5) * 0.15, y + h, (rnd() - 0.5) * 0.1, w * 2, h * 2, d * 2, 0, (rnd() - 0.5) * 0.4, 0);
      k.box(MAT.PAPER, [0.75, 0.65, 0.4], (rnd() - 0.5) * 0.05, y + h * 2 + 0.002, 0, w * 2, 0.004, 0.08);
      y += h * 2;
    }
    return { w: 0.38, d: 0.3, h: y };
  },
  pallet(k) {
    for (let i = 0; i < 5; i++) k.box(MAT.WOOD, C.wood, -0.48 + i * 0.24, 0.13, 0, 0.16, 0.025, 1.0);
    for (const x of [-0.5, 0, 0.5]) k.box(MAT.WOOD, C.darkWood, x, 0.06, 0, 0.1, 0.1, 1.0);
    return { w: 0, d: 0, h: 0 };
  },
  chair(k, rnd) {
    const c = pick(rnd, [C.steel, [0.3, 0.32, 0.4], C.red.map((v) => v * 1.2)]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(MAT.PAINTED_METAL, C.dark, sx * 0.2, 0.22, sz * 0.2, 0.012, 0.44);
    k.box(MAT.PAINTED_METAL, c, 0, 0.45, 0, 0.44, 0.03, 0.42);
    k.box(MAT.PAINTED_METAL, c, 0, 0.75, -0.2, 0.42, 0.28, 0.025, -0.1);
    for (const sx of [-1, 1]) k.cyl(MAT.PAINTED_METAL, C.dark, sx * 0.2, 0.62, -0.21, 0.012, 0.35);
    return { w: 0, d: 0, h: 0 };
  },
  fallenChair(k, rnd) {
    k.push().t(0, 0.22, 0).rx(-Math.PI / 2 + 0.2).t(0, -0.22, 0);
    PREFABS.chair(k, rnd);
    k.pop();
    return { w: 0, d: 0, h: 0 };
  },
  officeChair(k, rnd) {
    const c = pick(rnd, [[0.15, 0.15, 0.18], [0.2, 0.25, 0.4], [0.35, 0.12, 0.1]]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      k.box(MAT.PAINTED_METAL, C.dark, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15, 0.3, 0.03, 0.04, 0, -a, 0);
      k.ball(MAT.PAINTED_METAL, C.black, Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29, 0.05, 0.05, 0.05);
    }
    k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.27, 0, 0.025, 0.42);
    k.box(MAT.FABRIC, c, 0, 0.5, 0, 0.46, 0.08, 0.44);
    k.box(MAT.FABRIC, c, 0, 0.85, -0.22, 0.44, 0.56, 0.07, -0.12);
    for (const sx of [-1, 1]) k.box(MAT.PAINTED_METAL, C.dark, sx * 0.24, 0.66, 0, 0.04, 0.03, 0.3);
    return { w: 0, d: 0, h: 0 };
  },
  desk(k, rnd) {
    const top = pick(rnd, [C.wood, [0.6, 0.58, 0.55], C.darkWood]);
    k.box(MAT.WOOD, top, 0, 0.74, 0, 1.4, 0.04, 0.7);
    k.box(MAT.PAINTED_METAL, C.steel, -0.6, 0.37, 0, 0.04, 0.74, 0.66);
    k.box(MAT.PAINTED_METAL, C.steel, 0.47, 0.37, 0, 0.4, 0.74, 0.66);
    for (let i = 0; i < 3; i++) {
      k.box(MAT.PAINTED_METAL, [0.7, 0.7, 0.72], 0.47, 0.15 + i * 0.22, 0.335, 0.38, 0.19, 0.01);
      k.box(MAT.PAINTED_METAL, C.dark, 0.47, 0.2 + i * 0.22, 0.345, 0.1, 0.02, 0.01);
    }
    // monitor, keyboard, papers, mug
    if (rnd() < 0.8) {
      k.box(MAT.PAINTED_METAL, C.dark, -0.1, 0.98, -0.15, 0.48, 0.34, 0.05);
      k.box(MAT.GLASS, [0.1, 0.12, 0.12], -0.1, 0.98, -0.12, 0.44, 0.3, 0.005);
      k.box(MAT.PAINTED_METAL, C.dark, -0.1, 0.79, -0.15, 0.18, 0.02, 0.12);
      k.box(MAT.PAINTED_METAL, C.dark, -0.1, 0.84, -0.17, 0.05, 0.1, 0.03);
      k.box(MAT.PAINTED_METAL, [0.8, 0.8, 0.78], -0.08, 0.77, 0.15, 0.44, 0.02, 0.14);
    }
    for (let i = 0; i < 3; i++) k.box(MAT.PAPER, C.paper, 0.3 + rnd() * 0.25, 0.763 + i * 0.002, 0.05 + rnd() * 0.15, 0.21, 0.002, 0.29, 0, rnd() * 0.6, 0);
    if (rnd() < 0.6) k.cyl(MAT.PAINTED_METAL, pick(rnd, [C.white, C.red, C.blue]), 0.55, 0.81, -0.15, 0.04, 0.1);
    return { w: 0.7, d: 0.35, h: 0.76 };
  },
  table(k, rnd) {
    k.box(MAT.WOOD, C.wood, 0, 0.74, 0, 1.2, 0.05, 0.8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(MAT.WOOD, C.darkWood, sx * 0.54, 0.36, sz * 0.34, 0.03, 0.72);
    if (rnd() < 0.7) {
      k.box(MAT.PAINTED_METAL, [0.6, 0.6, 0.62], -0.25, 0.775, 0.1, 0.36, 0.02, 0.26);
      k.cyl(MAT.PAINTED_METAL, C.white, 0.3, 0.8, -0.1, 0.05, 0.1);
    }
    return { w: 0.6, d: 0.4, h: 0.77 };
  },
  shelf(k, rnd) {
    const col = pick(rnd, [C.steel, [0.35, 0.4, 0.35], C.rust]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(MAT.RUST_METAL, col, sx * 0.47, 1.0, sz * 0.18, 0.04, 2.0, 0.04);
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + i * 0.6;
      k.box(MAT.RUST_METAL, col, 0, y, 0, 0.98, 0.03, 0.4);
      let x = -0.42;
      while (x < 0.38) {
        const w = 0.08 + rnd() * 0.18;
        const r = rnd();
        if (r < 0.4) k.box(MAT.PAPER, C.card.map((v) => v * (0.7 + rnd() * 0.4)), x + w / 2, y + 0.1 + rnd() * 0.05, 0, w, 0.18 + rnd() * 0.1, 0.3);
        else if (r < 0.65) k.cyl(MAT.GLASS, pick(rnd, [[0.4, 0.6, 0.4], [0.6, 0.45, 0.25], [0.7, 0.75, 0.8]]), x + w / 2, y + 0.1, 0, Math.min(w, 0.1) / 2, 0.18);
        else if (r < 0.8) k.cyl(MAT.PAINTED_METAL, pick(rnd, [C.red, C.blue, C.yellow, C.white]), x + w / 2, y + 0.08, 0, Math.min(w, 0.12) / 2, 0.14);
        x += w + 0.03;
      }
    }
    return { w: 0.5, d: 0.2, h: 2.0 };
  },
  locker(k, rnd) {
    const col = pick(rnd, [[0.35, 0.42, 0.45], [0.45, 0.4, 0.3], [0.3, 0.38, 0.3]]);
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.42;
      k.box(MAT.PAINTED_METAL, col, x, 0.95, 0, 0.4, 1.9, 0.45);
      for (let s = 0; s < 4; s++) k.box(MAT.PAINTED_METAL, C.dark, x, 1.55 + s * 0.06, 0.226, 0.25, 0.02, 0.005);
      k.box(MAT.PAINTED_METAL, C.steel, x + 0.14, 1.0, 0.235, 0.03, 0.12, 0.02);
      if (rnd() < 0.2) k.box(MAT.PAINTED_METAL, col, x + 0.18, 0.95, 0.4, 0.38, 1.85, 0.02, 0, -1.1, 0);
    }
    return { w: n * 0.21, d: 0.23, h: 1.9 };
  },
  filing(k, rnd) {
    k.box(MAT.PAINTED_METAL, [0.55, 0.56, 0.52], 0, 0.66, 0, 0.47, 1.32, 0.6);
    for (let i = 0; i < 4; i++) {
      const open = rnd() < 0.15 ? 0.25 : 0;
      k.box(MAT.PAINTED_METAL, [0.6, 0.61, 0.57], 0, 0.17 + i * 0.32, 0.3 + open, 0.43, 0.29, 0.02);
      k.box(MAT.PAINTED_METAL, C.dark, 0, 0.25 + i * 0.32, 0.315 + open, 0.12, 0.025, 0.02);
      if (open) k.box(MAT.PAPER, C.paper, 0, 0.27 + i * 0.32, 0.18, 0.4, 0.18, 0.3);
    }
    return { w: 0.24, d: 0.3, h: 1.32 };
  },
  cooler(k) {
    k.box(MAT.PAINTED_METAL, C.white, 0, 0.5, 0, 0.32, 1.0, 0.32);
    k.cyl(MAT.GLASS, [0.55, 0.7, 0.85], 0, 1.22, 0, 0.14, 0.42);
    k.box(MAT.PAINTED_METAL, C.blue, -0.06, 0.82, 0.165, 0.04, 0.05, 0.03);
    k.box(MAT.PAINTED_METAL, C.red, 0.06, 0.82, 0.165, 0.04, 0.05, 0.03);
    return { w: 0.17, d: 0.17, h: 1.4 };
  },
  vending(k, rnd) {
    const c = pick(rnd, [[0.6, 0.08, 0.06], [0.1, 0.25, 0.55]]);
    k.box(MAT.PAINTED_METAL, c, 0, 0.95, 0, 0.9, 1.9, 0.7);
    k.box(MAT.GLASS, [0.15, 0.17, 0.2], -0.12, 1.1, 0.352, 0.58, 1.3, 0.01);
    for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) k.cyl(MAT.PAINTED_METAL, pick(rnd, [C.red, C.yellow, C.blue, C.green, C.white]), -0.35 + i * 0.15, 0.6 + r * 0.24, 0.25, 0.04, 0.12);
    k.box(MAT.LAMP, [0.6, 0.85, 1], 0.33, 1.4, 0.354, 0.14, 0.2, 0.01);
    k.box(MAT.PAINTED_METAL, C.dark, 0.33, 0.9, 0.354, 0.12, 0.3, 0.01);
    return { w: 0.45, d: 0.35, h: 1.9 };
  },
  radiator(k) {
    for (let i = 0; i < 10; i++) k.box(MAT.PAINTED_METAL, [0.75, 0.72, 0.66], -0.45 + i * 0.1, 0.45, 0, 0.06, 0.6, 0.12);
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.72, 0.66], 0, 0.78, 0, 0.025, 1.0, 0, 0, Math.PI / 2);
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.72, 0.66], 0, 0.14, 0, 0.025, 1.0, 0, 0, Math.PI / 2);
    return { w: 0.5, d: 0.08, h: 0.8 };
  },
  extinguisher(k) {
    k.box(MAT.PAINTED_METAL, C.dark, 0, 1.1, -0.05, 0.25, 0.04, 0.1);
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.08, 0.05], 0, 0.85, 0.02, 0.08, 0.5);
    k.ball(MAT.PAINTED_METAL, [0.75, 0.08, 0.05], 0, 1.1, 0.02, 0.16, 0.12, 0.16);
    k.box(MAT.PAINTED_METAL, C.dark, 0, 1.18, 0.02, 0.04, 0.08, 0.04);
    k.seg(MAT.PAINTED_METAL, C.black, [0.02, 1.17, 0.03], [0.1, 0.8, 0.08], 0.012, true);
    return { w: 0, d: 0, h: 0 };
  },
  electricBox(k, rnd) {
    k.box(MAT.PAINTED_METAL, [0.5, 0.52, 0.48], 0, 1.4, 0, 0.5, 0.65, 0.18);
    k.box(MAT.PAINTED_METAL, [0.95, 0.75, 0.1], 0, 1.55, 0.092, 0.12, 0.1, 0.005);
    for (let i = 0; i < 3; i++) k.cyl(MAT.PAINTED_METAL, C.dark, -0.15 + i * 0.15, 2.2, 0, 0.02, 0.9);
    if (rnd() < 0.5) k.seg(MAT.PAINTED_METAL, C.black, [0.18, 1.1, 0.05], [0.4, 0.05, 0.3], 0.012, true);
    return { w: 0, d: 0, h: 0 };
  },
  pipesWall(k, rnd, h = 3) {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const y = h - 0.25 - i * 0.18;
      const r = 0.04 + rnd() * 0.04;
      k.cyl(MAT.RUST_METAL, pick(rnd, [C.rust, C.steel, [0.4, 0.45, 0.4]]), 0, y, -0.1 + i * 0.02, r, 2.0, 0, 0, Math.PI / 2);
      k.ring(MAT.RUST_METAL, C.rust, -0.6, y, -0.1 + i * 0.02, r + 0.01, 0.012, 0, 0, Math.PI / 2);
      k.box(MAT.RUST_METAL, C.dark, 0.4, y + r + 0.03, -0.14, 0.05, 0.06, 0.05);
    }
    return { w: 0, d: 0, h: 0 };
  },
  cables(k, rnd, h = 3) {
    for (let i = 0; i < 3; i++) {
      const sag = 0.1 + rnd() * 0.3;
      let prev = [-1, h - 0.1, -0.05 + i * 0.03];
      for (let s = 1; s <= 6; s++) {
        const x = -1 + (s / 6) * 2;
        const y = h - 0.1 - Math.sin((s / 6) * Math.PI) * sag;
        const p = [x, y, -0.05 + i * 0.03];
        k.seg(MAT.PAINTED_METAL, C.black, prev, p, 0.01, true);
        prev = p;
      }
    }
    if (rnd() < 0.4) k.seg(MAT.PAINTED_METAL, C.black, [0.3, h - 0.25, 0], [0.35, h - 1.4 - rnd(), 0.2], 0.012, true);
    return { w: 0, d: 0, h: 0 };
  },
  trashBag(k, rnd) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.3, s = 0.22 + rnd() * 0.1;
      k.ball(MAT.GLASS, [0.06, 0.06, 0.07], x, s * 0.8, z, s * 2, s * 1.6, s * 1.8, 0, rnd(), 0);
      k.cone(MAT.GLASS, [0.06, 0.06, 0.07], x, s * 1.6, z, 0.05, 0.12);
    }
    return { w: 0, d: 0, h: 0 };
  },
  trashCan(k, rnd) {
    k.cyl(MAT.PAINTED_METAL, pick(rnd, [[0.35, 0.4, 0.35], C.steel, [0.25, 0.3, 0.45]]), 0, 0.42, 0, 0.27, 0.84);
    for (const y of [0.15, 0.45, 0.75]) k.ring(MAT.PAINTED_METAL, C.steel, 0, y, 0, 0.275, 0.012);
    if (rnd() < 0.6) k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.87, 0, 0.29, 0.04);
    else k.cyl(MAT.PAINTED_METAL, C.steel, 0.35, 0.1, 0.1, 0.29, 0.04, Math.PI / 2 - 0.3, 0, 0);
    return { w: 0.27, d: 0.27, h: 0.88 };
  },
  papers(k, rnd) {
    for (let i = 0; i < 6; i++) k.box(MAT.PAPER, C.paper.map((v) => v * (0.8 + rnd() * 0.2)), (rnd() - 0.5) * 1.4, 0.004 + i * 0.001, (rnd() - 0.5) * 1.4, 0.21, 0.002, 0.29, 0, rnd() * 6, 0);
    return { w: 0, d: 0, h: 0 };
  },
  debris(k, rnd) {
    for (let i = 0; i < 7; i++) {
      const s = 0.04 + rnd() * 0.12;
      k.box(MAT.CONCRETE, [0.7, 0.7, 0.68], (rnd() - 0.5) * 1.4, s * 0.4, (rnd() - 0.5) * 1.4, s * 2, s, s * 1.6, rnd(), rnd() * 6, rnd());
    }
    if (rnd() < 0.5) k.box(MAT.WOOD, C.darkWood, (rnd() - 0.5), 0.03, (rnd() - 0.5), 1.0, 0.04, 0.1, 0, rnd() * 6, 0.1);
    return { w: 0, d: 0, h: 0 };
  },
  bucket(k, rnd) {
    k.cyl(MAT.PAINTED_METAL, pick(rnd, [C.yellow, C.blue, C.steel]), 0, 0.15, 0, 0.14, 0.3);
    k.ring(MAT.PAINTED_METAL, C.steel, 0, 0.32, 0, 0.13, 0.008, Math.PI / 2 - 0.4, 0, 0);
    k.seg(MAT.WOOD, C.wood, [0.05, 0.2, 0], [0.25, 1.3, -0.15], 0.015, true);
    k.box(MAT.FABRIC, [0.6, 0.6, 0.55], 0.05, 0.12, 0, 0.18, 0.15, 0.06);
    return { w: 0, d: 0, h: 0 };
  },
  tires(k, rnd) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) k.ring(MAT.PAINTED_METAL, C.black, (rnd() - 0.5) * 0.1, 0.1 + i * 0.2, (rnd() - 0.5) * 0.1, 0.28, 0.1);
    return { w: 0.38, d: 0.38, h: n * 0.2 };
  },
  cinder(k, rnd) {
    for (let i = 0; i < 5; i++) k.box(MAT.CONCRETE, [0.75, 0.75, 0.72], (i % 3) * 0.42 - 0.42, 0.1 + Math.floor(i / 3) * 0.2, (rnd() - 0.5) * 0.05, 0.4, 0.2, 0.2);
    return { w: 0.62, d: 0.12, h: 0.4 };
  },
  mattress(k, rnd) {
    k.box(MAT.FABRIC, [0.75, 0.72, 0.62], 0, 0.08, 0, 0.9, 0.16, 1.9, 0, rnd() * 0.3, 0);
    k.ball(MAT.FABRIC, [0.6, 0.55, 0.45], 0.2, 0.12, 0.3, 0.4, 0.06, 0.5);
    return { w: 0, d: 0, h: 0 };
  },
  toilet(k) {
    k.box(MAT.PAINTED_METAL, C.steel, 0, 0.6, -0.1, 0.4, 0.4, 0.15);
    k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.2, 0.08, 0.13, 0.4);
    k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.42, 0.14, 0.2, 0.04);
    k.ring(MAT.PAINTED_METAL, [0.2, 0.2, 0.2], 0, 0.45, 0.14, 0.16, 0.025);
    return { w: 0.22, d: 0.25, h: 0.5 };
  },
  sink(k) {
    k.box(MAT.TILES, C.white, 0, 0.85, 0, 0.5, 0.12, 0.38);
    k.box(MAT.TILES, [0.5, 0.52, 0.5], 0, 0.9, 0.02, 0.42, 0.04, 0.3);
    k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.45, -0.1, 0.04, 0.8);
    k.seg(MAT.PAINTED_METAL, C.steel, [0, 0.92, -0.16], [0, 1.02, -0.05], 0.015, true);
    k.box(MAT.GLASS, [0.6, 0.65, 0.7], 0, 1.45, -0.18, 0.45, 0.55, 0.01);
    k.box(MAT.PAINTED_METAL, C.dark, 0, 1.45, -0.185, 0.5, 0.6, 0.01);
    return { w: 0.25, d: 0.19, h: 0.95 };
  },
  bench(k, rnd) {
    for (let i = 0; i < 3; i++) k.box(MAT.WOOD, C.wood, 0, 0.45, -0.15 + i * 0.15, 1.6, 0.04, 0.12);
    for (let i = 0; i < 2; i++) k.box(MAT.WOOD, C.wood, 0, 0.7 + i * 0.16, -0.28, 1.6, 0.1, 0.03, -0.15);
    for (const sx of [-0.7, 0.7]) {
      k.box(MAT.PAINTED_METAL, C.dark, sx, 0.22, 0, 0.05, 0.45, 0.4);
      k.box(MAT.PAINTED_METAL, C.dark, sx, 0.65, -0.28, 0.05, 0.45, 0.04, -0.15);
    }
    void rnd;
    return { w: 0.8, d: 0.22, h: 0.5 };
  },
  mailbox(k, rnd) {
    k.box(MAT.WOOD, C.darkWood, 0, 0.5, 0, 0.08, 1.0, 0.08);
    k.box(MAT.PAINTED_METAL, pick(rnd, [C.blue, C.red, C.steel]), 0, 1.08, 0, 0.22, 0.2, 0.45);
    k.cyl(MAT.PAINTED_METAL, pick(rnd, [C.blue, C.red, C.steel]), 0, 1.18, 0, 0.11, 0.45, Math.PI / 2, 0, 0);
    k.box(MAT.PAINTED_METAL, C.red, 0.12, 1.15, 0.1, 0.01, 0.15, 0.04);
    return { w: 0.05, d: 0.05, h: 1.2 };
  },
  hydrant(k) {
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.1, 0.06], 0, 0.35, 0, 0.11, 0.7);
    k.ball(MAT.PAINTED_METAL, [0.75, 0.1, 0.06], 0, 0.72, 0, 0.22, 0.16, 0.22);
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.1, 0.06], 0, 0.5, 0, 0.05, 0.36, 0, 0, Math.PI / 2);
    k.cyl(MAT.PAINTED_METAL, [0.75, 0.1, 0.06], 0, 0.06, 0, 0.16, 0.08);
    return { w: 0.15, d: 0.15, h: 0.8 };
  },
  cone(k) {
    k.box(MAT.PAINTED_METAL, C.dark, 0, 0.015, 0, 0.36, 0.03, 0.36);
    k.cone(MAT.PAINTED_METAL, C.orange, 0, 0.36, 0, 0.14, 0.66);
    k.ring(MAT.PAINTED_METAL, C.white, 0, 0.4, 0, 0.07, 0.012);
    return { w: 0, d: 0, h: 0 };
  },
  barrier(k) {
    for (const sx of [-0.6, 0.6]) k.box(MAT.PAINTED_METAL, C.white, sx, 0.45, 0, 0.06, 0.9, 0.4, 0.1);
    for (let i = 0; i < 6; i++) k.box(MAT.PAINTED_METAL, i % 2 ? C.white : C.red, -0.5 + i * 0.2, 0.78, 0, 0.2, 0.18, 0.04);
    return { w: 0.7, d: 0.1, h: 0.9 };
  },
  bush(k, rnd) {
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, l = 0.4 + rnd() * 0.6;
      k.seg(MAT.BARK, [0.5, 0.42, 0.35], [0, 0, 0], [Math.cos(a) * l * 0.6, l, Math.sin(a) * l * 0.6], 0.015, true);
    }
    k.ball(MAT.GRASS, [0.55, 0.5, 0.35], 0, 0.15, 0, 0.6, 0.3, 0.6, 0, 0, 0, true);
    return { w: 0, d: 0, h: 0 };
  },
  grass(k, rnd) {
    for (let i = 0; i < 6; i++) {
      const x = (rnd() - 0.5) * 1.6, z = (rnd() - 0.5) * 1.6;
      for (let j = 0; j < 5; j++) {
        const a = rnd() * Math.PI * 2, l = 0.25 + rnd() * 0.3;
        k.seg(MAT.GRASS, [0.75, 0.68, 0.4], [x, 0, z], [x + Math.cos(a) * 0.15, l, z + Math.sin(a) * 0.15], 0.01, true);
      }
    }
    return { w: 0, d: 0, h: 0 };
  },
  gravestone(k, rnd) {
    k.box(MAT.CONCRETE, [0.6, 0.6, 0.62], 0, 0.45, 0, 0.5, 0.9, 0.12, rnd() * 0.15 - 0.07, 0, rnd() * 0.12 - 0.06);
    k.cyl(MAT.CONCRETE, [0.6, 0.6, 0.62], 0, 0.9, 0, 0.25, 0.12, Math.PI / 2, 0, 0);
    k.box(MAT.DIRT, [0.8, 0.8, 0.8], 0, 0.04, 0.6, 0.6, 0.08, 1.1);
    return { w: 0.25, d: 0.06, h: 0.9 };
  },
  pole(k, rnd) {
    k.cyl(MAT.WOOD, C.darkWood, 0, 3.5, 0, 0.1, 7);
    k.box(MAT.WOOD, C.darkWood, 0, 6.6, 0, 1.6, 0.1, 0.1);
    for (const x of [-0.7, 0, 0.7]) k.cyl(MAT.GLASS, [0.6, 0.65, 0.6], x, 6.7, 0, 0.04, 0.12);
    k.cyl(MAT.PAINTED_METAL, C.steel, 0.15, 5.5, 0, 0.18, 0.5);
    void rnd;
    return { w: 0.1, d: 0.1, h: 7 };
  },
  wheelchair(k) {
    for (const sx of [-0.28, 0.28]) {
      k.ring(MAT.PAINTED_METAL, C.dark, sx, 0.3, 0, 0.3, 0.02, 0, 0, Math.PI / 2);
      k.ring(MAT.PAINTED_METAL, C.steel, sx * 1.08, 0.3, 0, 0.26, 0.008, 0, 0, Math.PI / 2);
      k.ring(MAT.PAINTED_METAL, C.dark, sx * 0.9, 0.07, 0.4, 0.07, 0.02, 0, 0, Math.PI / 2);
      k.cyl(MAT.PAINTED_METAL, C.steel, sx * 0.9, 0.62, -0.18, 0.015, 0.7);
    }
    k.box(MAT.FABRIC, [0.12, 0.12, 0.14], 0, 0.5, 0.05, 0.5, 0.05, 0.42);
    k.box(MAT.FABRIC, [0.12, 0.12, 0.14], 0, 0.75, -0.18, 0.5, 0.45, 0.04, -0.1);
    return { w: 0.33, d: 0.3, h: 0.9 };
  },
  hospitalBed(k, rnd) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.cyl(MAT.PAINTED_METAL, C.steel, sx * 0.42, 0.3, sz * 0.92, 0.02, 0.6);
      k.ball(MAT.PAINTED_METAL, C.dark, sx * 0.42, 0.04, sz * 0.92, 0.07, 0.07, 0.07);
    }
    k.box(MAT.PAINTED_METAL, C.steel, 0, 0.58, 0, 0.9, 0.05, 1.9);
    k.box(MAT.FABRIC, [0.8, 0.82, 0.8], 0, 0.65, 0.05, 0.84, 0.12, 1.8);
    k.box(MAT.FABRIC, C.white, 0, 0.75, -0.75, 0.6, 0.1, 0.3);
    k.box(MAT.FABRIC, [0.6, 0.7, 0.75], 0, 0.73, 0.35, 0.86, 0.06, 1.0, rnd() * 0.05);
    for (const sz of [-0.95, 0.95]) {
      k.box(MAT.PAINTED_METAL, C.steel, 0, 0.9, sz, 0.9, 0.04, 0.04);
      k.cyl(MAT.PAINTED_METAL, C.steel, -0.42, 0.75, sz, 0.02, 0.35);
      k.cyl(MAT.PAINTED_METAL, C.steel, 0.42, 0.75, sz, 0.02, 0.35);
    }
    k.box(MAT.PAINTED_METAL, C.steel, 0.46, 0.82, 0.2, 0.02, 0.2, 0.9);
    return { w: 0.45, d: 0.95, h: 0.9 };
  },
  ivStand(k, rnd) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      k.seg(MAT.PAINTED_METAL, C.steel, [0, 0.05, 0], [Math.cos(a) * 0.25, 0.02, Math.sin(a) * 0.25], 0.012, true);
    }
    k.cyl(MAT.PAINTED_METAL, C.steel, 0, 0.95, 0, 0.012, 1.85);
    k.box(MAT.PAINTED_METAL, C.steel, 0, 1.85, 0, 0.3, 0.015, 0.015);
    k.box(MAT.GLASS, [0.75, 0.85, 0.85], 0.12, 1.68, 0, 0.1, 0.22, 0.04);
    k.seg(MAT.PAINTED_METAL, [0.8, 0.85, 0.85], [0.12, 1.56, 0], [0.2, 0.7 + rnd() * 0.3, 0.1], 0.004, true);
    return { w: 0, d: 0, h: 0 };
  },
  curtain(k, rnd) {
    k.box(MAT.PAINTED_METAL, C.steel, 0, 2.2, 0, 1.8, 0.03, 0.03);
    for (let i = 0; i < 9; i++) k.box(MAT.FABRIC, [0.62, 0.72, 0.68], -0.8 + i * 0.2, 1.3, Math.sin(i * 1.7) * 0.05, 0.22, 1.75 - rnd() * 0.1, 0.01, 0, 0.25 * Math.sin(i * 2.3), 0);
    return { w: 0, d: 0, h: 0 };
  },
  medCabinet(k, rnd) {
    k.box(MAT.PAINTED_METAL, C.white, 0, 0.9, 0, 0.8, 1.8, 0.4);
    k.box(MAT.GLASS, [0.6, 0.7, 0.75], 0, 1.3, 0.2, 0.72, 0.8, 0.01);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) if (rnd() < 0.7) k.cyl(MAT.GLASS, pick(rnd, [[0.5, 0.35, 0.2], [0.8, 0.8, 0.85], [0.3, 0.5, 0.35]]), -0.3 + i * 0.12, 1.0 + r * 0.27, 0.05, 0.035, 0.13);
    k.box(MAT.PAINTED_METAL, C.red, 0, 1.75, 0.205, 0.12, 0.04, 0.005);
    k.box(MAT.PAINTED_METAL, C.red, 0, 1.75, 0.205, 0.04, 0.12, 0.005);
    return { w: 0.4, d: 0.2, h: 1.8 };
  },
  gurney(k) {
    k.box(MAT.PAINTED_METAL, C.steel, 0, 0.8, 0, 0.6, 0.04, 1.9);
    k.box(MAT.FABRIC, [0.8, 0.82, 0.8], 0, 0.84, 0, 0.56, 0.04, 1.85);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.cyl(MAT.PAINTED_METAL, C.steel, sx * 0.25, 0.42, sz * 0.85, 0.015, 0.76);
      k.ball(MAT.PAINTED_METAL, C.dark, sx * 0.25, 0.04, sz * 0.85, 0.07, 0.07, 0.07);
    }
    return { w: 0.3, d: 0.95, h: 0.86 };
  },
  bookshelf(k, rnd) {
    k.box(MAT.WOOD, C.darkWood, 0, 1.0, -0.15, 1.0, 2.0, 0.03);
    for (const sx of [-1, 1]) k.box(MAT.WOOD, C.darkWood, sx * 0.49, 1.0, 0, 0.03, 2.0, 0.32);
    for (let i = 0; i < 5; i++) {
      const y = 0.05 + i * 0.45;
      k.box(MAT.WOOD, C.darkWood, 0, y, 0, 0.98, 0.03, 0.32);
      let x = -0.46;
      while (x < 0.42) {
        const w = 0.03 + rnd() * 0.05, h = 0.22 + rnd() * 0.15;
        if (rnd() < 0.85) k.box(MAT.FABRIC, pick(rnd, [C.red, C.blue, C.green, [0.5, 0.4, 0.25], [0.3, 0.2, 0.15], C.cream]), x + w / 2, y + h / 2 + 0.015, 0.02, w, h, 0.22, 0, 0, rnd() < 0.1 ? 0.25 : 0);
        x += w + 0.004;
      }
    }
    return { w: 0.5, d: 0.17, h: 2.0 };
  },
  poster(k, rnd) {
    const c = pick(rnd, [[0.75, 0.68, 0.5], [0.5, 0.6, 0.65], [0.7, 0.5, 0.45], [0.85, 0.85, 0.8]]);
    const y = 1.3 + rnd() * 0.4;
    k.box(MAT.PAPER, c, 0, y, -0.005, 0.5, 0.7, 0.005, 0, 0, (rnd() - 0.5) * 0.1);
    k.box(MAT.PAPER, c.map((v) => v * 0.55), 0, y + 0.18, -0.002, 0.38, 0.14, 0.003);
    for (let i = 0; i < 4; i++) k.box(MAT.PAPER, [0.25, 0.25, 0.25], 0, y - 0.05 - i * 0.07, -0.002, 0.34 - i * 0.05, 0.02, 0.003);
    return { w: 0, d: 0, h: 0 };
  },
  clock(k) {
    k.cyl(MAT.PAINTED_METAL, C.dark, 0, 2.2, -0.02, 0.17, 0.05, Math.PI / 2);
    k.cyl(MAT.PAPER, C.white, 0, 2.2, 0.006, 0.15, 0.01, Math.PI / 2);
    k.box(MAT.PAINTED_METAL, C.black, 0.03, 2.24, 0.015, 0.012, 0.1, 0.005, 0, 0, -0.6);
    k.box(MAT.PAINTED_METAL, C.black, -0.02, 2.17, 0.015, 0.01, 0.07, 0.005, 0, 0, 2.5);
    return { w: 0, d: 0, h: 0 };
  },
  exitSign(k) {
    k.box(MAT.PAINTED_METAL, C.dark, 0, 2.55, -0.03, 0.5, 0.2, 0.06);
    k.box(MAT.LAMP, [0.2, 1, 0.35], 0, 2.55, 0.001, 0.44, 0.15, 0.005);
    return { w: 0, d: 0, h: 0 };
  },
  lantern(k) {
    k.cyl(MAT.PAINTED_METAL, C.dark, 0, 0.03, 0, 0.09, 0.06);
    k.cyl(MAT.LAMP, [1, 0.7, 0.35], 0, 0.17, 0, 0.06, 0.2);
    for (let i = 0; i < 4; i++) k.box(MAT.PAINTED_METAL, C.dark, Math.cos(i * 1.57) * 0.07, 0.17, Math.sin(i * 1.57) * 0.07, 0.012, 0.22, 0.012);
    k.cone(MAT.PAINTED_METAL, C.dark, 0, 0.32, 0, 0.09, 0.08);
    k.ring(MAT.PAINTED_METAL, C.dark, 0, 0.4, 0, 0.04, 0.006, Math.PI / 2, 0, 0);
    return { w: 0, d: 0, h: 0 };
  },
  tent(k) {
    k.box(MAT.FABRIC, [0.35, 0.45, 0.3], 0, 0.75, -0.45, 2.0, 1.75, 0.03, 0.55);
    k.box(MAT.FABRIC, [0.3, 0.4, 0.27], 0, 0.75, 0.45, 2.0, 1.75, 0.03, -0.55);
    k.box(MAT.FABRIC, [0.25, 0.3, 0.22], -1.0, 0.6, 0, 0.03, 1.1, 1.4);
    k.cyl(MAT.WOOD, C.darkWood, 1.05, 0.75, 0, 0.02, 1.5);
    k.cyl(MAT.WOOD, C.darkWood, -1.05, 0.75, 0, 0.02, 1.5);
    k.seg(MAT.FABRIC, [0.6, 0.6, 0.55], [1.05, 1.45, 0], [1.6, 0, 0.3], 0.006, true);
    return { w: 1.0, d: 0.9, h: 1.5 };
  },
  log(k, rnd) {
    const len = 1.6 + rnd() * 0.6;
    k.cyl(MAT.BARK, [0.65, 0.55, 0.45], 0, 0.2, 0, 0.2, len, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) k.cyl(MAT.WOOD, [0.75, 0.6, 0.45], sx * len / 2, 0.2, 0, 0.185, 0.02, 0, 0, Math.PI / 2);
    k.seg(MAT.BARK, [0.6, 0.5, 0.4], [0.3, 0.3, 0.1], [0.5, 0.65, 0.3], 0.03, true);
    return { w: len / 2, d: 0.2, h: 0.4 };
  },
  generatorProp(k) {
    k.box(MAT.RUST_METAL, [0.5, 0.48, 0.4], 0, 0.35, 0, 1.0, 0.5, 0.6);
    k.cyl(MAT.PAINTED_METAL, [0.7, 0.55, 0.15], 0, 0.75, 0, 0.18, 0.7, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(MAT.PAINTED_METAL, C.dark, sx * 0.48, 0.25, sz * 0.28, 0.02, 0.9);
    return { w: 0.5, d: 0.3, h: 0.9 };
  },
  radioBox(k) {
    k.box(MAT.WOOD, C.darkWood, 0, 0.15, 0, 0.45, 0.3, 0.2);
    k.box(MAT.FABRIC, [0.3, 0.25, 0.2], -0.08, 0.15, 0.101, 0.22, 0.2, 0.005);
    k.cyl(MAT.PAINTED_METAL, C.dark, 0.14, 0.18, 0.105, 0.035, 0.02, Math.PI / 2);
    k.seg(MAT.PAINTED_METAL, C.steel, [0.15, 0.3, -0.05], [0.3, 0.75, -0.08], 0.005, true);
    return { w: 0, d: 0, h: 0 };
  },
  carWreck(k, rnd) {
    const col = pick(rnd, [[0.45, 0.12, 0.08], [0.18, 0.25, 0.4], [0.4, 0.4, 0.37], [0.25, 0.32, 0.22]]);
    k.box(MAT.PAINTED_METAL, col, 0, 0.62, 0, 1.75, 0.55, 4.1);
    k.box(MAT.PAINTED_METAL, col, 0, 1.08, -0.15, 1.6, 0.42, 2.0);
    k.box(MAT.GLASS, [0.12, 0.14, 0.16], 0, 1.08, 0.86, 1.5, 0.38, 0.02, -0.5);
    k.box(MAT.GLASS, [0.12, 0.14, 0.16], 0, 1.1, -1.16, 1.5, 0.36, 0.02, 0.45);
    for (const sx of [-1, 1]) {
      k.box(MAT.GLASS, [0.12, 0.14, 0.16], sx * 0.805, 1.1, -0.15, 0.01, 0.34, 1.8);
      for (const sz of [-1.3, 1.3]) {
        k.ring(MAT.PAINTED_METAL, C.black, sx * 0.82, 0.33, sz, 0.25, 0.1, 0, 0, Math.PI / 2);
        k.cyl(MAT.PAINTED_METAL, C.steel, sx * 0.83, 0.33, sz, 0.17, 0.12, 0, 0, Math.PI / 2);
      }
    }
    k.box(MAT.PAINTED_METAL, C.dark, 0, 0.45, 2.06, 1.6, 0.18, 0.05);
    for (const sx of [-0.6, 0.6]) k.box(MAT.GLASS, [0.75, 0.75, 0.6], sx, 0.68, 2.06, 0.3, 0.12, 0.02);
    for (const sx of [-0.65, 0.65]) k.box(MAT.PAINTED_METAL, [0.5, 0.05, 0.03], sx, 0.68, -2.06, 0.25, 0.1, 0.02);
    return { w: 0.88, d: 2.06, h: 1.3 };
  },
  fenceRail(k, rnd) {
    for (let i = 0; i < 9; i++) if (rnd() > 0.15) k.box(MAT.WOOD, [0.7, 0.68, 0.62], -0.9 + i * 0.22, 0.6, 0, 0.14, 1.2 - rnd() * 0.2, 0.03, 0, 0, (rnd() - 0.5) * 0.1);
    for (const y of [0.35, 1.0]) k.box(MAT.WOOD, C.darkWood, 0, y, -0.03, 2.0, 0.08, 0.03);
    return { w: 1.0, d: 0.05, h: 1.2 };
  },
  ceilingVent(k, rnd, h = 3) {
    k.box(MAT.PAINTED_METAL, [0.7, 0.7, 0.7], 0, h - 0.01, 0, 0.6, 0.02, 0.6);
    for (let i = 0; i < 6; i++) k.box(MAT.PAINTED_METAL, C.dark, -0.25 + i * 0.1, h - 0.025, 0, 0.03, 0.01, 0.5);
    void rnd;
    return { w: 0, d: 0, h: 0 };
  },
  plant(k, rnd) {
    k.cyl(MAT.PAINTED_METAL, pick(rnd, [[0.55, 0.3, 0.2], [0.85, 0.85, 0.82], C.dark]), 0, 0.2, 0, 0.18, 0.4, 0, 0, 0);
    k.cyl(MAT.DIRT, [0.6, 0.5, 0.4], 0, 0.39, 0, 0.16, 0.02);
    for (let i = 0; i < 7; i++) {
      const a = rnd() * 6.28, l = 0.3 + rnd() * 0.5;
      k.seg(MAT.GRASS, [0.55, 0.5, 0.3], [0, 0.4, 0], [Math.cos(a) * 0.3, 0.4 + l, Math.sin(a) * 0.3], 0.012, true);
      k.ball(MAT.GRASS, [0.45, 0.42, 0.25], Math.cos(a) * 0.32, 0.4 + l, Math.sin(a) * 0.32, 0.12, 0.03, 0.08, 0, a, 0.5, true);
    }
    return { w: 0.18, d: 0.18, h: 0.4 };
  },
  cardboardWall(k, rnd) {
    for (let i = 0; i < 4; i++) k.box(MAT.PAPER, C.card.map((v) => v * (0.8 + rnd() * 0.3)), -0.6 + i * 0.4 + rnd() * 0.05, 0.4 + (i % 2) * 0.02, -0.08, 0.38, 0.8, 0.02, 0.05, 0, (rnd() - 0.5) * 0.15);
    return { w: 0, d: 0, h: 0 };
  },
  foodTray(k, rnd) {
    k.box(MAT.PAINTED_METAL, C.steel, 0, 0.012, 0, 0.42, 0.02, 0.3, 0, rnd() * 3, 0);
    k.cyl(MAT.PAINTED_METAL, C.steel, 0.1, 0.04, 0, 0.06, 0.04);
    k.cyl(MAT.PAINTED_METAL, C.white, -0.12, 0.05, 0.03, 0.04, 0.08);
    return { w: 0, d: 0, h: 0 };
  },
  wallShelf(k, rnd) {
    const y = 1.5 + rnd() * 0.3;
    k.box(MAT.WOOD, C.darkWood, 0, y, -0.08, 1.0, 0.03, 0.22);
    for (const sx of [-0.4, 0.4]) k.box(MAT.PAINTED_METAL, C.dark, sx, y - 0.08, -0.15, 0.02, 0.16, 0.12);
    let x = -0.42;
    while (x < 0.4) {
      const w = 0.06 + rnd() * 0.12;
      if (rnd() < 0.7) k.cyl(MAT.GLASS, pick(rnd, [[0.4, 0.55, 0.4], [0.7, 0.55, 0.3], [0.8, 0.8, 0.82]]), x, y + 0.1, -0.08, w / 2.5, 0.18);
      x += w + 0.04;
    }
    return { w: 0, d: 0, h: 0 };
  },
  bloodlessStain(k, rnd) {
    // dark water stains / puddles
    k.ball(MAT.GLASS, [0.3, 0.28, 0.24], 0, 0.002, 0, 0.6 + rnd() * 0.8, 0.003, 0.4 + rnd() * 0.6, 0, rnd() * 3, 0, true);
    return { w: 0, d: 0, h: 0 };
  },
  cobweb(k, rnd, h = 3) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 0.5;
      k.seg(MAT.FABRIC, [0.85, 0.85, 0.85], [0, h, 0], [Math.cos(a) * 0.5, h - Math.sin(a) * 0.5, 0.0], 0.003, true);
    }
    for (let r = 1; r <= 3; r++) k.seg(MAT.FABRIC, [0.85, 0.85, 0.85], [0.15 * r, h, 0], [0, h - 0.15 * r, 0], 0.003, true);
    void rnd;
    return { w: 0, d: 0, h: 0 };
  },
};

// build a prefab into a builder at a world position/rotation; returns world AABB of its collider
export function placePrefab(builder, name, pos, yaw, rnd, opts = {}) {
  const fn = PREFABS[name];
  if (!fn) return null;
  const base = m4.create();
  m4.translate(base, base, pos[0], pos[1] || 0, pos[2]);
  m4.rotateY(base, base, yaw);
  const k = new Kit(builder, base, { sky: opts.sky ?? 0 });
  const ext = fn(k, rnd, opts.h);
  if (!ext || !ext.w) return null;
  // rotate the half extents by yaw (90° steps only matter for walls)
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const hx = ext.w * c + ext.d * s, hz = ext.w * s + ext.d * c;
  return { min: [pos[0] - hx, 0, pos[2] - hz], max: [pos[0] + hx, ext.h, pos[2] + hz] };
}
