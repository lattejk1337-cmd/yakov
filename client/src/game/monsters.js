// Four unique antagonists with host-authoritative AI:
//  - Warden (prison): blind, hunts by sound.
//  - Scarecrow (town): moves only when nobody is looking at it.
//  - Moth (yellow rooms): drawn to lit flashlights and lamps.
//  - Nurse (hospital): senses racing heartbeats (fear, injuries, sprinting) through walls.
import { v3, clamp, lerp, dampAngle, angleDiff } from '../engine/math.js';
import { NavGrid } from './nav.js';
import { MonsterModel } from './monstermodels.js';

const DEFS = {
  warden: { name: 'mon_warden', radius: 0.42, walk: 1.6, investigate: 3.2, chase: 4.8, attackRange: 1.6, cooldown: 2.6, scream: 'growl' },
  scarecrow: { name: 'mon_scarecrow', radius: 0.38, walk: 2.0, investigate: 4.6, chase: 6.8, attackRange: 1.4, cooldown: 3.0, scream: 'scream' },
  moth: { name: 'mon_moth', radius: 0.42, walk: 2.3, investigate: 3.8, chase: 5.1, attackRange: 1.7, cooldown: 2.4, scream: 'scream' },
  nurse: { name: 'mon_nurse', radius: 0.36, walk: 1.5, investigate: 3.4, chase: 5.0, attackRange: 1.5, cooldown: 2.6, scream: 'scream' },
};
// collision height stays below the 2.25 m door lintels; the model ducks visually
const BODY_HEIGHT = 1.9;

export class Monster {
  constructor(type, game) {
    this.type = type;
    this.def = { ...DEFS[type] };
    this.game = game;
    this.pos = [0, 0, 0];
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
    this.attackAnim = 0;
    this.body = { pos: this.pos, radius: this.def.radius, height: BODY_HEIGHT, stepHeight: 0.4, onGround: true, vel: [0, 0, 0] };
    this.nav = new NavGrid(game.world, (x, z) => game.world.canMonsterWalk(x, z), { door: (x, z) => game.world.doorAt(x, z) });
    this.model = new MonsterModel(game, type);
    this.model.pos = this.pos;
    this.netPos = [0, 0, 0];
    this.netYaw = 0;
    this.soundT = 2 + Math.random() * 4;
    this.stepAcc = 0;
    this.awareness = 0;
    this.doorWait = 0;
    this.duck = 0;
    this.sidestep = 0;
    this.light = { pos: [0, 0, 0], color: { warden: [1, 0.55, 0.2], scarecrow: [1, 0.35, 0.08], moth: [1, 0.6, 0.25], nurse: [0.7, 0.8, 1] }[type], intensity: 0, radius: 4 };
  }

  get name() {
    return this.def.name;
  }

  // ------------------------------------------------------------------ AI (host)
  setState(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
      this.path = null;
    }
  }
  setStateKeep(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
    }
  }

  survivors() {
    return this.game.survivors.filter((s) => s.active && !s.downed && s.hidden === null);
  }

  hostUpdate(dt) {
    const g = this.game;
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.stun > 0) {
      this.stun -= dt;
      this.speed = lerp(this.speed, 0, 1 - Math.exp(-8 * dt));
      return;
    }
    if (this.type === 'warden') this.thinkWarden(dt);
    else if (this.type === 'scarecrow') this.thinkScarecrow(dt);
    else if (this.type === 'moth') this.thinkMoth(dt);
    else this.thinkNurse(dt);

    if (this.cooldown <= 0 && !this.frozen) {
      for (const s of g.survivors) {
        if (!s.active || s.downed || s.hidden !== null) continue;
        const d = v3.distXZ(s.pos, this.pos);
        if (d < this.def.attackRange && Math.abs(s.pos[1] - this.pos[1]) < 1.6 && g.world.physics.lineOfSight([this.pos[0], 1.2, this.pos[2]], [s.pos[0], 1.2, s.pos[2]])) {
          this.strike(s, false);
          break;
        }
      }
      for (const s of g.survivors) {
        if (s.hidden === null || !s.active || s.downed) continue;
        if (this.target === s.id && v3.distXZ(s.pos, this.pos) < 2.0 && s.hiddenSeen) this.strike(s, true);
      }
    }
    // everything electric flickers around the monster
    for (const l of g.world.lamps) if (v3.distXZ(l.pos, this.pos) < (this.type === 'moth' ? 6 : 4)) l.disturb = Math.min(1, l.disturb + dt * 2);
    this.move(dt);
  }

  strike(s, fromHide) {
    this.cooldown = this.def.cooldown;
    // face the victim for the jumpscare
    this.yaw = Math.atan2(-(s.pos[0] - this.pos[0]), -(s.pos[2] - this.pos[2]));
    this.game.hitSurvivor(s, this, fromHide);
    this.stun = 1.8;
    this.attackAnim = 1;
    this.setState('wander');
    this.goal = null;
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
    const noise = this.nearestNoise(0.8);
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
    }
    if ((this.state === 'chase' || this.state === 'investigate') && this.goal && v3.distXZ(this.goal, this.pos) < 1.0) this.setState('listen');
    if (this.state === 'listen' && this.stateT > 2.5) this.setState('wander');
    if (this.state === 'wander') this.wander();
    this.awareness = this.state === 'chase' ? 1 : this.state === 'investigate' ? 0.5 : 0.15;
    void dt;
  }

  thinkScarecrow(dt) {
    const g = this.game;
    this.frozen = g.survivors.some((s) => s.active && !s.downed && s.seesMonster);
    let best = null, bd = 1e9;
    for (const s of this.survivors()) {
      const d = v3.distXZ(s.pos, this.pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best && bd < 40) {
      this.target = best.id;
      this.goal = best.pos.slice();
      this.setStateKeep(bd < 14 ? 'chase' : 'investigate');
    } else this.setStateKeep('wander');
    if (this.state === 'wander') this.wander();
    this.awareness = this.frozen ? 0.5 : this.state === 'chase' ? 1 : 0.3;
    void dt;
  }

  thinkMoth() {
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
      this.goal = this.lastSeen || this.goal;
      this.target = null;
      this.setState('investigate');
    }
    if (this.state === 'investigate' && this.goal && v3.distXZ(this.goal, this.pos) < 1.2) this.setState('listen');
    if (this.state === 'listen' && this.stateT > 2) this.setState('wander');
    if (this.state === 'wander' && (!this.goal || this.stateT > 12 || v3.distXZ(this.goal, this.pos) < 1.5)) {
      const lit = g.world.lamps.filter((l) => l.state > 0.5 && v3.distXZ(l.pos, this.pos) < 30);
      const l = lit.length ? lit[Math.floor(g.rnd() * lit.length)] : null;
      this.goal = l ? [l.pos[0], 0, l.pos[2]] : g.world.randomFloorPoint(g.rnd, true);
      this.path = null;
      this.stateT = 0;
    }
    this.awareness = this.state === 'chase' ? 1 : this.state === 'investigate' ? 0.55 : 0.2;
  }

  // heartbeat = fear reported by each player (0..1), louder when injured or sprinting
  heartbeat(s) {
    return clamp((s.heart ?? 0) + (s.health === 1 ? 0.35 : 0) + (s.sprinting ? 0.3 : 0), 0, 1.5);
  }

  thinkNurse() {
    const g = this.game;
    let best = null, bestScore = 0;
    for (const s of this.survivors()) {
      const d = v3.distXZ(s.pos, this.pos);
      const hb = this.heartbeat(s);
      const range = 6 + hb * 22;
      let score = d < range ? range - d : 0;
      if (d < 7 && g.world.physics.lineOfSight([this.pos[0], 1.5, this.pos[2]], [s.pos[0], 1.4, s.pos[2]])) score = Math.max(score, 10 - d);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) {
      this.target = best.id;
      this.goal = best.pos.slice();
      this.lastSeen = best.pos.slice();
      this.setStateKeep(v3.distXZ(best.pos, this.pos) < 14 ? 'chase' : 'investigate');
    } else if (this.state === 'chase' || this.state === 'investigate') {
      this.goal = this.lastSeen || this.goal;
      if (this.goal && v3.distXZ(this.goal, this.pos) < 1.2) this.setState('listen');
    }
    if (this.state === 'listen' && this.stateT > 3) this.setState('wander');
    if (this.state === 'wander') this.wander();
    this.awareness = this.state === 'chase' ? 1 : this.state === 'investigate' ? 0.6 : 0.2;
  }

  wander() {
    const g = this.game;
    if (!this.goal || this.stateT > 15 || v3.distXZ(this.goal, this.pos) < 1.5) {
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
      this.speed = lerp(this.speed, 0, 1 - Math.exp(-10 * dt));
      return;
    }
    while (this.path.length && v3.distXZ(this.path[0], this.pos) < 0.45) this.path.shift();
    if (!this.path.length) {
      this.speed = lerp(this.speed, 0, 1 - Math.exp(-6 * dt));
      return;
    }
    const wp = this.path[0];
    let dx = wp[0] - this.pos[0], dz = wp[2] - this.pos[2];
    const d = Math.hypot(dx, dz) || 1e-4;
    dx /= d;
    dz /= d;
    // stuck recovery: brief sidestep perpendicular to the path
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const sx = -dz * this.sideDir, sz = dx * this.sideDir;
      dx = dx * 0.4 + sx;
      dz = dz * 0.4 + sz;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    this.yaw = dampAngle(this.yaw, wantYaw, 7, dt);
    const turn = Math.abs(angleDiff(this.yaw, wantYaw));
    this.speed = lerp(this.speed, sp * clamp(1.25 - turn * 0.8, 0.35, 1), 1 - Math.exp(-4 * dt));
    const step = Math.min(d, this.speed * dt);
    // open doors ahead
    const ahead = [this.pos[0] + dx * 1.3, 0, this.pos[2] + dz * 1.3];
    const [cx, cz] = g.world.cellOf(ahead);
    const door = g.world.doorAt(cx, cz);
    if (door && door.open < 0.5 && door.target < 0.5 && !door.locked && door.monsterCanOpen) {
      g.hostSetDoor(door, 1, true);
      this.doorWait = 0.6;
    }
    const before = [this.pos[0], this.pos[2]];
    g.world.physics.moveCharacter(this.body, dx * step, -0.1, dz * step, { monster: true });
    const moved = Math.hypot(this.pos[0] - before[0], this.pos[2] - before[1]);
    if (step > 0.005 && moved < step * 0.3) {
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT > 0.45 && this.sidestep <= 0) {
        this.sidestep = 0.45;
        this.sideDir = Math.random() < 0.5 ? -1 : 1;
      }
      if (this.stuckT > 1.6) {
        this.path = null;
        this.stuckT = 0;
        if (this.state === 'wander') this.goal = null;
      }
    } else this.stuckT = Math.max(0, (this.stuckT || 0) - dt);
  }

  // ------------------------------------------------------------------ networking
  snapshot() {
    return {
      p: [+this.pos[0].toFixed(2), +this.pos[1].toFixed(2), +this.pos[2].toFixed(2)],
      y: +this.yaw.toFixed(2),
      s: this.state,
      v: +this.speed.toFixed(2),
      f: this.frozen ? 1 : 0,
      a: this.attackAnim > 0.5 ? 1 : 0,
      w: +this.awareness.toFixed(2),
      t: this.target,
    };
  }
  applySnapshot(s) {
    this.netPos = s.p;
    this.netYaw = s.y;
    this.state = s.s;
    this.speed = s.v;
    this.frozen = !!s.f;
    this.target = s.t ?? null;
    if (s.a) this.attackAnim = 1;
    this.awareness = s.w;
    if (!this.hasNet) {
      v3.copy(this.pos, s.p);
      this.yaw = s.y;
      this.hasNet = true;
    }
  }
  clientUpdate(dt) {
    const k = 1 - Math.exp(-10 * dt);
    if (v3.dist(this.netPos, this.pos) > 8) v3.copy(this.pos, this.netPos);
    for (let i = 0; i < 3; i++) this.pos[i] += (this.netPos[i] - this.pos[i]) * k;
    this.yaw = dampAngle(this.yaw, this.netYaw, 10, dt);
  }

  // ------------------------------------------------------------------ visuals & sound
  update(dt, cam) {
    const g = this.game;
    const m = this.model;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 1.4);
    // duck under door lintels
    const [cx, cz] = g.world.cellOf(this.pos);
    let nearDoor = false;
    for (let dz = -1; dz <= 1 && !nearDoor; dz++) for (let dx = -1; dx <= 1 && !nearDoor; dx++) {
      const door = g.world.doorAt(cx + dx, cz + dz);
      if (door && door.kind !== 'gate' && v3.distXZ(door.pos, this.pos) < 1.4) nearDoor = true;
    }
    if (g.world.isIndoorAt(this.pos) && g.world.H < 2.9) nearDoor = true; // low ceilings
    this.duck = lerp(this.duck, nearDoor ? 1 : 0, 1 - Math.exp(-6 * dt));
    m.yaw = this.yaw;
    const tgt = this.target ? g.survivorById(this.target) : null;
    m.animate(dt, {
      speed: this.speed,
      state: this.state,
      frozen: this.frozen,
      attack: this.attackAnim,
      duck: this.duck,
      chase: this.state === 'chase',
      lookAt: tgt ? tgt.pos : cam && v3.distXZ(cam.pos, this.pos) < 12 ? cam.pos : null,
    });
    m.setSky(g.world.isIndoorAt(this.pos) ? 0 : 1);
    // lantern / eye light
    const hp = m.headPos();
    if (this.type === 'warden') {
      const pm = m.bones.pelvis;
      this.light.pos[0] = pm[12] + pm[0] * -0.3;
      this.light.pos[1] = pm[13] - 0.1;
      this.light.pos[2] = pm[14] + pm[2] * -0.3;
      this.light.intensity = 1.4 * (0.85 + Math.sin(m.time * 9) * 0.1);
    } else {
      v3.copy(this.light.pos, hp);
      this.light.intensity = (this.type === 'moth' ? 1.4 : this.type === 'nurse' ? 0.35 : 0.5) * (this.state === 'chase' ? 1.6 : 1);
    }
    // sounds
    const a = g.audio;
    if (a && cam) {
      const spd = this.frozen ? 0 : this.speed;
      if (spd > 0.3) {
        this.stepAcc += spd * dt;
        const stride = this.type === 'moth' ? 2.5 : 1.4;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          if (this.type === 'warden') {
            a.play('step_heavy', { pos: this.pos, volume: 1.0, refDistance: 3, maxDistance: 40, pitchVar: 0.15 });
            if (Math.random() < 0.4) a.play('can', { pos: this.pos, volume: 0.25, rate: 0.6, refDistance: 2, maxDistance: 20 });
          } else if (this.type === 'scarecrow') a.play('wood_creak', { pos: this.pos, volume: 0.7, refDistance: 2, maxDistance: 25, pitchVar: 0.3 });
          else if (this.type === 'nurse') a.play('step_tile', { pos: this.pos, volume: 0.7, rate: 0.8, refDistance: 2, maxDistance: 26, pitchVar: 0.1 });
        }
      }
      if (this.type === 'moth') {
        if (!this.flutter) this.flutter = a.play('flutter', { pos: this.pos, loop: true, volume: 0.7, refDistance: 2.5, maxDistance: 30 });
        if (this.flutter) {
          this.flutter.setPos(this.pos);
          this.flutter.setRate(this.state === 'chase' ? 1.4 : 1);
        }
      }
      if (this.type === 'nurse') {
        if (!this.hum) this.hum = a.play('whisper', { pos: hp, loop: true, volume: 0.35, refDistance: 2, maxDistance: 18, rate: 0.6 });
        if (this.hum) this.hum.setPos(hp);
      }
      this.soundT -= dt;
      if (this.soundT <= 0) {
        this.soundT = this.state === 'chase' ? 2.2 + Math.random() * 2 : 5 + Math.random() * 7;
        const occluded = !g.world.physics.lineOfSight(cam.pos, [this.pos[0], 1.6, this.pos[2]]);
        if (this.type === 'warden') a.play('growl', { pos: hp, volume: 1, refDistance: 4, maxDistance: 50, occluded, pitchVar: 0.1 });
        else if (this.type === 'scarecrow') a.play(this.frozen ? 'wood_creak' : 'whisper', { pos: hp, volume: 0.9, refDistance: 3, maxDistance: 30, occluded });
        else if (this.type === 'nurse') a.play(this.state === 'chase' ? 'scream' : 'whisper', { pos: hp, volume: this.state === 'chase' ? 0.5 : 0.8, refDistance: 3, maxDistance: 30, occluded, rate: this.state === 'chase' ? 1.3 : 0.8 });
        else a.play('whisper', { pos: hp, volume: 0.7, refDistance: 3, maxDistance: 30, occluded, rate: 0.7 });
      }
    }
  }

  collect(scene) {
    this.model.collect(scene.dynamic);
    if (this.light.intensity > 0) scene.pointLights.push(this.light);
  }

  dispose() {
    if (this.flutter) this.flutter.stop(0.2);
    if (this.hum) this.hum.stop(0.2);
  }
}

export const MONSTER_DEFS = DEFS;
