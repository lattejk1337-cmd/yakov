// Host-side AI teammates: collect and deliver items, pull levers, repair, revive, flee and
// follow players. They fill empty slots in matchmaking so a match always has a full team.
import { NavGrid } from './nav.js';
import { v3, damp, dampAngle, clamp } from '../engine/math.js';
import { CONFIG } from './config.js';

const P = CONFIG.PLAYER;

export class BotBrain {
  constructor(game, s) {
    this.game = game;
    this.s = s;
    this.body = { pos: s.pos, radius: P.radius, height: P.height, stepHeight: 0.42, onGround: true, vel: [0, 0, 0] };
    this.nav = new NavGrid(game.world, (x, z) => this.walkable(x, z));
    this.path = null;
    this.goal = null;
    this.task = null;
    this.thinkT = Math.random() * 0.5;
    this.holdT = 0;
    this.stamina = P.staminaMax;
    this.repathT = 0;
    this.skill = 0.6 + Math.random() * 0.3;
    this.stuckT = 0;
  }

  walkable(x, z) {
    const w = this.game.world;
    if (!w.navWalk[z]?.[x]) return false;
    for (const d of w.doors) if (d.x === x && d.z === z) return !d.locked;
    return true;
  }

  update(dt) {
    const s = this.s, g = this.game;
    if (!s.active) return;
    s.repairing = null;
    s.reviving = null;
    // bleed out
    if (s.downed) {
      const helped = g.survivors.some((o) => o !== s && o.active && o.reviving === s.id && v3.distXZ(o.pos, s.pos) < 2.5);
      if (!helped) s.bleed -= dt;
      if (s.inv.adrenaline > 0 && s.bleed < P.bleedOutTime - 6) {
        s.inv.adrenaline--;
        s.downed = false;
        s.health = 1;
        g.fx('inject', s.pos);
      }
      if (s.bleed <= 0) {
        s.dead = true;
        g.onSurvivorDied(s);
        return;
      }
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.4 + Math.random() * 0.2;
      this.think();
    }
    this.act(dt);
    this.updateSenses();
  }

  monsterThreat() {
    const m = this.game.monster;
    if (!m) return null;
    const d = v3.distXZ(m.pos, this.s.pos);
    return { m, d, chasingMe: m.state === 'chase' && m.target === this.s.id };
  }

  think() {
    const s = this.s, g = this.game;
    const th = this.monsterThreat();
    // flashlight discipline
    if (g.monster?.type === 'moth') s.flashOn = !(th && th.d < 18);
    else s.flashOn = !g.world.isIndoorAt(s.pos) || true;
    if (s.downed) {
      // crawl to the nearest teammate
      const mate = this.nearestMate();
      this.setTask(mate ? { type: 'goto', pos: mate.pos.slice(), crawl: true } : { type: 'idle' });
      return;
    }
    if (th && (th.chasingMe || th.d < 6) && !(th.m.type === 'scarecrow' && th.m.frozen && th.d > 3)) {
      if (!this.task || this.task.type !== 'flee' || this.stuckT > 0.8) this.setTask({ type: 'flee', pos: this.fleePoint(th.m.pos) });
      return;
    }
    if (g.exitOpen) {
      const [x, z] = g.world.exitCells[0] || [0, 0];
      this.setTask({ type: 'goto', pos: g.world.center(x, z), sprint: true });
      return;
    }
    // revive a downed teammate
    const downed = g.survivors.find((o) => o !== s && o.active && o.downed && !(th && v3.distXZ(th.m.pos, o.pos) < 8));
    if (downed) {
      this.setTask({ type: 'revive', target: downed.id, pos: downed.pos.slice() });
      return;
    }
    // heal self
    if (s.health === 1 && s.inv.medkit > 0 && !(th && th.d < 14)) {
      this.setTask({ type: 'heal', t: 0 });
      return;
    }
    // objectives
    const job = this.pickJob();
    if (job) {
      this.setTask(job);
      return;
    }
    // follow a human
    const human = g.survivors.find((o) => !o.isBot && o.active);
    if (human && v3.distXZ(human.pos, s.pos) > 4) this.setTask({ type: 'goto', pos: human.pos.slice(), follow: true });
    else if (!this.task || this.task.type === 'idle' || this.reached()) this.setTask({ type: 'goto', pos: g.world.randomFloorPoint(g.rnd) });
  }

  setTask(task) {
    const same = this.task && this.task.type === task.type && this.task.id === task.id && this.task.target === task.target && this.task.pos && task.pos && v3.distXZ(this.task.pos, task.pos) < 1.5;
    if (same) return;
    this.task = task;
    this.path = null;
    this.holdT = 0;
  }

  reached(r = 1.2) {
    return this.task?.pos && v3.distXZ(this.task.pos, this.s.pos) < r;
  }

  nearestMate() {
    let best = null, bd = 1e9;
    for (const o of this.game.survivors) {
      if (o === this.s || !o.active || o.downed) continue;
      const d = v3.distXZ(o.pos, this.s.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  fleePoint(from) {
    const g = this.game;
    let best = null, bd = -1;
    for (let i = 0; i < 12; i++) {
      const p = g.world.randomFloorPoint(g.rnd);
      const d = v3.distXZ(p, from) - v3.distXZ(p, this.s.pos) * 0.5;
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  pickJob() {
    const g = this.game, s = this.s;
    const jobs = [];
    // pickups
    for (const p of g.items.pickups) {
      if (!g.items.isAvailable(p)) continue;
      if (!p.puzzle) {
        const inv = s.inv;
        const full = (p.kind === 'medkit' && inv.medkit >= P.maxMedkits) || (p.kind === 'adrenaline' && inv.adrenaline >= P.maxAdrenaline) || (p.kind === 'battery' && inv.battery >= P.maxBatteries);
        if (full || v3.distXZ(p.pos, s.pos) > 14) continue;
      }
      if (!this.reachable(p.pos)) continue;
      jobs.push({ type: 'pickup', id: p.id, pos: p.pos.slice(), w: p.puzzle ? 0 : 8 });
    }
    // puzzle interactions bots understand
    for (const it of g.puzzles.interactables) {
      if (!it.bot) continue;
      if (it.available && !it.available(s)) continue;
      if (it.enabled && !it.enabled(s)) continue;
      const b = it.bot;
      const st = g.puzzles.state.obj[b.o];
      if (b.type === 'lever' && st.levers[b.i] === st.pattern[b.i]) continue;
      if (!this.reachable(it.pos)) continue;
      // avoid crowding the same job with other bots
      if (g.survivors.some((o) => o !== s && o.isBot && o.brain?.task?.id === it.id)) continue;
      jobs.push({ type: b.type, id: it.id, pos: it.pos.slice(), it, w: b.type === 'repair' ? 4 : 0 });
    }
    if (!jobs.length) return null;
    for (const j of jobs) j.score = v3.distXZ(j.pos, s.pos) + j.w;
    jobs.sort((a, b) => a.score - b.score);
    return jobs[0];
  }

  reachable(pos) {
    const [x, z] = this.game.world.cellOf(pos);
    return this.walkable(x, z) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.walkable(x + dx, z + dz));
  }

  act(dt) {
    const s = this.s, g = this.game;
    const task = this.task;
    if (!task) return;
    let sprint = false;
    let crawl = s.downed;
    let stop = false;
    switch (task.type) {
      case 'flee':
        sprint = true;
        if (this.reached(2)) this.task = null;
        break;
      case 'revive': {
        const o = g.survivorById(task.target);
        if (!o || !o.downed || !o.active) {
          this.task = null;
          break;
        }
        task.pos = o.pos.slice();
        if (v3.distXZ(o.pos, s.pos) < 1.6) {
          stop = true;
          s.reviving = o.id;
          this.faceTo(o.pos, dt);
          this.holdT += dt;
          if (this.holdT > P.reviveTime) {
            this.holdT = 0;
            g.hostRequest({ a: 'revive', id: o.id }, s);
            this.task = null;
          }
        }
        break;
      }
      case 'heal':
        stop = true;
        task.t += dt;
        if (task.t > P.healTime) {
          s.inv.medkit--;
          s.health = 2;
          this.task = null;
        }
        break;
      case 'pickup':
        if (this.reached(1.4)) {
          g.hostRequest({ a: 'pickup', id: task.id }, s);
          this.task = null;
        }
        break;
      case 'deliver':
      case 'lever':
        if (v3.distXZ(task.pos, s.pos) < 1.7) {
          stop = true;
          this.faceTo(task.pos, dt);
          this.holdT += dt;
          if (this.holdT > 0.6 / this.skill) {
            task.it.action(s);
            this.task = null;
          }
        }
        break;
      case 'valve':
        if (v3.distXZ(task.pos, s.pos) < 1.7) {
          stop = true;
          this.faceTo(task.pos, dt);
          this.holdT += dt;
          if (this.holdT > 2.6) {
            task.it.action(s);
            this.task = null;
          }
        }
        break;
      case 'repair':
        if (v3.distXZ(task.pos, s.pos) < 1.9) {
          stop = true;
          this.faceTo(task.pos, dt);
          if (g.puzzles.isDone(task.it.repair)) {
            this.task = null;
            break;
          }
          s.repairing = task.it.repair;
          this.holdT += dt;
          if (this.holdT > 4) {
            this.holdT = 0;
            if (Math.random() > this.skill) g.hostRequest({ a: 'repfail', o: task.it.repair }, s);
          }
        }
        break;
      case 'goto':
        if (task.follow && v3.distXZ(task.pos, s.pos) < 3) stop = true;
        if (task.sprint) sprint = true;
        if (this.reached()) this.task = task.follow ? task : null;
        break;
      default:
        stop = true;
    }
    this.move(dt, stop ? null : task?.pos, sprint, crawl);
  }

  faceTo(pos, dt) {
    const dx = pos[0] - this.s.pos[0], dz = pos[2] - this.s.pos[2];
    this.s.yaw = dampAngle(this.s.yaw, Math.atan2(-dx, -dz), 8, dt);
  }

  move(dt, target, sprint, crawl) {
    const s = this.s, g = this.game;
    let vx = 0, vz = 0;
    if (target) {
      this.repathT -= dt;
      if (!this.path || this.repathT <= 0) {
        this.path = this.nav.find(s.pos, target);
        this.repathT = 1.2;
      }
      if (this.path) {
        while (this.path.length && v3.distXZ(this.path[0], s.pos) < 0.45) this.path.shift();
        const wp = this.path[0];
        if (wp) {
          const dx = wp[0] - s.pos[0], dz = wp[2] - s.pos[2];
          const d = Math.hypot(dx, dz) || 1;
          if (sprint && this.stamina < 5) sprint = false;
          const sp = crawl ? 0.55 : sprint ? P.sprintSpeed : P.walkSpeed;
          vx = (dx / d) * sp;
          vz = (dz / d) * sp;
          this.s.yaw = dampAngle(s.yaw, Math.atan2(-dx, -dz), 9, dt);
          // open doors on the way
          const ahead = [s.pos[0] + (dx / d) * 1.1, 0, s.pos[2] + (dz / d) * 1.1];
          const [cx, cz] = g.world.cellOf(ahead);
          for (const door of g.world.doors) {
            if (door.x === cx && door.z === cz && door.target < 0.5 && !door.locked) g.hostSetDoor(door, 1);
          }
        }
      }
    }
    // scarecrow: keep eyes on it when close
    const m = g.monster;
    if (m && m.type === 'scarecrow' && v3.distXZ(m.pos, s.pos) < 14 && !crawl) {
      const dx = m.pos[0] - s.pos[0], dz = m.pos[2] - s.pos[2];
      s.yaw = dampAngle(s.yaw, Math.atan2(-dx, -dz), 10, dt);
    }
    s.sprinting = sprint && Math.hypot(vx, vz) > 3.5;
    if (s.sprinting) this.stamina = Math.max(0, this.stamina - P.sprintCost * dt);
    else this.stamina = Math.min(P.staminaMax, this.stamina + P.staminaRegen * dt);
    const vel = this.body.vel;
    vel[0] = damp(vel[0], vx, 10, dt);
    vel[2] = damp(vel[2], vz, 10, dt);
    vel[1] -= 16 * dt;
    const before = [s.pos[0], s.pos[2]];
    g.world.physics.moveCharacter(this.body, vel[0] * dt, vel[1] * dt, vel[2] * dt);
    if (this.body.onGround) vel[1] = Math.max(vel[1], -1);
    const moved = Math.hypot(s.pos[0] - before[0], s.pos[2] - before[1]);
    s.speed = moved / Math.max(dt, 1e-4);
    if (target && Math.hypot(vx, vz) > 0.5 && moved < 0.2 * dt) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        this.path = null;
        this.stuckT = 0;
        if (this.task?.type === 'goto' || this.task?.type === 'pickup') this.task = null;
      }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    s.crouch = damp(s.crouch, crawl ? 1 : 0, 8, dt);
    s.pitch = 0;
    // noise
    s.stepAcc += s.speed * dt;
    if (s.stepAcc > (s.sprinting ? 1.9 : 1.35)) {
      s.stepAcc = 0;
      g.audio?.play('step_' + g.world.surfaceAt(s.pos), { pos: s.pos, volume: s.sprinting ? 0.8 : 0.45, pitchVar: 0.15, refDistance: 2, maxDistance: 25 });
      if (s.sprinting) g.addNoise(s.pos.slice(), 14, s.id);
      else if (!crawl) g.addNoise(s.pos.slice(), 4, s.id);
    }
    // escape
    if (g.exitOpen) {
      const [cx, cz] = g.world.cellOf(s.pos);
      if (g.world.exitCells.some(([x, z]) => x === cx && z === cz)) {
        s.escaped = true;
        g.onSurvivorEscaped(s);
      }
    }
  }

  updateSenses() {
    const s = this.s, g = this.game;
    const m = g.monster;
    if (!m || m.type !== 'scarecrow') {
      s.seesMonster = false;
      return;
    }
    const dx = m.pos[0] - s.pos[0], dz = m.pos[2] - s.pos[2];
    const d = Math.hypot(dx, dz);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const dot = (dx * fx + dz * fz) / (d || 1);
    s.seesMonster = !s.downed && d < 22 && dot > 0.75 && g.world.physics.lineOfSight([s.pos[0], 1.6, s.pos[2]], [m.pos[0], 1.5, m.pos[2]]);
    void clamp;
  }
}
