// Three unique antagonists with host-authoritative AI:
//  - Warden (prison): blind, hunts by sound.
//  - Scarecrow (town): moves only when nobody is looking at it.
//  - Moth (yellow rooms): drawn to lit flashlights and lamps.
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { m4, v3, clamp, lerp, dampAngle, angleDiff } from '../engine/math.js';
import { NavGrid } from './nav.js';

const DEFS = {
  warden: { name: 'mon_warden', radius: 0.45, height: 2.5, walk: 1.7, investigate: 3.2, chase: 4.7, attackRange: 1.5, cooldown: 2.6 },
  scarecrow: { name: 'mon_scarecrow', radius: 0.4, height: 2.3, walk: 2.0, investigate: 4.5, chase: 6.8, attackRange: 1.35, cooldown: 3.0 },
  moth: { name: 'mon_moth', radius: 0.5, height: 2.3, walk: 2.3, investigate: 3.6, chase: 5.0, attackRange: 1.6, cooldown: 2.4 },
};

class MPart {
  constructor(bone, mesh, mat, color, t, s, r = null, opts = {}) {
    this.bone = bone;
    this.item = new DrawItem(mesh, mat, color);
    this.item.radius = 2;
    this.item.emissive = opts.emissive ?? 0;
    this.item.castShadow = opts.shadow ?? true;
    this.t = t;
    this.s = s;
    this.r = r;
  }
}

export class Monster {
  constructor(type, game) {
    this.type = type;
    this.def = DEFS[type];
    this.game = game;
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.state = 'wander';
    this.stateT = 0;
    this.target = null;
    this.path = null;
    this.pathT = 0;
    this.goal = null;
    this.cooldown = 0;
    this.stun = 0;
    this.frozen = false;
    this.speed = 0;
    this.phase = 0;
    this.anim = 0;
    this.body = { pos: this.pos, radius: this.def.radius, height: this.def.height, stepHeight: 0.4, onGround: true, vel: [0, 0, 0] };
    this.nav = new NavGrid(game.world, (x, z) => game.world.canMonsterWalk(x, z));
    this.bones = {};
    for (const b of ['root', 'body', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'wingL', 'wingR']) this.bones[b] = m4.create();
    this.parts = [];
    this.light = { pos: [0, 0, 0], color: [1, 0.3, 0.1], intensity: 0, radius: 3 };
    this.buildModel();
    this.netPos = [0, 0, 0];
    this.netYaw = 0;
    this.soundT = 2 + Math.random() * 4;
    this.stepAcc = 0;
    this.awareness = 0; // 0..1 shown via music intensity
    this.doorWait = 0;
  }

  // ------------------------------------------------------------------ model
  buildModel() {
    const P = this.game.prims;
    const add = (bone, mesh, mat, color, t, s, r, opts) => {
      const p = new MPart(bone, mesh, mat, color, t, s, r, opts);
      this.parts.push(p);
      return p;
    };
    if (this.type === 'warden') {
      const uni = [0.1, 0.12, 0.17];
      add('body', P.cube, MAT.FABRIC, uni, [0, 0.45, 0], [0.62, 0.95, 0.38]);
      add('body', P.cube, MAT.FABRIC, [0.08, 0.06, 0.05], [0, -0.05, 0], [0.64, 0.1, 0.4]);
      add('body', P.cylinder, MAT.RUST_METAL, [0.6, 0.5, 0.3], [0.25, -0.15, -0.1], [0.08, 0.1, 0.08], null, { emissive: 0 });
      this.lantern = add('body', P.sphere, MAT.LAMP, [1, 0.6, 0.25], [-0.3, -0.12, -0.14], [0.12, 0.16, 0.12], null, { emissive: 2.5, shadow: false });
      add('head', P.sphere, MAT.MONSTER, [0.75, 0.7, 0.62], [0, 0.18, -0.05], [0.34, 0.42, 0.36]);
      for (let i = 0; i < 4; i++) add('head', P.cylinder, MAT.FABRIC, [0.62, 0.58, 0.5], [0, 0.08 + i * 0.07, -0.05], [0.37, 0.05, 0.39], [0.15 * (i % 2 ? 1 : -1), 0, 0]);
      add('head', P.cylinder, MAT.FABRIC, uni, [0, 0.42, -0.02], [0.4, 0.1, 0.42]);
      add('head', P.cube, MAT.FABRIC, [0.05, 0.05, 0.05], [0, 0.39, -0.22], [0.3, 0.03, 0.18]);
      add('head', P.cube, MAT.SKIN, [0.15, 0.02, 0.02], [0, 0.0, -0.21], [0.16, 0.03, 0.02], null, { shadow: false });
      for (const side of ['L', 'R']) {
        add('arm' + side, P.cube, MAT.FABRIC, uni, [0, -0.35, 0], [0.18, 0.75, 0.18]);
        add('fore' + side, P.cube, MAT.MONSTER, [0.7, 0.66, 0.6], [0, -0.38, 0], [0.12, 0.8, 0.12]);
        add('fore' + side, P.cube, MAT.MONSTER, [0.6, 0.55, 0.5], [0, -0.85, -0.03], [0.16, 0.22, 0.08]);
        add('leg' + side, P.cube, MAT.FABRIC, uni, [0, -0.5, 0], [0.24, 1.0, 0.26]);
        add('leg' + side, P.cube, MAT.PAINTED_METAL, [0.05, 0.04, 0.04], [0, -1.02, -0.07], [0.26, 0.14, 0.4]);
      }
      this.light.color = [1, 0.55, 0.2];
      this.light.radius = 4;
      this.dims = { hip: 1.35, shoulder: 0.95, armW: 0.42, legW: 0.17, neck: 1.0 };
    } else if (this.type === 'scarecrow') {
      const coat = [0.22, 0.18, 0.12], sack = [0.62, 0.52, 0.34];
      add('body', P.cube, MAT.FABRIC, coat, [0, 0.4, 0], [0.5, 0.85, 0.28]);
      add('body', P.cube, MAT.FABRIC, coat, [0, -0.15, 0], [0.56, 0.35, 0.3]);
      for (let i = 0; i < 6; i++) add('body', P.cylinder, MAT.GRASS, [0.75, 0.62, 0.3], [-0.2 + i * 0.08, -0.38, 0], [0.03, 0.25, 0.03], [0.2 * Math.sin(i * 3), 0, 0.3 * Math.cos(i * 2)]);
      add('head', P.sphere, MAT.FABRIC, sack, [0, 0.2, 0], [0.36, 0.42, 0.36]);
      add('head', P.cylinder, MAT.FABRIC, [0.4, 0.3, 0.2], [0, -0.02, 0], [0.18, 0.08, 0.18]);
      // stitched smile + eye holes
      for (let i = 0; i < 7; i++) add('head', P.cube, MAT.SKIN, [0.03, 0.02, 0.02], [-0.12 + i * 0.04, 0.1 + Math.abs(i - 3) * 0.015, -0.175], [0.03, 0.012, 0.01], null, { shadow: false });
      this.eyeL = add('head', P.sphere, MAT.LAMP, [1, 0.45, 0.1], [-0.08, 0.24, -0.16], [0.05, 0.04, 0.02], null, { emissive: 1.5, shadow: false });
      this.eyeR = add('head', P.sphere, MAT.LAMP, [1, 0.45, 0.1], [0.08, 0.24, -0.16], [0.05, 0.04, 0.02], null, { emissive: 1.5, shadow: false });
      add('head', P.cone, MAT.GRASS, [0.55, 0.45, 0.25], [0, 0.55, 0], [0.42, 0.3, 0.42]);
      add('head', P.cylinder, MAT.GRASS, [0.55, 0.45, 0.25], [0, 0.4, 0], [0.8, 0.02, 0.8]);
      for (const side of ['L', 'R']) {
        add('arm' + side, P.cylinder, MAT.BARK, [0.5, 0.4, 0.3], [0, -0.35, 0], [0.06, 0.75, 0.06]);
        add('arm' + side, P.cube, MAT.FABRIC, coat, [0, -0.25, 0], [0.16, 0.55, 0.16]);
        add('fore' + side, P.cylinder, MAT.BARK, [0.5, 0.4, 0.3], [0, -0.35, 0], [0.05, 0.7, 0.05]);
        add('fore' + side, P.cylinder, MAT.GRASS, [0.7, 0.6, 0.3], [0, -0.72, 0], [0.12, 0.12, 0.12]);
        add('leg' + side, P.cylinder, MAT.BARK, [0.45, 0.35, 0.25], [0, -0.55, 0], [0.07, 1.1, 0.07]);
        add('leg' + side, P.cube, MAT.FABRIC, [0.2, 0.2, 0.25], [0, -0.3, 0], [0.18, 0.5, 0.18]);
      }
      this.light.color = [1, 0.45, 0.1];
      this.light.radius = 2.5;
      this.dims = { hip: 1.25, shoulder: 0.85, armW: 0.34, legW: 0.15, neck: 0.85 };
    } else {
      const body = [0.55, 0.52, 0.48];
      add('body', P.cube, MAT.MONSTER, body, [0, 0.35, 0], [0.32, 0.9, 0.26]);
      add('body', P.sphere, MAT.HAIR, [0.75, 0.72, 0.6], [0, 0.75, -0.02], [0.5, 0.35, 0.4]);
      add('body', P.cube, MAT.MONSTER, body.map((c) => c * 0.8), [0, -0.25, 0.05], [0.24, 0.5, 0.22], [0.3, 0, 0]);
      add('head', P.sphere, MAT.MONSTER, [0.5, 0.48, 0.45], [0, 0.15, -0.05], [0.3, 0.32, 0.32]);
      this.eyeL = add('head', P.sphere, MAT.LAMP, [1, 0.75, 0.25], [-0.1, 0.18, -0.15], [0.14, 0.16, 0.1], null, { emissive: 3, shadow: false });
      this.eyeR = add('head', P.sphere, MAT.LAMP, [1, 0.75, 0.25], [0.1, 0.18, -0.15], [0.14, 0.16, 0.1], null, { emissive: 3, shadow: false });
      add('head', P.cylinder, MAT.HAIR, [0.3, 0.27, 0.22], [-0.08, 0.45, -0.1], [0.02, 0.45, 0.02], [-0.5, 0, -0.4]);
      add('head', P.cylinder, MAT.HAIR, [0.3, 0.27, 0.22], [0.08, 0.45, -0.1], [0.02, 0.45, 0.02], [-0.5, 0, 0.4]);
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? -1 : 1;
        add('wing' + side, P.cube, MAT.MONSTER, [0.32, 0.29, 0.25], [sx * 0.75, 0.15, 0], [1.4, 1.1, 0.02]);
        add('wing' + side, P.cube, MAT.MONSTER, [0.42, 0.36, 0.3], [sx * 0.65, -0.55, 0.01], [1.0, 0.6, 0.02]);
        add('wing' + side, P.sphere, MAT.LAMP, [0.9, 0.5, 0.2], [sx * 0.85, 0.25, -0.02], [0.28, 0.28, 0.01], null, { emissive: 0.5, shadow: false });
        add('arm' + side, P.cylinder, MAT.MONSTER, body, [0, -0.4, 0], [0.05, 0.8, 0.05]);
        add('fore' + side, P.cylinder, MAT.MONSTER, body, [0, -0.45, 0], [0.04, 0.9, 0.04]);
        add('leg' + side, P.cylinder, MAT.MONSTER, body, [0, -0.45, 0], [0.05, 0.9, 0.05]);
      }
      this.light.color = [1, 0.7, 0.3];
      this.light.radius = 4;
      this.dims = { hip: 1.25, shoulder: 0.8, armW: 0.2, legW: 0.1, neck: 0.85 };
    }
  }

  // ------------------------------------------------------------------ AI (host)
  setState(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
      this.path = null;
    }
  }

  survivors() {
    return this.game.survivors.filter((s) => s.active && !s.downed && !s.hidden);
  }

  hostUpdate(dt) {
    const g = this.game;
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.stun > 0) {
      this.stun -= dt;
      this.speed = 0;
      return;
    }
    if (this.type === 'warden') this.thinkWarden(dt);
    else if (this.type === 'scarecrow') this.thinkScarecrow(dt);
    else this.thinkMoth(dt);

    // attack
    if (this.cooldown <= 0 && !this.frozen) {
      for (const s of g.survivors) {
        if (!s.active || s.downed || s.hidden) continue;
        const d = v3.distXZ(s.pos, this.pos);
        if (d < this.def.attackRange && Math.abs(s.pos[1] - this.pos[1]) < 1.6 && g.world.physics.lineOfSight([this.pos[0], 1.2, this.pos[2]], [s.pos[0], 1.2, s.pos[2]])) {
          this.cooldown = this.def.cooldown;
          g.hitSurvivor(s, this);
          this.stun = 1.6; // wipe the weapon, gives a window to flee
          this.attackAnim = 1;
          this.setState('wander');
          break;
        }
      }
      // hidden players: if the monster saw them enter a locker it pulls them out
      for (const s of g.survivors) {
        if (!s.hidden || !s.active || s.downed) continue;
        if (this.target === s.id && v3.distXZ(s.pos, this.pos) < 1.8 && s.hiddenSeen) {
          this.cooldown = this.def.cooldown;
          g.hitSurvivor(s, this, true);
          this.stun = 1.6;
          this.attackAnim = 1;
        }
      }
    }
    this.move(dt);
  }

  nearestNoise(maxAge = 1.5) {
    let best = null, bestScore = 0;
    for (const n of this.game.noises) {
      if (this.game.time - n.t > maxAge) continue;
      const d = v3.distXZ(n.pos, this.pos);
      if (d > n.radius) continue;
      const score = n.radius - d;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  thinkWarden(dt) {
    const g = this.game;
    const noise = this.nearestNoise(0.8);
    // touch/proximity sense
    let touch = null;
    for (const s of this.survivors()) if (v3.distXZ(s.pos, this.pos) < 2.2) touch = s;
    if (touch) {
      this.target = touch.id;
      this.goal = touch.pos.slice();
      this.setStateKeep('chase');
    } else if (noise) {
      this.goal = noise.pos.slice();
      this.target = noise.source ?? null;
      const d = v3.distXZ(noise.pos, this.pos);
      this.setStateKeep(d < 12 && noise.source ? 'chase' : 'investigate');
      this.alertT = 6;
    }
    this.alertT = Math.max(0, (this.alertT || 0) - dt);
    if (this.state === 'chase' || this.state === 'investigate') {
      if (this.goal && v3.distXZ(this.goal, this.pos) < 1.0) {
        // reached: listen around
        this.setState('listen');
      }
    }
    if (this.state === 'listen') {
      this.speed = 0;
      if (this.stateT > 2.5) this.setState('wander');
    }
    if (this.state === 'wander') this.wander(dt);
    this.awareness = this.state === 'chase' ? 1 : this.state === 'investigate' ? 0.5 : 0.15;
    void g;
  }

  thinkScarecrow(dt) {
    const g = this.game;
    // frozen if any survivor sees it
    this.frozen = g.survivors.some((s) => s.active && !s.downed && s.seesMonster);
    let best = null, bd = 1e9;
    for (const s of this.survivors()) {
      const d = v3.distXZ(s.pos, this.pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (this.retreatT > 0) {
      this.retreatT -= dt;
      this.setStateKeep('wander');
    } else if (best && bd < 40) {
      this.target = best.id;
      this.goal = best.pos.slice();
      this.setStateKeep(bd < 14 ? 'chase' : 'investigate');
    } else this.setStateKeep('wander');
    if (this.state === 'wander') this.wander(dt);
    this.awareness = this.frozen ? 0.5 : this.state === 'chase' ? 1 : 0.3;
    void dt;
  }

  thinkMoth(dt) {
    const g = this.game;
    let best = null, bestScore = 0;
    for (const s of this.survivors()) {
      const d = v3.dist(s.pos, this.pos);
      let score = 0;
      if (s.flashOn) {
        if (d < 34 && (d < 12 || g.world.physics.lineOfSight([this.pos[0], 1.5, this.pos[2]], [s.pos[0], 1.4, s.pos[2]]))) score = 40 - d;
      } else if (d < 3.5 || (s.sprinting && d < 7)) score = 10 - d;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    const noise = this.nearestNoise(1.0);
    if (best) {
      this.target = best.id;
      this.goal = best.pos.slice();
      this.lastSeen = best.pos.slice();
      this.setStateKeep('chase');
    } else if (noise && noise.lure) {
      this.goal = noise.pos.slice();
      this.target = null;
      this.setStateKeep('investigate');
    } else if (this.state === 'chase') {
      // lost the light: search the last known position
      this.goal = this.lastSeen || this.goal;
      this.target = null;
      this.setState('investigate');
    }
    if (this.state === 'investigate' && this.goal && v3.distXZ(this.goal, this.pos) < 1.2) this.setState('listen');
    if (this.state === 'listen') {
      this.speed = 0;
      if (this.stateT > 2) this.setState('wander');
    }
    if (this.state === 'wander') {
      // drift between lit lamps
      if (!this.goal || this.stateT > 12 || v3.distXZ(this.goal, this.pos) < 1.5) {
        const lit = g.world.lamps.filter((l) => l.state > 0.5 && v3.distXZ(l.pos, this.pos) < 30);
        const l = lit.length ? lit[Math.floor(g.rnd() * lit.length)] : null;
        this.goal = l ? [l.pos[0], 0, l.pos[2]] : g.world.randomFloorPoint(g.rnd, true);
        this.path = null;
        this.stateT = 0;
      }
    }
    // disturb nearby lamps
    for (const l of g.world.lamps) if (v3.distXZ(l.pos, this.pos) < 5) l.disturb = Math.min(1, l.disturb + dt * 2);
    this.awareness = this.state === 'chase' ? 1 : this.state === 'investigate' ? 0.55 : 0.2;
    void dt;
  }

  setStateKeep(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
    }
  }

  wander() {
    const g = this.game;
    if (!this.goal || this.stateT > 15 || v3.distXZ(this.goal, this.pos) < 1.5) {
      // bias towards survivors so the game stays tense
      const alive = this.survivors();
      if (alive.length && g.rnd() < 0.45) {
        const s = alive[Math.floor(g.rnd() * alive.length)];
        this.goal = [s.pos[0] + (g.rnd() - 0.5) * 16, 0, s.pos[2] + (g.rnd() - 0.5) * 16];
      } else this.goal = g.world.randomFloorPoint(g.rnd);
      this.path = null;
      this.stateT = 0;
    }
  }

  move(dt) {
    const g = this.game;
    if (this.frozen) {
      this.speed = 0;
      return;
    }
    const sp = this.state === 'chase' ? this.def.chase : this.state === 'investigate' ? this.def.investigate : this.state === 'listen' ? 0 : this.def.walk;
    if (!this.goal || sp <= 0) {
      this.speed = lerp(this.speed, 0, 1 - Math.exp(-6 * dt));
      return;
    }
    this.pathT -= dt;
    if (!this.path || this.pathT <= 0) {
      this.path = this.nav.find(this.pos, this.goal);
      this.pathT = this.state === 'chase' ? 0.35 : 1.5;
      if (!this.path) {
        this.goal = null;
        return;
      }
    }
    if (this.doorWait > 0) {
      this.doorWait -= dt;
      this.speed = 0;
      return;
    }
    while (this.path.length && v3.distXZ(this.path[0], this.pos) < 0.5) this.path.shift();
    if (!this.path.length) {
      this.speed = 0;
      return;
    }
    const wp = this.path[0];
    const dx = wp[0] - this.pos[0], dz = wp[2] - this.pos[2];
    const d = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    this.yaw = dampAngle(this.yaw, wantYaw, 8, dt);
    // slow down on sharp turns
    const turn = Math.abs(angleDiff(this.yaw, wantYaw));
    this.speed = lerp(this.speed, sp * clamp(1.2 - turn, 0.3, 1), 1 - Math.exp(-5 * dt));
    const step = Math.min(d, this.speed * dt);
    // doors on the way
    const ahead = [this.pos[0] + (dx / d) * 1.2, 0, this.pos[2] + (dz / d) * 1.2];
    const [cx, cz] = g.world.cellOf(ahead);
    for (const door of g.world.doors) {
      if (door.x === cx && door.z === cz && door.open < 0.5 && door.target < 0.5 && !door.locked && door.monsterCanOpen) {
        g.hostSetDoor(door, 1, true);
        this.doorWait = 0.7;
      }
    }
    const before = [this.pos[0], this.pos[2]];
    g.world.physics.moveCharacter(this.body, (dx / d) * step, -0.1, (dz / d) * step, { monster: true });
    const moved = Math.hypot(this.pos[0] - before[0], this.pos[2] - before[1]);
    if (step > 0.01 && moved < step * 0.2) {
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT > 1) {
        this.path = null;
        this.stuckT = 0;
        if (this.state === 'wander') this.goal = null;
      }
    } else this.stuckT = 0;
  }

  snapshot() {
    return {
      p: [+this.pos[0].toFixed(2), +this.pos[1].toFixed(2), +this.pos[2].toFixed(2)],
      y: +this.yaw.toFixed(2),
      s: this.state,
      v: +this.speed.toFixed(2),
      f: this.frozen ? 1 : 0,
      a: this.attackAnim > 0.5 ? 1 : 0,
      w: +this.awareness.toFixed(2),
    };
  }
  applySnapshot(s) {
    this.netPos = s.p;
    this.netYaw = s.y;
    this.state = s.s;
    this.speed = s.v;
    this.frozen = !!s.f;
    if (s.a) this.attackAnim = 1;
    this.awareness = s.w;
    if (!this.hasNet) {
      v3.copy(this.pos, s.p);
      this.yaw = s.y;
      this.hasNet = true;
    }
  }
  clientUpdate(dt) {
    // interpolate towards authoritative state
    const k = 1 - Math.exp(-10 * dt);
    for (let i = 0; i < 3; i++) this.pos[i] += (this.netPos[i] - this.pos[i]) * k;
    this.yaw = dampAngle(this.yaw, this.netYaw, 10, dt);
  }

  // ------------------------------------------------------------------ visuals & sound
  update(dt, cam) {
    const g = this.game;
    const B = this.bones;
    const spd = this.frozen ? 0 : this.speed;
    this.phase += spd * dt * (this.type === 'warden' ? 2.0 : 2.6);
    this.anim += dt;
    this.attackAnim = Math.max(0, (this.attackAnim || 0) - dt * 1.5);
    const sw = Math.sin(this.phase);
    const amp = clamp(spd / 3, 0, 1);
    const D = this.dims;
    m4.identity(B.root);
    let hover = 0;
    if (this.type === 'moth') hover = 0.5 + Math.sin(this.anim * 2.2) * 0.15;
    m4.translate(B.root, B.root, this.pos[0], this.pos[1] + hover, this.pos[2]);
    m4.rotateY(B.root, B.root, this.yaw);
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * amp;
    m4.translate(B.body, B.root, 0, D.hip + bob, 0);
    let lean = 0.25 + amp * 0.25;
    if (this.type === 'scarecrow') lean = this.frozen ? 0.05 : 0.15 + Math.sin(this.anim * 13) * 0.05 * amp;
    if (this.type === 'moth') lean = 0.15 + amp * 0.35;
    if (this.state === 'listen') lean = 0.1;
    m4.rotateX(B.body, B.body, -lean - this.attackAnim * 0.4);
    m4.translate(B.head, B.body, 0, D.neck, 0);
    let tilt = 0;
    if (this.type === 'warden' && this.state === 'listen') tilt = Math.sin(this.anim * 1.5) * 0.4;
    if (this.type === 'scarecrow') tilt = this.frozen ? 0.3 : Math.sin(this.anim * 9) * 0.25;
    m4.rotateZ(B.head, B.head, tilt);
    m4.rotateX(B.head, B.head, lean * 0.8);
    const attack = this.attackAnim;
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const arm = B['arm' + side], fore = B['fore' + side], leg = B['leg' + side];
      m4.translate(arm, B.body, sx * D.armW, D.shoulder, 0);
      const swing = sx * sw * 0.5 * amp + (this.type === 'warden' ? 0.25 : 0) + attack * 2.2;
      m4.rotateX(arm, arm, swing + (this.type === 'moth' ? 0.9 : 0));
      m4.rotateZ(arm, arm, sx * (this.type === 'scarecrow' ? 1.4 : 0.12));
      m4.translate(fore, arm, 0, this.type === 'warden' ? -0.7 : -0.75, 0);
      m4.rotateX(fore, fore, 0.3 + attack * 0.5 + (this.type === 'moth' ? 0.8 : 0));
      m4.translate(leg, B.body, sx * D.legW, -0.12, 0);
      m4.rotateX(leg, leg, -sx * sw * 0.55 * amp);
      if (this.type === 'moth') {
        const wing = B['wing' + side];
        const flap = Math.sin(this.anim * (this.state === 'chase' ? 14 : 7)) * 0.6;
        m4.translate(wing, B.body, sx * 0.12, 0.65, 0.12);
        m4.rotateY(wing, wing, sx * (0.5 + flap));
      }
    }
    for (const p of this.parts) {
      const m = p.item.model;
      m4.translate(m, B[p.bone], p.t[0], p.t[1], p.t[2]);
      if (p.r) {
        m4.rotateX(m, m, p.r[0]);
        m4.rotateY(m, m, p.r[1]);
        m4.rotateZ(m, m, p.r[2]);
      }
      m4.scale(m, m, p.s[0], p.s[1], p.s[2]);
      p.item.center[0] = this.pos[0];
      p.item.center[1] = this.pos[1] + 1.2;
      p.item.center[2] = this.pos[2];
      p.item.sky = g.world.isIndoorAt(this.pos) ? 0 : 1;
    }
    // eye/lantern light
    const src = this.lantern || this.eyeL;
    if (src) {
      const m = src.item.model;
      this.light.pos[0] = m[12];
      this.light.pos[1] = m[13];
      this.light.pos[2] = m[14] ;
      const base = this.type === 'warden' ? 1.6 : this.type === 'moth' ? 1.2 : 0.6;
      this.light.intensity = base * (0.85 + Math.sin(this.anim * 7) * 0.1);
    }
    // sounds
    const a = g.audio;
    if (a && cam) {
      if (!this.frozen && spd > 0.3) {
        this.stepAcc += spd * dt;
        const stride = this.type === 'moth' ? 2.5 : 1.4;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          if (this.type === 'warden') a.play('step_heavy', { pos: this.pos, volume: 1.0, refDistance: 3, maxDistance: 40, pitchVar: 0.15 });
          else if (this.type === 'scarecrow') a.play('wood_creak', { pos: this.pos, volume: 0.6, refDistance: 2, maxDistance: 25, pitchVar: 0.3 });
        }
      }
      if (this.type === 'moth') {
        if (!this.flutter) this.flutter = a.play('flutter', { pos: this.pos, loop: true, volume: 0.7, refDistance: 2.5, maxDistance: 30 });
        if (this.flutter) {
          this.flutter.setPos(this.pos);
          this.flutter.setRate(this.state === 'chase' ? 1.4 : 1);
        }
      }
      this.soundT -= dt;
      if (this.soundT <= 0) {
        this.soundT = this.state === 'chase' ? 2.5 + Math.random() * 2 : 5 + Math.random() * 7;
        const occluded = !g.world.physics.lineOfSight(cam.pos, [this.pos[0], 1.6, this.pos[2]]);
        if (this.type === 'warden') a.play('growl', { pos: [this.pos[0], 2, this.pos[2]], volume: 1, refDistance: 4, maxDistance: 50, occluded, pitchVar: 0.1 });
        else if (this.type === 'scarecrow') a.play(this.frozen ? 'wood_creak' : 'whisper', { pos: [this.pos[0], 1.8, this.pos[2]], volume: 0.9, refDistance: 3, maxDistance: 30, occluded });
        else a.play('whisper', { pos: [this.pos[0], 1.8, this.pos[2]], volume: 0.7, refDistance: 3, maxDistance: 30, occluded, rate: 0.7 });
      }
    }
  }

  collect(scene) {
    for (const p of this.parts) scene.dynamic.push(p.item);
    if (this.light.intensity > 0) scene.pointLights.push(this.light);
  }

  dispose() {
    if (this.flutter) this.flutter.stop(0.2);
  }
}

export const MONSTER_DEFS = DEFS;
