// Procedural PBR-ish material library. Every surface in the game is synthesised at load
// time (albedo + roughness, tangent-space normal), so the build ships no image assets.
import { fbm, worley, vnoiseXY, rand2 } from './noise.js';

export const MAT = {
  CONCRETE: 0,
  CONCRETE_FLOOR: 1,
  PRISON_WALL: 2,
  RUST_METAL: 3,
  TILES: 4,
  WALLPAPER: 5,
  CARPET: 6,
  CEILING_TILES: 7,
  BRICK: 8,
  WOOD: 9,
  ASPHALT: 10,
  DIRT: 11,
  METAL_PLATE: 12,
  SIDING: 13,
  ROOF: 14,
  FABRIC: 15,
  SKIN: 16,
  LAMP: 17,
  PAPER: 18,
  MONSTER: 19,
  PLASTER: 20,
  GRASS: 21,
  PAINTED_METAL: 22,
  BARK: 23,
  HAIR: 24,
  GLASS: 25,
};
export const MAT_COUNT = 26;

// meters per texture repeat for world-space UVs; emissive multipliers; normal strength
export const MAT_INFO = [
  { tile: 2.0, normal: 2.0 }, // CONCRETE
  { tile: 2.0, normal: 2.5 }, // CONCRETE_FLOOR
  { tile: 3.0, normal: 2.0 }, // PRISON_WALL
  { tile: 1.5, normal: 3.0 }, // RUST_METAL
  { tile: 2.0, normal: 3.0 }, // TILES
  { tile: 1.5, normal: 1.0 }, // WALLPAPER
  { tile: 1.5, normal: 2.0 }, // CARPET
  { tile: 2.0, normal: 2.5 }, // CEILING_TILES
  { tile: 2.0, normal: 3.5 }, // BRICK
  { tile: 2.5, normal: 3.0 }, // WOOD
  { tile: 4.0, normal: 2.0 }, // ASPHALT
  { tile: 3.0, normal: 3.0 }, // DIRT
  { tile: 1.0, normal: 4.0 }, // METAL_PLATE
  { tile: 3.0, normal: 3.0 }, // SIDING
  { tile: 2.0, normal: 4.0 }, // ROOF
  { tile: 0.6, normal: 1.5 }, // FABRIC
  { tile: 1.0, normal: 0.6 }, // SKIN
  { tile: 1.0, normal: 0.0, emissive: 6.0 }, // LAMP
  { tile: 1.0, normal: 0.8 }, // PAPER
  { tile: 0.8, normal: 3.0 }, // MONSTER
  { tile: 2.5, normal: 1.5 }, // PLASTER
  { tile: 2.0, normal: 3.0 }, // GRASS
  { tile: 1.5, normal: 1.5 }, // PAINTED_METAL
  { tile: 1.5, normal: 4.0 }, // BARK
  { tile: 0.4, normal: 3.0 }, // HAIR
  { tile: 1.0, normal: 0.2 }, // GLASS
];

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;

// Each generator writes o.r,o.g,o.b (sRGB 0..1), o.rough (0..1), o.h (height 0..1)
function rgb(o, r, g, b) {
  o.r = r; o.g = g; o.b = b;
}

const GEN = [];

GEN[MAT.CONCRETE] = (u, v, o) => {
  const n = fbm(u, v, 4, 5, 1);
  const fine = fbm(u, v, 32, 2, 3);
  const w = worley(u, v, 28, 5);
  const pit = ss(0.12, 0.0, w[0]);
  const stain = ss(0.55, 0.8, fbm(u, v, 3, 4, 9));
  let c = 0.46 + (n - 0.5) * 0.28 + (fine - 0.5) * 0.1 - pit * 0.12;
  rgb(o, c * (1 - stain * 0.25), c * (1 - stain * 0.3), c * (1 - stain * 0.38));
  o.rough = 0.88;
  o.h = n * 0.35 + fine * 0.45 - pit * 0.5;
};

GEN[MAT.CONCRETE_FLOOR] = (u, v, o) => {
  const n = fbm(u, v, 3, 5, 11);
  const fine = fbm(u, v, 48, 2, 12);
  const w = worley(u, v, 4, 21);
  const crack = ss(0.035, 0.0, w[1] - w[0]) * ss(0.4, 0.6, fbm(u, v, 6, 3, 22));
  const wet = ss(0.6, 0.68, fbm(u, v, 2, 4, 33));
  let c = 0.36 + (n - 0.5) * 0.22 + (fine - 0.5) * 0.08;
  c *= 1 - crack * 0.6;
  c *= 1 - wet * 0.35;
  rgb(o, c, c * 0.98, c * 0.95);
  o.rough = mix(0.85, 0.12, wet);
  o.h = n * 0.3 + fine * 0.4 - crack * 0.8 - wet * 0.1;
};

GEN[MAT.PRISON_WALL] = (u, v, o) => {
  const n = fbm(u, v, 4, 4, 41);
  const fine = fbm(u, v, 32, 2, 42);
  const peel = ss(0.64, 0.7, fbm(u, v, 5, 5, 44));
  const streak = vnoiseXY(u * 24, v * 2, 24, 2, 45);
  const grime = ss(0.3, 0.0, v) * 0.35 + streak * 0.25 * (1 - v);
  let r, g, b;
  if (v < 0.4) { r = 0.2; g = 0.31; b = 0.25; }
  else if (v < 0.42) { r = 0.12; g = 0.14; b = 0.12; }
  else { r = 0.6; g = 0.58; b = 0.5; }
  const k = 1 + (n - 0.5) * 0.25 - grime * 0.6;
  r *= k; g *= k; b *= k;
  const conc = 0.4 + (fine - 0.5) * 0.15;
  rgb(o, mix(r, conc, peel), mix(g, conc, peel), mix(b, conc * 0.95, peel));
  o.rough = mix(0.55, 0.92, peel);
  o.h = 0.6 - peel * 0.25 + fine * 0.1 - (v > 0.4 && v < 0.42 ? 0.05 : 0);
};

GEN[MAT.RUST_METAL] = (u, v, o) => {
  const brushed = vnoiseXY(u * 128, v * 4, 128, 4, 51);
  const rustMask = ss(0.45, 0.62, fbm(u, v, 4, 5, 52));
  const fine = fbm(u, v, 32, 3, 53);
  const m = 0.38 + (brushed - 0.5) * 0.1;
  const rr = 0.42 * (0.6 + fine * 0.7), rg = 0.2 * (0.6 + fine * 0.6), rb = 0.09 * (0.6 + fine * 0.5);
  rgb(o, mix(m, rr, rustMask), mix(m * 1.02, rg, rustMask), mix(m * 1.05, rb, rustMask));
  o.rough = mix(0.35, 0.95, rustMask);
  o.h = 0.5 + rustMask * fine * 0.5;
};

GEN[MAT.TILES] = (u, v, o) => {
  const N = 6;
  const tu = fract(u * N), tv = fract(v * N);
  const id = rand2(Math.floor(u * N), Math.floor(v * N), 61);
  const edge = Math.min(tu, 1 - tu, tv, 1 - tv);
  const grout = ss(0.045, 0.02, edge);
  const dirt = fbm(u, v, 4, 4, 62);
  const fine = fbm(u, v, 64, 2, 63);
  const crack = id > 0.85 ? ss(0.02, 0, Math.abs(tu - tv * 0.7 - 0.15)) : 0;
  let c = 0.74 + (id - 0.5) * 0.06 - ss(0.5, 0.9, dirt) * 0.3 + (fine - 0.5) * 0.03;
  const gc = 0.28 + dirt * 0.1;
  c = mix(c, gc, grout) * (1 - crack * 0.5);
  rgb(o, c * 0.98, c, c * 0.97);
  o.rough = mix(0.18 + dirt * 0.3, 0.95, grout);
  o.h = 1 - grout * 0.8 - crack * 0.3 - ss(0.0, 0.1, edge) * 0.0;
};

GEN[MAT.WALLPAPER] = (u, v, o) => {
  const stripe = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 10);
  const motifU = fract(u * 10), motifV = fract(v * 14);
  const diamond = ss(0.12, 0.08, Math.abs(motifU - 0.5) + Math.abs(motifV - 0.5) * 0.7);
  const n = fbm(u, v, 4, 4, 71);
  const damp = ss(0.35, 0.0, v) * ss(0.35, 0.65, fbm(u, v, 3, 4, 72)) + ss(0.62, 0.75, fbm(u, v, 2, 4, 73)) * 0.6;
  let r = 0.74, g = 0.66, b = 0.38;
  const k = 1 - stripe * 0.05 - diamond * 0.07 + (n - 0.5) * 0.12;
  r *= k; g *= k; b *= k;
  rgb(o, mix(r, r * 0.55, damp), mix(g, g * 0.5, damp), mix(b, b * 0.42, damp));
  o.rough = 0.82;
  o.h = 0.5 + diamond * 0.15 - damp * 0.1;
};

GEN[MAT.CARPET] = (u, v, o) => {
  const fib = fbm(u, v, 96, 2, 81);
  const n = fbm(u, v, 3, 4, 82);
  const damp = ss(0.55, 0.7, fbm(u, v, 2, 4, 83));
  const k = 0.88 + (fib - 0.5) * 0.35 + (n - 0.5) * 0.15;
  rgb(o, 0.55 * k * (1 - damp * 0.4), 0.48 * k * (1 - damp * 0.45), 0.3 * k * (1 - damp * 0.5));
  o.rough = mix(0.97, 0.6, damp);
  o.h = fib;
};

GEN[MAT.CEILING_TILES] = (u, v, o) => {
  const N = 2;
  const tu = fract(u * N), tv = fract(v * N);
  const edge = Math.min(tu, 1 - tu, tv, 1 - tv);
  const grid = ss(0.025, 0.015, edge);
  const speck = rand2(Math.floor(u * 256), Math.floor(v * 256), 91) < 0.06 ? 1 : 0;
  const stainN = fbm(u, v, 3, 4, 92);
  const stain = ss(0.6, 0.66, stainN) - ss(0.7, 0.76, stainN) * 0.5;
  let c = 0.78 - speck * 0.12 + (fbm(u, v, 16, 2, 93) - 0.5) * 0.05;
  let r = c, g = c * 0.97, b = c * 0.88;
  r = mix(r, 0.5, stain * 0.6); g = mix(g, 0.42, stain * 0.6); b = mix(b, 0.28, stain * 0.6);
  rgb(o, mix(r, 0.55, grid), mix(g, 0.55, grid), mix(b, 0.56, grid));
  o.rough = mix(0.95, 0.5, grid);
  o.h = 0.7 - speck * 0.2 - grid * 0.5 + ss(0.025, 0.06, edge) * 0.1;
};

GEN[MAT.BRICK] = (u, v, o) => {
  const rows = 8, cols = 4;
  const row = Math.floor(v * rows);
  const off = row % 2 ? 0.5 : 0;
  const bu = fract(u * cols + off), bv = fract(v * rows);
  const id = rand2(Math.floor(u * cols + off) % cols, row, 101);
  const mortar = ss(0.06, 0.03, Math.min(bu, 1 - bu) * 0.5) + ss(0.08, 0.04, Math.min(bv, 1 - bv));
  const m = Math.min(1, mortar);
  const n = fbm(u, v, 8, 4, 102);
  const soot = ss(0.5, 0.8, fbm(u, v, 3, 4, 103));
  const k = 0.85 + (id - 0.5) * 0.35 + (n - 0.5) * 0.25;
  let r = 0.46 * k, g = 0.22 * k, b = 0.15 * k;
  r = mix(r, 0.42, m); g = mix(g, 0.4, m); b = mix(b, 0.36, m);
  rgb(o, r * (1 - soot * 0.5), g * (1 - soot * 0.5), b * (1 - soot * 0.45));
  o.rough = 0.9;
  o.h = 1 - m * 0.7 + n * 0.15;
};

GEN[MAT.WOOD] = (u, v, o) => {
  const planks = 6;
  const p = Math.floor(v * planks);
  const pv = fract(v * planks);
  const id = rand2(p, 0, 111);
  const seam = ss(0.06, 0.0, Math.min(pv, 1 - pv));
  const endSeam = ss(0.008, 0.0, Math.abs(fract(u + id) - 0.5) - 0.49 + 0.01);
  const warp = fbm(u, v, 4, 3, 112);
  const grain = 0.5 + 0.5 * Math.sin((pv * 10 + warp * 8 + id * 20) * Math.PI * 2 + vnoiseXY(u * 8, v * 48, 8, 48, 113) * 3);
  const age = fbm(u, v, 3, 3, 114);
  const k = 0.75 + grain * 0.25 + (id - 0.5) * 0.25;
  let r = 0.42 * k, g = 0.29 * k, b = 0.18 * k;
  const gray = (r + g + b) / 3;
  r = mix(r, gray * 1.05, age * 0.6); g = mix(g, gray, age * 0.6); b = mix(b, gray * 0.95, age * 0.6);
  const s = Math.max(seam, endSeam);
  rgb(o, r * (1 - s * 0.7), g * (1 - s * 0.7), b * (1 - s * 0.7));
  o.rough = 0.72;
  o.h = 0.6 + grain * 0.15 - s * 0.6;
};

GEN[MAT.ASPHALT] = (u, v, o) => {
  const agg = rand2(Math.floor(u * 512), Math.floor(v * 512), 121);
  const n = fbm(u, v, 6, 4, 122);
  const w = worley(u, v, 5, 123);
  const crack = ss(0.03, 0, w[1] - w[0]) * ss(0.45, 0.6, fbm(u, v, 4, 3, 124));
  const wet = ss(0.62, 0.7, fbm(u, v, 2, 3, 125));
  let c = 0.17 + (n - 0.5) * 0.08 + (agg > 0.85 ? 0.08 : 0) - crack * 0.1;
  c *= 1 - wet * 0.4;
  rgb(o, c, c, c * 1.02);
  o.rough = mix(0.85, 0.1, wet);
  o.h = 0.5 + (agg > 0.85 ? 0.2 : 0) - crack * 0.6;
};

GEN[MAT.DIRT] = (u, v, o) => {
  const n = fbm(u, v, 5, 5, 131);
  const w = worley(u, v, 18, 132);
  const pebble = ss(0.35, 0.2, w[0]) * (w[2] > 0.6 ? 1 : 0);
  const grass = ss(0.5, 0.7, fbm(u, v, 3, 4, 133));
  let r = 0.25 + (n - 0.5) * 0.12, g = 0.2 + (n - 0.5) * 0.1, b = 0.14 + (n - 0.5) * 0.08;
  r = mix(r, 0.27, grass); g = mix(g, 0.27, grass); b = mix(b, 0.15, grass);
  r = mix(r, 0.36, pebble); g = mix(g, 0.34, pebble); b = mix(b, 0.31, pebble);
  rgb(o, r, g, b);
  o.rough = 0.95;
  o.h = n * 0.5 + pebble * 0.4;
};

GEN[MAT.METAL_PLATE] = (u, v, o) => {
  const N = 8;
  const a = fract((u + v) * N), b = fract((u - v) * N);
  const bump = ss(0.12, 0.0, Math.abs(a - 0.5) * 0.7 + Math.abs(fract(v * N * 2) - 0.5) * 0.15) * (Math.floor(u * N * 2 + v * N * 2) % 2 ? 1 : 0);
  void b;
  const rust = ss(0.55, 0.7, fbm(u, v, 3, 4, 141));
  const fine = fbm(u, v, 64, 2, 142);
  const m = 0.42 + bump * 0.08 + (fine - 0.5) * 0.06;
  rgb(o, mix(m, 0.38, rust), mix(m, 0.2, rust), mix(m * 1.03, 0.1, rust));
  o.rough = mix(0.38, 0.9, rust);
  o.h = 0.4 + bump * 0.5;
};

GEN[MAT.SIDING] = (u, v, o) => {
  const boards = 10;
  const bv = fract(v * boards);
  const id = rand2(Math.floor(v * boards), 3, 151);
  const lip = ss(0.0, 0.15, bv);
  const peel = ss(0.55, 0.62, fbm(u, v, 6, 5, 152));
  const n = fbm(u, v, 8, 3, 153);
  const grain = vnoiseXY(u * 64, v * 8, 64, 8, 154);
  let pr = 0.56, pg = 0.6, pb = 0.6;
  const k = 0.85 + (n - 0.5) * 0.2 + (id - 0.5) * 0.1;
  pr *= k; pg *= k; pb *= k;
  const wr = 0.35 * (0.8 + grain * 0.3), wg = 0.27 * (0.8 + grain * 0.3), wb = 0.2 * (0.8 + grain * 0.3);
  const shade = 0.75 + lip * 0.25;
  rgb(o, mix(pr, wr, peel) * shade, mix(pg, wg, peel) * shade, mix(pb, wb, peel) * shade);
  o.rough = mix(0.65, 0.85, peel);
  o.h = lip * 0.6 + 0.3 - peel * 0.1;
};

GEN[MAT.ROOF] = (u, v, o) => {
  const rows = 10;
  const r = Math.floor(v * rows);
  const off = r % 2 ? 0.5 : 0;
  const su = fract(u * 6 + off), sv = fract(v * rows);
  const id = rand2(Math.floor(u * 6 + off) % 6, r, 161);
  const gap = ss(0.05, 0.0, Math.min(su, 1 - su)) + ss(0.12, 0.0, sv);
  const n = fbm(u, v, 8, 3, 162);
  const moss = ss(0.6, 0.75, fbm(u, v, 3, 4, 163));
  let c = 0.17 + (id - 0.5) * 0.06 + (n - 0.5) * 0.06;
  rgb(o, mix(c, 0.2, moss) * (1 - gap * 0.5), mix(c, 0.24, moss) * (1 - gap * 0.5), mix(c * 1.05, 0.12, moss) * (1 - gap * 0.5));
  o.rough = 0.9;
  o.h = sv * 0.6 + 0.2 - gap * 0.4;
};

GEN[MAT.FABRIC] = (u, v, o) => {
  const wx = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 64);
  const wy = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 64);
  const check = (Math.floor(u * 64) + Math.floor(v * 64)) % 2;
  const weave = check ? wx : wy;
  const n = fbm(u, v, 4, 3, 171);
  const dirt = ss(0.55, 0.8, fbm(u, v, 3, 3, 172));
  const c = (0.78 + weave * 0.12 + (n - 0.5) * 0.1) * (1 - dirt * 0.25);
  rgb(o, c, c, c);
  o.rough = 0.95;
  o.h = weave * 0.5;
};

GEN[MAT.SKIN] = (u, v, o) => {
  const n = fbm(u, v, 16, 3, 181);
  const c = 0.86 + (n - 0.5) * 0.06;
  rgb(o, c, c, c);
  o.rough = 0.55;
  o.h = n * 0.3;
};

GEN[MAT.LAMP] = (u, v, o) => {
  const n = fbm(u, v, 8, 2, 191);
  rgb(o, 1, 0.98 - n * 0.02, 0.92);
  o.rough = 0.3;
  o.h = 0.5;
};

GEN[MAT.PAPER] = (u, v, o) => {
  const fib = fbm(u, v, 64, 2, 201);
  const stain = ss(0.55, 0.8, fbm(u, v, 3, 4, 202));
  const lines = ss(0.04, 0.0, Math.abs(fract(v * 18) - 0.5) - 0.46) * 0.15;
  const c = 0.86 + (fib - 0.5) * 0.06 - lines;
  rgb(o, c * (1 - stain * 0.15), c * (1 - stain * 0.22), c * (1 - stain * 0.38) * 0.94);
  o.rough = 0.9;
  o.h = fib * 0.3;
};

GEN[MAT.MONSTER] = (u, v, o) => {
  const w = worley(u, v, 10, 211);
  const vein = ss(0.06, 0.0, w[1] - w[0]);
  const n = fbm(u, v, 6, 4, 212);
  const wr = vnoiseXY(u * 6, v * 40, 6, 40, 213);
  const c = 0.6 + (n - 0.5) * 0.3 - wr * 0.12;
  rgb(o, c * (1 - vein * 0.4), c * 0.96 * (1 - vein * 0.5), c * 0.9 * (1 - vein * 0.3));
  o.rough = 0.45;
  o.h = n * 0.4 + wr * 0.4 - vein * 0.3;
};

GEN[MAT.PLASTER] = (u, v, o) => {
  const n = fbm(u, v, 4, 5, 221);
  const fine = fbm(u, v, 32, 2, 222);
  const w = worley(u, v, 3, 223);
  const crack = ss(0.02, 0.0, w[1] - w[0]) * ss(0.5, 0.6, fbm(u, v, 5, 3, 224));
  const damp = ss(0.3, 0.0, v) * ss(0.4, 0.6, fbm(u, v, 3, 4, 225));
  const mold = ss(0.68, 0.78, fbm(u, v, 4, 4, 226));
  let c = 0.62 + (n - 0.5) * 0.12 + (fine - 0.5) * 0.04 - crack * 0.25;
  let r = c, g = c * 0.97, b = c * 0.9;
  r = mix(r, r * 0.6, damp); g = mix(g, g * 0.58, damp); b = mix(b, b * 0.5, damp);
  r = mix(r, 0.22, mold); g = mix(g, 0.25, mold); b = mix(b, 0.2, mold);
  rgb(o, r, g, b);
  o.rough = 0.88;
  o.h = 0.5 + fine * 0.2 - crack * 0.5;
};

GEN[MAT.GRASS] = (u, v, o) => {
  const blades = vnoiseXY(u * 128, v * 24, 128, 24, 231);
  const n = fbm(u, v, 4, 4, 232);
  const dry = ss(0.4, 0.7, fbm(u, v, 3, 3, 233));
  const k = 0.7 + blades * 0.45;
  rgb(o, mix(0.2, 0.36, dry) * k * (0.85 + n * 0.3), mix(0.26, 0.32, dry) * k * (0.85 + n * 0.3), mix(0.12, 0.17, dry) * k);
  o.rough = 0.92;
  o.h = blades * 0.7 + n * 0.3;
};

GEN[MAT.PAINTED_METAL] = (u, v, o) => {
  const chip = ss(0.66, 0.7, fbm(u, v, 8, 4, 241));
  const n = fbm(u, v, 4, 3, 242);
  const scratch = ss(0.03, 0.0, Math.abs(fract(u * 3 + v * 9 + fbm(u, v, 2, 2, 243)) - 0.5)) * 0.3;
  const c = 0.82 + (n - 0.5) * 0.1 - scratch * 0.2;
  // chipped paint reveals bare grey steel (no reddish tones that could read as blood)
  rgb(o, mix(c, 0.3, chip), mix(c, 0.3, chip), mix(c, 0.32, chip));
  o.rough = mix(0.42, 0.75, chip);
  o.h = 0.6 - chip * 0.2;
};

GEN[MAT.BARK] = (u, v, o) => {
  const groove = vnoiseXY(u * 16, v * 3, 16, 3, 251);
  const n = fbm(u, v, 8, 4, 252);
  const k = 0.6 + groove * 0.5 + (n - 0.5) * 0.2;
  rgb(o, 0.23 * k, 0.19 * k, 0.15 * k);
  o.rough = 0.95;
  o.h = groove * 0.8 + n * 0.2;
};

GEN[MAT.HAIR] = (u, v, o) => {
  const strands = vnoiseXY(u * 96, v * 6, 96, 6, 261);
  const c = 0.75 + strands * 0.3;
  rgb(o, c, c, c);
  o.rough = 0.6;
  o.h = strands;
};

GEN[MAT.GLASS] = (u, v, o) => {
  const dirt = ss(0.5, 0.85, fbm(u, v, 4, 4, 271));
  const c = 0.2 + dirt * 0.25;
  rgb(o, c * 0.9, c, c * 1.05);
  o.rough = mix(0.05, 0.6, dirt);
  o.h = 0.5;
};

// Produces RGBA8 albedo (A = roughness) and RGBA8 normal (A = height) buffers.
export function generateMaterial(id, size) {
  const gen = GEN[id];
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const o = { r: 0, g: 0, b: 0, rough: 0.5, h: 0.5 };
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      gen(u, v, o);
      const i = (y * size + x) * 4;
      albedo[i] = Math.max(0, Math.min(255, o.r * 255));
      albedo[i + 1] = Math.max(0, Math.min(255, o.g * 255));
      albedo[i + 2] = Math.max(0, Math.min(255, o.b * 255));
      albedo[i + 3] = Math.max(0, Math.min(255, o.rough * 255));
      height[y * size + x] = o.h;
    }
  }
  const strength = (MAT_INFO[id].normal ?? 2) * (size / 256);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (yc + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz * 0.5 + 0.5) * 255;
      normal[i + 3] = Math.max(0, Math.min(255, height[yc + x] * 255));
    }
  }
  return { albedo, normal };
}

// Generates all materials, in parallel workers when available, then uploads two texture arrays.
export async function buildMaterialArrays(gl, size, onProgress) {
  const results = new Array(MAT_COUNT);
  let done = 0;
  const report = () => onProgress && onProgress(done / MAT_COUNT);

  let workers = [];
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' }));
  } catch (e) {
    workers = [];
  }

  if (workers.length) {
    try {
      await new Promise((resolve, reject) => {
        let next = 0;
        const timeout = setTimeout(() => reject(new Error('texture worker timeout')), 30000);
        const feed = (w) => {
          if (next >= MAT_COUNT) return;
          const id = next++;
          w.postMessage({ id, size });
        };
        for (const w of workers) {
          w.onmessage = (e) => {
            const { id, albedo, normal } = e.data;
            results[id] = { albedo: new Uint8Array(albedo), normal: new Uint8Array(normal) };
            done++;
            report();
            if (done === MAT_COUNT) {
              clearTimeout(timeout);
              resolve();
            } else feed(w);
          };
          w.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
          };
          feed(w);
        }
      });
    } catch (e) {
      console.warn('Texture workers failed, falling back to main thread', e);
    }
    workers.forEach((w) => w.terminate());
  }

  for (let id = 0; id < MAT_COUNT; id++) {
    if (results[id]) continue;
    results[id] = generateMaterial(id, size);
    done++;
    report();
    await new Promise((r) => setTimeout(r, 0));
  }

  const make = (key, srgb) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, size, size, MAT_COUNT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (let i = 0; i < MAT_COUNT; i++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, results[i][key]);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (gl.caps.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, gl.caps.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.caps.maxAniso));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    return t;
  };
  return { albedo: make('albedo', true), normal: make('normal', false), size };
}
