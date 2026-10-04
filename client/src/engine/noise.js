// Tileable procedural noise used for texture synthesis.

function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

// Periodic value noise; x,y in lattice units, period in lattice cells.
export function vnoise(x, y, period, seed = 0) {
  return vnoiseXY(x, y, period, period, seed);
}

export function vnoiseXY(x, y, px, py, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = mod(xi, px), y0 = mod(yi, py);
  const x1 = mod(xi + 1, px), y1 = mod(yi + 1, py);
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// fbm on u,v in [0,1): base frequency f (integer -> tileable)
export function fbm(u, v, f, octaves = 4, seed = 0, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, freq = f;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(u * freq, v * freq, freq, seed + i * 17) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

// Tileable Worley noise: returns [F1, F2, cellId]
const _w = [0, 0, 0];
export function worley(u, v, f, seed = 0) {
  const x = u * f, y = v * f;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = mod(cx, f), wy = mod(cy, f);
      const px = cx + hash(wx, wy, seed), py = cy + hash(wx, wy, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(wx, wy, seed + 13);
      } else if (d < f2) f2 = d;
    }
  }
  _w[0] = f1; _w[1] = f2; _w[2] = id;
  return _w;
}

export function rand2(x, y, seed = 0) {
  return hash(x | 0, y | 0, seed);
}
