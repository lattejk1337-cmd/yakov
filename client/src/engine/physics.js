// Collision world of axis-aligned boxes in a uniform grid; character controller (vertical
// cylinder with step-up), rigid "prop" spheres with bounce/friction, ray casts.

export class PhysicsWorld {
  constructor(cellSize = 4) {
    this.cell = cellSize;
    this.boxes = [];
    this.grid = new Map();
    this.queryStamp = 0;
    this._result = [];
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  // box: {min:[x,y,z], max:[x,y,z], solid:true, blocksSight:true, tag, enabled:true}
  add(box) {
    box.enabled = box.enabled ?? true;
    box.solid = box.solid ?? true;
    box.blocksSight = box.blocksSight ?? true;
    box.blocksMonster = box.blocksMonster ?? true;
    box._stamp = 0;
    this.boxes.push(box);
    const c = this.cell;
    for (let ix = Math.floor(box.min[0] / c); ix <= Math.floor(box.max[0] / c); ix++) {
      for (let iz = Math.floor(box.min[2] / c); iz <= Math.floor(box.max[2] / c); iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(box);
      }
    }
    return box;
  }
  query(minX, minZ, maxX, maxZ) {
    const out = this._result;
    out.length = 0;
    const stamp = ++this.queryStamp;
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const b of list) {
          if (b._stamp === stamp || !b.enabled) continue;
          b._stamp = stamp;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Character move: body {pos:[x,y,z] (feet), vel, radius, height, onGround, stepHeight}
  moveCharacter(body, dx, dy, dz, opts = {}) {
    const r = body.radius;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.5)));
    const sx = dx / steps, sz = dz / steps;
    for (let s = 0; s < steps; s++) {
      body.pos[0] += sx;
      body.pos[2] += sz;
      this.resolveHorizontal(body, opts);
    }
    // vertical
    body.pos[1] += dy;
    body.onGround = false;
    const p = body.pos;
    const boxes = this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r);
    for (const b of boxes) {
      if (!b.solid || (opts.monster && !b.blocksMonster)) continue;
      if (!circleRect(p[0], p[2], r * 0.9, b)) continue;
      const top = b.max[1], bottom = b.min[1];
      if (p[1] < top && p[1] + body.height > bottom) {
        if (dy <= 0 && p[1] > top - 0.6) {
          p[1] = top;
          body.vel && (body.vel[1] = Math.max(0, body.vel[1]));
          body.onGround = true;
        } else if (dy > 0 && p[1] + body.height < bottom + 0.5) {
          p[1] = bottom - body.height;
          body.vel && (body.vel[1] = Math.min(0, body.vel[1]));
        }
      }
    }
    if (p[1] <= (opts.floorY ?? 0)) {
      p[1] = opts.floorY ?? 0;
      if (body.vel) body.vel[1] = Math.max(0, body.vel[1]);
      body.onGround = true;
    }
  }

  resolveHorizontal(body, opts) {
    const p = body.pos, r = body.radius;
    const stepH = body.stepHeight ?? 0.45;
    for (let iter = 0; iter < 3; iter++) {
      const boxes = this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r);
      let pushed = false;
      for (const b of boxes) {
        if (!b.solid || (opts.monster && !b.blocksMonster)) continue;
        // vertical overlap with body
        if (b.max[1] <= p[1] + 0.001 || b.min[1] >= p[1] + body.height) continue;
        // step up onto low obstacles
        if (b.max[1] - p[1] <= stepH && body.onGround !== false) {
          if (circleRect(p[0], p[2], r, b) && !this.blockedAbove(body, b.max[1], opts)) {
            p[1] = b.max[1];
            continue;
          }
        }
        const cx = Math.max(b.min[0], Math.min(p[0], b.max[0]));
        const cz = Math.max(b.min[2], Math.min(p[2], b.max[2]));
        let ox = p[0] - cx, oz = p[2] - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {
          // center inside box: push out along smallest axis
          const l = p[0] - b.min[0], rr = b.max[0] - p[0], f = p[2] - b.min[2], bk = b.max[2] - p[2];
          const m = Math.min(l, rr, f, bk);
          if (m === l) p[0] = b.min[0] - r;
          else if (m === rr) p[0] = b.max[0] + r;
          else if (m === f) p[2] = b.min[2] - r;
          else p[2] = b.max[2] + r;
        } else {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-4;
          p[0] += (ox / d) * push;
          p[2] += (oz / d) * push;
        }
        pushed = true;
      }
      if (!pushed) break;
    }
  }

  blockedAbove(body, newY, opts) {
    const p = body.pos, r = body.radius;
    const boxes = this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r);
    for (const b of boxes) {
      if (!b.solid || (opts.monster && !b.blocksMonster)) continue;
      if (!circleRect(p[0], p[2], r, b)) continue;
      if (b.min[1] < newY + body.height && b.max[1] > newY + 0.01 && b.min[1] > p[1] + 0.01) return true;
    }
    return false;
  }

  // Ceiling check for standing up from crouch
  headroom(pos, radius, fromY, toY) {
    const boxes = this.query(pos[0] - radius, pos[2] - radius, pos[0] + radius, pos[2] + radius);
    for (const b of boxes) {
      if (!b.solid) continue;
      if (!circleRect(pos[0], pos[2], radius, b)) continue;
      if (b.min[1] < toY && b.max[1] > fromY) return false;
    }
    return true;
  }

  // Ray cast. Returns {t, box, normal} or null. filter(box) -> boolean to consider.
  raycast(origin, dir, maxDist, filter = null) {
    const ex = origin[0] + dir[0] * maxDist, ez = origin[2] + dir[2] * maxDist;
    const boxes = this.query(Math.min(origin[0], ex), Math.min(origin[2], ez), Math.max(origin[0], ex), Math.max(origin[2], ez));
    let best = maxDist, hit = null, nAxis = 0, nSign = 0;
    for (const b of boxes) {
      if (filter ? !filter(b) : !b.solid) continue;
      let tmin = 0, tmax = best, axis = -1, sign = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const o = origin[a], d = dir[a];
        if (Math.abs(d) < 1e-9) {
          if (o < b.min[a] || o > b.max[a]) { ok = false; break; }
          continue;
        }
        let t1 = (b.min[a] - o) / d, t2 = (b.max[a] - o) / d;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok || tmin >= best) continue;
      best = tmin;
      hit = b;
      nAxis = axis;
      nSign = sign;
    }
    if (!hit) return null;
    const normal = [0, 0, 0];
    if (nAxis >= 0) normal[nAxis] = nSign;
    return { t: best, box: hit, normal };
  }

  lineOfSight(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) return true;
    d[0] /= len; d[1] /= len; d[2] /= len;
    return !this.raycast(a, d, len - 0.05, (bx) => bx.blocksSight);
  }
}

export function circleRect(x, z, r, b) {
  const cx = Math.max(b.min[0], Math.min(x, b.max[0]));
  const cz = Math.max(b.min[2], Math.min(z, b.max[2]));
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

// Small rigid props (bottles, cans, boxes) simulated as spheres against the world.
export class Prop {
  constructor(id, pos, radius = 0.12, kind = 'bottle') {
    this.id = id;
    this.kind = kind;
    this.pos = pos.slice();
    this.vel = [0, 0, 0];
    this.radius = radius;
    this.rot = [0, Math.random() * 6.28, 0];
    this.angVel = [0, 0, 0];
    this.sleeping = true;
    this.held = false;
    this.impactCb = null;
  }
  step(world, dt) {
    if (this.sleeping || this.held) return;
    const g = -9.81;
    this.vel[1] += g * dt;
    const p = this.pos, v = this.vel, r = this.radius;
    for (let a = 0; a < 3; a++) p[a] += v[a] * dt;
    // world collisions
    const boxes = world.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r);
    for (const b of boxes) {
      if (!b.solid) continue;
      const cx = Math.max(b.min[0], Math.min(p[0], b.max[0]));
      const cy = Math.max(b.min[1], Math.min(p[1], b.max[1]));
      const cz = Math.max(b.min[2], Math.min(p[2], b.max[2]));
      let nx = p[0] - cx, ny = p[1] - cy, nz = p[2] - cz;
      const d2 = nx * nx + ny * ny + nz * nz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        nx = 0; ny = 1; nz = 0; d = 0;
      } else {
        nx /= d; ny /= d; nz /= d;
      }
      const pen = r - d;
      p[0] += nx * pen; p[1] += ny * pen; p[2] += nz * pen;
      this.bounce(nx, ny, nz);
    }
    if (p[1] < r) {
      p[1] = r;
      this.bounce(0, 1, 0);
    }
    // spin
    for (let a = 0; a < 3; a++) {
      this.rot[a] += this.angVel[a] * dt;
      this.angVel[a] *= Math.exp(-1.5 * dt);
    }
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (speed < 0.08 && Math.abs(v[1]) < 0.1) {
      this.restTime = (this.restTime || 0) + dt;
      if (this.restTime > 0.4) {
        this.sleeping = true;
        v[0] = v[1] = v[2] = 0;
        // lie on the side for bottles
        this.rot[0] = this.kind === 'bottle' || this.kind === 'can' ? Math.PI / 2 : 0;
        this.rot[2] = 0;
      }
    } else this.restTime = 0;
  }
  bounce(nx, ny, nz) {
    const v = this.vel;
    const vn = v[0] * nx + v[1] * ny + v[2] * nz;
    if (vn >= 0) return;
    const restitution = this.kind === 'box' ? 0.15 : 0.35;
    const friction = 0.82;
    // reflect normal component, damp tangential
    v[0] -= (1 + restitution) * vn * nx;
    v[1] -= (1 + restitution) * vn * ny;
    v[2] -= (1 + restitution) * vn * nz;
    const tn = v[0] * nx + v[1] * ny + v[2] * nz;
    v[0] = (v[0] - tn * nx) * friction + tn * nx;
    v[1] = (v[1] - tn * ny) * friction + tn * ny;
    v[2] = (v[2] - tn * nz) * friction + tn * nz;
    this.angVel[0] += (Math.random() - 0.5) * 8 * Math.min(1, -vn);
    this.angVel[2] += (Math.random() - 0.5) * 8 * Math.min(1, -vn);
    if (-vn > 1.2 && this.impactCb) this.impactCb(this, -vn);
  }
  throw(from, dir, speed) {
    this.pos = from.slice();
    this.vel = [dir[0] * speed, dir[1] * speed + 1.5, dir[2] * speed];
    this.angVel = [Math.random() * 10 - 5, Math.random() * 4 - 2, Math.random() * 10 - 5];
    this.sleeping = false;
    this.held = false;
    this.restTime = 0;
  }
  kick(dir, strength) {
    this.vel[0] += dir[0] * strength;
    this.vel[1] += 1.2 * Math.min(1, strength / 3);
    this.vel[2] += dir[2] * strength;
    this.angVel[1] += (Math.random() - 0.5) * 10;
    this.sleeping = false;
    this.restTime = 0;
  }
}
