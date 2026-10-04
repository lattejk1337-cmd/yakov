// 3D menu background: survivors of the party gathered around a campfire in a foggy forest
// clearing (Dead-by-Daylight style lobby). Also used as the character customisation preview.
import { MeshBuilder, cylinderBuilder } from '../engine/mesh.js';
import { MAT } from '../engine/textures.js';
import { Camera, DrawItem } from '../engine/renderer.js';
import { m4, mulberry32, damp, lerp } from '../engine/math.js';
import { Character } from './character.js';

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
    this.focus = null; // 'customize' zooms on the local character
    this.statics = [];
    this.fireLight = { pos: [0, 0.6, 0.2], color: [1, 0.55, 0.22], intensity: 9, radius: 11 };
    this.fireGlow = { pos: [0, 0.5, 0.2], size: 2.2, color: [1, 0.5, 0.15], intensity: 0.7 };
    this.moonSpot = { pos: [6, 9, 6], dir: [-0.45, -0.75, -0.45], color: [0.55, 0.65, 0.9], intensity: 1.6, range: 30, outer: 0.7, inner: 0.4, shadow: true };
    this.env = {
      ambient: [0.012, 0.012, 0.016],
      skyAmbient: [0.02, 0.025, 0.04],
      moonDir: [0.4, 0.7, 0.5],
      moonColor: [0.05, 0.06, 0.1],
      fogColor: [0.008, 0.01, 0.016],
      fogDensity: 0.07,
      sky: true,
      skyTop: [0.004, 0.006, 0.012],
      skyHorizon: [0.02, 0.025, 0.04],
      cloudiness: 0.7,
      wetness: 0.2,
      dust: { color: [0.03, 0.012, 0.004], drift: [0.05, 0.25, 0.03] },
      volumeDensity: 0.11,
    };
    this.scene = { static: [], dynamic: [], viewmodel: [], pointLights: [], spotLights: [], glows: [], env: this.env, lampState: null };
    this.build();
  }

  build() {
    const gl = this.gl;
    const rnd = mulberry32(77);
    const b = new MeshBuilder(8192);
    // ground
    for (let z = -12; z < 12; z++) for (let x = -12; x < 12; x++) b.box([x * 2, -0.2, z * 2], [x * 2 + 2, 0, z * 2 + 2], Math.hypot(x, z) < 3 ? MAT.DIRT : MAT.GRASS, { sky: 1, faces: 4 });
    // forest ring
    const trunk = cylinderBuilder(MAT.BARK, 8, false, 0.15, 0.3).setAttr(null, 1);
    const branch = cylinderBuilder(MAT.BARK, 6, false, 0.02, 0.07).setAttr(null, 1);
    const m = m4.create();
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 14;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 2 && Math.abs(x) < 4) continue; // keep the camera view clear
      const h = 7 + rnd() * 5;
      m4.identity(m);
      m4.translate(m, m, x, h / 2, z);
      m4.scale(m, m, 1, h, 1);
      b.append(trunk, m);
      for (let k = 0; k < 6; k++) {
        m4.identity(m);
        m4.translate(m, m, x, h * (0.4 + rnd() * 0.55), z);
        m4.rotateY(m, m, rnd() * 6.28);
        m4.rotateZ(m, m, 0.6 + rnd() * 0.6);
        const len = 1 + rnd() * 2;
        m4.translate(m, m, 0, len / 2, 0);
        m4.scale(m, m, 1, len, 1);
        b.append(branch, m);
      }
    }
    // campfire stones & logs
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = Math.cos(a) * 0.65, z = 0.2 + Math.sin(a) * 0.65;
      b.box([x - 0.13, 0, z - 0.1], [x + 0.13, 0.17, z + 0.1], MAT.CONCRETE, { uv: 'local', sky: 1 });
    }
    const log = cylinderBuilder(MAT.BARK, 8, true).setAttr(null, 1);
    for (let i = 0; i < 4; i++) {
      m4.identity(m);
      m4.translate(m, m, 0, 0.12, 0.2);
      m4.rotateY(m, m, (i / 4) * Math.PI);
      m4.rotateZ(m, m, Math.PI / 2 - 0.25);
      m4.scale(m, m, 0.12, 0.9, 0.12);
      b.append(log, m);
    }
    // sitting logs
    for (const [x, z, yaw] of [[-2.2, 1.9, 0.6], [2.4, 2.1, -0.5]]) {
      m4.identity(m);
      m4.translate(m, m, x, 0.18, z);
      m4.rotateY(m, m, yaw);
      m4.rotateZ(m, m, Math.PI / 2);
      m4.scale(m, m, 0.36, 1.8, 0.36);
      b.append(log, m);
    }
    // an abandoned car and a sign
    b.box([-7, 0.3, -6], [-3.5, 1.1, -4.2], MAT.RUST_METAL, { uv: 'local', sky: 1 });
    b.box([-6.3, 1.1, -5.8], [-4.4, 1.6, -4.4], MAT.GLASS, { uv: 'local', sky: 1 });
    b.box([4.5, 0, -4], [4.6, 2.2, -3.9], MAT.WOOD, { uv: 'local', sky: 1 });
    b.box([4.0, 1.6, -4.05], [5.6, 2.2, -3.95], MAT.WOOD, { uv: 'local', sky: 1 });
    const mesh = b.build(gl);
    this.statics.push({ mesh, min: mesh.min, max: mesh.max });
    // flames: emissive cones that flicker
    this.flames = [];
    for (let i = 0; i < 5; i++) {
      const it = new DrawItem(this.prims.cone, MAT.LAMP, [1, 0.45 + i * 0.05, 0.12]);
      it.castShadow = false;
      it.emissive = 3;
      it.sky = 0;
      this.flames.push({ it, ph: i * 1.7, off: [(i - 2) * 0.09, 0, ((i * 7) % 3) * 0.06 - 0.06] });
    }
    // lurking silhouette (an easter egg between the trees)
    this.lurker = new DrawItem(this.prims.cube, MAT.MONSTER, [0.05, 0.05, 0.05]);
    this.lurkerEyes = new DrawItem(this.prims.cube, MAT.LAMP, [1, 0.3, 0.1]);
    this.lurkerEyes.emissive = 4;
    this.lurkerEyes.castShadow = false;
    this.lurkT = 12;
  }

  setMembers(list) {
    // list: [{id, app, name, ready, isLocal}]
    const keep = [];
    list.slice(0, 4).forEach((mem, i) => {
      let c = this.members.find((x) => x.id === mem.id);
      const key = JSON.stringify(mem.app);
      if (!c) {
        c = { id: mem.id, char: new Character(this.prims, mem.app), key, wave: 1.5 };
      } else if (c.key !== key) {
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
    // camera
    const local = this.members.find((m) => m.isLocal) || this.members[0];
    let target = [0, 1.35, 7.2], look = [0, 1.0, 0];
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
    c.pos[1] = this.camTarget[1];
    c.pos[2] = this.camTarget[2];
    const dx = this.lookAt[0] - c.pos[0], dy = this.lookAt[1] - c.pos[1], dz = this.lookAt[2] - c.pos[2];
    c.yaw = Math.atan2(-dx, -dz);
    c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.roll = 0;
    c.fov = this.focus === 'customize' ? 45 : 50;
    // fire flicker
    const fl = 0.75 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.06 + Math.random() * 0.08;
    this.fireLight.intensity = 9 * fl;
    this.fireLight.pos[0] = Math.sin(t * 7) * 0.05;
    this.fireGlow.intensity = 0.6 * fl;
    for (const f of this.flames) {
      const m = f.it.model;
      const h = 0.45 + Math.sin(t * 9 + f.ph) * 0.12 + Math.random() * 0.05;
      m4.identity(m);
      m4.translate(m, m, f.off[0], 0.15 + h / 2, 0.2 + f.off[2]);
      m4.rotateZ(m, m, Math.sin(t * 5 + f.ph) * 0.15);
      m4.scale(m, m, 0.22, h, 0.22);
      f.it.center = [0, 0.4, 0.2];
    }
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
    // lurker
    this.lurkT -= dt;
    const lm = this.lurker.model;
    if (this.lurkT < 0 && this.lurkT > -4) {
      const a = -Math.PI / 2 + Math.sin(this.lurkSeed || 1) * 0.6;
      const x = Math.cos(a) * 13, z = Math.sin(a) * 13;
      m4.identity(lm);
      m4.translate(lm, lm, x, 1.3, z);
      m4.scale(lm, lm, 0.6, 2.6, 0.4);
      this.lurker.center = [x, 1.3, z];
      const em = this.lurkerEyes.model;
      m4.identity(em);
      m4.translate(em, em, x, 2.4, z + 0.21);
      m4.scale(em, em, 0.3, 0.04, 0.02);
      this.lurkerEyes.center = [x, 2.4, z];
      this.lurkerVisible = true;
    } else {
      this.lurkerVisible = false;
      if (this.lurkT <= -4) {
        this.lurkT = 20 + Math.random() * 25;
        this.lurkSeed = Math.random() * 10;
      }
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
    if (this.lurkerVisible) sc.dynamic.push(this.lurker, this.lurkerEyes);
    sc.pointLights.push(this.fireLight);
    sc.glows.push(this.fireGlow);
    sc.spotLights.push(this.moonSpot);
    renderer.post.fear = 0;
    renderer.post.damage = 0;
    renderer.post.desat = 0;
    renderer.post.vignette = 0.5;
    renderer.render(sc, this.cam, dt);
  }
}
