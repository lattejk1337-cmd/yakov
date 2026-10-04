// Turns an ASCII map definition into renderable chunks, colliders, lamps, doors, anchors and a
// navigation grid.
import { MeshBuilder, FACE, cylinderBuilder, sphereBuilder } from '../engine/mesh.js';
import { MAT } from '../engine/textures.js';
import { PhysicsWorld } from '../engine/physics.js';
import { DrawItem } from '../engine/renderer.js';
import { m4, mulberry32, clamp } from '../engine/math.js';
import { CONFIG } from './config.js';

const CELL = CONFIG.CELL;
const CHUNK = 8;

const SOLID = new Set(['#', 'B', 'W', 'Y']);
// Furniture/anchor cells are undetermined and inherit indoor/outdoor from their neighbours.
const OUTDOOR_BASE = new Set([',', '_', 'L', 'T', 'C', 'f', 'g']);
const INDOOR_BASE = new Set(['.', 'l', 'v', 'w']);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Lamp {
  constructor(index, pos, color, intensity, radius, opts = {}) {
    this.index = index;
    this.pos = pos;
    this.color = color;
    this.base = intensity;
    this.intensity = intensity;
    this.radius = radius;
    this.powered = opts.powered ?? true;
    this.group = opts.group ?? null;
    this.flicker = opts.flicker ?? 0; // 0 none, 1 occasional, 2 heavy
    this.phase = Math.random() * 100;
    this.broken = !!opts.broken;
    this.disturb = 0; // monster proximity flicker
    this.state = 1;
  }
  update(dt, t) {
    let k = this.powered && !this.broken ? 1 : 0;
    if (k) {
      if (this.flicker === 1) {
        const s = Math.sin(t * 0.7 + this.phase) * Math.sin(t * 1.3 + this.phase * 2);
        if (s > 0.93) k = Math.random() < 0.5 ? 0.05 : 0.6;
      } else if (this.flicker === 2) {
        k = Math.random() < 0.12 ? Math.random() * 0.3 : 0.85 + Math.random() * 0.15;
      }
      if (this.disturb > 0) {
        if (Math.random() < this.disturb * 0.6) k *= Math.random() * 0.2;
        this.disturb = Math.max(0, this.disturb - dt * 0.8);
      }
    }
    this.state = k;
    this.intensity = this.base * k;
  }
}

export class Door {
  constructor(id, opts) {
    Object.assign(this, opts);
    this.id = id;
    this.open = 0;
    this.target = 0;
    this.items = [];
  }
}

export class World {
  constructor(gl, def, seed, prims) {
    this.gl = gl;
    this.def = def;
    this.seed = seed;
    this.prims = prims;
    this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.grid = def.grid.map((row) => row.split(''));
    this.h = this.grid.length;
    this.w = Math.max(...this.grid.map((r) => r.length));
    for (const row of this.grid) while (row.length < this.w) row.push('#');
    this.H = def.wallHeight ?? CONFIG.WALL_H;
    this.roofH = this.H + 0.35;
    this.physics = new PhysicsWorld(4);
    this.chunks = new Map();
    this.staticMeshes = [];
    this.lamps = [];
    this.lampState = new Float32Array(1024);
    this.doors = [];
    this.dynamicItems = [];
    this.anchors = {};
    this.spawns = [];
    this.monsterSpawns = [];
    this.exitCells = [];
    this.itemSpawns = [];
    this.propSpawns = [];
    this.hideSpots = [];
    this.glows = [];
    this.indoor = [];
    this.walk = [];
    this.surface = [];
    this.vents = [];
    this.decals = [];
  }

  // ------------------------------------------------------------------ helpers
  at(x, z) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return '#';
    return this.grid[z][x];
  }
  solid(x, z) {
    return SOLID.has(this.at(x, z)) || (this.def.objects?.[this.at(x, z)]?.solid ?? false);
  }
  center(x, z, y = 0) {
    return [(x + 0.5) * CELL, y, (z + 0.5) * CELL];
  }
  cellOf(pos) {
    return [Math.floor(pos[0] / CELL), Math.floor(pos[2] / CELL)];
  }
  isIndoorAt(pos) {
    const [x, z] = this.cellOf(pos);
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return false;
    return this.indoor[z][x];
  }
  zoneAt(x, z) {
    for (const zn of this.def.zones || []) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn;
    return null;
  }
  chunkBuilder(x, z) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.chunks.get(k);
    if (!b) this.chunks.set(k, (b = new MeshBuilder(4096)));
    return b;
  }
  builderAt(pos) {
    return this.chunkBuilder(Math.floor(pos[0] / CELL), Math.floor(pos[2] / CELL));
  }

  // ------------------------------------------------------------------ build
  build() {
    this.classify();
    this.buildFloorsAndCeilings();
    this.buildWalls();
    this.buildCells();
    this.buildColliders();
    if (this.def.decorate) this.def.decorate(this);
    this.buildNav();
    for (const b of this.chunks.values()) {
      const mesh = b.build(this.gl);
      if (mesh) this.staticMeshes.push({ mesh, min: mesh.min, max: mesh.max });
    }
    this.chunks.clear();
    return this;
  }

  classify() {
    const { w, h } = this;
    const type = []; // 'in' | 'out' | 'solid' | null
    for (let z = 0; z < h; z++) {
      type.push([]);
      for (let x = 0; x < w; x++) {
        const c = this.at(x, z);
        const obj = this.def.objects?.[c];
        if (this.solid(x, z)) type[z].push('solid');
        else if (obj?.outdoor === true || OUTDOOR_BASE.has(c)) type[z].push('out');
        else if (obj?.outdoor === false || INDOOR_BASE.has(c)) type[z].push('in');
        else type[z].push(null);
      }
    }
    // propagate to undetermined cells (doors, anchors, spawns...)
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
          if (type[z][x] !== null) continue;
          let hasIn = false, hasOut = false;
          for (const [dx, dz] of DIRS) {
            const t = type[z + dz]?.[x + dx];
            if (t === 'in') hasIn = true;
            if (t === 'out') hasOut = true;
          }
          if (hasIn) type[z][x] = 'in';
          else if (hasOut) type[z][x] = 'out';
          if (type[z][x] !== null) changed = true;
        }
      }
      if (!changed) break;
    }
    this.type = type;
    for (let z = 0; z < h; z++) {
      this.indoor.push([]);
      this.walk.push([]);
      this.surface.push([]);
      for (let x = 0; x < w; x++) {
        if (type[z][x] === null) type[z][x] = this.def.outdoorDefault ? 'out' : 'in';
        this.indoor[z].push(type[z][x] === 'in');
        this.walk[z].push(type[z][x] !== 'solid');
        this.surface[z].push(this.floorSurface(x, z));
      }
    }
  }

  floorMat(x, z) {
    const c = this.at(x, z);
    const zn = this.zoneAt(x, z);
    const p = this.def.palette;
    const obj = this.def.objects?.[c];
    if (obj?.floor !== undefined) return obj.floor;
    if (c === '_') return p.road ?? MAT.ASPHALT;
    if (c === 'v') return MAT.METAL_PLATE;
    if (c === 'g') return MAT.GRASS;
    if (this.type[z][x] === 'out') return zn?.outFloor ?? p.outdoor ?? MAT.DIRT;
    return zn?.floor ?? p.floor;
  }
  floorSurface(x, z) {
    if (this.type[z][x] === 'solid') return 'concrete';
    const c = this.at(x, z);
    if (c === 'w') return 'water';
    const m = this.floorMat(x, z);
    return (
      {
        [MAT.CONCRETE_FLOOR]: 'concrete', [MAT.CONCRETE]: 'concrete', [MAT.TILES]: 'tile', [MAT.CARPET]: 'carpet',
        [MAT.WOOD]: 'wood', [MAT.DIRT]: 'dirt', [MAT.GRASS]: 'grass', [MAT.ASPHALT]: 'concrete', [MAT.METAL_PLATE]: 'metal',
      }[m] || 'concrete'
    );
  }
  surfaceAt(pos) {
    const [x, z] = this.cellOf(pos);
    return this.surface[z]?.[x] ?? 'concrete';
  }

  // voxel-style ambient occlusion at a floor corner (corner between cells)
  cornerAO(cx, cz, sx, sz) {
    // sx,sz in {0,1}: which corner of cell (cx,cz)
    const ox = sx ? 1 : -1, oz = sz ? 1 : -1;
    const a = this.solid(cx + ox, cz) ? 1 : 0;
    const b = this.solid(cx, cz + oz) ? 1 : 0;
    const c = this.solid(cx + ox, cz + oz) ? 1 : 0;
    const n = a && b ? 3 : a + b + c;
    return 1 - n * 0.17;
  }

  buildFloorsAndCeilings() {
    const H = this.H;
    const hasOutdoor = this.hasOutdoorNear();
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const t = this.type[z][x];
        if (t === 'solid') continue;
        const b = this.chunkBuilder(x, z);
        const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
        const fm = this.floorMat(x, z);
        const out = t === 'out';
        const sky = out ? 1 : 0;
        const ao = [this.cornerAO(x, z, 0, 1), this.cornerAO(x, z, 1, 1), this.cornerAO(x, z, 1, 0), this.cornerAO(x, z, 0, 0)];
        b.box([x0, -0.2, z0], [x1, 0, z1], fm, {
          faces: FACE.PY,
          tile: this.def.matTile?.[fm],
          aoFn: (p) => {
            const sx = p[0] > x0 + 0.01 ? 1 : 0, sz = p[2] > z0 + 0.01 ? 1 : 0;
            return sx ? (sz ? ao[1] : ao[2]) : sz ? ao[0] : ao[3];
          },
          sky,
        });
        if (!out) {
          const c = this.at(x, z);
          const ceilY = c === 'v' ? 1.15 : H;
          const zn = this.zoneAt(x, z);
          const cm = c === 'v' ? MAT.METAL_PLATE : zn?.ceil ?? this.def.palette.ceil;
          b.box([x0, ceilY, z0], [x1, ceilY + 0.2, z1], cm, {
            faces: FACE.NY,
            aoFn: (p) => {
              const sx = p[0] > x0 + 0.01 ? 1 : 0, sz = p[2] > z0 + 0.01 ? 1 : 0;
              return (sx ? (sz ? ao[1] : ao[2]) : sz ? ao[0] : ao[3]) * 0.9 + 0.1;
            },
          });
          if (c === 'v') {
            // vent duct: walls of the duct facing neighbouring non-vent spaces
            for (const [dx, dz] of DIRS) {
              const nc = this.at(x + dx, z + dz);
              if (nc === 'v' || this.solid(x + dx, z + dz)) continue;
              const mask = dx === 1 ? FACE.PX : dx === -1 ? FACE.NX : dz === 1 ? FACE.PZ : FACE.NZ;
              b.box([x0, 1.15, z0], [x1, H, z1], MAT.METAL_PLATE, { faces: mask });
            }
            this.vents.push([x, z]);
          }
          if (hasOutdoor && this.def.roofs !== false) {
            b.box([x0, this.roofH - 0.2, z0], [x1, this.roofH, z1], this.def.palette.roof ?? MAT.ROOF, { faces: FACE.PY, sky: 1 });
          }
        }
      }
    }
  }

  wallMatFor(c, x, z, nx, nz) {
    const p = this.def.palette;
    if (c === 'B') return MAT.BRICK;
    if (c === 'W') return MAT.SIDING;
    if (c === 'Y') return MAT.WALLPAPER;
    const zn = this.zoneAt(nx, nz);
    if (zn?.wall !== undefined) return zn.wall;
    if (this.type[nz]?.[nx] === 'out') return p.exterior ?? p.wall;
    return p.wall;
  }

  buildWalls() {
    const H = this.H;
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (this.type[z][x] !== 'solid') continue;
        const c = this.at(x, z);
        const b = this.chunkBuilder(x, z);
        const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
        let topH = 0;
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = DIRS[d];
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
          const nt = this.type[nz][nx];
          if (nt === 'solid') continue;
          const out = nt === 'out';
          const wallTop = out ? this.def.exteriorHeight ?? this.roofH + 0.7 : H;
          topH = Math.max(topH, out ? wallTop : this.def.outdoorDefault || this.hasOutdoorNear(x, z) ? this.roofH : H);
          const mask = [FACE.PX, FACE.NX, FACE.PZ, FACE.NZ][d];
          const mat = this.wallMatFor(c, x, z, nx, nz);
          // corner AO: darken vertical edges forming concave corners
          const edgeA = this.solid(nx + (dz !== 0 ? -1 : 0), nz + (dx !== 0 ? -1 : 0));
          const edgeB = this.solid(nx + (dz !== 0 ? 1 : 0), nz + (dx !== 0 ? 1 : 0));
          b.box([x0, 0, z0], [x1, wallTop, z1], mat, {
            faces: mask,
            sky: out ? 1 : 0,
            aoFn: (p) => {
              let ao = p[1] < 0.01 ? 0.72 : p[1] > wallTop - 0.01 && !out ? 0.82 : 1;
              const along = dz !== 0 ? p[0] : p[2];
              const lo = dz !== 0 ? x0 : z0;
              const atA = Math.abs(along - lo) < 0.01;
              if ((atA && edgeA) || (!atA && edgeB)) ao *= 0.65;
              return ao;
            },
          });
          // baseboard / trims indoors
          if (!out && this.def.baseboard) {
            const bm = this.def.baseboard;
            const inset = 0.04;
            const bx0 = dx === 1 ? x1 : dx === -1 ? x0 - inset : x0;
            const bx1 = dx === 1 ? x1 + inset : dx === -1 ? x0 : x1;
            const bz0 = dz === 1 ? z1 : dz === -1 ? z0 - inset : z0;
            const bz1 = dz === 1 ? z1 + inset : dz === -1 ? z0 : z1;
            b.box([bx0, 0, bz0], [bx1, 0.14, bz1], bm, { faces: FACE.ALL & ~FACE.NY, ao: 0.8 });
          }
        }
        if (topH > 0 && (this.def.outdoorDefault || this.hasOutdoorNear(x, z))) {
          b.box([x0, 0, z0], [x1, topH, z1], this.def.palette.wallTop ?? MAT.CONCRETE, { faces: FACE.PY, sky: 1 });
        }
      }
    }
  }

  hasOutdoorNear() {
    if (this._anyOutdoor === undefined) this._anyOutdoor = !!this.def.outdoorDefault || this.type.some((r) => r.includes('out'));
    return this._anyOutdoor;
  }

  // orientation of a cell sitting in a wall line: 'x' if neighbours along x are blocking
  lineAxis(x, z, blockers) {
    const bx = blockers(x - 1, z) || blockers(x + 1, z);
    const bz = blockers(x, z - 1) || blockers(x, z + 1);
    if (bx && !bz) return 'x';
    if (bz && !bx) return 'z';
    return bx ? 'x' : 'z';
  }

  wallSide(x, z) {
    // returns first direction that has a solid neighbour (for wall-mounted objects)
    const order = this.rnd() < 0.5 ? [0, 1, 2, 3] : [2, 3, 0, 1];
    for (const d of order) {
      const [dx, dz] = DIRS[d];
      if (this.solid(x + dx, z + dz)) return [dx, dz];
    }
    return null;
  }

  buildCells() {
    const p = this.def.palette;
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.at(x, z);
        const obj = this.def.objects?.[c];
        const cpos = this.center(x, z);
        if (c === 'X' && obj) this.exitCells.push([x, z]);
        if (obj) {
          const anchor = { x, z, pos: cpos, wall: this.wallSide(x, z), obj };
          (this.anchors[c] ||= []).push(anchor);
          if (obj.door) anchor.door = this.addDoor(x, z, obj.door, { locked: obj.lockedBy ?? null });
          if (obj.build) obj.build(this, x, z);
          continue;
        }
        switch (c) {
          case 'P': this.spawns.push(cpos); break;
          case 'M': this.monsterSpawns.push(cpos); break;
          case 'X': this.exitCells.push([x, z]); break;
          case 'i': this.itemSpawns.push(cpos); break;
          case 'p': this.propSpawns.push(cpos); break;
          case 'l': this.addCeilingLamp(x, z); break;
          case 'L': this.addStreetLamp(x, z); break;
          case 'D': this.addDoor(x, z, p.door ?? 'wood'); break;
          case '|': this.addBars(x, z); break;
          case 'b': this.addDoor(x, z, 'bars'); break;
          case 'f': this.addFence(x, z); break;
          case 't': this.addTable(x, z); break;
          case 'k': this.addBed(x, z); break;
          case 's': this.addShelf(x, z); break;
          case 'H': this.addLocker(x, z); break;
          case 'c': this.addCrates(x, z); break;
          case 'o': this.addPillar(x, z); break;
          case 'C': this.addCar(x, z); break;
          case 'T': this.addTree(x, z); break;
          case 'h': this.addDesk(x, z); break;
          case 'r': this.addRubble(x, z); break;
          default: break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ props
  addCeilingLamp(x, z, opts = {}) {
    const b = this.chunkBuilder(x, z);
    const [cx, , cz] = this.center(x, z);
    const H = this.H;
    const style = this.def.lampStyle ?? 'cage';
    const idx = this.lamps.length;
    const lampVerts = (min, max) => {
      const start = b.vc;
      b.box(min, max, MAT.LAMP, { uv: 'local' });
      for (let i = start; i < b.vc; i++) b.v[i * 14 + 13] = idx; // lamp index in sky channel
    };
    if (style === 'panel') {
      // office fluorescent panel
      b.box([cx - 0.62, H - 0.03, cz - 0.32], [cx + 0.62, H, cz + 0.32], MAT.PAINTED_METAL, { uv: 'local', faces: FACE.SIDES });
      lampVerts([cx - 0.58, H - 0.035, cz - 0.28], [cx + 0.58, H - 0.02, cz + 0.28]);
    } else if (style === 'cage') {
      b.box([cx - 0.08, H - 0.12, cz - 0.08], [cx + 0.08, H, cz + 0.08], MAT.RUST_METAL, { uv: 'local' });
      lampVerts([cx - 0.11, H - 0.32, cz - 0.11], [cx + 0.11, H - 0.12, cz + 0.11]);
      // wire cage
      for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        b.box([cx + ox * 0.14 - 0.01, H - 0.36, cz + oz * 0.14 - 0.01], [cx + ox * 0.14 + 0.01, H - 0.1, cz + oz * 0.14 + 0.01], MAT.RUST_METAL, { uv: 'local' });
      }
    } else {
      // hanging bulb
      b.box([cx - 0.01, H - 0.6, cz - 0.01], [cx + 0.01, H, cz + 0.01], MAT.RUST_METAL, { uv: 'local' });
      const s = sphereBuilder(MAT.LAMP, 8, 6);
      const m = m4.create();
      m4.translate(m, m, cx, H - 0.68, cz);
      m4.scale(m, m, 0.16, 0.2, 0.16);
      const start = b.vc;
      b.append(s, m);
      for (let i = start; i < b.vc; i++) b.v[i * 14 + 13] = idx;
    }
    const L = this.def.lamp ?? {};
    const r = this.rnd();
    const lamp = new Lamp(idx, [cx, H - (style === 'bulb' ? 0.75 : 0.4), cz], L.color ?? [1, 0.85, 0.6], (L.intensity ?? 7) * (0.85 + this.rnd() * 0.3), L.radius ?? 8, {
      flicker: opts.flicker ?? (r < (L.flickerChance ?? 0.25) ? (r < 0.06 ? 2 : 1) : 0),
      broken: opts.broken ?? this.rnd() < (L.brokenChance ?? 0.1),
      group: opts.group ?? this.zoneAt(x, z)?.powerGroup ?? null,
    });
    if (lamp.group && this.def.unpoweredGroups?.includes(lamp.group)) lamp.powered = false;
    this.lamps.push(lamp);
    this.glows.push({ pos: lamp.pos, size: L.glow ?? 0.9, color: lamp.color, intensity: 0, lamp });
    return lamp;
  }

  addStreetLamp(x, z) {
    const b = this.chunkBuilder(x, z);
    const [cx, , cz] = this.center(x, z);
    const pole = cylinderBuilder(MAT.PAINTED_METAL, 8, true, 0.06, 0.09);
    const m = m4.create();
    m4.translate(m, m, cx, 2.5, cz);
    m4.scale(m, m, 1, 5, 1);
    b.append(pole, m);
    b.box([cx - 0.04, 4.9, cz - 0.04], [cx + 0.7, 4.98, cz + 0.04], MAT.PAINTED_METAL, { uv: 'local' });
    const idx = this.lamps.length;
    const start = b.vc;
    b.box([cx + 0.45, 4.78, cz - 0.15], [cx + 0.85, 4.9, cz + 0.15], MAT.LAMP, { uv: 'local' });
    for (let i = start; i < b.vc; i++) b.v[i * 14 + 13] = idx;
    this.physics.add({ min: [cx - 0.1, 0, cz - 0.1], max: [cx + 0.1, 5, cz + 0.1], blocksSight: false });
    const L = this.def.streetLamp ?? {};
    const lamp = new Lamp(idx, [cx + 0.65, 4.6, cz], L.color ?? [1, 0.7, 0.4], L.intensity ?? 16, L.radius ?? 12, {
      flicker: this.rnd() < 0.3 ? 1 : 0,
      broken: this.rnd() < (L.brokenChance ?? 0.25),
      group: L.group ?? null,
    });
    if (lamp.group && this.def.unpoweredGroups?.includes(lamp.group)) lamp.powered = false;
    this.lamps.push(lamp);
    this.glows.push({ pos: [cx + 0.65, 4.75, cz], size: 1.6, color: lamp.color, intensity: 0, lamp });
  }

  addDoor(x, z, kind, opts = {}) {
    const axis = this.lineAxis(x, z, (a, b) => this.solid(a, b) || this.at(a, b) === '|');
    const [cx, , cz] = this.center(x, z);
    const H = this.H;
    const b = this.chunkBuilder(x, z);
    const wallMat = this.def.palette.wall;
    const open = kind === 'gate' ? 1.8 : 1.4;
    const half = open / 2;
    const doorH = kind === 'gate' ? Math.min(H, 2.8) : 2.25;
    const out = this.type[z][x] === 'out';
    const sky = out ? 1 : 0;
    if (kind !== 'bars' && kind !== 'gate') {
      // jambs and lintel through the 2m-thick wall cell
      if (axis === 'x') {
        b.box([x * CELL, 0, z * CELL], [cx - half, H, (z + 1) * CELL], wallMat, { faces: FACE.PX | FACE.PZ | FACE.NZ, sky });
        b.box([cx + half, 0, z * CELL], [(x + 1) * CELL, H, (z + 1) * CELL], wallMat, { faces: FACE.NX | FACE.PZ | FACE.NZ, sky });
        b.box([cx - half, doorH, z * CELL], [cx + half, H, (z + 1) * CELL], wallMat, { faces: FACE.NY | FACE.PZ | FACE.NZ, sky });
        this.physics.add({ min: [x * CELL, -1, z * CELL], max: [cx - half, H + 2, (z + 1) * CELL] });
        this.physics.add({ min: [cx + half, -1, z * CELL], max: [(x + 1) * CELL, H + 2, (z + 1) * CELL] });
        this.physics.add({ min: [cx - half, doorH, z * CELL], max: [cx + half, H + 2, (z + 1) * CELL] });
      } else {
        b.box([x * CELL, 0, z * CELL], [(x + 1) * CELL, H, cz - half], wallMat, { faces: FACE.PZ | FACE.PX | FACE.NX, sky });
        b.box([x * CELL, 0, cz + half], [(x + 1) * CELL, H, (z + 1) * CELL], wallMat, { faces: FACE.NZ | FACE.PX | FACE.NX, sky });
        b.box([x * CELL, doorH, cz - half], [(x + 1) * CELL, H, cz + half], wallMat, { faces: FACE.NY | FACE.PX | FACE.NX, sky });
        this.physics.add({ min: [x * CELL, -1, z * CELL], max: [(x + 1) * CELL, H + 2, cz - half] });
        this.physics.add({ min: [x * CELL, -1, cz + half], max: [(x + 1) * CELL, H + 2, (z + 1) * CELL] });
        this.physics.add({ min: [x * CELL, doorH, cz - half], max: [(x + 1) * CELL, H + 2, cz + half] });
      }
    }
    const thick = kind === 'bars' || kind === 'gate' ? 0.08 : 0.07;
    const panelW = kind === 'bars' || kind === 'gate' ? CELL : open - 0.04;
    const collider = this.physics.add(
      axis === 'x'
        ? { min: [cx - panelW / 2, 0, cz - 0.1], max: [cx + panelW / 2, doorH, cz + 0.1], blocksSight: kind !== 'bars' && kind !== 'gate', tag: 'door' }
        : { min: [cx - 0.1, 0, cz - panelW / 2], max: [cx + 0.1, doorH, cz + panelW / 2], blocksSight: kind !== 'bars' && kind !== 'gate', tag: 'door' }
    );
    const door = new Door(this.doors.length, {
      x, z, axis, kind, pos: [cx, 0, cz], collider, panelW, doorH, thick,
      locked: opts.locked ?? null,
      lockedText: opts.lockedText ?? null,
      sky,
      monsterCanOpen: opts.monsterCanOpen ?? (kind === 'wood' || kind === 'metal'),
    });
    collider.door = door;
    if (kind === 'bars' || kind === 'gate') {
      const mesh = this.barsMesh(panelW, doorH, kind === 'gate');
      const item = new DrawItem(mesh, -1);
      item.sky = sky;
      item.radius = 2.2;
      door.items.push(item);
    } else {
      const item = new DrawItem(this.prims.cube, kind === 'metal' ? MAT.PAINTED_METAL : MAT.WOOD);
      if (kind === 'metal') item.setColor(this.def.palette.doorColor ?? [0.35, 0.38, 0.36]);
      else item.setColor([0.85, 0.8, 0.75]);
      item.sky = sky;
      item.uvScale = [1, 1];
      item.radius = 1.6;
      door.items.push(item);
      // handle
      const h = new DrawItem(this.prims.cube, MAT.PAINTED_METAL);
      h.setColor([0.6, 0.55, 0.4]);
      h.sky = sky;
      h.radius = 1.6;
      h.castShadow = false;
      door.items.push(h);
    }
    this.doors.push(door);
    this.updateDoorTransform(door);
    return door;
  }

  barsMesh(width, height, heavy) {
    const b = new MeshBuilder(1024);
    const n = Math.round(width / 0.16);
    const cyl = cylinderBuilder(MAT.RUST_METAL, 6, false);
    const m = m4.create();
    for (let i = 0; i <= n; i++) {
      const x = -width / 2 + (i / n) * width;
      m4.identity(m);
      m4.translate(m, m, x, height / 2, 0);
      m4.scale(m, m, heavy ? 0.05 : 0.035, height, heavy ? 0.05 : 0.035);
      b.append(cyl, m);
    }
    for (const y of heavy ? [0.1, height * 0.5, height - 0.08] : [0.12, 1.1, height - 0.08]) {
      b.box([-width / 2, y - 0.04, -0.03], [width / 2, y + 0.04, 0.03], MAT.RUST_METAL, { uv: 'local', uvScale: [4, 0.3] });
    }
    return b.build(this.gl);
  }

  updateDoorTransform(door) {
    const [cx, , cz] = door.pos;
    const o = door.open;
    if (door.kind === 'bars' || door.kind === 'gate') {
      // slide sideways into the wall
      const item = door.items[0];
      const m = item.model;
      m4.identity(m);
      const slide = o * door.panelW * 0.95;
      if (door.axis === 'x') m4.translate(m, m, cx + slide, 0, cz);
      else {
        m4.translate(m, m, cx, 0, cz + slide);
        m4.rotateY(m, m, Math.PI / 2);
      }
      item.center = [cx, 1.2, cz];
      return;
    }
    const w = door.panelW;
    const sign = door.swing ?? 1;
    const ang = -o * 1.75 * sign;
    const [panel, handle] = door.items;
    const m = panel.model;
    m4.identity(m);
    if (door.axis === 'x') {
      m4.translate(m, m, cx - w / 2, 0, cz);
      m4.rotateY(m, m, ang);
      m4.translate(m, m, w / 2, door.doorH / 2, 0);
    } else {
      m4.translate(m, m, cx, 0, cz - w / 2);
      m4.rotateY(m, m, ang - Math.PI / 2);
      m4.translate(m, m, w / 2, door.doorH / 2, 0);
    }
    m4.copy(handle.model, m);
    m4.translate(handle.model, handle.model, w * 0.38, 0, 0);
    m4.scale(handle.model, handle.model, 0.12, 0.04, door.thick + 0.08);
    m4.scale(m, m, w, door.doorH, door.thick);
    panel.uvScale = [1, 1];
    panel.center = [cx, 1.1, cz];
    handle.center = panel.center;
  }

  addBars(x, z) {
    const axis = this.lineAxis(x, z, (a, b) => this.solid(a, b) || '|b'.includes(this.at(a, b)));
    const [cx, , cz] = this.center(x, z);
    const H = this.H;
    const b = this.chunkBuilder(x, z);
    const bars = cylinderBuilder(MAT.RUST_METAL, 6, false);
    const m = m4.create();
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = -CELL / 2 + (i / n) * CELL;
      m4.identity(m);
      if (axis === 'x') m4.translate(m, m, cx + t, H / 2, cz);
      else m4.translate(m, m, cx, H / 2, cz + t);
      m4.scale(m, m, 0.035, H, 0.035);
      b.append(bars, m);
    }
    for (const y of [0.15, 1.1, H - 0.1]) {
      if (axis === 'x') b.box([cx - CELL / 2, y - 0.04, cz - 0.03], [cx + CELL / 2, y + 0.04, cz + 0.03], MAT.RUST_METAL, { uv: 'local' });
      else b.box([cx - 0.03, y - 0.04, cz - CELL / 2], [cx + 0.03, y + 0.04, cz + CELL / 2], MAT.RUST_METAL, { uv: 'local' });
    }
    this.physics.add(
      axis === 'x'
        ? { min: [cx - CELL / 2, -1, cz - 0.08], max: [cx + CELL / 2, H + 1, cz + 0.08], blocksSight: false }
        : { min: [cx - 0.08, -1, cz - CELL / 2], max: [cx + 0.08, H + 1, cz + CELL / 2], blocksSight: false }
    );
    this.walk[z][x] = false;
  }

  addFence(x, z) {
    const axis = this.lineAxis(x, z, (a, b) => this.solid(a, b) || 'fD'.includes(this.at(a, b)));
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const h = 1.45;
    const along = (a0, a1, y0, y1, th) =>
      axis === 'x' ? b.box([cx + a0, y0, cz - th], [cx + a1, y1, cz + th], MAT.WOOD, { sky: 1 }) : b.box([cx - th, y0, cz + a0], [cx + th, y1, cz + a1], MAT.WOOD, { sky: 1 });
    // posts
    along(-1.0, -0.9, 0, h + 0.1, 0.06);
    // rails
    along(-1, 1, 0.35, 0.45, 0.03);
    along(-1, 1, 1.05, 1.15, 0.03);
    // pickets with random missing ones
    for (let i = 0; i < 9; i++) {
      if (this.rnd() < 0.12) continue;
      const a = -0.95 + i * 0.22;
      const tilt = this.rnd() * 0.15;
      along(a, a + 0.14, 0.05, h - tilt, 0.045);
    }
    this.physics.add(
      axis === 'x'
        ? { min: [cx - 1, 0, cz - 0.1], max: [cx + 1, h, cz + 0.1], blocksSight: false }
        : { min: [cx - 0.1, 0, cz - 1], max: [cx + 0.1, h, cz + 1], blocksSight: false }
    );
    this.walk[z][x] = false;
  }

  addTable(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const ox = (this.rnd() - 0.5) * 0.4, oz = (this.rnd() - 0.5) * 0.4;
    const w = 0.7, d = 0.5;
    const tx = cx + ox, tz = cz + oz;
    const mat = this.def.palette.furniture ?? MAT.WOOD;
    b.box([tx - w, 0.72, tz - d], [tx + w, 0.78, tz + d], mat, { uv: 'local', ao: 1 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.box([tx + sx * (w - 0.08) - 0.04, 0, tz + sz * (d - 0.08) - 0.04], [tx + sx * (w - 0.08) + 0.04, 0.72, tz + sz * (d - 0.08) + 0.04], mat, { uv: 'local' });
    }
    this.physics.add({ min: [tx - w, 0, tz - d], max: [tx + w, 0.78, tz + d], blocksSight: false, blocksMonster: true });
    // chair
    if (this.rnd() < 0.7) {
      const s = this.rnd() < 0.5 ? -1 : 1;
      const chx = tx + (this.rnd() - 0.5) * 0.6, chz = tz + s * (d + 0.35);
      b.box([chx - 0.22, 0.42, chz - 0.22], [chx + 0.22, 0.46, chz + 0.22], mat, { uv: 'local' });
      b.box([chx - 0.22, 0.46, chz + s * 0.18], [chx + 0.22, 0.95, chz + s * 0.22], mat, { uv: 'local' });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box([chx + sx * 0.18 - 0.02, 0, chz + sz * 0.18 - 0.02], [chx + sx * 0.18 + 0.02, 0.42, chz + sz * 0.18 + 0.02], mat, { uv: 'local' });
    }
    this.maybeClutterOn([tx, 0.78, tz], w, d);
  }

  maybeClutterOn(top, w, d) {
    const b = this.builderAt(top);
    const n = Math.floor(this.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const px = top[0] + (this.rnd() - 0.5) * w * 1.6, pz = top[2] + (this.rnd() - 0.5) * d * 1.6;
      if (this.rnd() < 0.5) {
        // papers
        b.box([px - 0.15, top[1], pz - 0.11], [px + 0.15, top[1] + 0.005, pz + 0.11], MAT.PAPER, { uv: 'local' });
      } else {
        const h = 0.08 + this.rnd() * 0.15;
        b.box([px - 0.06, top[1], pz - 0.06], [px + 0.06, top[1] + h, pz + 0.06], this.rnd() < 0.5 ? MAT.RUST_METAL : MAT.PAINTED_METAL, { uv: 'local' });
      }
    }
  }

  addBed(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    // bunk bed aligned to the nearest wall
    const ws = this.wallSide(x, z) || [1, 0];
    const alongX = ws[1] !== 0;
    const L = 0.95, W = 0.45;
    const ox = alongX ? cx : cx + ws[0] * 0.45, oz = alongX ? cz + ws[1] * 0.45 : cz;
    const box = (x0, y0, z0, x1, y1, z1, m) => (alongX ? b.box([ox + x0, y0, oz + z0], [ox + x1, y1, oz + z1], m, { uv: 'local' }) : b.box([ox + z0, y0, oz + x0], [ox + z1, y1, oz + x1], m, { uv: 'local' }));
    for (const y of [0.4, 1.4]) {
      box(-L, y, -W, L, y + 0.06, W, MAT.RUST_METAL);
      box(-L + 0.05, y + 0.06, -W + 0.05, L - 0.05, y + 0.18, W - 0.05, MAT.FABRIC);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(sx * L - 0.03, 0, sz * W - 0.03, sx * L + 0.03, 1.9, sz * W + 0.03, MAT.RUST_METAL);
    const min = alongX ? [ox - L, 0, oz - W] : [ox - W, 0, oz - L];
    const max = alongX ? [ox + L, 1.9, oz + W] : [ox + W, 1.9, oz + L];
    this.physics.add({ min, max, blocksSight: false });
  }

  addShelf(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const ws = this.wallSide(x, z) || [1, 0];
    const alongX = ws[1] !== 0;
    const L = 0.85, D = 0.25, Hh = 2.0;
    const ox = alongX ? cx : cx + ws[0] * 0.7, oz = alongX ? cz + ws[1] * 0.7 : cz;
    const mat = this.def.palette.shelf ?? MAT.RUST_METAL;
    const box = (x0, y0, z0, x1, y1, z1, m) => (alongX ? b.box([ox + x0, y0, oz + z0], [ox + x1, y1, oz + z1], m, { uv: 'local' }) : b.box([ox + z0, y0, oz + x0], [ox + z1, y1, oz + x1], m, { uv: 'local' }));
    for (const s of [-1, 1]) box(s * L - 0.03, 0, -D, s * L + 0.03, Hh, D, mat);
    for (let i = 0; i < 4; i++) {
      const y = 0.1 + i * 0.6;
      box(-L, y, -D, L, y + 0.04, D, mat);
      // boxes and jars on shelves
      let px = -L + 0.1;
      while (px < L - 0.2) {
        const w = 0.12 + this.rnd() * 0.25;
        if (this.rnd() < 0.7) {
          const h = 0.1 + this.rnd() * 0.35;
          box(px, y + 0.04, -D + 0.04, px + w, y + 0.04 + h, D - 0.04, this.rnd() < 0.6 ? MAT.PAPER : MAT.WOOD);
        }
        px += w + 0.05;
      }
    }
    const min = alongX ? [ox - L, 0, oz - D] : [ox - D, 0, oz - L];
    const max = alongX ? [ox + L, Hh, oz + D] : [ox + D, Hh, oz + L];
    this.physics.add({ min, max });
  }

  addLocker(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const ws = this.wallSide(x, z) || [1, 0];
    const alongX = ws[1] !== 0;
    const W = 0.4, D = 0.32, Hh = 2.05;
    const ox = alongX ? cx : cx + ws[0] * 0.62, oz = alongX ? cz + ws[1] * 0.62 : cz;
    const min = alongX ? [ox - W, 0, oz - D] : [ox - D, 0, oz - W];
    const max = alongX ? [ox + W, Hh, oz + D] : [ox + D, Hh, oz + W];
    b.box(min, max, MAT.PAINTED_METAL, { uv: 'local' });
    // vent slits on the front
    const fx = -ws[0], fz = -ws[1];
    for (let i = 0; i < 4; i++) {
      const y = 1.55 + i * 0.07;
      if (alongX) b.box([ox - 0.2, y, oz + fz * (D + 0.005) - 0.005], [ox + 0.2, y + 0.025, oz + fz * (D + 0.005) + 0.005], MAT.RUST_METAL, { uv: 'local' });
      else b.box([ox + fx * (D + 0.005) - 0.005, y, oz - 0.2], [ox + fx * (D + 0.005) + 0.005, y + 0.025, oz + 0.2], MAT.RUST_METAL, { uv: 'local' });
    }
    this.physics.add({ min, max });
    const front = [ox + fx * (D + 0.55), 0, oz + fz * (D + 0.55)];
    this.hideSpots.push({ id: this.hideSpots.length, pos: [ox, 0, oz], front, facing: Math.atan2(-fx, -fz), occupant: null });
  }

  addCrates(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    let y = 0;
    const n = 1 + Math.floor(this.rnd() * 3);
    let maxS = 0;
    for (let i = 0; i < n; i++) {
      const s = 0.35 + this.rnd() * 0.25;
      const ox = (this.rnd() - 0.5) * 0.3, oz = (this.rnd() - 0.5) * 0.3;
      b.box([cx + ox - s, y, cz + oz - s], [cx + ox + s, y + s * 2, cz + oz + s], MAT.WOOD, { uv: 'local', aoFn: (p) => (p[1] < 0.01 ? 0.6 : 1) });
      maxS = Math.max(maxS, s + 0.15);
      y += s * 2;
    }
    this.physics.add({ min: [cx - maxS, 0, cz - maxS], max: [cx + maxS, y, cz + maxS], blocksSight: y > 1.4 });
    if (y > 1.4) this.walk[z][x] = false;
  }

  addPillar(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const s = 0.3;
    b.box([cx - s, 0, cz - s], [cx + s, this.H, cz + s], this.def.palette.pillar ?? MAT.CONCRETE, { faces: FACE.SIDES, aoFn: (p) => (p[1] < 0.01 ? 0.7 : 1) });
    this.physics.add({ min: [cx - s, 0, cz - s], max: [cx + s, this.H, cz + s] });
  }

  addRubble(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    for (let i = 0; i < 6; i++) {
      const s = 0.08 + this.rnd() * 0.2;
      const px = cx + (this.rnd() - 0.5) * 1.6, pz = cz + (this.rnd() - 0.5) * 1.6;
      b.box([px - s, 0, pz - s * 0.8], [px + s, s * 1.2, pz + s * 0.8], MAT.CONCRETE, { uv: 'local' });
    }
  }

  addDesk(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const ws = this.wallSide(x, z);
    const alongX = ws ? ws[1] !== 0 : this.rnd() < 0.5;
    const ox = cx + (ws && !alongX ? ws[0] * 0.4 : 0), oz = cz + (ws && alongX ? ws[1] * 0.4 : 0);
    const L = 0.75, D = 0.38;
    const box = (x0, y0, z0, x1, y1, z1, m, opts = { uv: 'local' }) => (alongX ? b.box([ox + x0, y0, oz + z0], [ox + x1, y1, oz + z1], m, opts) : b.box([ox + z0, y0, oz + x0], [ox + z1, y1, oz + x1], m, opts));
    box(-L, 0.72, -D, L, 0.76, D, MAT.WOOD);
    box(-L, 0, -D, -L + 0.04, 0.72, D, MAT.WOOD);
    box(L - 0.4, 0, -D, L, 0.72, D, MAT.WOOD);
    // monitor
    const s = ws ? (alongX ? ws[1] : ws[0]) : 1;
    box(-0.25, 0.76, s * 0.1 - 0.12, 0.25, 1.12, s * 0.1 + 0.12, MAT.PAINTED_METAL);
    box(-0.05, 0.76, -0.05, 0.05, 0.8, 0.05, MAT.PAINTED_METAL);
    // chair
    const cs = -s;
    box(-0.25, 0.45, cs * 0.6 - 0.25, 0.25, 0.5, cs * 0.6 + 0.25, MAT.FABRIC);
    box(-0.25, 0.5, cs * 0.85 - 0.03, 0.25, 1.0, cs * 0.85 + 0.03, MAT.FABRIC);
    box(-0.03, 0, cs * 0.6 - 0.03, 0.03, 0.45, cs * 0.6 + 0.03, MAT.PAINTED_METAL);
    const min = alongX ? [ox - L, 0, oz - D] : [ox - D, 0, oz - L];
    const max = alongX ? [ox + L, 0.76, oz + D] : [ox + D, 0.76, oz + L];
    this.physics.add({ min, max, blocksSight: false });
    this.maybeClutterOn([ox, 0.76, oz], alongX ? L * 0.6 : D, alongX ? D : L * 0.6);
  }

  addCar(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const alongX = this.rnd() < 0.5;
    const L = 2.0, W = 0.85;
    const colors = [[0.5, 0.1, 0.08], [0.15, 0.2, 0.35], [0.4, 0.4, 0.38], [0.2, 0.3, 0.2], [0.55, 0.5, 0.4]];
    const col = colors[Math.floor(this.rnd() * colors.length)];
    const sub = new MeshBuilder(256);
    sub.box([-L, 0.3, -W], [L, 0.95, W], MAT.PAINTED_METAL, { uv: 'local' });
    sub.box([-L * 0.45, 0.95, -W * 0.92], [L * 0.45, 1.45, W * 0.92], MAT.GLASS, { uv: 'local' });
    sub.box([-L * 0.42, 1.45, -W * 0.9], [L * 0.42, 1.5, W * 0.9], MAT.PAINTED_METAL, { uv: 'local' });
    const wheel = cylinderBuilder(MAT.RUST_METAL, 10, true);
    const m = m4.create();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      m4.identity(m);
      m4.translate(m, m, sx * L * 0.65, 0.32, sz * W);
      m4.rotateX(m, m, Math.PI / 2);
      m4.scale(m, m, 0.64, 0.25, 0.64);
      sub.append(wheel, m);
    }
    // tint painted metal by baking: we can't tint static geometry per object, so use a material variant
    m4.identity(m);
    m4.translate(m, m, cx, 0, cz);
    if (!alongX) m4.rotateY(m, m, Math.PI / 2);
    m4.rotateY(m, m, (this.rnd() - 0.5) * 0.3);
    // dynamic item for colour
    const item = new DrawItem(sub.build(this.gl), -1);
    item.setColor(col);
    item.sky = 1;
    m4.copy(item.model, m);
    item.center = [cx, 0.8, cz];
    item.radius = 2.5;
    this.dynamicItems.push(item);
    const min = alongX ? [cx - L, 0, cz - W] : [cx - W, 0, cz - L];
    const max = alongX ? [cx + L, 1.5, cz + W] : [cx + W, 1.5, cz + L];
    this.physics.add({ min, max, blocksSight: false });
    void b;
  }

  addTree(x, z) {
    const [cx, , cz] = this.center(x, z);
    const b = this.chunkBuilder(x, z);
    const ox = cx + (this.rnd() - 0.5) * 0.8, oz = cz + (this.rnd() - 0.5) * 0.8;
    const h = 5 + this.rnd() * 3;
    const trunk = cylinderBuilder(MAT.BARK, 8, false, 0.12, 0.25);
    const m = m4.create();
    m4.translate(m, m, ox, h / 2, oz);
    m4.scale(m, m, 1, h, 1);
    b.append(trunk.setAttr(null, 1), m);
    // bare branches
    const branch = cylinderBuilder(MAT.BARK, 6, false, 0.02, 0.06).setAttr(null, 1);
    const nb = 5 + Math.floor(this.rnd() * 4);
    for (let i = 0; i < nb; i++) {
      const y = h * (0.45 + this.rnd() * 0.5);
      const ang = this.rnd() * Math.PI * 2;
      const tilt = 0.5 + this.rnd() * 0.7;
      const len = 1 + this.rnd() * 1.8;
      m4.identity(m);
      m4.translate(m, m, ox, y, oz);
      m4.rotateY(m, m, ang);
      m4.rotateZ(m, m, tilt);
      m4.translate(m, m, 0, len / 2, 0);
      m4.scale(m, m, 1, len, 1);
      b.append(branch, m);
    }
    this.physics.add({ min: [ox - 0.25, 0, oz - 0.25], max: [ox + 0.25, h, oz + 0.25], blocksSight: false });
  }

  // wall-mounted placement helper for puzzle objects: returns {pos, normal, yaw}
  wallMount(anchor, height = 1.3, inset = 0.02) {
    const [cx, , cz] = anchor.pos;
    const w = anchor.wall || [0, 1];
    const pos = [cx + w[0] * (CELL / 2 - inset), height, cz + w[1] * (CELL / 2 - inset)];
    const normal = [-w[0], 0, -w[1]];
    const yaw = Math.atan2(normal[0], normal[2]);
    return { pos, normal, yaw };
  }

  // ------------------------------------------------------------------ colliders & nav
  buildColliders() {
    // merge solid cells row by row into boxes
    for (let z = 0; z < this.h; z++) {
      let x = 0;
      while (x < this.w) {
        if (this.type[z][x] !== 'solid') {
          x++;
          continue;
        }
        const x0 = x;
        while (x < this.w && this.type[z][x] === 'solid') x++;
        this.physics.add({ min: [x0 * CELL, -1, z * CELL], max: [x * CELL, 30, (z + 1) * CELL] });
      }
    }
    // vent ceilings
    for (const [x, z] of this.vents) {
      this.physics.add({ min: [x * CELL, 1.15, z * CELL], max: [(x + 1) * CELL, 30, (z + 1) * CELL], vent: true });
    }
    // map border
    const W = this.w * CELL, Hh = this.h * CELL;
    this.physics.add({ min: [-5, -1, -5], max: [0, 30, Hh + 5] });
    this.physics.add({ min: [W, -1, -5], max: [W + 5, 30, Hh + 5] });
    this.physics.add({ min: [-5, -1, -5], max: [W + 5, 30, 0] });
    this.physics.add({ min: [-5, -1, Hh], max: [W + 5, 30, Hh + 5] });
  }

  buildNav() {
    // monster walkability: not solid, not vent, not bars/fence/blocked furniture
    this.navWalk = [];
    for (let z = 0; z < this.h; z++) {
      this.navWalk.push([]);
      for (let x = 0; x < this.w; x++) {
        const c = this.at(x, z);
        this.navWalk[z].push(this.walk[z][x] && c !== 'v' && !(this.def.objects?.[c]?.blockNav));
      }
    }
  }

  canMonsterWalk(x, z) {
    if (!this.navWalk[z]?.[x]) return false;
    for (const d of this.doors) if (d.x === x && d.z === z) return d.open > 0.5 || (!d.locked && d.monsterCanOpen);
    return true;
  }

  // ------------------------------------------------------------------ runtime
  update(dt, t) {
    for (const l of this.lamps) {
      l.update(dt, t);
      this.lampState[l.index] = l.state;
    }
    for (const g of this.glows) g.intensity = g.lamp ? g.lamp.state * 0.6 : g.intensity;
    for (const d of this.doors) {
      if (Math.abs(d.open - d.target) > 0.001) {
        const speed = d.kind === 'gate' ? 0.4 : d.kind === 'bars' ? 0.9 : 2.2;
        d.open += clamp(d.target - d.open, -speed * dt, speed * dt);
        this.updateDoorTransform(d);
      }
      d.collider.enabled = d.open < 0.6;
    }
  }

  setPowerGroup(group, on) {
    for (const l of this.lamps) if (l.group === group) l.powered = on;
  }

  // Collects draw items for the frame
  collect(scene) {
    for (const s of this.staticMeshes) scene.static.push(s);
    for (const it of this.dynamicItems) scene.dynamic.push(it);
    for (const d of this.doors) for (const it of d.items) scene.dynamic.push(it);
    for (const l of this.lamps) scene.pointLights.push(l);
    for (const g of this.glows) scene.glows.push(g);
  }

  randomFloorPoint(rnd, indoorOnly = false) {
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rnd() * this.w), z = Math.floor(rnd() * this.h);
      if (!this.navWalk[z][x]) continue;
      if (indoorOnly && !this.indoor[z][x]) continue;
      return this.center(x, z);
    }
    return this.spawns[0] || this.center(1, 1);
  }
}
