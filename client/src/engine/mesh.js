// Geometry building. Vertex layout (17 floats):
// pos(3) normal(3) tangent(3) uv(2) attr(3: materialLayer, ambientOcclusion, skyExposure) color(3)
import { MAT_INFO } from './textures.js';

export const FLOATS_PER_VERTEX = 17;
const STRIDE = FLOATS_PER_VERTEX * 4;

export class Mesh {
  constructor(gl, vertices, indices, min, max) {
    this.gl = gl;
    this.count = indices.length;
    this.min = min;
    this.max = max;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const attr = (loc, size, offset) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset * 4);
    };
    attr(0, 3, 0);
    attr(1, 3, 3);
    attr(2, 3, 6);
    attr(3, 2, 9);
    attr(4, 3, 11);
    attr(5, 3, 14);
    gl.bindVertexArray(null);
  }
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }
  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

// Box face table: normal, tangent (u direction). bitangent = cross(n, t) (v direction)
const FACES = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], t: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], t: [-1, 0, 0], b: [0, 1, 0] },
];
export const FACE = { PX: 1, NX: 2, PY: 4, NY: 8, PZ: 16, NZ: 32, ALL: 63, SIDES: 1 | 2 | 16 | 32 };
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export class MeshBuilder {
  constructor(capacity = 1024) {
    this.v = new Float32Array(capacity * FLOATS_PER_VERTEX);
    this.vc = 0;
    this.i = [];
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
    this.col = [1, 1, 1];
  }
  // current vertex colour (multiplies the material albedo)
  color(c) {
    this.col = c ? [c[0], c[1], c[2]] : [1, 1, 1];
    return this;
  }
  get vertexCount() {
    return this.vc;
  }
  ensure(n) {
    const need = (this.vc + n) * FLOATS_PER_VERTEX;
    if (need <= this.v.length) return;
    let cap = this.v.length * 2;
    while (cap < need) cap *= 2;
    const nv = new Float32Array(cap);
    nv.set(this.v);
    this.v = nv;
  }
  vertex(p, n, t, u, v, mat, ao = 1, sky = 0) {
    this.ensure(1);
    const o = this.vc * FLOATS_PER_VERTEX;
    const a = this.v;
    a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2];
    a[o + 3] = n[0]; a[o + 4] = n[1]; a[o + 5] = n[2];
    a[o + 6] = t[0]; a[o + 7] = t[1]; a[o + 8] = t[2];
    a[o + 9] = u; a[o + 10] = v;
    a[o + 11] = mat; a[o + 12] = ao; a[o + 13] = sky;
    a[o + 14] = this.col[0]; a[o + 15] = this.col[1]; a[o + 16] = this.col[2];
    for (let k = 0; k < 3; k++) {
      if (p[k] < this.min[k]) this.min[k] = p[k];
      if (p[k] > this.max[k]) this.max[k] = p[k];
    }
    return this.vc++;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  // Quad from 4 corners (CCW seen from the front) with explicit uvs.
  quad(ps, n, t, uvs, mat, aos = null, sky = 0) {
    const base = this.vc;
    for (let k = 0; k < 4; k++) this.vertex(ps[k], n, t, uvs[k][0], uvs[k][1], mat, aos ? aos[k] : 1, sky);
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Axis aligned box. opts: faces (mask), uv: 'world' | 'local', tile, aoFn(p, n), sky (number or fn(p,n)), uvOffset
  box(min, max, mat, opts = {}) {
    const prevCol = this.col;
    if (opts.color) this.col = opts.color;
    const mask = opts.faces ?? FACE.ALL;
    const tile = opts.tile ?? MAT_INFO[mat]?.tile ?? 2;
    const world = (opts.uv ?? 'world') === 'world';
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const h = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
    const p = [0, 0, 0];
    const uo = opts.uvOffset ?? [0, 0];
    for (let f = 0; f < 6; f++) {
      if (!(mask & (1 << f))) continue;
      const F = FACES[f];
      const axisN = F.n[0] ? 0 : F.n[1] ? 1 : 2;
      const axisT = F.t[0] ? 0 : F.t[1] ? 1 : 2;
      const axisB = F.b[0] ? 0 : F.b[1] ? 1 : 2;
      const base = this.vc;
      for (let k = 0; k < 4; k++) {
        const [su, sv] = CORNERS[k];
        p[axisN] = c[axisN] + F.n[axisN] * h[axisN];
        p[axisT] = c[axisT] + F.t[axisT] * h[axisT] * su;
        p[axisB] = c[axisB] + F.b[axisB] * h[axisB] * sv;
        let u, v;
        if (world) {
          u = (p[0] * F.t[0] + p[1] * F.t[1] + p[2] * F.t[2]) / tile + uo[0];
          v = (p[0] * F.b[0] + p[1] * F.b[1] + p[2] * F.b[2]) / tile + uo[1];
        } else {
          u = (su * 0.5 + 0.5) * (opts.uvScale?.[0] ?? 1);
          v = (sv * 0.5 + 0.5) * (opts.uvScale?.[1] ?? 1);
        }
        const ao = opts.aoFn ? opts.aoFn(p, F.n) : opts.ao ?? 1;
        const sky = typeof opts.sky === 'function' ? opts.sky(p, F.n) : opts.sky ?? 0;
        this.vertex(p, F.n, F.t, u, v, mat, ao, sky);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.col = prevCol;
  }
  // Append another builder transformed by a 4x4 matrix (any affine transform). Colours are
  // multiplied by the builder's current colour so prefabs can be tinted.
  append(other, m = null, opts = {}) {
    const base = this.vc;
    this.ensure(other.vc);
    const p = [0, 0, 0], n = [0, 0, 0], t = [0, 0, 0];
    const s = other.v;
    let nm = null;
    if (m) {
      // inverse-transpose of the upper 3x3 for normals
      const a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
      const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
      const det = a00 * b01 + a01 * b11 + a02 * b21 || 1;
      const id = 1 / det;
      nm = [
        b01 * id, b11 * id, b21 * id,
        (-a22 * a01 + a02 * a21) * id, (a22 * a00 - a02 * a20) * id, (-a21 * a00 + a01 * a20) * id,
        (a12 * a01 - a02 * a11) * id, (-a12 * a00 + a02 * a10) * id, (a11 * a00 - a01 * a10) * id,
      ];
    }
    const prev = this.col;
    const tint = this.col;
    const mat = opts.mat ?? null, sky = opts.sky ?? null;
    for (let k = 0; k < other.vc; k++) {
      const o = k * FLOATS_PER_VERTEX;
      if (m) {
        const x = s[o], y = s[o + 1], z = s[o + 2];
        p[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
        p[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        p[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const nx = s[o + 3], ny = s[o + 4], nz = s[o + 5];
        n[0] = nm[0] * nx + nm[1] * ny + nm[2] * nz;
        n[1] = nm[3] * nx + nm[4] * ny + nm[5] * nz;
        n[2] = nm[6] * nx + nm[7] * ny + nm[8] * nz;
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        n[0] /= nl; n[1] /= nl; n[2] /= nl;
        const tx = s[o + 6], ty = s[o + 7], tz = s[o + 8];
        t[0] = m[0] * tx + m[4] * ty + m[8] * tz;
        t[1] = m[1] * tx + m[5] * ty + m[9] * tz;
        t[2] = m[2] * tx + m[6] * ty + m[10] * tz;
        const tl = Math.hypot(t[0], t[1], t[2]) || 1;
        t[0] /= tl; t[1] /= tl; t[2] /= tl;
      } else {
        p[0] = s[o]; p[1] = s[o + 1]; p[2] = s[o + 2];
        n[0] = s[o + 3]; n[1] = s[o + 4]; n[2] = s[o + 5];
        t[0] = s[o + 6]; t[1] = s[o + 7]; t[2] = s[o + 8];
      }
      this.col = [s[o + 14] * tint[0], s[o + 15] * tint[1], s[o + 16] * tint[2]];
      this.vertex(p, n, t, s[o + 9], s[o + 10], mat ?? s[o + 11], s[o + 12], sky ?? s[o + 13]);
    }
    this.col = prev;
    for (const idx of other.i) this.i.push(idx + base);
    return this;
  }
  // Overwrite material/sky of all vertices (useful for prefab reuse)
  setAttr(mat = null, sky = null, color = null) {
    for (let k = 0; k < this.vc; k++) {
      const o = k * FLOATS_PER_VERTEX;
      if (mat !== null) this.v[o + 11] = mat;
      if (sky !== null) this.v[o + 13] = sky;
      if (color) {
        this.v[o + 14] = color[0];
        this.v[o + 15] = color[1];
        this.v[o + 16] = color[2];
      }
    }
    return this;
  }
  // set the sky channel of vertices from `start` (used to store lamp indices)
  setSkyFrom(start, value) {
    for (let k = start; k < this.vc; k++) this.v[k * FLOATS_PER_VERTEX + 13] = value;
  }
  build(gl) {
    if (!this.vc) return null;
    const verts = this.v.subarray(0, this.vc * FLOATS_PER_VERTEX);
    const idx = this.vc > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    return new Mesh(gl, verts, idx, this.min.slice(), this.max.slice());
  }
}

// ------------------------------------------------------------------ primitives (local UVs)
export function cubeBuilder(mat = 0) {
  const b = new MeshBuilder(24);
  b.box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], mat, { uv: 'local' });
  return b;
}

export function cylinderBuilder(mat = 0, seg = 12, caps = true, rTop = 0.5, rBottom = 0.5) {
  const b = new MeshBuilder(seg * 6);
  const slope = rBottom - rTop;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const n0 = norm3([c0, slope, s0]), n1 = norm3([c1, slope, s1]);
    const base = b.vc;
    // tangent points towards decreasing angle so that cross(N, T) is +up (matches v)
    b.vertex([c0 * rBottom, -0.5, s0 * rBottom], n0, [s0, 0, -c0], 1 - i / seg, 0, mat);
    b.vertex([c1 * rBottom, -0.5, s1 * rBottom], n1, [s1, 0, -c1], 1 - (i + 1) / seg, 0, mat);
    b.vertex([c1 * rTop, 0.5, s1 * rTop], n1, [s1, 0, -c1], 1 - (i + 1) / seg, 1, mat);
    b.vertex([c0 * rTop, 0.5, s0 * rTop], n0, [s0, 0, -c0], 1 - i / seg, 1, mat);
    // CCW from outside: base, base+3, base+2 ... (because angle increases towards -tangent when viewed from outside)
    b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  if (caps) {
    for (const [y, r, ny] of [[0.5, rTop, 1], [-0.5, rBottom, -1]]) {
      if (r <= 0) continue;
      const center = b.vertex([0, y, 0], [0, ny, 0], [1, 0, 0], 0.5, 0.5, mat);
      const ring = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(b.vertex([Math.cos(a) * r, y, Math.sin(a) * r], [0, ny, 0], [1, 0, 0], 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, mat));
      }
      for (let i = 0; i < seg; i++) {
        if (ny > 0) b.i.push(center, ring[i + 1], ring[i]);
        else b.i.push(center, ring[i], ring[i + 1]);
      }
    }
  }
  return b;
}

export function sphereBuilder(mat = 0, seg = 12, rings = 8) {
  const b = new MeshBuilder((seg + 1) * (rings + 1));
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const y = -Math.cos(phi) * 0.5, rr = Math.sin(phi) * 0.5;
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      b.vertex([x, y, z], norm3([x, y, z]), [Math.sin(th), 0, -Math.cos(th)], 1 - s / seg, r / rings, mat);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, c = a + seg + 1;
      b.i.push(a, c + 1, a + 1, a, c, c + 1);
    }
  }
  return b;
}

// Capsule along Y: radius r, total height h, centred at origin
export function capsuleBuilder(mat = 0, r = 0.5, h = 2, seg = 12, rings = 6) {
  const b = new MeshBuilder((seg + 1) * (rings * 2 + 2));
  const half = Math.max(0, h / 2 - r);
  const rows = [];
  for (let i = 0; i <= rings; i++) rows.push({ phi: (i / rings) * (Math.PI / 2), y: -half });
  for (let i = 0; i <= rings; i++) rows.push({ phi: Math.PI / 2 + (i / rings) * (Math.PI / 2), y: half });
  rows.forEach((row, ri) => {
    const sy = -Math.cos(row.phi), rr = Math.sin(row.phi);
    for (let s2 = 0; s2 <= seg; s2++) {
      const th = (s2 / seg) * Math.PI * 2;
      const nx = Math.cos(th) * rr, nz = Math.sin(th) * rr;
      b.vertex([nx * r, row.y + sy * r, nz * r], norm3([nx, sy, nz]), [Math.sin(th), 0, -Math.cos(th)], 1 - s2 / seg, ri / (rows.length - 1), mat);
    }
  });
  for (let r2 = 0; r2 < rows.length - 1; r2++) {
    for (let s2 = 0; s2 < seg; s2++) {
      const a = r2 * (seg + 1) + s2, c = a + seg + 1;
      b.i.push(a, c + 1, a + 1, a, c, c + 1);
    }
  }
  return b;
}

// Torus in the XZ plane (ring radius R, tube radius r)
export function torusBuilder(mat = 0, R = 0.4, r = 0.1, seg = 16, side = 8) {
  const b = new MeshBuilder((seg + 1) * (side + 1));
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= side; j++) {
      const v = (j / side) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const n = [cu * cv, sv, su * cv];
      b.vertex([cu * (R + r * cv), r * sv, su * (R + r * cv)], n, [-su, 0, cu], i / seg, j / side, mat);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < side; j++) {
      const a = i * (side + 1) + j, c = a + side + 1;
      b.i.push(a, a + 1, c + 1, a, c + 1, c);
    }
  }
  return b;
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Shared primitive meshes for dynamic objects
export function createPrimitives(gl) {
  return {
    cube: cubeBuilder().build(gl),
    cylinder: cylinderBuilder(0, 14).build(gl),
    cone: cylinderBuilder(0, 12, true, 0.0, 0.5).build(gl),
    sphere: sphereBuilder(0, 14, 10).build(gl),
    lowSphere: sphereBuilder(0, 8, 6).build(gl),
    capsule: capsuleBuilder(0, 0.5, 2, 12, 5).build(gl),
    quad: (() => {
      const b = new MeshBuilder(4);
      b.quad([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [0, 0, 1], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
      return b.build(gl);
    })(),
  };
}
