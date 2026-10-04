// Detailed monster models: a skeleton of bones, each bone a single merged mesh (vertex
// coloured), animated procedurally (gait with knee lift, spine, head tracking, attacks).
import { MeshBuilder } from '../engine/mesh.js';
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { m4, clamp, lerp, mulberry32 } from '../engine/math.js';
import { Kit } from './props.js';

const M = MAT;
const SK = {
  warden: { skin: [0.52, 0.54, 0.5], coat: [0.075, 0.075, 0.085], cloth: [0.55, 0.5, 0.4], boot: [0.05, 0.045, 0.045] },
  scarecrow: { sack: [0.5, 0.4, 0.26], coat: [0.17, 0.15, 0.1], straw: [0.75, 0.6, 0.3], wood: [0.35, 0.27, 0.2], pants: [0.16, 0.17, 0.2] },
  moth: { fur: [0.78, 0.74, 0.62], body: [0.45, 0.42, 0.38], wing: [0.42, 0.36, 0.28], band: [0.18, 0.15, 0.12], eye: [1, 0.55, 0.15] },
  nurse: { skin: [0.7, 0.68, 0.64], dress: [0.62, 0.66, 0.62], apron: [0.82, 0.8, 0.74], hair: [0.05, 0.04, 0.04], shoe: [0.12, 0.1, 0.1] },
};

// rig: [name, parent, offset]
export function rig(d) {
  const r = [
    ['root', null, [0, 0, 0]],
    ['pelvis', 'root', [0, d.hip, 0]],
    ['spine', 'pelvis', [0, 0.08, 0]],
    ['chest', 'spine', [0, d.spine, 0]],
    ['neck', 'chest', [0, d.chest, 0.02]],
    ['head', 'neck', [0, d.neck, 0]],
    ['jaw', 'head', [0, 0.02, -0.04]],
  ];
  for (const s of ['L', 'R']) {
    const x = s === 'L' ? -1 : 1;
    r.push(['arm' + s, 'chest', [x * d.shoulder, d.chest - 0.08, 0]]);
    r.push(['fore' + s, 'arm' + s, [0, -d.upper, 0]]);
    r.push(['hand' + s, 'fore' + s, [0, -d.fore, 0]]);
    r.push(['thigh' + s, 'pelvis', [x * d.hipW, -0.02, 0]]);
    r.push(['shin' + s, 'thigh' + s, [0, -d.thigh, 0]]);
    r.push(['foot' + s, 'shin' + s, [0, -d.shin, 0]]);
    if (d.wings) r.push(['wing' + s, 'chest', [x * 0.08, d.chest * 0.75, 0.16]]);
  }
  return r;
}

const DIMS = {
  warden: { hip: 1.22, spine: 0.32, chest: 0.6, neck: 0.3, shoulder: 0.35, upper: 0.62, fore: 0.66, hipW: 0.15, thigh: 0.62, shin: 0.56, hunch: 0.45 },
  scarecrow: { hip: 1.12, spine: 0.26, chest: 0.52, neck: 0.18, shoulder: 0.3, upper: 0.5, fore: 0.5, hipW: 0.13, thigh: 0.56, shin: 0.52, hunch: 0.15 },
  moth: { hip: 1.15, spine: 0.25, chest: 0.42, neck: 0.12, shoulder: 0.2, upper: 0.48, fore: 0.55, hipW: 0.1, thigh: 0.5, shin: 0.6, hunch: 0.3, wings: true },
  nurse: { hip: 1.0, spine: 0.24, chest: 0.48, neck: 0.22, shoulder: 0.2, upper: 0.42, fore: 0.44, hipW: 0.1, thigh: 0.5, shin: 0.48, hunch: 0.2 },
};

// ------------------------------------------------------------------ mesh authoring per bone
function fingers(k, mat, col, n, len, spread, curl, r = 0.018) {
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * spread;
    let p = [x, -0.02, 0];
    let ang = 0;
    for (let s = 0; s < 3; s++) {
      ang += curl;
      const l = len / 3;
      const q = [p[0] + x * 0.15, p[1] - Math.cos(ang) * l, p[2] - Math.sin(ang) * l];
      k.seg(mat, col, p, q, r * (1 - s * 0.2), true);
      p = q;
    }
    k.cone(M.PAINTED_METAL, [0.08, 0.07, 0.06], p[0], p[1] - 0.02, p[2] - 0.01, r * 0.8, 0.05, Math.PI);
  }
}

export const BUILD = {
  warden(K, d) {
    const c = SK.warden;
    const coat = c.coat, coatD = coat.map((v) => v * 0.7);
    // long coat skirt split into flaps
    K.pelvis.box(M.FABRIC, coat, 0, -0.02, 0.0, 0.52, 0.3, 0.36);
    for (let i = 0; i < 8; i++) {
      const a = -0.75 + (i / 7) * 1.5;
      K.pelvis.box(M.FABRIC, i % 2 ? coat : coatD, Math.sin(a) * 0.24, -0.5 - (i % 3) * 0.05, Math.cos(a) * 0.17 - 0.02, 0.17, 0.75 + (i % 2) * 0.12, 0.025, 0.12 * Math.cos(a), a, 0);
    }
    K.pelvis.box(M.FABRIC, [0.06, 0.05, 0.04], 0, 0.12, 0, 0.55, 0.07, 0.38);
    K.pelvis.box(M.PAINTED_METAL, [0.5, 0.42, 0.22], 0, 0.12, -0.195, 0.09, 0.07, 0.02);
    for (let i = 0; i < 5; i++) K.pelvis.box(M.PAINTED_METAL, [0.6, 0.52, 0.32], 0.27, -0.02 - i * 0.025, -0.12 + i * 0.03, 0.015, 0.1, 0.03, 0.3 * i, 0, 0.3);
    K.pelvis.ring(M.PAINTED_METAL, [0.6, 0.52, 0.32], 0.27, 0.05, -0.08, 0.045, 0.006, Math.PI / 2, 0, 0);
    for (let i = 0; i < 10; i++) K.pelvis.ring(M.RUST_METAL, [0.45, 0.42, 0.38], -0.28, -0.05 - i * 0.11, 0.04 + Math.sin(i) * 0.03, 0.033, 0.009, i % 2 ? Math.PI / 2 : 0, 0, Math.PI / 2);
    K.pelvis.cyl(M.PAINTED_METAL, [0.08, 0.08, 0.08], -0.31, 0.02, -0.12, 0.06, 0.03);
    K.pelvis.ball(M.LAMP, [1, 0.58, 0.22], -0.31, -0.09, -0.12, 0.1, 0.14, 0.1);
    for (let i = 0; i < 4; i++) K.pelvis.box(M.PAINTED_METAL, [0.08, 0.08, 0.08], -0.31 + Math.cos(i * 1.57) * 0.055, -0.09, -0.12 + Math.sin(i * 1.57) * 0.055, 0.012, 0.16, 0.012);
    // gaunt torso inside an open coat
    K.spine.caps(M.MONSTER, c.skin.map((v) => v * 0.6), 0, d.spine / 2, 0.02, 0.28, d.spine + 0.12, 0.2);
    K.spine.box(M.FABRIC, coat, -0.2, d.spine / 2, 0, 0.14, d.spine + 0.1, 0.34, 0, 0.15, 0);
    K.spine.box(M.FABRIC, coat, 0.2, d.spine / 2, 0, 0.14, d.spine + 0.1, 0.34, 0, -0.15, 0);
    K.chest.caps(M.MONSTER, [0.16, 0.15, 0.15], 0, d.chest * 0.45, 0.0, 0.34, d.chest * 0.95, 0.26);
    for (let i = 0; i < 7; i++) {
      const y = 0.06 + i * 0.065;
      for (const sx of [-1, 1]) K.chest.box(M.MONSTER, [0.75, 0.73, 0.66], sx * 0.07, y, -0.125 + Math.abs(i - 3) * 0.004, 0.13 - Math.abs(i - 3) * 0.008, 0.022, 0.03, 0, sx * 0.35, sx * -0.25);
    }
    K.chest.box(M.MONSTER, [0.72, 0.7, 0.64], 0, 0.25, -0.13, 0.035, 0.42, 0.03);
    for (const sx of [-1, 1]) {
      K.chest.box(M.FABRIC, coat, sx * 0.21, d.chest * 0.5, 0.02, 0.2, d.chest + 0.02, 0.36, 0, sx * -0.2, 0);
      K.chest.box(M.FABRIC, coatD, sx * 0.12, d.chest * 0.62, -0.17, 0.12, d.chest * 0.7, 0.03, 0.05, sx * -0.5, 0);
      K.chest.ball(M.FABRIC, coat, sx * 0.33, d.chest - 0.06, 0.02, 0.26, 0.22, 0.32);
    }
    K.chest.box(M.PAINTED_METAL, [0.6, 0.5, 0.18], 0.24, d.chest * 0.72, -0.16, 0.06, 0.07, 0.01, 0, -0.2, 0);
    for (let i = 0; i < 7; i++) K.chest.ball(M.MONSTER, c.skin, 0, 0.06 + i * 0.085, 0.2, 0.08, 0.06, 0.07);
    // long crooked neck
    K.neck.caps(M.MONSTER, c.skin, 0, d.neck / 2, 0, 0.13, d.neck + 0.1, 0.12);
    K.neck.ring(M.FABRIC, c.cloth, 0, d.neck * 0.35, 0, 0.07, 0.022, 0.3, 0, 0.2);
    // head: long pale skull, eyes bound with filthy bandages, a maw splitting the face
    K.head.ball(M.MONSTER, c.skin, 0, 0.22, 0.02, 0.36, 0.52, 0.38);
    K.head.ball(M.MONSTER, c.skin.map((v) => v * 0.85), 0, 0.42, 0.05, 0.3, 0.2, 0.32);
    for (let i = 0; i < 4; i++) K.head.ring(M.FABRIC, c.cloth.map((v) => v * (0.75 + i * 0.07)), 0, 0.3 + i * 0.045, 0.02, 0.172 - i * 0.004, 0.024, -0.25 + i * 0.12, 0, (i % 2 ? 0.1 : -0.12));
    K.head.box(M.FABRIC, c.cloth, 0.13, 0.22, 0.14, 0.05, 0.36, 0.012, 0.5, 0.6, 0.35);
    K.head.box(M.FABRIC, c.cloth.map((v) => v * 0.8), -0.1, 0.15, 0.16, 0.04, 0.3, 0.012, 0.4, -0.5, -0.25);
    // vertical maw from chin to brow
    K.head.box(M.PAINTED_METAL, [0.01, 0.0, 0.0], 0, 0.2, -0.185, 0.085, 0.38, 0.04);
    K.head.box(M.LAMP, [0.25, 0.02, 0.0], 0, 0.2, -0.17, 0.04, 0.3, 0.01);
    for (let i = 0; i < 9; i++) {
      const y = 0.04 + i * 0.038;
      const l = 0.04 + Math.sin((i / 8) * Math.PI) * 0.025;
      K.head.cone(M.PAINTED_METAL, [0.86, 0.82, 0.68], -0.04, y, -0.19, 0.011, l, 0, 0, -Math.PI / 2);
      K.head.cone(M.PAINTED_METAL, [0.86, 0.82, 0.68], 0.04, y + 0.015, -0.19, 0.011, l, 0, 0, Math.PI / 2);
    }
    // battered peaked guard cap
    K.head.cyl(M.FABRIC, coatD, 0.0, 0.5, 0.03, 0.2, 0.12, 0.25, 0, 0.12);
    K.head.box(M.PAINTED_METAL, [0.04, 0.04, 0.04], 0.0, 0.45, -0.18, 0.3, 0.02, 0.16, 0.45, 0, 0.12);
    K.head.box(M.PAINTED_METAL, [0.55, 0.45, 0.18], 0.0, 0.53, -0.16, 0.06, 0.05, 0.01, 0.25, 0, 0.12);
    K.jaw.ball(M.MONSTER, c.skin, 0, -0.06, -0.06, 0.24, 0.16, 0.24);
    for (let i = 0; i < 6; i++) K.jaw.cone(M.PAINTED_METAL, [0.86, 0.82, 0.68], -0.075 + i * 0.03, 0.0, -0.17, 0.012, 0.05);
    // arms: sleeves to the elbow, bony forearms, huge clawed hands
    for (const s of ['L', 'R']) {
      K['arm' + s].caps(M.FABRIC, coat, 0, -d.upper / 2, 0, 0.19, d.upper + 0.14, 0.19);
      K['arm' + s].ring(M.FABRIC, coatD, 0, -d.upper + 0.03, 0, 0.1, 0.03);
      K['fore' + s].caps(M.MONSTER, c.skin, 0, -d.fore / 2, 0, 0.095, d.fore + 0.06, 0.09);
      K['fore' + s].ball(M.MONSTER, c.skin, 0, -0.02, 0, 0.12, 0.1, 0.12);
      for (let i = 0; i < 3; i++) K['fore' + s].ring(M.FABRIC, c.cloth.map((v) => v * 0.8), 0, -0.2 - i * 0.06, 0, 0.05, 0.012, 0.2 * i, 0, 0.15);
      K['hand' + s].box(M.MONSTER, c.skin, 0, -0.07, -0.01, 0.15, 0.15, 0.055);
      fingers(K['hand' + s], M.MONSTER, c.skin, 4, 0.42, 0.045, 0.18, 0.017);
      K['hand' + s].seg(M.MONSTER, c.skin, [s === 'L' ? 0.07 : -0.07, -0.05, 0], [s === 'L' ? 0.12 : -0.12, -0.2, -0.06], 0.016, true);
      K['thigh' + s].caps(M.FABRIC, coatD, 0, -d.thigh / 2, 0, 0.2, d.thigh + 0.1, 0.2);
      K['shin' + s].caps(M.FABRIC, coatD, 0, -d.shin / 2, 0, 0.16, d.shin + 0.06, 0.16);
      K['shin' + s].cyl(M.PAINTED_METAL, c.boot, 0, -d.shin + 0.14, 0, 0.095, 0.28);
      K['foot' + s].box(M.PAINTED_METAL, c.boot, 0, -0.03, -0.08, 0.16, 0.11, 0.36);
    }
  },
  scarecrow(K, d) {
    const c = SK.scarecrow;
    K.pelvis.box(M.FABRIC, c.coat, 0, -0.05, 0, 0.42, 0.34, 0.28);
    K.pelvis.ring(M.FABRIC, [0.55, 0.45, 0.3], 0, 0.1, 0, 0.2, 0.02);
    for (let i = 0; i < 9; i++) K.pelvis.box(M.FABRIC, c.coat.map((v) => v * (0.8 + (i % 3) * 0.12)), -0.2 + i * 0.05, -0.38 - (i % 4) * 0.05, (i % 2 ? 0.13 : -0.13), 0.06, 0.45 + (i % 3) * 0.1, 0.015, (i % 2 ? 0.2 : -0.2), 0, (i - 4) * 0.05);
    for (let i = 0; i < 8; i++) K.pelvis.cone(M.GRASS, c.straw, -0.18 + i * 0.05, -0.25, 0.0, 0.025, 0.28, Math.PI + (i % 2 ? 0.3 : -0.3), 0, (i - 4) * 0.08);
    // stake behind the body
    K.spine.cyl(M.BARK, c.wood, 0, 0.6, 0.2, 0.05, 2.1);
    K.spine.cyl(M.BARK, c.wood, 0, 1.05, 0.2, 0.04, 1.6, 0, 0, Math.PI / 2);
    K.spine.caps(M.FABRIC, c.coat, 0, d.spine / 2, 0, 0.36, d.spine + 0.1, 0.26);
    K.chest.box(M.FABRIC, c.coat, 0, d.chest * 0.5, 0, 0.48, d.chest, 0.28);
    K.chest.box(M.FABRIC, [0.4, 0.2, 0.15], -0.12, d.chest * 0.4, -0.145, 0.12, 0.12, 0.01, 0, 0, 0.2);
    K.chest.box(M.FABRIC, [0.2, 0.3, 0.35], 0.14, d.chest * 0.7, -0.145, 0.1, 0.09, 0.01, 0, 0, -0.3);
    for (let i = 0; i < 6; i++) K.chest.box(M.PAINTED_METAL, [0.05, 0.04, 0.03], 0, 0.06 + i * 0.07, -0.146, 0.012, 0.03, 0.005);
    for (let i = 0; i < 10; i++) K.chest.cone(M.GRASS, c.straw, Math.cos(i) * 0.12, d.chest - 0.02, Math.sin(i) * 0.08, 0.02, 0.2, (Math.sin(i * 3) * 0.6), 0, Math.cos(i * 2) * 0.6);
    K.neck.cyl(M.FABRIC, c.sack, 0, d.neck / 2, 0, 0.07, d.neck + 0.06);
    K.neck.ring(M.FABRIC, [0.5, 0.4, 0.25], 0, d.neck * 0.6, 0, 0.08, 0.018);
    // sack head
    K.head.ball(M.FABRIC, c.sack, 0, 0.22, 0, 0.42, 0.46, 0.4);
    K.head.cone(M.FABRIC, c.sack, 0.04, 0.5, 0.04, 0.08, 0.16, 0.3, 0, -0.4);
    K.head.ring(M.FABRIC, [0.5, 0.4, 0.25], 0.0, 0.44, 0.0, 0.07, 0.02, 0.3, 0, -0.2);
    // carved grin glowing from inside, like a lantern
    for (let i = 0; i < 9; i++) {
      const a = -0.95 + i * 0.24;
      const x = Math.sin(a) * 0.17, y = 0.1 - Math.cos(a) * 0.06 + 0.06;
      const h = i % 2 ? 0.07 : 0.035;
      K.head.box(M.LAMP, [1, 0.42, 0.06], x, y + (i % 2 ? 0.01 : -0.01), -0.193 + Math.abs(Math.sin(a)) * 0.035, 0.045, h, 0.01, 0, -Math.sin(a) * 0.7, 0);
    }
    for (let i = 0; i < 12; i++) {
      const a = -1.05 + i * 0.19;
      K.head.box(M.PAINTED_METAL, [0.04, 0.03, 0.02], Math.sin(a) * 0.18, 0.06 - Math.cos(a) * 0.05, -0.197 + Math.abs(Math.sin(a)) * 0.04, 0.008, 0.14, 0.008, 0, -Math.sin(a) * 0.6, 0);
    }
    for (const x of [-0.085, 0.085]) {
      K.head.box(M.PAINTED_METAL, [0.02, 0.01, 0.01], x, 0.29, -0.175, 0.09, 0.08, 0.03, 0, 0, x > 0 ? -0.3 : 0.3);
      K.head.ball(M.LAMP, [1, 0.38, 0.05], x, 0.285, -0.19, 0.04, 0.035, 0.01);
    }
    // drooping hat
    K.head.cyl(M.GRASS, [0.5, 0.42, 0.25], 0, 0.44, 0, 0.42, 0.025, 0.12, 0, 0.1);
    K.head.cone(M.GRASS, [0.5, 0.42, 0.25], 0.02, 0.6, 0.02, 0.18, 0.32, -0.2, 0, 0.15);
    for (const s of ['L', 'R']) {
      K['arm' + s].caps(M.FABRIC, c.coat, 0, -d.upper / 2, 0, 0.15, d.upper + 0.1, 0.15);
      for (let i = 0; i < 4; i++) K['arm' + s].box(M.FABRIC, c.coat, (i - 1.5) * 0.03, -d.upper - 0.05, 0.03, 0.03, 0.18, 0.01, 0.3, 0, 0.1 * i);
      K['fore' + s].cyl(M.BARK, c.wood, 0, -d.fore / 2, 0, 0.03, d.fore);
      for (let i = 0; i < 5; i++) K['fore' + s].cone(M.GRASS, c.straw, 0, -0.05, 0, 0.03, 0.22, Math.PI + Math.sin(i * 2) * 0.6, 0, Math.cos(i * 3) * 0.6);
      fingers(K['hand' + s], M.BARK, c.wood, 3, 0.3, 0.04, 0.35, 0.012);
      K['thigh' + s].caps(M.FABRIC, c.pants, 0, -d.thigh / 2, 0, 0.17, d.thigh + 0.08, 0.17);
      K['thigh' + s].box(M.FABRIC, [0.45, 0.3, 0.2], 0.04, -d.thigh * 0.5, -0.088, 0.09, 0.1, 0.01);
      K['shin' + s].cyl(M.BARK, c.wood, 0, -d.shin / 2, 0, 0.035, d.shin);
      K['shin' + s].caps(M.FABRIC, c.pants, 0, -0.12, 0, 0.15, 0.3, 0.15);
      K['foot' + s].box(M.PAINTED_METAL, [0.2, 0.14, 0.1], 0, -0.03, -0.06, 0.14, 0.09, 0.3);
    }
  },
  moth(K, d) {
    const c = SK.moth;
    // segmented abdomen hanging below
    for (let i = 0; i < 5; i++) K.pelvis.ball(M.HAIR, c.fur.map((v) => v * (1 - i * 0.07)), 0, -0.05 - i * 0.13, 0.1 + i * 0.05, 0.36 - i * 0.05, 0.18, 0.32 - i * 0.04);
    for (let i = 0; i < 4; i++) K.pelvis.ring(M.HAIR, c.band, 0, -0.1 - i * 0.13, 0.12 + i * 0.05, 0.15 - i * 0.025, 0.02, 0.3, 0, 0);
    K.spine.caps(M.HAIR, c.fur, 0, d.spine / 2, 0, 0.3, d.spine + 0.12, 0.26);
    K.chest.ball(M.HAIR, c.fur, 0, d.chest * 0.5, 0, 0.5, d.chest + 0.15, 0.42);
    K.chest.ball(M.HAIR, [0.88, 0.85, 0.75], 0, d.chest * 0.9, -0.05, 0.56, 0.2, 0.46);
    K.neck.cyl(M.MONSTER, c.body, 0, d.neck / 2, 0, 0.06, d.neck + 0.04);
    K.head.ball(M.HAIR, c.fur, 0, 0.12, 0, 0.3, 0.28, 0.28);
    for (const x of [-0.1, 0.1]) {
      K.head.ball(M.LAMP, c.eye, x, 0.14, -0.08, 0.16, 0.2, 0.15);
      K.head.ball(M.PAINTED_METAL, [0.05, 0.02, 0.0], x * 1.05, 0.14, -0.14, 0.05, 0.06, 0.03);
    }
    // feathered antennae
    for (const s of [-1, 1]) {
      const a = [s * 0.06, 0.25, -0.08], b = [s * 0.25, 0.6, -0.15];
      K.head.seg(M.HAIR, c.band, a, b, 0.008, true);
      for (let i = 1; i < 8; i++) {
        const t = i / 8;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        K.head.seg(M.HAIR, c.band, p, [p[0] + s * 0.05, p[1] + 0.02, p[2] - 0.03], 0.004, true);
        K.head.seg(M.HAIR, c.band, p, [p[0] - s * 0.03, p[1] + 0.05, p[2] - 0.02], 0.004, true);
      }
    }
    K.jaw.ring(M.MONSTER, [0.2, 0.15, 0.1], 0, -0.02, -0.1, 0.035, 0.008, Math.PI / 2, 0, 0);
    // insect arms (two pairs merged into arm/fore) and dangling legs
    for (const s of ['L', 'R']) {
      K['arm' + s].seg(M.MONSTER, c.body, [0, 0, 0], [0, -d.upper, 0], 0.025, true);
      K['arm' + s].ball(M.HAIR, c.fur, 0, -0.02, 0, 0.1, 0.1, 0.1);
      K['fore' + s].seg(M.MONSTER, c.body, [0, 0, 0], [0, -d.fore, 0], 0.02, true);
      K['fore' + s].ball(M.MONSTER, c.body, 0, 0, 0, 0.05, 0.05, 0.05);
      fingers(K['hand' + s], M.MONSTER, [0.2, 0.17, 0.14], 2, 0.2, 0.05, 0.5, 0.01);
      K['thigh' + s].seg(M.MONSTER, c.body, [0, 0, 0], [0, -d.thigh, 0], 0.022, true);
      K['shin' + s].seg(M.MONSTER, c.body, [0, 0, 0], [0, -d.shin, 0], 0.016, true);
      K['shin' + s].ball(M.MONSTER, c.body, 0, 0, 0, 0.04, 0.04, 0.04);
      K['foot' + s].cone(M.MONSTER, [0.15, 0.12, 0.1], 0, -0.04, 0, 0.015, 0.1, Math.PI);
      const sx = s === 'L' ? -1 : 1;
      const W = K['wing' + s];
      W.ball(M.MONSTER, c.wing, sx * 0.85, 0.25, 0, 1.6, 1.15, 0.025, 0, 0, sx * -0.25);
      W.ball(M.MONSTER, c.wing.map((v) => v * 0.8), sx * 0.6, -0.45, 0.02, 1.0, 0.75, 0.02, 0, 0, sx * 0.35);
      for (let i = 0; i < 3; i++) W.ball(M.MONSTER, c.band, sx * (0.45 + i * 0.35), 0.3 - i * 0.02, -0.014, 0.08, 0.9 - i * 0.2, 0.01, 0, 0, sx * -0.3);
      W.ball(M.PAINTED_METAL, [0.1, 0.07, 0.05], sx * 0.95, 0.35, -0.016, 0.42, 0.42, 0.01);
      W.ball(M.LAMP, [0.95, 0.5, 0.12], sx * 0.95, 0.35, -0.02, 0.3, 0.3, 0.01);
      W.ball(M.PAINTED_METAL, [0.02, 0.02, 0.02], sx * 0.95, 0.35, -0.024, 0.13, 0.13, 0.01);
    }
  },
  nurse(K, d) {
    const c = SK.nurse;
    // long uniform dress, stained apron
    K.pelvis.cone(M.FABRIC, c.dress, 0, -0.42, 0, 0.36, 0.95);
    K.pelvis.caps(M.FABRIC, c.dress, 0, -0.05, 0, 0.32, 0.3, 0.24);
    K.pelvis.box(M.FABRIC, c.apron, 0, -0.38, -0.16, 0.34, 0.75, 0.02, 0.12);
    for (let i = 0; i < 4; i++) K.pelvis.box(M.FABRIC, mulC(c.apron, 0.6), -0.1 + i * 0.07, -0.55 - i * 0.04, -0.17 - i * 0.01, 0.05, 0.18, 0.005, 0.12);
    K.pelvis.ring(M.FABRIC, c.apron, 0, 0.06, 0, 0.16, 0.02);
    K.spine.caps(M.FABRIC, c.dress, 0, d.spine / 2, 0, 0.28, d.spine + 0.12, 0.2);
    K.chest.caps(M.FABRIC, c.dress, 0, d.chest * 0.5, 0, 0.34, d.chest + 0.08, 0.22);
    K.chest.box(M.FABRIC, c.apron, 0, d.chest * 0.42, -0.105, 0.24, d.chest * 0.75, 0.01);
    K.chest.box(M.PAINTED_METAL, [0.55, 0.08, 0.06], 0.08, d.chest * 0.72, -0.115, 0.045, 0.045, 0.004);
    K.chest.box(M.PAINTED_METAL, [0.55, 0.08, 0.06], 0.08, d.chest * 0.72, -0.115, 0.015, 0.07, 0.004);
    for (const x of [-0.17, 0.17]) K.chest.ball(M.FABRIC, c.dress, x, d.chest - 0.05, 0, 0.15, 0.13, 0.18);
    K.neck.caps(M.SKIN, c.skin, 0, d.neck / 2, 0, 0.08, d.neck + 0.06, 0.08);
    // bowed head, long black hair hanging over the face, cap
    K.head.ball(M.SKIN, c.skin, 0, 0.14, 0, 0.22, 0.28, 0.24);
    K.head.ball(M.HAIR, c.hair, 0, 0.19, 0.02, 0.25, 0.27, 0.27);
    for (let i = 0; i < 18; i++) {
      const a = Math.PI + (i / 17 - 0.5) * 2.6;
      const x = Math.sin(a) * 0.12, z = Math.cos(a) * 0.12;
      const len = 0.42 + ((i * 7) % 5) * 0.05;
      K.head.seg(M.HAIR, c.hair, [x, 0.22, z], [x * 1.15, 0.22 - len, z * 1.1 - 0.03], 0.016, true);
    }
    for (let i = 0; i < 8; i++) K.head.seg(M.HAIR, c.hair, [Math.sin(i) * 0.1, 0.2, 0.1], [Math.sin(i) * 0.12, -0.25, 0.14], 0.02, true);
    K.head.box(M.FABRIC, c.apron, 0, 0.36, 0.02, 0.2, 0.08, 0.14, -0.25);
    K.head.box(M.PAINTED_METAL, [0.55, 0.08, 0.06], 0, 0.37, -0.055, 0.04, 0.04, 0.004, -0.25);
    // one pale eye glinting through the hair
    K.head.ball(M.LAMP, [0.75, 0.85, 0.9], 0.05, 0.13, -0.235, 0.025, 0.018, 0.01);
    for (const s of ['L', 'R']) {
      K['arm' + s].caps(M.FABRIC, c.dress, 0, -d.upper / 2, 0, 0.1, d.upper + 0.06, 0.1);
      K['fore' + s].caps(M.SKIN, c.skin, 0, -d.fore / 2, 0, 0.07, d.fore + 0.04, 0.07);
      K['fore' + s].ring(M.FABRIC, c.apron, 0, -0.02, 0, 0.045, 0.012);
      K['hand' + s].box(M.SKIN, c.skin, 0, -0.04, 0, 0.075, 0.09, 0.035);
      fingers(K['hand' + s], M.SKIN, c.skin, 4, 0.24, 0.02, 0.12, 0.009);
      K['thigh' + s].caps(M.FABRIC, c.dress, 0, -d.thigh / 2, 0, 0.11, d.thigh + 0.04, 0.11);
      K['shin' + s].caps(M.SKIN, [0.75, 0.73, 0.7], 0, -d.shin / 2, 0, 0.075, d.shin + 0.02, 0.075);
      K['foot' + s].box(M.PAINTED_METAL, c.shoe, 0, -0.03, -0.05, 0.085, 0.07, 0.2);
    }
    K.handR.ring(M.PAINTED_METAL, [0.55, 0.45, 0.28], 0, -0.17, 0.02, 0.05, 0.007, 0.3, 0, 0);
  },
};

function mulC(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export class MonsterModel {
  constructor(game, type) {
    this.type = type;
    this.game = game;
    this.d = DIMS[type];
    this.rig = rig(this.d);
    this.bones = {};
    this.items = [];
    const builders = {};
    for (const [name] of this.rig) {
      builders[name] = new MeshBuilder(1024);
      this.bones[name] = m4.create();
    }
    const K = {};
    for (const name of Object.keys(builders)) K[name] = new Kit(builders[name]);
    BUILD[type](K, this.d);
    this.boneItems = {};
    for (const [name] of this.rig) {
      const mesh = builders[name].build(game.gl);
      if (!mesh) continue;
      const it = new DrawItem(mesh, -1, [1, 1, 1]);
      it.radius = 2.5;
      it.castShadow = true;
      this.items.push(it);
      this.boneItems[name] = it;
    }
    this.pose = {};
    for (const [name] of this.rig) this.pose[name] = [0, 0, 0];
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.phase = 0;
    this.time = Math.random() * 10;
    this.jaw = 0;
    this.visible = true;
    this.lastPos = null;
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    this.twitch = [0, 0, 0];
    this.twitchT = 0;
    this.dim = 1;
  }

  // st: {speed, state, frozen, attack, duck, lookAt:[x,y,z]|null, chase}
  animate(dt, st) {
    const d = this.d;
    const P = this.pose;
    this.time += dt;
    const t = this.time;
    // stride from real displacement so feet don't slide
    let moved = 0;
    if (this.lastPos) moved = Math.hypot(this.pos[0] - this.lastPos[0], this.pos[2] - this.lastPos[1]);
    this.lastPos = [this.pos[0], this.pos[2]];
    if (moved > 1) moved = 0; // teleport/snap
    const stride = { warden: 1.5, scarecrow: 1.3, moth: 2.4, nurse: 1.0 }[this.type];
    if (!st.frozen) this.phase += (moved / stride) * Math.PI;
    const sp = st.frozen ? 0 : clamp(st.speed / 4, 0, 1.2);
    const ph = this.phase;
    const s = Math.sin(ph), cph = Math.cos(ph);
    for (const k of Object.keys(P)) P[k][0] = P[k][1] = P[k][2] = 0;
    // random twitches (scarier when hunting)
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = (st.chase ? 0.15 : 0.6) + this.rnd() * 1.5;
      this.twitch = [(this.rnd() - 0.5) * 0.5, (this.rnd() - 0.5) * 0.9, (this.rnd() - 0.5) * 0.7];
    }
    const tw = this.twitch;
    const att = st.attack || 0;
    const duck = st.duck || 0;
    let hipY = d.hip;
    const hunch = d.hunch + duck * 0.5;
    switch (this.type) {
      case 'warden': {
        hipY += -Math.abs(cph) * 0.05 * sp - duck * 0.3;
        P.pelvis[1] = s * 0.12 * sp;
        P.pelvis[2] = cph * 0.05 * sp;
        P.spine[0] = -hunch - 0.15 * sp;
        P.chest[0] = -0.25 - att * 0.5;
        P.chest[1] = -s * 0.15 * sp;
        P.neck[0] = 0.35 + duck * 0.3;
        P.head[2] = st.state === 'listen' ? Math.sin(t * 1.3) * 0.5 + tw[2] * 0.6 : tw[2] * 0.3;
        P.head[0] = 0.2 + tw[0] * 0.3;
        for (const [side, k] of [['L', 1], ['R', -1]]) {
          const sw = k * s;
          P['thigh' + side][0] = sw * 0.5 * sp + duck * 0.6;
          P['shin' + side][0] = -(Math.max(0, k * cph) * 0.9 * sp) - 0.15 - duck * 1.0;
          P['foot' + side][0] = 0.15;
          P['arm' + side][0] = -sw * 0.35 * sp + 0.25 + att * 2.0;
          P['arm' + side][2] = k * 0.15 + (st.chase ? k * 0.25 : 0);
          P['fore' + side][0] = 0.35 + att * 0.4 + Math.sin(t * 1.7 + k) * 0.05;
          P['hand' + side][0] = 0.2;
        }
        break;
      }
      case 'scarecrow': {
        // stiff, jerky glide with arms spread like on its post
        hipY += Math.abs(Math.sin(t * 18)) * 0.03 * sp - duck * 0.25;
        P.pelvis[1] = s * 0.08 * sp + tw[1] * 0.1 * sp;
        P.spine[0] = -hunch - 0.1 * sp - duck * 0.3;
        P.chest[2] = tw[2] * 0.15;
        P.neck[2] = 0.45 + (st.frozen ? 0 : Math.sin(t * 9) * 0.1);
        P.head[1] = st.frozen ? tw[1] * 0.4 : tw[1];
        P.head[0] = 0.15 + tw[0];
        for (const [side, k] of [['L', 1], ['R', -1]]) {
          const sw = k * s;
          P['thigh' + side][0] = sw * 0.35 * sp + duck * 0.5;
          P['shin' + side][0] = -0.1 - duck * 0.8;
          P['arm' + side][2] = k * (1.35 - att * 0.8) + (st.frozen ? 0 : Math.sin(t * 7 + k) * 0.08);
          P['arm' + side][0] = att * 1.6;
          P['fore' + side][0] = 0.15 + tw[0] * 0.3;
          P['fore' + side][2] = k * 0.2;
        }
        break;
      }
      case 'moth': {
        const flap = Math.sin(t * (st.chase ? 15 : 8));
        hipY += 0.45 + Math.sin(t * 2.3) * 0.12 - duck * 0.2;
        P.spine[0] = -0.35 - 0.3 * sp - att * 0.5;
        P.chest[0] = -0.1;
        P.neck[0] = 0.3;
        P.head[2] = tw[2] * 0.4;
        P.head[0] = 0.2 + tw[0] * 0.2;
        for (const [side, k] of [['L', 1], ['R', -1]]) {
          P['wing' + side][1] = k * (0.35 + flap * 0.55) * (1 - duck * 0.6);
          P['wing' + side][2] = k * flap * 0.15;
          P['arm' + side][0] = 1.1 + Math.sin(t * 3 + k) * 0.2 + att * 1.4;
          P['arm' + side][2] = k * 0.4;
          P['fore' + side][0] = -1.2 + Math.sin(t * 4 + k) * 0.2 - att * 0.6;
          P['thigh' + side][0] = 0.3 + Math.sin(t * 2 + k) * 0.15;
          P['thigh' + side][2] = k * 0.15;
          P['shin' + side][0] = -0.6 + Math.sin(t * 2.4 + k) * 0.2;
        }
        break;
      }
      case 'nurse': {
        // gliding, head lolling to the side, sudden snaps
        hipY += -Math.abs(cph) * 0.03 * sp - duck * 0.2;
        P.pelvis[1] = s * 0.1 * sp;
        P.spine[0] = -hunch - 0.2 * sp;
        P.neck[2] = 0.7 + tw[2] * 0.3;
        P.neck[0] = 0.4;
        P.head[0] = 0.3 + tw[0] * 0.4;
        P.head[1] = tw[1] * 0.5;
        for (const [side, k] of [['L', 1], ['R', -1]]) {
          const sw = k * s;
          P['thigh' + side][0] = sw * 0.4 * sp;
          P['shin' + side][0] = -(Math.max(0, k * cph) * 0.6 * sp) - 0.05;
          P['arm' + side][0] = (st.chase ? 1.2 : 0.1) + att * 1.5 - sw * 0.15 * sp;
          P['arm' + side][2] = k * 0.08;
          P['fore' + side][0] = st.chase ? 0.3 : 0.1;
        }
        break;
      }
      default:
        break;
    }
    // look at target
    if (st.lookAt && !st.frozen) {
      const dx = st.lookAt[0] - this.pos[0], dz = st.lookAt[2] - this.pos[2];
      let rel = Math.atan2(-dx, -dz) - this.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      P.head[1] += clamp(rel, -1.0, 1.0) * 0.7;
      P.neck[1] += clamp(rel, -1.0, 1.0) * 0.3;
    }
    this.jaw = lerp(this.jaw, st.chase || att > 0 ? 0.5 + Math.sin(t * 10) * 0.15 : 0.05, 1 - Math.exp(-8 * dt));
    P.jaw[0] = this.jaw;
    this.buildMatrices(hipY);
  }

  buildMatrices(hipY) {
    const B = this.bones;
    for (const [name, parent, off] of this.rig) {
      const m = B[name];
      if (!parent) {
        m4.identity(m);
        m4.translate(m, m, this.pos[0], this.pos[1], this.pos[2]);
        m4.rotateY(m, m, this.yaw);
      } else {
        const y = name === 'pelvis' ? hipY : off[1];
        m4.translate(m, B[parent], off[0], y, off[2]);
      }
      const r = this.pose[name];
      if (r[1]) m4.rotateY(m, m, r[1]);
      if (r[0]) m4.rotateX(m, m, r[0]);
      if (r[2]) m4.rotateZ(m, m, r[2]);
    }
    for (const [name, it] of Object.entries(this.boneItems)) {
      m4.copy(it.model, B[name]);
      it.center[0] = this.pos[0];
      it.center[1] = this.pos[1] + 1.2;
      it.center[2] = this.pos[2];
      it.visible = this.visible;
      it.tint[0] = it.tint[1] = it.tint[2] = this.dim;
    }
  }

  setSky(s) {
    for (const it of this.items) it.sky = s;
  }

  headPos(out = [0, 0, 0]) {
    const m = this.bones.head;
    out[0] = m[12];
    out[1] = m[13] + 0.15;
    out[2] = m[14];
    return out;
  }

  collect(list) {
    if (!this.visible) return;
    for (const it of this.items) list.push(it);
  }
}

export const MONSTER_DIMS = DIMS;
