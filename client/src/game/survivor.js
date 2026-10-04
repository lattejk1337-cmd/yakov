// A survivor in a match: local player, remote player or bot. Holds gameplay state, the
// character model and its flashlight.
import { Character } from './character.js';
import { ITEM_BY_ID } from './catalog.js';
import { v3, dampAngle, lerp } from '../engine/math.js';
import { CONFIG } from './config.js';

export class Survivor {
  constructor(game, info) {
    this.game = game;
    this.id = info.id;
    this.name = info.name;
    this.app = info.app;
    this.isBot = !!info.isBot;
    this.isLocal = !!info.isLocal;
    this.perks = info.perks || [];
    this.char = new Character(game.prims, info.app);
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.crouch = 0;
    this.speed = 0;
    this.sprinting = false;
    this.flashOn = true;
    this.battery = CONFIG.PLAYER.batteryMax;
    this.health = 2;
    this.downed = false;
    this.dead = false;
    this.escaped = false;
    this.left = false;
    this.hidden = null;
    this.hiddenSeen = false;
    this.seesMonster = false;
    this.bleed = CONFIG.PLAYER.bleedOutTime;
    this.reviveProgress = 0;
    this.repairing = null;
    this.reviving = null;
    this.repairRate = this.perks.includes('mechanic') ? 1.1 : 1;
    this.inv = { medkit: 0, adrenaline: this.perks.includes('hoarder') ? 1 : 0, battery: 0, held: null };
    this.stats = { puzzles: 0, revives: 0, pickups: 0 };
    const light = ITEM_BY_ID[info.app.light]?.color || [1, 0.95, 0.85];
    this.flash = { pos: [0, 0, 0], dir: [0, 0, -1], color: light.slice(), intensity: 0, range: 24, outer: 0.44, inner: 0.16, shadow: true };
    this.net = { pos: [0, 0, 0], yaw: 0, pitch: 0, t: 0, has: false };
    this.flicker = 0;
    this.stepAcc = 0;
  }

  get active() {
    return !this.dead && !this.escaped && !this.left;
  }
  get alive() {
    return !this.dead && !this.left;
  }
  // latest authoritative position (remote players: last received, not the smoothed one)
  get authPos() {
    return this.isLocal || this.isBot || !this.net.has ? this.pos : this.net.pos;
  }

  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return {
      p: [r(this.pos[0]), r(this.pos[1]), r(this.pos[2])],
      y: r(this.yaw),
      pi: r(this.pitch),
      c: r(this.crouch),
      s: r(this.speed),
      sp: this.sprinting ? 1 : 0,
      f: this.flashOn && this.battery > 0 ? 1 : 0,
      h: this.health,
      d: this.downed ? 1 : 0,
      dd: this.dead ? 1 : 0,
      e: this.escaped ? 1 : 0,
      hd: this.hidden,
      hs: this.hiddenSeen ? 1 : 0,
      sm: this.seesMonster ? 1 : 0,
      rp: this.repairing,
      rv: this.reviving,
      b: Math.round(this.bleed),
      it: this.inv.held ? 1 : 0,
    };
  }

  applyNet(s) {
    this.net.pos = s.p;
    this.net.yaw = s.y;
    this.net.pitch = s.pi;
    this.crouch = s.c;
    this.speed = s.s;
    this.sprinting = !!s.sp;
    this.flashOn = !!s.f;
    this.health = s.h;
    this.downed = !!s.d;
    this.dead = !!s.dd;
    this.escaped = !!s.e;
    this.hidden = s.hd ?? null;
    this.hiddenSeen = !!s.hs;
    this.seesMonster = !!s.sm;
    this.repairing = s.rp ?? null;
    this.reviving = s.rv ?? null;
    this.bleed = s.b ?? this.bleed;
    if (!this.net.has) {
      v3.copy(this.pos, s.p);
      this.yaw = s.y;
      this.net.has = true;
    }
  }

  interpolate(dt) {
    const k = 1 - Math.exp(-12 * dt);
    const n = this.net.pos;
    if (v3.dist(n, this.pos) > 6) v3.copy(this.pos, n); // teleport / respawn
    for (let i = 0; i < 3; i++) this.pos[i] += (n[i] - this.pos[i]) * k;
    this.yaw = dampAngle(this.yaw, this.net.yaw, 12, dt);
    this.pitch = lerp(this.pitch, this.net.pitch, k);
  }

  // Update model + flashlight for rendering (all non-local survivors, and local when spectated)
  updateVisual(dt, cam) {
    const c = this.char;
    v3.copy(c.pos, this.pos);
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    c.speed = this.speed;
    c.crouch = this.crouch;
    c.downed = lerp(c.downed, this.downed ? 1 : 0, 1 - Math.exp(-6 * dt));
    c.injured = this.health === 1;
    c.flashOn = this.flashOn && !this.downed;
    c.visible = this.alive && !this.escaped && this.hidden === null;
    c.update(dt, cam);
    c.setSky(this.game.world.isIndoorAt(this.pos) ? 0 : 1);
    // flashlight from the hand
    if (c.visible && this.flashOn) {
      c.flashTransform(this.flash.pos, this.flash.dir);
      this.flash.intensity = 2.2 * this.flickerMul();
    } else this.flash.intensity = 0;
  }

  flickerMul() {
    let k = 1;
    if (this.battery < 15) k *= Math.random() < 0.08 ? 0.15 : 0.6 + this.battery / 40;
    const m = this.game.monster;
    if (m && v3.distXZ(m.pos, this.pos) < 7 && Math.random() < 0.15) k *= Math.random() * 0.4;
    return k;
  }

  collect(scene) {
    if (!this.char.visible) return;
    this.char.collect(scene.dynamic);
  }
}
