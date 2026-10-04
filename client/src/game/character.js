// Detailed survivor model. Each bone is one merged, vertex-coloured mesh built from the
// appearance (face, hair, clothing details, fingers, shoes, gear), animated procedurally.
import { MeshBuilder } from '../engine/mesh.js';
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { m4, clamp, lerp } from '../engine/math.js';
import { SKIN_TONES, HAIR_COLORS, ITEM_BY_ID } from './catalog.js';
import { Kit } from './props.js';

const M = MAT;
const BONES = ['root', 'hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function buildBody(K, app, broad) {
  const skin = SKIN_TONES[app.skin] || SKIN_TONES[1];
  const hairC = HAIR_COLORS[app.hairColor] || HAIR_COLORS[0];
  const jacket = ITEM_BY_ID[app.jacket] || ITEM_BY_ID.jk_hoodie;
  const pants = ITEM_BY_ID[app.pants] || ITEM_BY_ID.pt_jeans;
  const jc = jacket.color, ac = jacket.accent, pc = pants.color;
  const glow = !!jacket.glow;
  const shoe = [0.1, 0.09, 0.09];
  const b = broad;
  // ---------------- hips
  K.hips.caps(M.FABRIC, pc, 0, 0.0, 0, 0.36 * b, 0.26, 0.22);
  K.hips.box(M.FABRIC, [0.08, 0.07, 0.06], 0, 0.1, 0, 0.37 * b, 0.05, 0.23);
  K.hips.box(M.PAINTED_METAL, [0.6, 0.6, 0.62], 0, 0.1, -0.116, 0.05, 0.035, 0.01);
  for (const sx of [-1, 1]) K.hips.box(M.FABRIC, mul(pc, 0.8), sx * 0.12 * b, -0.02, -0.11, 0.09, 0.06, 0.01, 0, 0, sx * 0.3);
  // ---------------- torso
  K.torso.caps(M.FABRIC, jc, 0, 0.28, 0, 0.42 * b, 0.6, 0.25);
  K.torso.caps(M.FABRIC, jc, 0, 0.42, 0, 0.46 * b, 0.32, 0.26);
  for (const sx of [-1, 1]) K.torso.ball(M.FABRIC, jc, sx * 0.21 * b, 0.47, 0, 0.17, 0.15, 0.2);
  K.torso.box(M.PAINTED_METAL, [0.15, 0.15, 0.16], 0, 0.3, -0.127, 0.012, 0.48, 0.005);
  K.torso.box(M.PAINTED_METAL, [0.7, 0.7, 0.72], 0, 0.5, -0.13, 0.02, 0.03, 0.008);
  for (const sx of [-1, 1]) K.torso.box(M.FABRIC, mul(jc, 0.82), sx * 0.12 * b, 0.12, -0.125, 0.13, 0.12, 0.01, 0, 0, sx * 0.1);
  K.torso.ring(M.FABRIC, mul(jc, 0.85), 0, 0.57, 0, 0.1, 0.035);
  if (app.jacket === 'jk_hoodie' || app.hat === 'hat_hood') {
    K.torso.ball(M.FABRIC, mul(jc, 0.9), 0, 0.58, 0.1, 0.32, 0.18, 0.2);
    for (const sx of [-0.04, 0.04]) K.torso.seg(M.FABRIC, [0.85, 0.85, 0.85], [sx, 0.55, -0.12], [sx * 1.2, 0.38, -0.13], 0.008, true);
  }
  if (app.jacket === 'jk_leather' || app.jacket === 'jk_bomber') for (const sx of [-1, 1]) K.torso.box(M.FABRIC, mul(jc, 0.75), sx * 0.08, 0.5, -0.12, 0.1, 0.16, 0.02, 0.2, 0, sx * 0.5);
  if (app.jacket === 'jk_medic') {
    K.torso.box(M.FABRIC, jc, 0, -0.2, 0, 0.44 * b, 0.4, 0.27);
    K.hips.box(M.FABRIC, jc, 0, -0.25, 0, 0.44 * b, 0.35, 0.26);
  }
  if (app.jacket === 'jk_rain') K.torso.ball(M.FABRIC, jc, 0, 0.6, 0.12, 0.34, 0.2, 0.22);
  if (ac) {
    const em = glow ? M.LAMP : M.FABRIC;
    K.torso.box(em, ac, -0.06, 0.3, -0.128, 0.025, 0.46, 0.006);
    K.torso.box(em, ac, 0.06, 0.3, -0.128, 0.025, 0.46, 0.006);
    K.torso.ring(em, ac, 0, 0.05, 0, 0.215 * b, 0.018);
  }
  // back gear
  const back = ITEM_BY_ID[app.back];
  const bc = back?.color || [0.3, 0.2, 0.1];
  if (app.back === 'back_pack' || app.back === 'back_big') {
    const big = app.back === 'back_big';
    K.torso.box(M.FABRIC, bc, 0, big ? 0.32 : 0.28, 0.2, 0.32, big ? 0.6 : 0.4, 0.16);
    K.torso.box(M.FABRIC, mul(bc, 0.8), 0, big ? 0.14 : 0.16, 0.29, 0.26, 0.16, 0.05);
    for (const sx of [-1, 1]) K.torso.box(M.FABRIC, mul(bc, 0.7), sx * 0.12, 0.35, -0.02, 0.04, 0.5, 0.28, 0, 0, 0);
    if (big) K.torso.cyl(M.FABRIC, [0.4, 0.15, 0.1], 0, 0.68, 0.2, 0.08, 0.38, 0, 0, Math.PI / 2);
  }
  if (app.back === 'back_radio') {
    K.torso.box(M.PAINTED_METAL, bc, 0, 0.3, 0.2, 0.3, 0.36, 0.12);
    K.torso.box(M.PAINTED_METAL, [0.1, 0.1, 0.1], -0.06, 0.38, 0.262, 0.12, 0.08, 0.005);
    for (let i = 0; i < 3; i++) K.torso.cyl(M.PAINTED_METAL, [0.15, 0.15, 0.15], 0.08, 0.25 + i * 0.06, 0.265, 0.018, 0.01, Math.PI / 2);
    K.torso.cyl(M.RUST_METAL, [0.1, 0.1, 0.1], 0.1, 0.8, 0.22, 0.008, 0.7);
  }
  // ---------------- head
  K.head.caps(M.SKIN, skin, 0, 0.03, 0.01, 0.12, 0.16, 0.12);
  K.head.ball(M.SKIN, skin, 0, 0.18, 0, 0.22, 0.27, 0.24);
  K.head.ball(M.SKIN, skin, 0, 0.1, -0.03, 0.17, 0.12, 0.19);
  K.head.caps(M.SKIN, mul(skin, 0.95), 0, 0.165, -0.12, 0.04, 0.07, 0.05, -0.3);
  for (const sx of [-1, 1]) {
    K.head.ball(M.SKIN, mul(skin, 0.95), sx * 0.11, 0.18, 0.005, 0.04, 0.07, 0.05);
    K.head.ball(M.PAINTED_METAL, [0.92, 0.92, 0.9], sx * 0.048, 0.205, -0.098, 0.045, 0.03, 0.02);
    K.head.ball(M.PAINTED_METAL, [0.12, 0.09, 0.07], sx * 0.048, 0.205, -0.107, 0.022, 0.022, 0.01);
    K.head.box(M.HAIR, mul(hairC, 0.9), sx * 0.05, 0.245, -0.103, 0.05, 0.012, 0.012, 0, 0, sx * -0.12);
  }
  K.head.box(M.SKIN, mul(skin, 0.7), 0, 0.105, -0.113, 0.06, 0.008, 0.01);
  // hair
  const hair = app.hair;
  const hooded = app.hat === 'hat_hood' || app.mask === 'mask_gas';
  if (hair !== 'hair_none' && !hooded) {
    K.head.ball(M.HAIR, hairC, 0, 0.235, 0.015, 0.235, 0.21, 0.255);
    for (const sx of [-1, 1]) K.head.box(M.HAIR, hairC, sx * 0.105, 0.17, -0.02, 0.02, 0.09, 0.05);
    if (hair === 'hair_long') {
      K.head.caps(M.HAIR, hairC, 0, 0.12, 0.13, 0.08, 0.3, 0.08, 0.35);
      K.head.ring(M.FABRIC, [0.6, 0.1, 0.1], 0, 0.22, 0.13, 0.035, 0.01, 0.35, 0, 0);
    }
    if (hair === 'hair_mohawk') for (let i = 0; i < 6; i++) K.head.cone(M.HAIR, hairC, 0, 0.32 + Math.sin(i / 5 * Math.PI) * 0.03, -0.1 + i * 0.045, 0.03, 0.12);
    if (hair === 'hair_bun') K.head.ball(M.HAIR, hairC, 0, 0.32, 0.09, 0.12, 0.11, 0.12);
    if (hair === 'hair_messy') for (let i = 0; i < 8; i++) K.head.ball(M.HAIR, hairC, Math.sin(i * 2.1) * 0.09, 0.3 + (i % 3) * 0.01, Math.cos(i * 1.7) * 0.09, 0.08, 0.07, 0.09, i, i * 2, 0);
    if (hair === 'hair_short') K.head.box(M.HAIR, hairC, 0, 0.29, -0.09, 0.16, 0.04, 0.06, 0.4);
  }
  const hat = ITEM_BY_ID[app.hat];
  const hc = hat?.color || [0.2, 0.2, 0.2];
  switch (app.hat) {
    case 'hat_cap':
      K.head.ball(M.FABRIC, hc, 0, 0.275, 0.01, 0.25, 0.15, 0.27);
      K.head.box(M.FABRIC, mul(hc, 0.85), 0, 0.27, -0.16, 0.2, 0.015, 0.14, -0.15);
      K.head.ball(M.FABRIC, mul(hc, 0.8), 0, 0.35, 0.01, 0.03, 0.02, 0.03);
      break;
    case 'hat_beanie':
      K.head.ball(M.FABRIC, hc, 0, 0.27, 0.01, 0.26, 0.24, 0.27);
      K.head.ring(M.FABRIC, mul(hc, 0.85), 0, 0.21, 0.01, 0.125, 0.025);
      K.head.ball(M.FABRIC, mul(hc, 1.1), 0, 0.4, 0.01, 0.07, 0.07, 0.07);
      break;
    case 'hat_hood':
      K.head.ball(M.FABRIC, hc, 0, 0.21, 0.03, 0.3, 0.34, 0.32);
      K.head.ring(M.FABRIC, mul(hc, 0.8), 0, 0.17, -0.07, 0.13, 0.025, Math.PI / 2 - 0.3, 0, 0);
      break;
    case 'hat_bandana':
      K.head.ring(M.FABRIC, hc, 0, 0.27, 0, 0.12, 0.03, 0.1, 0, 0);
      K.head.box(M.FABRIC, hc, 0, 0.24, 0.14, 0.05, 0.12, 0.02, 0.4);
      break;
    case 'hat_hardhat':
      K.head.ball(M.PAINTED_METAL, hc, 0, 0.29, 0, 0.27, 0.2, 0.29);
      K.head.cyl(M.PAINTED_METAL, hc, 0, 0.25, -0.02, 0.17, 0.02);
      K.head.box(M.PAINTED_METAL, mul(hc, 0.9), 0, 0.37, 0, 0.03, 0.04, 0.26);
      break;
    case 'hat_headlamp':
      K.head.ring(M.FABRIC, hc, 0, 0.24, 0, 0.122, 0.02);
      K.head.cyl(M.PAINTED_METAL, [0.15, 0.15, 0.15], 0, 0.25, -0.13, 0.035, 0.04, Math.PI / 2);
      K.head.cyl(M.LAMP, [1, 0.95, 0.8], 0, 0.25, -0.152, 0.028, 0.005, Math.PI / 2);
      break;
    case 'hat_officer':
      K.head.cyl(M.FABRIC, hc, 0, 0.31, 0.01, 0.15, 0.1);
      K.head.cyl(M.FABRIC, hc, 0, 0.36, 0.01, 0.16, 0.02);
      K.head.box(M.PAINTED_METAL, [0.05, 0.05, 0.05], 0, 0.27, -0.15, 0.2, 0.015, 0.1, -0.2);
      K.head.box(M.PAINTED_METAL, [0.8, 0.65, 0.2], 0, 0.32, -0.15, 0.04, 0.035, 0.008);
      break;
    default:
      break;
  }
  const mask = ITEM_BY_ID[app.mask];
  const mc = mask?.color || [0.5, 0.5, 0.5];
  switch (app.mask) {
    case 'mask_surgical':
      K.head.ball(M.FABRIC, mc, 0, 0.1, -0.06, 0.2, 0.1, 0.13);
      for (const sx of [-1, 1]) K.head.seg(M.FABRIC, [0.9, 0.9, 0.9], [sx * 0.09, 0.12, -0.08], [sx * 0.11, 0.18, 0.0], 0.004, true);
      break;
    case 'mask_bandit':
      K.head.box(M.FABRIC, mc, 0, 0.09, -0.1, 0.21, 0.11, 0.06, 0.15);
      K.head.cone(M.FABRIC, mc, 0, 0.0, -0.11, 0.08, 0.1, Math.PI);
      break;
    case 'mask_gas':
      K.head.ball(M.PAINTED_METAL, mc, 0, 0.19, -0.02, 0.25, 0.3, 0.27);
      K.head.cyl(M.PAINTED_METAL, mul(mc, 0.6), 0, 0.08, -0.15, 0.06, 0.12, Math.PI / 2 - 0.3);
      K.head.cyl(M.PAINTED_METAL, mul(mc, 0.4), 0, 0.05, -0.21, 0.07, 0.03, Math.PI / 2 - 0.3);
      for (const sx of [-1, 1]) {
        K.head.cyl(M.GLASS, [0.35, 0.4, 0.35], sx * 0.06, 0.21, -0.12, 0.045, 0.02, Math.PI / 2);
        K.head.ring(M.PAINTED_METAL, [0.1, 0.1, 0.1], sx * 0.06, 0.21, -0.13, 0.045, 0.008, Math.PI / 2, 0, 0);
      }
      break;
    case 'mask_white':
    case 'mask_skull':
      K.head.ball(M.PAINTED_METAL, mc, 0, 0.16, -0.07, 0.21, 0.27, 0.12);
      for (const sx of [-1, 1]) K.head.ball(M.PAINTED_METAL, [0.02, 0.02, 0.02], sx * 0.05, 0.2, -0.128, 0.05, app.mask === 'mask_skull' ? 0.06 : 0.025, 0.01);
      if (app.mask === 'mask_skull') {
        K.head.box(M.PAINTED_METAL, [0.02, 0.02, 0.02], 0, 0.14, -0.13, 0.025, 0.035, 0.01);
        for (let i = 0; i < 5; i++) K.head.box(M.PAINTED_METAL, [0.05, 0.05, 0.05], -0.04 + i * 0.02, 0.08, -0.125, 0.004, 0.03, 0.006);
      }
      break;
    default:
      break;
  }
  // ---------------- limbs
  for (const s of ['L', 'R']) {
    K['arm' + s].caps(M.FABRIC, jc, 0, -0.15, 0, 0.13, 0.36, 0.14);
    K['fore' + s].caps(M.FABRIC, jc, 0, -0.12, 0, 0.115, 0.3, 0.12);
    K['fore' + s].ring(M.FABRIC, mul(jc, 0.8), 0, -0.25, 0, 0.055, 0.016);
    if (ac) K['arm' + s].ring(glow ? M.LAMP : M.FABRIC, ac, 0, -0.08, 0, 0.068, 0.012);
    // hand with fingers
    K['fore' + s].box(M.SKIN, skin, 0, -0.31, -0.005, 0.075, 0.08, 0.04);
    for (let f = 0; f < 4; f++) K['fore' + s].seg(M.SKIN, skin, [-0.026 + f * 0.017, -0.34, -0.01], [-0.026 + f * 0.017, -0.39, -0.03], 0.009, true);
    K['fore' + s].seg(M.SKIN, skin, [s === 'L' ? 0.03 : -0.03, -0.3, -0.02], [s === 'L' ? 0.04 : -0.04, -0.35, -0.045], 0.01, true);
    K['leg' + s].caps(M.FABRIC, pc, 0, -0.21, 0, 0.16, 0.48, 0.17);
    K['shin' + s].caps(M.FABRIC, pc, 0, -0.18, 0, 0.135, 0.42, 0.14);
    if (app.pants === 'pt_track') K['shin' + s].box(M.FABRIC, [0.9, 0.9, 0.9], s === 'L' ? -0.068 : 0.068, -0.18, 0, 0.008, 0.4, 0.03);
    K['shin' + s].ball(M.PAINTED_METAL, shoe, 0, -0.41, -0.035, 0.13, 0.1, 0.26);
    K['shin' + s].box(M.PAINTED_METAL, [0.75, 0.73, 0.7], 0, -0.455, -0.04, 0.13, 0.025, 0.27);
    for (let i = 0; i < 3; i++) K['shin' + s].box(M.FABRIC, [0.85, 0.85, 0.82], 0, -0.375 + i * 0.012, -0.1 - i * 0.025, 0.06, 0.006, 0.006);
  }
  // flashlight in the right hand
  K.foreR.cyl(M.PAINTED_METAL, [0.1, 0.1, 0.11], 0, -0.37, -0.03, 0.022, 0.22);
  for (let i = 0; i < 4; i++) K.foreR.ring(M.PAINTED_METAL, [0.2, 0.2, 0.22], 0, -0.3 - i * 0.03, -0.03, 0.022, 0.004);
  K.foreR.cyl(M.PAINTED_METAL, [0.14, 0.14, 0.15], 0, -0.48, -0.03, 0.03, 0.05);
}

export class Character {
  constructor(prims, appearance) {
    this.prims = prims;
    this.gl = prims.cube.gl;
    this.items = [];
    this.boneItems = {};
    this.bones = {};
    for (const b of BONES) this.bones[b] = m4.create();
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.phase = 0;
    this.speed = 0;
    this.crouch = 0;
    this.downed = 0;
    this.injured = false;
    this.visible = true;
    this.flashOn = false;
    this.wave = 0;
    this.idleT = Math.random() * 10;
    this.lens = new DrawItem(prims.cylinder, MAT.LAMP, [1, 0.95, 0.85]);
    this.lens.castShadow = false;
    this.setAppearance(appearance);
  }

  setAppearance(app) {
    this.app = app;
    for (const it of this.items) it.mesh.dispose();
    this.items = [];
    this.boneItems = {};
    this.broad = app.build === 1 ? 1.12 : 1;
    const builders = {};
    const K = {};
    for (const b of BONES) {
      builders[b] = new MeshBuilder(512);
      K[b] = new Kit(builders[b]);
    }
    buildBody(K, app, this.broad);
    for (const b of BONES) {
      const mesh = builders[b].build(this.gl);
      if (!mesh) continue;
      const it = new DrawItem(mesh, -1, [1, 1, 1]);
      it.radius = 1.3;
      if (b === 'head') it.emissive = 0;
      this.items.push(it);
      this.boneItems[b] = it;
    }
    const jacket = ITEM_BY_ID[app.jacket];
    this.glowAccent = !!jacket?.glow;
  }

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
    m4.identity(B.root);
    m4.translate(B.root, B.root, this.pos[0], this.pos[1], this.pos[2]);
    m4.rotateY(B.root, B.root, this.yaw);
    const breathe = Math.sin(this.idleT * 1.6) * 0.006;
    const bounce = moving ? Math.abs(Math.cos(ph)) * lerp(0.03, 0.07, runK) : breathe;
    const hipY = lerp(lerp(0.95, 0.62, crouch), 0.22, down);
    const lean = lerp(runK * 0.25 + crouch * 0.35, 1.35, down) + limp * 0.1;
    m4.translate(B.hips, B.root, 0, hipY + bounce * (1 - down), 0);
    if (down > 0) m4.translate(B.hips, B.hips, 0, 0, -0.3 * down);
    m4.rotateY(B.hips, B.hips, sw * 0.1 * amp);
    m4.rotateZ(B.hips, B.hips, Math.cos(ph) * 0.04 * amp + limp * 0.08);
    m4.rotateX(B.torso, B.hips, -lean);
    m4.translate(B.torso, B.torso, 0, 0.08, 0);
    m4.rotateY(B.torso, B.torso, -sw * 0.15 * amp);
    m4.translate(B.head, B.torso, 0, 0.6, 0);
    m4.rotateY(B.head, B.head, Math.sin(this.idleT * 0.37) * 0.15 * (moving ? 0.2 : 1));
    m4.rotateX(B.head, B.head, lean * 0.6 + this.pitch * 0.6 + (down ? 0.6 : 0));
    const shoulderW = 0.25 * this.broad;
    const armSwing = sw * amp * 0.9;
    const flashUp = this.flashOn && down < 0.5 ? 1 : 0;
    m4.translate(B.armL, B.torso, -shoulderW, 0.5, 0);
    m4.rotateX(B.armL, B.armL, -armSwing + crouch * 0.3 + down * 2.4);
    m4.rotateZ(B.armL, B.armL, -0.08 - this.wave * (0.6 + Math.sin(this.idleT * 9) * 0.3));
    m4.translate(B.foreL, B.armL, 0, -0.3, 0);
    m4.rotateX(B.foreL, B.foreL, 0.25 + runK * 0.9 + this.wave * 1.2);
    m4.translate(B.armR, B.torso, shoulderW, 0.5, 0);
    const rArm = lerp(armSwing + crouch * 0.3, Math.PI / 2 + this.pitch + lean - 0.25, flashUp);
    m4.rotateX(B.armR, B.armR, rArm + down * 2.4);
    m4.rotateZ(B.armR, B.armR, 0.08);
    m4.translate(B.foreR, B.armR, 0, -0.3, 0);
    m4.rotateX(B.foreR, B.foreR, lerp(0.25 + runK * 0.9, 0.25, flashUp));
    const legSwing = sw * amp;
    m4.translate(B.legL, B.hips, -0.1 * this.broad, -0.05, 0);
    m4.rotateX(B.legL, B.legL, legSwing + crouch * 1.25 - down * 0.1);
    m4.translate(B.shinL, B.legL, 0, -0.43, 0);
    m4.rotateX(B.shinL, B.shinL, -(Math.max(0, -Math.cos(ph) * amp * 1.1) + crouch * 1.9 + down * 0.4));
    m4.translate(B.legR, B.hips, 0.1 * this.broad, -0.05, 0);
    m4.rotateX(B.legR, B.legR, -legSwing + crouch * 1.25 - down * 0.1);
    m4.translate(B.shinR, B.legR, 0, -0.43, 0);
    m4.rotateX(B.shinR, B.shinR, -(Math.max(0, Math.cos(ph) * amp * 1.1) + crouch * 1.9 + down * 0.6));
    for (const [name, it] of Object.entries(this.boneItems)) {
      m4.copy(it.model, B[name]);
      it.center[0] = this.pos[0];
      it.center[1] = this.pos[1] + 1;
      it.center[2] = this.pos[2];
      it.visible = this.visible;
    }
    // lens glow
    const lm = this.lens.model;
    m4.translate(lm, B.foreR, 0, -0.507, -0.03);
    m4.scale(lm, lm, 0.052, 0.006, 0.052);
    this.lens.center = this.boneItems.foreR?.center || this.pos;
    this.lens.visible = this.visible;
    this.lens.emissive = this.flashOn ? 3 : 0;
    void cam;
  }

  // world-space flashlight origin & direction
  flashTransform(outPos, outDir) {
    const m = this.bones.foreR;
    outPos[0] = m[0] * 0 + m[4] * -0.52 + m[8] * -0.03 + m[12];
    outPos[1] = m[1] * 0 + m[5] * -0.52 + m[9] * -0.03 + m[13];
    outPos[2] = m[2] * 0 + m[6] * -0.52 + m[10] * -0.03 + m[14];
    const l = Math.hypot(m[4], m[5], m[6]) || 1;
    outDir[0] = -m[4] / l;
    outDir[1] = -m[5] / l;
    outDir[2] = -m[6] / l;
    if (!this.flashOn) {
      outDir[0] = -Math.sin(this.yaw) * Math.cos(this.pitch);
      outDir[1] = Math.sin(this.pitch);
      outDir[2] = -Math.cos(this.yaw) * Math.cos(this.pitch);
    }
  }

  collect(list) {
    if (!this.visible) return;
    for (const it of this.items) list.push(it);
    list.push(this.lens);
  }
  setSky(s) {
    for (const it of this.items) it.sky = s;
    this.lens.sky = s;
  }
}
