// Procedural survivor model: hierarchical parts built from primitives, customisable appearance,
// procedural walk/run/crouch/downed animation.
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { m4, clamp, lerp } from '../engine/math.js';
import { SKIN_TONES, HAIR_COLORS, ITEM_BY_ID } from './catalog.js';

const tmp = m4.create();

class Part {
  constructor(bone, mesh, mat, color, t, s, opts = {}) {
    this.bone = bone;
    this.item = new DrawItem(mesh, mat, color);
    this.item.castShadow = opts.shadow ?? true;
    this.item.emissive = opts.emissive ?? 0;
    this.item.radius = 1.2;
    this.t = t; // local translation
    this.s = s; // local scale
    this.r = opts.r || null; // local rotation [x,y,z]
    this.detail = opts.detail ?? false; // hidden at distance
  }
}

export class Character {
  constructor(prims, appearance) {
    this.prims = prims;
    this.parts = [];
    this.bones = {};
    for (const b of ['root', 'hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR']) this.bones[b] = m4.create();
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.phase = 0;
    this.speed = 0;
    this.crouch = 0;
    this.downed = 0;
    this.sprint = 0;
    this.injured = false;
    this.visible = true;
    this.flashOn = false;
    this.wave = 0;
    this.idleT = Math.random() * 10;
    this.setAppearance(appearance);
  }

  setAppearance(app) {
    this.app = app;
    const P = this.prims;
    const skin = SKIN_TONES[app.skin] || SKIN_TONES[1];
    const hairC = HAIR_COLORS[app.hairColor] || HAIR_COLORS[0];
    const jacket = ITEM_BY_ID[app.jacket] || ITEM_BY_ID.jk_hoodie;
    const pants = ITEM_BY_ID[app.pants] || ITEM_BY_ID.pt_jeans;
    const jc = jacket.color, ac = jacket.accent;
    const pc = pants.color;
    const shoe = [0.08, 0.07, 0.07];
    const broad = app.build === 1 ? 1.12 : 1;
    this.broad = broad;
    const parts = [];
    const add = (bone, mesh, mat, color, t, s, opts) => {
      const p = new Part(bone, mesh, mat, color, t, s, opts);
      parts.push(p);
      return p;
    };
    // body
    add('hips', P.cube, MAT.FABRIC, pc, [0, 0, 0], [0.34 * broad, 0.2, 0.2]);
    add('torso', P.cube, MAT.FABRIC, jc, [0, 0.27, 0], [0.4 * broad, 0.52, 0.23]);
    add('torso', P.cylinder, MAT.FABRIC, jc, [0, 0.52, 0], [0.34 * broad, 0.08, 0.2]);
    if (ac) {
      add('torso', P.cube, MAT.FABRIC, ac, [0, 0.3, -0.118], [0.08, 0.5, 0.01], { shadow: false, detail: true, emissive: jacket.glow ? 1.2 : 0 });
      add('torso', P.cube, MAT.FABRIC, ac, [0, 0.05, 0], [0.41 * broad, 0.05, 0.24], { shadow: false, detail: true, emissive: jacket.glow ? 1.2 : 0 });
    }
    if (app.jacket === 'jk_hoodie' || app.hat === 'hat_hood') add('torso', P.cube, MAT.FABRIC, jc, [0, 0.5, 0.1], [0.3, 0.14, 0.08], { detail: true });
    add('head', P.cylinder, MAT.SKIN, skin, [0, 0.02, 0], [0.11, 0.12, 0.11], { shadow: false });
    add('head', P.sphere, MAT.SKIN, skin, [0, 0.17, 0], [0.22, 0.27, 0.24]);
    add('head', P.cube, MAT.SKIN, [0.05, 0.04, 0.04], [-0.05, 0.2, -0.115], [0.035, 0.022, 0.01], { shadow: false, detail: true });
    add('head', P.cube, MAT.SKIN, [0.05, 0.04, 0.04], [0.05, 0.2, -0.115], [0.035, 0.022, 0.01], { shadow: false, detail: true });
    add('head', P.cube, MAT.SKIN, skin.map((c) => c * 0.9), [0, 0.16, -0.12], [0.03, 0.05, 0.03], { shadow: false, detail: true });
    // hair
    const hair = app.hair;
    if (hair !== 'hair_none' && app.hat !== 'hat_hood') {
      add('head', P.sphere, MAT.HAIR, hairC, [0, 0.22, 0.012], [0.235, 0.22, 0.25]);
      if (hair === 'hair_long') add('head', P.cylinder, MAT.HAIR, hairC, [0, 0.12, 0.15], [0.07, 0.22, 0.07], { r: [0.4, 0, 0] });
      if (hair === 'hair_mohawk') add('head', P.cube, MAT.HAIR, hairC, [0, 0.34, 0.02], [0.05, 0.1, 0.26]);
      if (hair === 'hair_bun') add('head', P.sphere, MAT.HAIR, hairC, [0, 0.3, 0.1], [0.12, 0.12, 0.12]);
      if (hair === 'hair_messy') for (let i = 0; i < 5; i++) add('head', P.cube, MAT.HAIR, hairC, [Math.sin(i * 2) * 0.09, 0.3, Math.cos(i * 3) * 0.09], [0.07, 0.06, 0.07], { r: [i, i * 2, 0], detail: true });
    }
    // hats
    const hat = ITEM_BY_ID[app.hat];
    const hc = hat?.color || [0.2, 0.2, 0.2];
    switch (app.hat) {
      case 'hat_cap':
        add('head', P.cylinder, MAT.FABRIC, hc, [0, 0.31, 0.01], [0.25, 0.1, 0.26]);
        add('head', P.cube, MAT.FABRIC, hc, [0, 0.27, -0.15], [0.2, 0.02, 0.14], { detail: true });
        break;
      case 'hat_beanie':
        add('head', P.sphere, MAT.FABRIC, hc, [0, 0.27, 0.01], [0.26, 0.24, 0.27]);
        break;
      case 'hat_hood':
        add('head', P.sphere, MAT.FABRIC, hc, [0, 0.22, 0.03], [0.29, 0.33, 0.3]);
        break;
      case 'hat_bandana':
        add('head', P.cylinder, MAT.FABRIC, hc, [0, 0.27, 0.0], [0.25, 0.07, 0.26]);
        break;
      case 'hat_hardhat':
        add('head', P.sphere, MAT.PAINTED_METAL, hc, [0, 0.3, 0], [0.28, 0.2, 0.3]);
        add('head', P.cylinder, MAT.PAINTED_METAL, hc, [0, 0.27, 0], [0.34, 0.02, 0.36], { detail: true });
        break;
      case 'hat_headlamp':
        add('head', P.cylinder, MAT.FABRIC, hc, [0, 0.25, 0], [0.245, 0.04, 0.255]);
        add('head', P.cylinder, MAT.LAMP, [1, 0.95, 0.8], [0, 0.25, -0.13], [0.05, 0.04, 0.05], { r: [Math.PI / 2, 0, 0], shadow: false });
        break;
      case 'hat_officer':
        add('head', P.cylinder, MAT.FABRIC, hc, [0, 0.33, 0.01], [0.28, 0.12, 0.3]);
        add('head', P.cube, MAT.PAINTED_METAL, [0.05, 0.05, 0.05], [0, 0.28, -0.15], [0.22, 0.02, 0.1], { detail: true });
        add('head', P.cube, MAT.PAINTED_METAL, [0.8, 0.65, 0.2], [0, 0.34, -0.14], [0.05, 0.04, 0.01], { detail: true });
        break;
      default:
        break;
    }
    // masks
    const mask = ITEM_BY_ID[app.mask];
    const mc = mask?.color || [0.5, 0.5, 0.5];
    switch (app.mask) {
      case 'mask_surgical':
      case 'mask_bandit':
        add('head', P.cube, MAT.FABRIC, mc, [0, 0.11, -0.1], [0.2, 0.1, 0.06], { detail: true });
        break;
      case 'mask_gas':
        add('head', P.sphere, MAT.PAINTED_METAL, mc, [0, 0.17, -0.06], [0.24, 0.26, 0.17]);
        add('head', P.cylinder, MAT.PAINTED_METAL, mc.map((c) => c * 0.6), [0, 0.09, -0.17], [0.08, 0.1, 0.08], { r: [Math.PI / 2, 0, 0], detail: true });
        add('head', P.cylinder, MAT.GLASS, [0.3, 0.35, 0.3], [-0.06, 0.21, -0.14], [0.06, 0.02, 0.06], { r: [Math.PI / 2, 0, 0], detail: true });
        add('head', P.cylinder, MAT.GLASS, [0.3, 0.35, 0.3], [0.06, 0.21, -0.14], [0.06, 0.02, 0.06], { r: [Math.PI / 2, 0, 0], detail: true });
        break;
      case 'mask_white':
      case 'mask_skull':
        add('head', P.sphere, MAT.PAINTED_METAL, mc, [0, 0.16, -0.075], [0.21, 0.27, 0.12]);
        add('head', P.cube, MAT.SKIN, [0.02, 0.02, 0.02], [-0.05, 0.2, -0.135], [0.045, app.mask === 'mask_skull' ? 0.05 : 0.02, 0.01], { shadow: false, detail: true });
        add('head', P.cube, MAT.SKIN, [0.02, 0.02, 0.02], [0.05, 0.2, -0.135], [0.045, app.mask === 'mask_skull' ? 0.05 : 0.02, 0.01], { shadow: false, detail: true });
        if (app.mask === 'mask_skull') add('head', P.cube, MAT.SKIN, [0.02, 0.02, 0.02], [0, 0.08, -0.13], [0.09, 0.02, 0.01], { shadow: false, detail: true });
        break;
      default:
        break;
    }
    // back items
    const back = ITEM_BY_ID[app.back];
    const bc = back?.color || [0.3, 0.2, 0.1];
    if (app.back === 'back_pack') add('torso', P.cube, MAT.FABRIC, bc, [0, 0.28, 0.18], [0.3, 0.36, 0.14]);
    if (app.back === 'back_big') {
      add('torso', P.cube, MAT.FABRIC, bc, [0, 0.32, 0.2], [0.34, 0.55, 0.18]);
      add('torso', P.cylinder, MAT.FABRIC, [0.4, 0.15, 0.1], [0, 0.66, 0.2], [0.12, 0.38, 0.12], { r: [0, 0, Math.PI / 2], detail: true });
    }
    if (app.back === 'back_radio') {
      add('torso', P.cube, MAT.PAINTED_METAL, bc, [0, 0.28, 0.18], [0.28, 0.34, 0.12]);
      add('torso', P.cylinder, MAT.RUST_METAL, [0.1, 0.1, 0.1], [0.1, 0.75, 0.2], [0.012, 0.6, 0.012], { detail: true, shadow: false });
    }
    // arms
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      add('arm' + side, P.cube, MAT.FABRIC, jc, [0, -0.15, 0], [0.12, 0.32, 0.13]);
      add('fore' + side, P.cube, MAT.FABRIC, jc, [0, -0.13, 0], [0.105, 0.28, 0.11]);
      add('fore' + side, P.cube, MAT.SKIN, skin, [0, -0.3, 0], [0.08, 0.1, 0.09], { detail: true });
      add('leg' + side, P.cube, MAT.FABRIC, pc, [0, -0.21, 0], [0.15, 0.44, 0.16]);
      add('shin' + side, P.cube, MAT.FABRIC, pc, [0, -0.2, 0], [0.13, 0.4, 0.14]);
      add('shin' + side, P.cube, MAT.PAINTED_METAL, shoe, [0, -0.42, -0.04], [0.13, 0.08, 0.24]);
      void sx;
    }
    // flashlight in right hand
    this.flash = add('foreR', P.cylinder, MAT.PAINTED_METAL, [0.12, 0.12, 0.13], [0, -0.38, -0.03], [0.045, 0.22, 0.045], { detail: true });
    this.lens = add('foreR', P.cylinder, MAT.LAMP, [1, 0.95, 0.8], [0, -0.495, -0.03], [0.05, 0.012, 0.05], { shadow: false, detail: true });
    this.parts = parts;
  }

  // anim state update + bone matrices
  update(dt, cam) {
    const spd = this.speed;
    const moving = spd > 0.2;
    const runK = clamp((spd - 3) / 2.5, 0, 1);
    const stride = lerp(1.25, 1.9, runK);
    this.phase += (spd / stride) * Math.PI * dt * (moving ? 1 : 0);
    if (!moving) this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 1 - Math.exp(-8 * dt));
    this.idleT += dt;
    const ph = this.phase;
    const sw = Math.sin(ph);
    const amp = moving ? lerp(0.45, 0.8, runK) : 0;
    const crouch = this.crouch;
    const down = this.downed;
    const limp = this.injured ? 0.15 : 0;

    const B = this.bones;
    // root
    m4.identity(B.root);
    m4.translate(B.root, B.root, this.pos[0], this.pos[1], this.pos[2]);
    m4.rotateY(B.root, B.root, this.yaw);
    const bounce = moving ? Math.abs(Math.cos(ph)) * lerp(0.03, 0.07, runK) : Math.sin(this.idleT * 1.6) * 0.005;
    const hipY = lerp(lerp(0.93, 0.62, crouch), 0.22, down);
    const lean = lerp(runK * 0.25 + crouch * 0.35, 1.35, down) + limp * 0.1;
    m4.translate(B.hips, B.root, 0, hipY + bounce * (1 - down), 0);
    if (down > 0) m4.translate(B.hips, B.hips, 0, 0, -0.3 * down);
    m4.rotateY(B.hips, B.hips, sw * 0.1 * amp);
    m4.rotateX(B.torso, B.hips, -lean);
    m4.translate(B.torso, B.torso, 0, 0.08, 0);
    m4.rotateY(B.torso, B.torso, -sw * 0.15 * amp);
    // head looks with pitch
    m4.translate(B.head, B.torso, 0, 0.56, 0);
    m4.rotateX(B.head, B.head, lean * 0.6 + this.pitch * 0.6 + (down ? 0.6 : 0));
    // arms
    const shoulderW = 0.25 * this.broad;
    const armSwing = sw * amp * 0.9;
    const flashUp = this.flashOn && down < 0.5 ? 1 : 0;
    m4.translate(B.armL, B.torso, -shoulderW, 0.48, 0);
    m4.rotateX(B.armL, B.armL, -armSwing + crouch * 0.3 + down * 2.4);
    m4.rotateZ(B.armL, B.armL, -0.08 - this.wave * (0.6 + Math.sin(this.idleT * 9) * 0.3));
    m4.translate(B.foreL, B.armL, 0, -0.3, 0);
    m4.rotateX(B.foreL, B.foreL, 0.25 + runK * 0.9 + this.wave * 1.2);
    m4.translate(B.armR, B.torso, shoulderW, 0.48, 0);
    const rArm = lerp(armSwing + crouch * 0.3, Math.PI / 2 + this.pitch + lean - 0.25, flashUp);
    m4.rotateX(B.armR, B.armR, rArm + down * 2.4);
    m4.rotateZ(B.armR, B.armR, 0.08);
    m4.translate(B.foreR, B.armR, 0, -0.3, 0);
    m4.rotateX(B.foreR, B.foreR, lerp(0.25 + runK * 0.9, 0.25, flashUp));
    // legs
    const legSwing = sw * amp;
    m4.translate(B.legL, B.hips, -0.1 * this.broad, -0.05, 0);
    m4.rotateX(B.legL, B.legL, legSwing + crouch * 1.25 - down * 0.1);
    m4.translate(B.shinL, B.legL, 0, -0.43, 0);
    m4.rotateX(B.shinL, B.shinL, -(Math.max(0, -Math.cos(ph) * amp * 1.1) + crouch * 1.9 + down * 0.4));
    m4.translate(B.legR, B.hips, 0.1 * this.broad, -0.05, 0);
    m4.rotateX(B.legR, B.legR, -legSwing + crouch * 1.25 - down * 0.1);
    m4.translate(B.shinR, B.legR, 0, -0.43, 0);
    m4.rotateX(B.shinR, B.shinR, -(Math.max(0, Math.cos(ph) * amp * 1.1) + crouch * 1.9 + down * 0.6));

    const dist = cam ? Math.hypot(cam.pos[0] - this.pos[0], cam.pos[2] - this.pos[2]) : 0;
    const far = dist > 18;
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
      p.item.center[1] = this.pos[1] + 1;
      p.item.center[2] = this.pos[2];
      p.item.visible = this.visible && !(far && p.detail);
    }
    this.lens.item.emissive = this.flashOn ? 3 : 0;
  }

  // world-space flashlight origin & direction
  flashTransform(outPos, outDir) {
    const m = this.lens.item.model;
    outPos[0] = m[12]; outPos[1] = m[13]; outPos[2] = m[14];
    // the flashlight points along the forearm's -Y axis
    const l = Math.hypot(m[4], m[5], m[6]) || 1;
    outDir[0] = -m[4] / l; outDir[1] = -m[5] / l; outDir[2] = -m[6] / l;
    // fallback: use yaw/pitch when the arm is not raised
    if (!this.flashOn) {
      outDir[0] = -Math.sin(this.yaw) * Math.cos(this.pitch);
      outDir[1] = Math.sin(this.pitch);
      outDir[2] = -Math.cos(this.yaw) * Math.cos(this.pitch);
    }
  }

  collect(list) {
    for (const p of this.parts) list.push(p.item);
  }
  setSky(s) {
    for (const p of this.parts) p.item.sky = s;
  }
}

void tmp;
