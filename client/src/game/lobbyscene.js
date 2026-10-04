// 3D menu background: the party gathered at a survivors' camp — campfire with rising embers,
// tent, lantern, gear, string lights between dead trees, ground mist, an abandoned car, and
// something watching from the treeline (Dead-by-Daylight style lobby). Also used as the
// character customisation preview.
import { MeshBuilder, cylinderBuilder } from '../engine/mesh.js';
import { MAT } from '../engine/textures.js';
import { Camera, DrawItem } from '../engine/renderer.js';
import { m4, mulberry32, damp, lerp } from '../engine/math.js';
import { Character } from './character.js';
import { Kit, placePrefab } from './props.js';
import { MonsterModel } from './monstermodels.js';

const SLOTS = [
  { pos: [-1.5, 0, -0.6], yaw: -0.5 },
  { pos: [1.5, 0, -0.5], yaw: 0.55 },
  { pos: [-2.7, 0, 0.6], yaw: -1.0 },
  { pos: [2.8, 0, 0.7], yaw: 1.05 },
];

export class LobbyScene {
  constructor(app) {
    this.app = app;
    this.gl = app.gl;
    this.prims = app.prims;
    this.cam = new Camera();
    this.cam.far = 80;
    this.time = 0;
    this.members = [];
    this.focus = null;
    this.statics = [];
    this.fireLight = { pos: [0, 0.7, 0.2], color: [1, 0.52, 0.2], intensity: 9, radius: 12 };
    this.lanternLight = { pos: [2.35, 1.0, -2.05], color: [1, 0.7, 0.35], intensity: 1.6, radius: 5 };
    this.fireGlow = { pos: [0, 0.55, 0.2], size: 2.4, color: [1, 0.48, 0.14], intensity: 0.7 };
    this.moonSpot = { pos: [6, 9, 6], dir: [-0.45, -0.75, -0.45], color: [0.55, 0.65, 0.9], intensity: 1.6, range: 30, outer: 0.7, inner: 0.4, shadow: true };
    this.env = {
      ambient: [0.012, 0.012, 0.016],
      skyAmbient: [0.02, 0.025, 0.04],
      moonDir: [0.4, 0.7, 0.5],
      moonColor: [0.05, 0.06, 0.1],
      fogColor: [0.008, 0.01, 0.016],
      fogDensity: 0.06,
      groundFog: 0.12,
      sky: true,
      skyTop: [0.004, 0.006, 0.012],
      skyHorizon: [0.02, 0.025, 0.04],
      cloudiness: 0.7,
      wetness: 0.2,
      dust: { color: [0.03, 0.012, 0.004], drift: [0.05, 0.25, 0.03] },
      volumeDensity: 0.11,
    };
    this.scene = { static: [], dynamic: [], viewmodel: [], pointLights: [], spotLights: [], glows: [], env: this.env, lampState: null };
    this.embers = [];
    this.bulbs = [];
    this.build();
  }

  build() {
    const gl = this.gl;
    const rnd = mulberry32(77);
    const b = new MeshBuilder(65536);
    // ground: dirt clearing fading into grass
    for (let z = -14; z < 14; z++) for (let x = -14; x < 14; x++) b.box([x * 2, -0.2, z * 2], [x * 2 + 2, 0, z * 2 + 2], Math.hypot(x + 0.5, z + 0.5) < 3.2 ? MAT.DIRT : MAT.GRASS, { sky: 1, faces: 4 });
    const k = new Kit(b, null, { sky: 1 });
    // fallen leaves and grass tufts
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2, r = 1.4 + rnd() * 11;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (rnd() < 0.55) k.box(MAT.GRASS, [0.55 + rnd() * 0.3, 0.35 + rnd() * 0.15, 0.15], x, 0.006, z, 0.08, 0.004, 0.05, 0, rnd() * 6, 0);
      else if (r > 3) placePrefab(b, 'grass', [x, 0, z], rnd() * 6, rnd, { sky: 1 });
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = 5 + rnd() * 6;
      placePrefab(b, 'bush', [Math.cos(a) * r, 0, Math.sin(a) * r], rnd() * 6, rnd, { sky: 1 });
    }
    // dead forest ring
    const trunk = cylinderBuilder(MAT.BARK, 10, false, 0.13, 0.32).setAttr(null, 1, [0.75, 0.68, 0.6]);
    const branch = cylinderBuilder(MAT.BARK, 6, false, 0.015, 0.07).setAttr(null, 1, [0.75, 0.68, 0.6]);
    const m = m4.create();
    this.trees = [];
    for (let i = 0; i < 52; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 15;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 2 && Math.abs(x) < 4.5) continue;
      const h = 7 + rnd() * 6;
      this.trees.push([x, z, h]);
      m4.identity(m);
      m4.translate(m, m, x, h / 2, z);
      m4.rotateZ(m, m, (rnd() - 0.5) * 0.08);
      m4.scale(m, m, 1, h, 1);
      b.append(trunk, m);
      for (let j = 0; j < 7; j++) {
        m4.identity(m);
        m4.translate(m, m, x, h * (0.35 + rnd() * 0.6), z);
        m4.rotateY(m, m, rnd() * 6.28);
        m4.rotateZ(m, m, 0.5 + rnd() * 0.7);
        const len = 1 + rnd() * 2.4;
        m4.translate(m, m, 0, len / 2, 0);
        m4.scale(m, m, 1, len, 1);
        b.append(branch, m);
      }
      // roots
      for (let j = 0; j < 4; j++) {
        const ra = rnd() * 6.28;
        k.seg(MAT.BARK, [0.7, 0.62, 0.55], [x, 0.25, z], [x + Math.cos(ra) * 0.7, -0.02, z + Math.sin(ra) * 0.7], 0.06, true);
      }
    }
    // campfire: stone ring, crossed logs, embers bed
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const s = 0.12 + rnd() * 0.06;
      k.ball(MAT.CONCRETE, [0.6 + rnd() * 0.1, 0.58, 0.55], Math.cos(a) * 0.7, s * 0.6, 0.2 + Math.sin(a) * 0.7, s * 2.2, s * 1.6, s * 1.8, 0, rnd() * 3, 0);
    }
    k.cyl(MAT.DIRT, [0.25, 0.2, 0.18], 0, 0.01, 0.2, 0.6, 0.02);
    for (let i = 0; i < 5; i++) {
      k.push().t(0, 0.14, 0.2).ry((i / 5) * Math.PI * 2 + 0.3).rz(Math.PI / 2 - 0.35);
      k.cyl(MAT.BARK, [0.45, 0.35, 0.28], 0, 0, 0, 0.07, 0.9);
      k.cyl(MAT.WOOD, [0.08, 0.05, 0.04], 0, 0.45, 0, 0.065, 0.02);
      k.pop();
    }
    for (let i = 0; i < 10; i++) k.ball(MAT.LAMP, [1, 0.32, 0.06], (rnd() - 0.5) * 0.6, 0.03, 0.2 + (rnd() - 0.5) * 0.6, 0.08, 0.04, 0.08, 0, 0, 0, true);
    // seating logs, tent, gear
    placePrefab(b, 'log', [-2.3, 0, 1.95], 0.6, rnd, { sky: 1 });
    placePrefab(b, 'log', [2.5, 0, 2.05], -0.5, rnd, { sky: 1 });
    placePrefab(b, 'log', [0.2, 0, -2.6], 0.05, rnd, { sky: 1 });
    placePrefab(b, 'tent', [-4.6, 0, -2.6], 0.45, rnd, { sky: 1 });
    placePrefab(b, 'crate', [2.4, 0, -2.2], 0.3, rnd, { sky: 1 });
    k.push().t(2.35, 0.78, -2.05);
    placePrefab(b, 'lantern', [2.35, 0.79, -2.05], 0, rnd, { sky: 1 });
    k.pop();
    placePrefab(b, 'radioBox', [2.75, 0.79, -2.3], -0.4, rnd, { sky: 1 });
    placePrefab(b, 'barrels', [4.2, 0, -3.4], -0.3, rnd, { sky: 1 });
    placePrefab(b, 'generatorProp', [-3.6, 0, 0.9 - 4.2], 0.9, rnd, { sky: 1 });
    placePrefab(b, 'boxes', [-2.9, 0, -3.6], 0.2, rnd, { sky: 1 });
    placePrefab(b, 'carWreck', [-6.8, 0, -5.4], 1.1, rnd, { sky: 1 });
    placePrefab(b, 'fenceRail', [6.0, 0, -6.0], -0.7, rnd, { sky: 1 });
    placePrefab(b, 'fenceRail', [7.5, 0, -4.4], -0.9, rnd, { sky: 1 });
    // backpack and sleeping bag near the tent
    k.box(MAT.FABRIC, [0.35, 0.2, 0.12], -3.2, 0.25, -1.8, 0.32, 0.45, 0.2, 0, 0.6, 0.15);
    k.caps(MAT.FABRIC, [0.2, 0.35, 0.3], -5.0, 0.1, -0.9, 0.5, 1.6, 0.25, Math.PI / 2, 0.3, 0);
    // signpost
    k.cyl(MAT.WOOD, [0.5, 0.4, 0.3], 4.6, 1.1, -4.0, 0.05, 2.2);
    k.box(MAT.WOOD, [0.55, 0.45, 0.32], 4.85, 1.85, -4.0, 0.8, 0.22, 0.04, 0, 0.2, -0.05);
    k.box(MAT.WOOD, [0.55, 0.45, 0.32], 4.4, 1.5, -4.0, 0.7, 0.2, 0.04, 0, -0.3, 0.06);
    // string lights between two trees behind the camp
    const p0 = [-5.5, 2.8, -4.5], p1 = [5.2, 2.6, -5.0];
    let prev = p0;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const p = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - Math.sin(t * Math.PI) * 0.9, p0[2] + (p1[2] - p0[2]) * t];
      k.seg(MAT.PAINTED_METAL, [0.05, 0.05, 0.05], prev, p, 0.006, true);
      if (i % 2 === 0 && i < 24) {
        k.ball(MAT.LAMP, [1, 0.75, 0.4], p[0], p[1] - 0.06, p[2], 0.06, 0.08, 0.06, 0, 0, 0, true);
        this.bulbs.push({ pos: [p[0], p[1] - 0.06, p[2]], size: 0.35, color: [1, 0.7, 0.35], intensity: 0.35, ph: rnd() * 10 });
      }
      prev = p;
    }
    for (const p of [p0, p1]) k.cyl(MAT.BARK, [0.7, 0.62, 0.55], p[0], 1.6, p[2], 0.18, 3.4);
    const mesh = b.build(gl);
    this.statics.push({ mesh, min: mesh.min, max: mesh.max });
    // flames: layered emissive cones
    this.flames = [];
    for (let i = 0; i < 7; i++) {
      const hot = i < 3;
      const it = new DrawItem(this.prims.cone, MAT.LAMP, hot ? [1, 0.75, 0.3] : [1, 0.36 + i * 0.03, 0.08]);
      it.castShadow = false;
      it.emissive = hot ? 4 : 2.5;
      it.sky = 0;
      const a = (i / 7) * Math.PI * 2;
      this.flames.push({ it, ph: i * 1.7, hot, off: [hot ? (i - 1) * 0.06 : Math.cos(a) * 0.16, 0, hot ? 0 : Math.sin(a) * 0.12] });
    }
    for (let i = 0; i < 26; i++) this.embers.push({ pos: [0, 0.3, 0.2], vel: [0, 0, 0], life: 0, size: 0.06, color: [1, 0.45, 0.1], intensity: 0 });
    // something watches from the treeline
    const types = ['warden', 'scarecrow', 'moth', 'nurse'];
    this.lurker = new MonsterModel({ gl }, types[Math.floor(rnd() * types.length)]);
    this.lurkT = 10;
  }

  setMembers(list) {
    const keep = [];
    list.slice(0, 4).forEach((mem, i) => {
      let c = this.members.find((x) => x.id === mem.id);
      const key = JSON.stringify(mem.app);
      if (!c) c = { id: mem.id, char: new Character(this.prims, mem.app), key, wave: 1.5 };
      else if (c.key !== key) {
        c.char.setAppearance(mem.app);
        c.key = key;
      }
      c.slot = i;
      c.ready = mem.ready;
      c.isLocal = mem.isLocal;
      keep.push(c);
    });
    this.members = keep;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const local = this.members.find((m) => m.isLocal) || this.members[0];
    let target = [0, 1.4, 7.0], look = [0, 1.0, 0];
    if (this.focus === 'customize' && local) {
      const s = SLOTS[local.slot];
      target = [s.pos[0] + 0.3, 1.25, s.pos[2] + 2.6];
      look = [s.pos[0], 1.0, s.pos[2]];
    }
    const sway = Math.sin(t * 0.15) * 0.4;
    this.camTarget = this.camTarget || target.slice();
    for (let i = 0; i < 3; i++) this.camTarget[i] = damp(this.camTarget[i], target[i] + (i === 0 ? sway : 0), 3, dt);
    this.lookAt = this.lookAt || look.slice();
    for (let i = 0; i < 3; i++) this.lookAt[i] = damp(this.lookAt[i], look[i], 3, dt);
    const c = this.cam;
    c.pos[0] = this.camTarget[0];
    c.pos[1] = this.camTarget[1] + Math.sin(t * 0.4) * 0.03;
    c.pos[2] = this.camTarget[2];
    const dx = this.lookAt[0] - c.pos[0], dy = this.lookAt[1] - c.pos[1], dz = this.lookAt[2] - c.pos[2];
    c.yaw = Math.atan2(-dx, -dz);
    c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.roll = 0;
    c.fov = this.focus === 'customize' ? 45 : 50;
    // fire flicker
    const fl = 0.75 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.06 + Math.random() * 0.08;
    this.fireLight.intensity = 9 * fl;
    this.fireLight.pos[0] = Math.sin(t * 7) * 0.06;
    this.fireLight.pos[2] = 0.2 + Math.cos(t * 5) * 0.05;
    this.fireGlow.intensity = 0.6 * fl;
    this.lanternLight.intensity = 1.6 * (0.9 + Math.sin(t * 13) * 0.05);
    for (const f of this.flames) {
      const mm = f.it.model;
      const h = (f.hot ? 0.38 : 0.62) + Math.sin(t * 9 + f.ph) * 0.12 + Math.random() * 0.06;
      m4.identity(mm);
      m4.translate(mm, mm, f.off[0], 0.12 + h / 2, 0.2 + f.off[2]);
      m4.rotateZ(mm, mm, Math.sin(t * 5 + f.ph) * 0.18);
      m4.rotateX(mm, mm, Math.cos(t * 4 + f.ph) * 0.1);
      const w = f.hot ? 0.16 : 0.24;
      m4.scale(mm, mm, w, h, w);
      f.it.center = [0, 0.4, 0.2];
    }
    // embers rising from the fire
    for (const e of this.embers) {
      e.life -= dt;
      if (e.life <= 0) {
        e.life = 1 + Math.random() * 2.5;
        e.max = e.life;
        e.pos = [(Math.random() - 0.5) * 0.4, 0.3, 0.2 + (Math.random() - 0.5) * 0.4];
        e.vel = [(Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.3];
      }
      e.vel[0] += Math.sin(t * 3 + e.max * 10) * 0.4 * dt;
      for (let i = 0; i < 3; i++) e.pos[i] += e.vel[i] * dt;
      e.intensity = Math.min(1, e.life / e.max * 2) * (0.6 + Math.random() * 0.4) * 0.9;
    }
    for (const bl of this.bulbs) bl.intensity = 0.3 + Math.sin(t * 2 + bl.ph) * 0.05 + (Math.random() < 0.01 ? -0.3 : 0);
    // characters idle
    for (const mem of this.members) {
      const ch = mem.char;
      const s = SLOTS[mem.slot];
      ch.pos[0] = s.pos[0];
      ch.pos[1] = 0;
      ch.pos[2] = s.pos[2];
      const faceCam = this.focus === 'customize' && mem.isLocal;
      ch.yaw = damp(ch.yaw, faceCam ? 0.15 + Math.sin(t * 0.4) * 0.5 : s.yaw + Math.sin(t * 0.3 + mem.slot) * 0.1, 3, dt);
      ch.pitch = -0.1;
      ch.speed = 0;
      ch.crouch = mem.ready ? 0 : 0.15;
      mem.wave = Math.max(0, mem.wave - dt);
      ch.wave = lerp(ch.wave, mem.wave > 0 ? 1 : 0, 1 - Math.exp(-6 * dt));
      ch.flashOn = false;
      ch.update(dt, this.cam);
      ch.setSky(1);
    }
    // the lurker appears between the trees now and then
    this.lurkT -= dt;
    const L = this.lurker;
    if (this.lurkT < 0 && this.lurkT > -6) {
      if (!this.lurkerVisible) {
        const tr = this.trees[Math.floor(Math.random() * this.trees.length)];
        const a = Math.atan2(tr[1], tr[0]);
        const r = Math.max(9, Math.hypot(tr[0], tr[1]) - 0.8);
        L.pos = [Math.cos(a) * r, 0, Math.sin(a) * r];
        if (L.pos[2] > 2) L.pos[2] = -L.pos[2];
        L.lastPos = null;
      }
      L.yaw = Math.atan2(-(this.cam.pos[0] - L.pos[0]), -(this.cam.pos[2] - L.pos[2]));
      L.animate(dt, { speed: 0, state: 'listen', lookAt: this.cam.pos });
      L.setSky(1);
      L.dim = Math.min(1, -this.lurkT * 0.8) * Math.min(1, (6 + this.lurkT) * 0.8);
      this.lurkerVisible = true;
    } else {
      this.lurkerVisible = false;
      if (this.lurkT <= -6) this.lurkT = 25 + Math.random() * 30;
    }
  }

  wave(id) {
    const m = this.members.find((x) => x.id === id);
    if (m) m.wave = 1.6;
  }

  render(renderer, dt) {
    const sc = this.scene;
    sc.static.length = 0;
    sc.dynamic.length = 0;
    sc.pointLights.length = 0;
    sc.spotLights.length = 0;
    sc.glows.length = 0;
    sc.viewmodel.length = 0;
    for (const s of this.statics) sc.static.push(s);
    for (const f of this.flames) sc.dynamic.push(f.it);
    for (const mem of this.members) mem.char.collect(sc.dynamic);
    if (this.lurkerVisible) this.lurker.collect(sc.dynamic);
    sc.pointLights.push(this.fireLight, this.lanternLight);
    sc.glows.push(this.fireGlow);
    for (const e of this.embers) if (e.intensity > 0.02) sc.glows.push(e);
    for (const bl of this.bulbs) sc.glows.push(bl);
    sc.spotLights.push(this.moonSpot);
    renderer.post.fear = 0;
    renderer.post.damage = 0;
    renderer.post.desat = 0;
    renderer.post.vignette = 0.5;
    renderer.render(sc, this.cam, dt);
  }
}
