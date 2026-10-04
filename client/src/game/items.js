// World pickups (consumables & puzzle items) and throwable physics props.
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { Prop } from '../engine/physics.js';
import { m4, mulberry32 } from '../engine/math.js';

export const PERSONAL = new Set(['medkit', 'adrenaline', 'battery']);
export const TEAM_ITEMS = new Set(['fuse', 'key', 'gas', 'keycard']);

function buildVisual(prims, kind) {
  const parts = [];
  const add = (mesh, mat, color, t, s, r = null, emissive = 0) => {
    const it = new DrawItem(mesh, mat, color);
    it.emissive = emissive;
    it.castShadow = false;
    it.radius = 0.6;
    parts.push({ item: it, t, s, r });
  };
  switch (kind) {
    case 'medkit':
      add(prims.cube, MAT.PAINTED_METAL, [0.9, 0.9, 0.88], [0, 0.1, 0], [0.36, 0.2, 0.24]);
      add(prims.cube, MAT.PAINTED_METAL, [0.8, 0.05, 0.05], [0, 0.201, 0], [0.18, 0.005, 0.05], null, 0.3);
      add(prims.cube, MAT.PAINTED_METAL, [0.8, 0.05, 0.05], [0, 0.201, 0], [0.05, 0.005, 0.15], null, 0.3);
      add(prims.cube, MAT.PAINTED_METAL, [0.2, 0.2, 0.2], [0, 0.22, 0], [0.1, 0.03, 0.03]);
      break;
    case 'adrenaline':
      add(prims.cylinder, MAT.GLASS, [0.8, 1, 0.6], [0, 0.04, 0], [0.04, 0.2, 0.04], [0, 0, Math.PI / 2], 0.6);
      add(prims.cylinder, MAT.PAINTED_METAL, [0.9, 0.85, 0.1], [0.13, 0.04, 0], [0.05, 0.06, 0.05], [0, 0, Math.PI / 2]);
      add(prims.cylinder, MAT.RUST_METAL, [0.8, 0.8, 0.8], [-0.14, 0.04, 0], [0.006, 0.1, 0.006], [0, 0, Math.PI / 2]);
      break;
    case 'battery':
      add(prims.cylinder, MAT.PAINTED_METAL, [0.08, 0.08, 0.08], [0, 0.03, 0], [0.06, 0.13, 0.06], [0, 0, Math.PI / 2]);
      add(prims.cylinder, MAT.PAINTED_METAL, [0.75, 0.45, 0.1], [0.04, 0.03, 0], [0.062, 0.05, 0.062], [0, 0, Math.PI / 2]);
      break;
    case 'fuse':
      add(prims.cylinder, MAT.GLASS, [1, 0.8, 0.5], [0, 0.04, 0], [0.07, 0.16, 0.07], [0, 0, Math.PI / 2], 1.2);
      add(prims.cylinder, MAT.RUST_METAL, [0.8, 0.75, 0.6], [0.09, 0.04, 0], [0.075, 0.04, 0.075], [0, 0, Math.PI / 2]);
      add(prims.cylinder, MAT.RUST_METAL, [0.8, 0.75, 0.6], [-0.09, 0.04, 0], [0.075, 0.04, 0.075], [0, 0, Math.PI / 2]);
      break;
    case 'key':
      add(prims.cube, MAT.PAINTED_METAL, [0.85, 0.65, 0.2], [0.05, 0.01, 0], [0.16, 0.012, 0.03], null, 0.6);
      add(prims.cylinder, MAT.PAINTED_METAL, [0.85, 0.65, 0.2], [-0.06, 0.01, 0], [0.07, 0.012, 0.07], null, 0.6);
      add(prims.cube, MAT.PAINTED_METAL, [0.85, 0.65, 0.2], [0.11, 0.01, 0.025], [0.03, 0.012, 0.03], null, 0.6);
      break;
    case 'gas':
      add(prims.cube, MAT.PAINTED_METAL, [0.65, 0.07, 0.05], [0, 0.22, 0], [0.32, 0.44, 0.16]);
      add(prims.cube, MAT.PAINTED_METAL, [0.65, 0.07, 0.05], [0.05, 0.48, 0], [0.18, 0.06, 0.05]);
      add(prims.cylinder, MAT.PAINTED_METAL, [0.2, 0.2, 0.2], [-0.12, 0.48, 0], [0.05, 0.08, 0.05], null, 0.2);
      break;
    case 'keycard':
      add(prims.cube, MAT.PAINTED_METAL, [0.15, 0.35, 0.8], [0, 0.005, 0], [0.16, 0.008, 0.1], null, 0.4);
      add(prims.cube, MAT.PAINTED_METAL, [0.95, 0.95, 0.95], [0, 0.011, 0.025], [0.14, 0.002, 0.02], null, 0.6);
      break;
    case 'bottle':
      add(prims.cylinder, MAT.GLASS, [0.3, 0.6, 0.35], [0, 0, 0], [0.12, 0.26, 0.12]);
      add(prims.cylinder, MAT.GLASS, [0.3, 0.6, 0.35], [0, 0.18, 0], [0.05, 0.1, 0.05]);
      break;
    case 'can':
      add(prims.cylinder, MAT.PAINTED_METAL, [0.7, 0.15, 0.1], [0, 0, 0], [0.13, 0.22, 0.13]);
      break;
    default:
      add(prims.cube, MAT.PAINTED_METAL, [1, 0, 1], [0, 0.1, 0], [0.2, 0.2, 0.2]);
  }
  return parts;
}

export class Items {
  constructor(game, seed) {
    this.game = game;
    this.rnd = mulberry32(seed ^ 0x51ed27);
    this.pickups = [];
    this.props = [];
    this.byId = new Map();
    this.glows = [];
  }

  populate() {
    const w = this.game.world;
    for (const pos of w.itemSpawns) {
      const r = this.rnd();
      const kind = r < 0.4 ? 'battery' : r < 0.75 ? 'medkit' : r < 0.88 ? 'adrenaline' : 'bottle';
      if (kind === 'bottle') this.addProp('bottle', [pos[0], 0.2, pos[2]]);
      else this.addPickup(kind, this.jitter(pos));
    }
    for (const pos of w.propSpawns) this.addProp(this.rnd() < 0.6 ? 'bottle' : 'can', [pos[0] + (this.rnd() - 0.5), 0.2, pos[2] + (this.rnd() - 0.5)]);
  }

  jitter(pos) {
    return [pos[0] + (this.rnd() - 0.5) * 0.8, pos[1] || 0, pos[2] + (this.rnd() - 0.5) * 0.8];
  }

  addPickup(kind, pos, opts = {}) {
    const id = 'i' + (this.pickups.length + this.props.length);
    const parts = buildVisual(this.game.prims, kind);
    const p = {
      id, kind, pos: pos.slice(), taken: false, parts, yaw: this.rnd() * 6.28,
      hiddenUntil: opts.hiddenUntil ?? null, puzzle: TEAM_ITEMS.has(kind),
    };
    // rest on furniture if spawned inside a table collider
    const hit = this.game.world.physics.raycast([pos[0], 2.2, pos[2]], [0, -1, 0], 3, (b) => b.solid && b.max[1] < 1.5);
    if (hit) p.pos[1] = 2.2 - hit.t + 0.005;
    const glow = { pos: [p.pos[0], p.pos[1] + 0.15, p.pos[2]], size: p.puzzle ? 0.35 : 0.2, color: p.puzzle ? [1, 0.75, 0.35] : [0.6, 0.9, 1], intensity: p.puzzle ? 0.35 : 0.12 };
    p.glow = glow;
    this.updatePickupTransform(p);
    this.pickups.push(p);
    this.byId.set(id, p);
    return p;
  }

  updatePickupTransform(p) {
    for (const part of p.parts) {
      const m = part.item.model;
      m4.identity(m);
      m4.translate(m, m, p.pos[0], p.pos[1], p.pos[2]);
      m4.rotateY(m, m, p.yaw);
      m4.translate(m, m, part.t[0], part.t[1], part.t[2]);
      if (part.r) {
        m4.rotateX(m, m, part.r[0]);
        m4.rotateY(m, m, part.r[1]);
        m4.rotateZ(m, m, part.r[2]);
      }
      m4.scale(m, m, part.s[0], part.s[1], part.s[2]);
      part.item.center = [p.pos[0], p.pos[1], p.pos[2]];
      part.item.sky = this.game.world.isIndoorAt(p.pos) ? 0 : 1;
    }
  }

  addProp(kind, pos) {
    const id = 'i' + (this.pickups.length + this.props.length);
    const prop = new Prop(id, pos, kind === 'can' ? 0.07 : 0.09, kind);
    prop.parts = buildVisual(this.game.prims, kind);
    prop.holder = null;
    prop.sleeping = false; // settle on spawn
    prop.impactCb = (pr, v) => this.game.onPropImpact(pr, v);
    this.props.push(prop);
    this.byId.set(id, prop);
    return prop;
  }

  isAvailable(p) {
    if (p.taken) return false;
    if (p.hiddenUntil && !this.game.isObjectiveDone(p.hiddenUntil)) return false;
    return true;
  }

  update(dt) {
    const phys = this.game.world.physics;
    for (const pr of this.props) {
      if (pr.holder) continue;
      const wasAwake = !pr.sleeping;
      // sub-step for stability
      const steps = wasAwake ? 3 : 0;
      for (let i = 0; i < steps; i++) pr.step(phys, dt / steps);
      if (wasAwake || !pr._placed) {
        pr._placed = true;
        for (const part of pr.parts) {
          const m = part.item.model;
          m4.identity(m);
          m4.translate(m, m, pr.pos[0], pr.pos[1], pr.pos[2]);
          m4.rotateY(m, m, pr.rot[1]);
          m4.rotateX(m, m, pr.rot[0]);
          m4.rotateZ(m, m, pr.rot[2]);
          m4.translate(m, m, part.t[0], part.t[1], part.t[2]);
          m4.scale(m, m, part.s[0], part.s[1], part.s[2]);
          part.item.center = pr.pos;
          part.item.sky = this.game.world.isIndoorAt(pr.pos) ? 0 : 1;
        }
      }
    }
  }

  collect(scene) {
    for (const p of this.pickups) {
      if (!this.isAvailable(p)) continue;
      for (const part of p.parts) scene.dynamic.push(part.item);
      scene.glows.push(p.glow);
    }
    for (const pr of this.props) {
      if (pr.holder) continue;
      for (const part of pr.parts) scene.dynamic.push(part.item);
    }
  }
}

export { buildVisual };
