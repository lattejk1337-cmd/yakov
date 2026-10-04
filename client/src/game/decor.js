// Dresses a built world with prop prefabs according to the map's decor theme. Placement is
// deterministic (seeded) so colliders match on every client, and never blocks doorways,
// narrow corridors, anchors or spawns.
import { placePrefab, PREFABS } from './props.js';
import { mulberry32 } from '../engine/math.js';
import { CONFIG } from './config.js';

const CELL = CONFIG.CELL;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FREE = new Set(['.', ',', '_', 'g', 'w', 'l']);
// props that sit flush against the wall (offset from the wall plane)
const THIN_OFFSET = { pipesWall: 0.12, poster: 0.0, radiator: 0.1, extinguisher: 0.08, electricBox: 0.1, cables: 0.06, clock: 0.0, exitSign: 0.0, wallShelf: 0.12, cobweb: 0.02, cardboardWall: 0.1 };

function weighted(rnd, list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rnd() * total;
  for (const [name, w] of list) {
    r -= w;
    if (r <= 0) return name;
  }
  return list[list.length - 1][0];
}

export function decorate(world) {
  const theme = world.def.decor;
  if (!theme) return;
  const rnd = mulberry32(world.seed ^ 0xdec0de);
  const used = new Set();
  const key = (x, z) => x + ',' + z;
  const isDoor = (x, z) => world.doors.some((d) => d.x === x && d.z === z);
  const blockedNear = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (isDoor(x + dx, z + dz)) return true;
      const c = world.at(x + dx, z + dz);
      if (world.def.objects?.[c] || 'PXM'.includes(c)) return true;
    }
    return false;
  };
  const H = world.H;
  for (let z = 1; z < world.h - 1; z++) {
    for (let x = 1; x < world.w - 1; x++) {
      const c = world.at(x, z);
      if (!FREE.has(c) || world.def.objects?.[c]) continue;
      const out = world.type[z][x] === 'out';
      const zone = world.zoneAt(x, z);
      const th = { ...theme, ...(zone?.decor || {}) };
      const dens = { wall: 0.3, thin: 0.22, floor: 0.2, ceiling: 0.12, outdoor: 0.22, ...(theme.density || {}), ...(zone?.decor?.density || {}) };
      const walls = DIRS.filter(([dx, dz]) => world.solid(x + dx, z + dz));
      const narrow = (world.solid(x - 1, z) && world.solid(x + 1, z)) || (world.solid(x, z - 1) && world.solid(x, z + 1));
      const center = world.center(x, z);
      const near = blockedNear(x, z);
      const sky = out ? 1 : 0;
      const b = world.chunkBuilder(x, z);
      const place = (name, pos, yaw, collide) => {
        const box = placePrefab(b, name, pos, yaw, rnd, { sky, h: H });
        if (box && collide) world.physics.add({ ...box, blocksSight: box.max[1] > 1.6 });
        used.add(key(x, z));
      };
      if (out) {
        if (rnd() < dens.outdoor && th.outdoor && !near) {
          const name = weighted(rnd, th.outdoor);
          const big = ['trashCan', 'barrels', 'barrel', 'tires', 'crate', 'carWreck', 'pole', 'gravestone', 'bench', 'mailbox', 'hydrant', 'barrier'].includes(name);
          if (big && (c === '_' || narrow)) continue;
          const jit = big ? 0.3 : 0.6;
          const pos = [center[0] + (rnd() - 0.5) * jit, 0, center[2] + (rnd() - 0.5) * jit];
          let yaw = rnd() * Math.PI * 2;
          if (walls.length && big) {
            const [wx, wz] = walls[0];
            pos[0] = center[0] + wx * (CELL / 2 - 0.5);
            pos[2] = center[2] + wz * (CELL / 2 - 0.5);
            yaw = Math.atan2(-wx, -wz);
          }
          if (name === 'carWreck') {
            if (walls.length || narrow) continue;
            yaw = Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.4;
          }
          place(name, pos, yaw, big);
        }
        continue;
      }
      // indoor
      if (walls.length) {
        const [wx, wz] = walls[Math.floor(rnd() * walls.length)];
        const yaw = Math.atan2(-wx, -wz);
        const lateral = (rnd() - 0.5) * 0.6;
        const along = [-wz, wx];
        if (!narrow && !near && th.wall && rnd() < dens.wall) {
          const name = weighted(rnd, th.wall);
          const pos = [center[0] + wx * (CELL / 2 - 0.5) + along[0] * lateral, 0, center[2] + wz * (CELL / 2 - 0.5) + along[1] * lateral];
          place(name, pos, yaw, true);
        } else if (th.thin && rnd() < dens.thin) {
          const name = weighted(rnd, th.thin);
          const off = THIN_OFFSET[name] ?? 0.12;
          const pos = [center[0] + wx * (CELL / 2 - off) + along[0] * lateral * 0.5, 0, center[2] + wz * (CELL / 2 - off) + along[1] * lateral * 0.5];
          place(name, pos, yaw, false);
        }
        if (th.ceiling && rnd() < dens.ceiling) {
          const name = weighted(rnd, th.ceiling);
          const off = THIN_OFFSET[name] ?? 0.12;
          const pos = name === 'ceilingVent' ? center.slice() : [center[0] + wx * (CELL / 2 - off), 0, center[2] + wz * (CELL / 2 - off)];
          placePrefab(b, name, pos, yaw, rnd, { h: H });
        }
      }
      if (th.floor && rnd() < dens.floor) {
        const name = weighted(rnd, th.floor);
        const pos = [center[0] + (rnd() - 0.5) * 0.6, 0, center[2] + (rnd() - 0.5) * 0.6];
        placePrefab(b, name, pos, rnd() * Math.PI * 2, rnd, { h: H });
      }
    }
  }
  void PREFABS;
}
