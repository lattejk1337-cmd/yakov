// Local player controller: first-person movement & physics, stamina, flashlight, items,
// interaction, hiding, downed/escape states, camera effects and the first-person viewmodel.
import { CONFIG } from './config.js';
import { v3, m4, clamp, lerp, damp, smoothstep } from '../engine/math.js';
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { ITEM_BY_ID, SKIN_TONES } from './catalog.js';
import { buildVisual } from './items.js';
import { t } from './i18n.js';

const P = CONFIG.PLAYER;

export class LocalPlayer {
  constructor(game, survivor) {
    this.game = game;
    this.s = survivor;
    this.body = { pos: survivor.pos, radius: P.radius, height: P.height, stepHeight: 0.42, onGround: true, vel: [0, 0, 0] };
    this.vel = this.body.vel;
    this.stamina = P.staminaMax;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.crouchWant = false;
    this.eye = P.eye;
    this.bob = 0;
    this.bobAmt = 0;
    this.roll = 0;
    this.fovKick = 0;
    this.fear = 0;
    this.boost = 0;
    this.healProgress = 0;
    this.hold = { target: null, t: 0 };
    this.focus = null;
    this.airTime = 0;
    this.lastVy = 0;
    this.noiseT = 0;
    this.heartT = 0;
    this.breathT = 0;
    this.skillT = 4;
    this.spectating = null;
    this.camPos = [0, 0, 0];
    this.flashDir = [0, 0, -1];
    this.damageFlash = 0;
    this.shake = 0;
    this.buildViewmodel();
  }

  get perks() {
    return this.s.perks;
  }
  perk(id) {
    return this.s.perks.includes(id);
  }

  buildViewmodel() {
    const prims = this.game.prims;
    const app = this.s.app;
    const jc = ITEM_BY_ID[app.jacket]?.color || [0.3, 0.3, 0.3];
    const skin = SKIN_TONES[app.skin] || SKIN_TONES[1];
    const mk = (mesh, mat, col, em = 0) => {
      const d = new DrawItem(mesh, mat, col);
      d.emissive = em;
      d.castShadow = false;
      return d;
    };
    this.vm = {
      sleeve: mk(prims.cylinder, MAT.FABRIC, jc),
      cuff: mk(prims.cylinder, MAT.FABRIC, jc.map((c) => c * 0.7)),
      hand: mk(prims.sphere, MAT.SKIN, skin),
      thumb: mk(prims.sphere, MAT.SKIN, skin),
      body: mk(prims.cylinder, MAT.PAINTED_METAL, [0.1, 0.1, 0.11]),
      head: mk(prims.cylinder, MAT.PAINTED_METAL, [0.14, 0.14, 0.15]),
      lens: mk(prims.cylinder, MAT.LAMP, [1, 0.95, 0.85], 2),
      sleeveL: mk(prims.cylinder, MAT.FABRIC, jc),
      handL: mk(prims.sphere, MAT.SKIN, skin),
    };
    this.vmHeld = null;
    this.vmHeldKind = null;
    this.vmMat = m4.create();
    this.camWorld = m4.create();
  }

  setHeldVisual(kind) {
    if (this.vmHeldKind === kind) return;
    this.vmHeldKind = kind;
    this.vmHeld = kind ? buildVisual(this.game.prims, kind) : null;
  }

  // ------------------------------------------------------------------ main update
  update(dt, input, cam) {
    const s = this.s;
    const g = this.game;
    if (!s.active) {
      this.updateSpectate(dt, input, cam);
      return;
    }
    // look
    const [lx, ly] = input.consumeLook();
    if (s.hidden === null) {
      s.yaw -= lx;
      s.pitch = clamp(s.pitch - ly, -1.45, 1.45);
    } else {
      // limited look while hiding
      const spot = g.world.hideSpots[s.hidden];
      s.yaw = clamp(s.yaw - lx, spot.facing - 0.5, spot.facing + 0.5);
      s.pitch = clamp(s.pitch - ly, -0.4, 0.3);
    }

    if (s.hidden !== null) this.updateHidden(dt, input);
    else this.updateMovement(dt, input);

    this.updateFlashlight(dt, input);
    this.updateItems(dt, input);
    this.updateInteraction(dt, input);
    this.updateStatus(dt);
    this.updateCamera(dt, cam);
    this.updateFear(dt, cam);
  }

  updateMovement(dt, input) {
    const s = this.s, g = this.game, phys = g.world.physics;
    // crouch
    if (input.pressed('crouch')) this.crouchWant = !this.crouchWant;
    let crouched = this.crouchWant || s.downed;
    if (!crouched && s.crouch > 0.5 && !phys.headroom(s.pos, P.radius * 0.9, s.pos[1] + 0.1, s.pos[1] + P.height)) crouched = true;
    s.crouch = damp(s.crouch, crouched ? 1 : 0, 10, dt);
    this.body.height = lerp(P.height, P.crouchHeight, s.crouch);
    if (s.downed) this.body.height = 0.6;

    // wish direction
    const mx = input.move.x, my = input.move.y;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    let wx = fx * my + rx * mx, wz = fz * my + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const moving = wl > 0.1;
    const wantSprint = input.down('sprint') || input.down('sprintToggle') || input.down('sprintStick');
    const canSprint = !this.exhausted && this.stamina > 0 && !crouched && my > 0.2 && !s.downed && this.healProgress <= 0;
    s.sprinting = wantSprint && canSprint && moving;
    let speed = P.walkSpeed;
    if (s.sprinting) speed = P.sprintSpeed;
    if (crouched) speed = P.crouchSpeed;
    if (s.downed) speed = 0.55;
    if (s.health === 1 && !s.downed) speed *= P.injuredMul;
    if (this.boost > 0) speed *= 1.25;
    if (this.healProgress > 0) speed = Math.min(speed, 1.0);
    if (this.hold.target) speed = Math.min(speed, 1.2);
    // horizontal velocity
    const accel = this.body.onGround ? 11 : 2.5;
    this.vel[0] = damp(this.vel[0], wx * speed, accel, dt);
    this.vel[2] = damp(this.vel[2], wz * speed, accel, dt);
    // stamina
    if (s.sprinting) {
      this.stamina -= P.sprintCost * (this.perk('light_feet') ? 0.8 : 1) * (this.boost > 0 ? 0 : 1) * dt;
      this.staminaDelay = P.staminaDelay;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        g.audio?.play('breath', { volume: 0.7 });
      }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(P.staminaMax, this.stamina + P.staminaRegen * (this.perk('second_wind') ? 1.3 : 1) * (s.health === 1 ? 0.75 : 1) * dt);
    }
    if (this.exhausted && this.stamina >= P.exhaustedUntil) this.exhausted = false;
    // jump
    if (input.pressed('jump') && this.body.onGround && !crouched && this.stamina >= P.jumpCost && !s.downed) {
      this.vel[1] = P.jumpVel;
      this.stamina -= P.jumpCost;
      this.staminaDelay = P.staminaDelay;
    }
    // gravity & move
    this.vel[1] -= 16 * dt;
    const wasGround = this.body.onGround;
    const vyBefore = this.vel[1];
    phys.moveCharacter(this.body, this.vel[0] * dt, this.vel[1] * dt, this.vel[2] * dt);
    if (this.body.onGround) {
      if (!wasGround && vyBefore < -4.5) {
        g.audio?.play('step_' + g.world.surfaceAt(s.pos), { volume: 0.9, rate: 0.8 });
        this.makeNoise(Math.min(14, -vyBefore * 1.8));
        this.shake = Math.min(1, -vyBefore / 12);
      }
      this.vel[1] = Math.max(this.vel[1], -1);
    }
    const hs = Math.hypot(this.vel[0], this.vel[2]);
    s.speed = hs;
    // footsteps
    if (this.body.onGround && hs > 0.4) {
      const stride = s.sprinting ? 1.9 : crouched ? 0.85 : 1.35;
      s.stepAcc += hs * dt;
      if (s.stepAcc > stride) {
        s.stepAcc = 0;
        const surf = g.world.surfaceAt(s.pos);
        const quiet = this.perk('quiet') ? 0.65 : 1;
        const vol = (s.sprinting ? 0.9 : crouched ? 0.25 : 0.55) * quiet;
        g.audio?.play('step_' + surf, { volume: vol, pitchVar: 0.15, rate: crouched ? 0.85 : 1 });
        const radius = (s.sprinting ? 16 : crouched || s.downed ? 0 : 5.5) * quiet * (surf === 'metal' || surf === 'water' ? 1.4 : 1);
        if (radius > 0) this.makeNoise(radius);
      }
    }
    // escape
    if (g.exitOpen) {
      const [cx, cz] = g.world.cellOf(s.pos);
      if (g.world.exitCells.some(([x, z]) => x === cx && z === cz)) g.localEscaped();
    }
  }

  makeNoise(radius, lure = false) {
    this.game.addNoise(this.s.pos.slice(), radius, this.s.id, lure);
  }

  updateHidden(dt, input) {
    const s = this.s;
    s.speed = 0;
    s.sprinting = false;
    this.stamina = Math.min(P.staminaMax, this.stamina + P.staminaRegen * dt);
    if (input.pressed('interact') || input.pressed('jump')) this.leaveHide();
    void dt;
  }

  enterHide(spot) {
    const s = this.s, g = this.game;
    s.hidden = spot.id;
    this.hideReturn = s.pos.slice();
    v3.copy(s.pos, [spot.pos[0], 0, spot.pos[2]]);
    s.yaw = spot.facing;
    s.pitch = 0;
    s.flashOn = false;
    const m = g.monster;
    s.hiddenSeen = !!(m && m.state === 'chase' && m.target === s.id && v3.distXZ(m.pos, s.pos) < 12);
    g.audio?.play('door_close', { volume: 0.5, rate: 1.4 });
    this.makeNoise(4);
  }
  leaveHide() {
    const s = this.s, g = this.game;
    const spot = g.world.hideSpots[s.hidden];
    s.hidden = null;
    s.hiddenSeen = false;
    v3.copy(s.pos, spot ? [spot.front[0], 0, spot.front[2]] : this.hideReturn);
    g.audio?.play('door_open', { volume: 0.4, rate: 1.5 });
  }

  updateFlashlight(dt, input) {
    const s = this.s;
    if (input.pressed('flashlight') && !s.downed && s.hidden === null) {
      s.flashOn = !s.flashOn;
      this.game.audio?.play('flash_click', { volume: 0.6 });
    }
    if (s.flashOn && s.battery > 0) {
      s.battery = Math.max(0, s.battery - P.batteryDrain * (this.perk('electrician') ? 0.7 : 1) * dt);
      if (s.battery <= 0) this.game.hud?.toast(t('no_battery'));
    }
    if (input.pressed('reload')) {
      if (s.inv.battery > 0 && s.battery < 95) {
        s.inv.battery--;
        s.battery = P.batteryMax;
        this.game.audio?.play('battery', { volume: 0.8 });
      } else if (s.inv.battery <= 0) this.game.hud?.toast(t('no_battery'));
    }
  }

  updateItems(dt, input) {
    const s = this.s, g = this.game;
    // medkit (hold)
    const healDown = input.down('heal');
    if (healDown && s.inv.medkit > 0 && s.health === 1 && !s.downed && s.hidden === null) {
      if (this.healProgress === 0) g.audio?.play('heal', { volume: 0.8 });
      this.healProgress += dt / (P.healTime * (this.perk('medic') ? 0.65 : 1));
      if (this.healProgress >= 1) {
        this.healProgress = 0;
        s.inv.medkit--;
        s.health = 2;
        g.hud?.toast('✚ ' + t('health_healthy'));
      }
    } else {
      if (input.pressed('heal')) {
        if (s.inv.medkit <= 0) g.hud?.toast(t('no_medkit'));
      }
      this.healProgress = 0;
    }
    // adrenaline
    if (input.pressed('adrenaline')) {
      if (s.inv.adrenaline > 0) {
        s.inv.adrenaline--;
        this.boost = 6;
        this.stamina = P.staminaMax;
        this.exhausted = false;
        if (s.downed) {
          s.downed = false;
          s.health = 1;
          s.bleed = P.bleedOutTime;
        } else s.health = Math.min(2, s.health + 1);
        g.audio?.play('inject', { volume: 0.9 });
        g.request({ a: 'selfrevive' });
      } else g.hud?.toast(t('no_adrenaline'));
    }
    this.boost = Math.max(0, this.boost - dt);
    // throw
    if (input.pressed('throw') && s.inv.held && s.hidden === null && !s.downed) {
      const dir = v3.fromYawPitch([0, 0, 0], s.yaw, s.pitch + 0.08);
      const from = [this.camPos[0] + dir[0] * 0.4, this.camPos[1] - 0.1, this.camPos[2] + dir[2] * 0.4];
      g.throwProp(s.inv.held, from, dir, 11);
      s.inv.held = null;
      g.audio?.play('whoosh', { volume: 0.6 });
    }
    this.setHeldVisual(s.inv.held ? g.items.byId.get(s.inv.held)?.kind : null);
  }

  // find what the player is looking at
  findFocus() {
    const g = this.game, s = this.s;
    const eye = this.camPos;
    const fwd = v3.fromYawPitch([0, 0, 0], s.yaw, s.pitch);
    let best = null, bestScore = -1;
    const touch = g.input.usingTouch;
    for (const it of g.interactables()) {
      if (it.available && !it.available(s)) continue;
      const dx = it.pos[0] - eye[0], dy = it.pos[1] - eye[1], dz = it.pos[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > (it.radius ?? 2) + 0.3) continue;
      const dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / (d || 1);
      const minDot = touch ? 0.6 : d < 0.9 ? 0.5 : 0.82;
      if (dot < minDot) continue;
      const score = dot - d * 0.05;
      if (score <= bestScore) continue;
      // visibility
      const dir = [dx / d, dy / d, dz / d];
      const hit = g.world.physics.raycast(eye, dir, d - 0.25, (b) => b.blocksSight && b.solid && !(it.door && b.door === it.door));
      if (hit) continue;
      best = it;
      bestScore = score;
    }
    return best;
  }

  updateInteraction(dt, input) {
    const s = this.s, g = this.game;
    const focus = s.downed ? null : this.findFocus();
    this.focus = focus;
    s.repairing = null;
    s.reviving = null;
    if (!focus) {
      this.hold.target = null;
      this.hold.t = 0;
      return;
    }
    const enabled = !focus.enabled || focus.enabled(s);
    // continuous repair (generator)
    if (focus.repair) {
      if (input.down('interact')) {
        s.repairing = focus.repair;
        this.skillT -= dt;
        if (this.skillT <= 0) {
          this.skillT = 3 + Math.random() * 5;
          if (Math.random() < 0.65)
            g.ui.skillCheck(this.perk('mechanic') ? 1.4 : 1, (res) => {
              if (res === 'fail') g.request({ a: 'repfail', o: focus.repair });
              else if (res === 'great') g.request({ a: 'repgreat', o: focus.repair });
            });
        }
        if (!this.repairSound || this.repairSound.stopped) this.repairSound = g.audio?.play('generator', { pos: focus.pos, loop: true, volume: 0.5 });
      } else if (this.repairSound) {
        this.repairSound.stop(0.3);
        this.repairSound = null;
      }
      return;
    }
    if (this.repairSound) {
      this.repairSound.stop(0.3);
      this.repairSound = null;
    }
    if (!enabled) {
      if (input.pressed('interact')) g.audio?.play('door_locked', { volume: 0.5 });
      return;
    }
    const holdTime = typeof focus.hold === 'function' ? focus.hold(s) : focus.hold;
    if (holdTime > 0) {
      if (input.down('interact')) {
        if (this.hold.target !== focus.id) {
          this.hold.target = focus.id;
          this.hold.t = 0;
          if (focus.holdSound) g.audio?.play(focus.holdSound, { volume: 0.4 });
        }
        if (focus.revive) s.reviving = focus.revive;
        this.hold.t += dt;
        if (this.hold.t >= holdTime) {
          this.hold.t = 0;
          this.hold.target = null;
          focus.action(s);
        }
      } else {
        this.hold.target = null;
        this.hold.t = 0;
      }
    } else if (input.pressed('interact')) {
      focus.action(s);
    }
  }

  updateStatus(dt) {
    const s = this.s, g = this.game;
    if (s.downed) {
      const helped = g.survivors.some((o) => o !== s && o.active && o.reviving === s.id && v3.distXZ(o.pos, s.pos) < 2.5);
      if (!helped) s.bleed -= dt;
      if (s.bleed <= 0) g.localDied();
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 0.8);
  }

  onHit(downed) {
    this.damageFlash = 1;
    this.shake = 1;
    this.crouchWant = false;
    this.boost = downed ? 0 : 2.5; // adrenaline rush after a hit, like a survivor sprint burst
    if (!downed) {
      this.stamina = Math.min(P.staminaMax, this.stamina + 40);
      this.exhausted = false;
    }
    if (this.s.hidden !== null) this.leaveHide();
  }

  updateCamera(dt, cam) {
    const s = this.s;
    const settings = this.game.settings;
    const targetEye = s.downed ? 0.38 : lerp(P.eye, P.crouchEye, s.crouch);
    this.eye = damp(this.eye, targetEye, 12, dt);
    const hs = s.speed;
    if (this.body.onGround && hs > 0.3) this.bob += hs * dt * (s.sprinting ? 1.45 : 1.6);
    this.bobAmt = damp(this.bobAmt, settings.bob ? clamp(hs / 5, 0, 1) : 0, 8, dt);
    const bobY = Math.sin(this.bob * Math.PI) * 0.045 * this.bobAmt;
    const bobX = Math.cos(this.bob * Math.PI * 0.5) * 0.03 * this.bobAmt;
    const rightX = Math.cos(s.yaw), rightZ = -Math.sin(s.yaw);
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * 0.04;
    this.camPos[0] = s.pos[0] + rightX * bobX + (Math.random() - 0.5) * sh;
    this.camPos[1] = s.pos[1] + this.eye + bobY + (Math.random() - 0.5) * sh;
    this.camPos[2] = s.pos[2] + rightZ * bobX + (Math.random() - 0.5) * sh;
    // strafe roll & downed tilt
    const strafe = this.vel[0] * rightX + this.vel[2] * rightZ;
    this.roll = damp(this.roll, (settings.bob ? -strafe * 0.008 : 0) + (s.downed ? 0.25 : 0), 6, dt);
    this.fovKick = damp(this.fovKick, s.sprinting ? 7 : 0, 5, dt);
    v3.copy(cam.pos, this.camPos);
    cam.yaw = s.yaw;
    cam.pitch = s.pitch;
    cam.roll = this.roll;
    cam.fov = settings.fov + this.fovKick;
    // flashlight follows the view with a little inertia
    const fwd = v3.fromYawPitch([0, 0, 0], s.yaw, s.pitch);
    for (let i = 0; i < 3; i++) this.flashDir[i] = damp(this.flashDir[i], fwd[i], 16, dt);
    v3.norm(this.flashDir, this.flashDir);
    const f = s.flash;
    const right = [rightX, 0, rightZ];
    // light origin sits just past the lens so the viewmodel is not blown out
    f.pos[0] = this.camPos[0] + right[0] * 0.14 + fwd[0] * 0.45;
    f.pos[1] = this.camPos[1] - 0.12 + fwd[1] * 0.45;
    f.pos[2] = this.camPos[2] + right[2] * 0.14 + fwd[2] * 0.45;
    v3.copy(f.dir, this.flashDir);
    f.intensity = s.flashOn && s.battery > 0 && s.hidden === null && !s.downed ? 2.4 * s.flickerMul() : 0;
    if (s.hidden !== null) {
      // peeking through locker slits
      cam.fov = settings.fov - 10;
    }
  }

  updateFear(dt, cam) {
    const s = this.s, g = this.game;
    const m = g.monster;
    let target = 0;
    if (m) {
      const d = v3.dist(m.pos, s.pos);
      const vis = d < 25 && g.world.physics.lineOfSight(cam.pos, [m.pos[0], 1.6, m.pos[2]]);
      target = clamp(1 - d / 22, 0, 1) * (vis ? 1 : 0.5);
      if (m.state === 'chase' && m.target === s.id) target = Math.max(target, 0.7);
      // scarecrow: report whether we are looking at it
      if (m.type === 'scarecrow') {
        const to = [m.pos[0] - cam.pos[0], m.pos[1] + 1.4 - cam.pos[1], m.pos[2] - cam.pos[2]];
        const dl = Math.hypot(to[0], to[1], to[2]);
        const fwd = cam.forward;
        const dot = (to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2]) / dl;
        const lit = dl < 9 || (s.flashOn && s.battery > 0 && dot > 0.9 && dl < 22) || g.world.lamps.some((l) => l.state > 0.5 && v3.dist(l.pos, m.pos) < l.radius * 0.8);
        s.seesMonster = s.hidden === null && !s.downed && dot > 0.72 && dl < 28 && lit && vis;
      } else s.seesMonster = false;
    }
    if (s.health === 1) target = Math.max(target, 0.25);
    if (s.downed) target = 0.8;
    const rate = this.perk('steady') ? 0.5 : 1;
    this.fear = damp(this.fear, target, target > this.fear ? 2.5 * rate : 0.8, dt);
    // heartbeat
    this.heartT -= dt;
    if (this.fear > 0.3 && this.heartT <= 0) {
      this.heartT = lerp(1.1, 0.42, smoothstep(0.3, 1, this.fear));
      g.audio?.play('heartbeat', { volume: 0.25 + this.fear * 0.6, bus: 'sfx' });
    }
    this.breathT -= dt;
    if ((this.exhausted || this.fear > 0.75) && this.breathT <= 0) {
      this.breathT = 1.6;
      g.audio?.play('breath', { volume: 0.35 });
    }
  }

  // ------------------------------------------------------------------ spectating
  updateSpectate(dt, input, cam) {
    const g = this.game;
    const others = g.survivors.filter((o) => o.active && o !== this.s);
    if (!others.length) return;
    if (!this.spectating || !this.spectating.active || input.pressed('interact')) {
      const i = others.indexOf(this.spectating);
      this.spectating = others[(i + 1) % others.length];
    }
    const o = this.spectating;
    input.consumeLook();
    const back = v3.fromYawPitch([0, 0, 0], o.yaw, -0.25);
    const head = [o.pos[0], o.pos[1] + 1.7, o.pos[2]];
    const want = [head[0] - back[0] * 2.6, head[1] + 0.5, head[2] - back[2] * 2.6];
    const hit = g.world.physics.raycast(head, v3.norm([0, 0, 0], v3.sub([0, 0, 0], want, head)), 2.8);
    if (hit) v3.lerp(want, head, want, Math.max(0, hit.t - 0.3) / 2.8);
    for (let i = 0; i < 3; i++) this.camPos[i] = damp(this.camPos[i], want[i], 8, dt);
    v3.copy(cam.pos, this.camPos);
    cam.yaw = o.yaw;
    cam.pitch = -0.2;
    cam.roll = 0;
    cam.fov = g.settings.fov;
    this.s.flash.intensity = 0;
  }

  // ------------------------------------------------------------------ viewmodel
  collectViewmodel(scene, cam) {
    const s = this.s;
    if (!s.active || s.hidden !== null) return;
    const vm = this.vm;
    m4.invert(this.camWorld, cam.view);
    const bobX = Math.cos(this.bob * Math.PI * 0.5) * 0.012 * this.bobAmt;
    const bobY = Math.abs(Math.sin(this.bob * Math.PI)) * 0.018 * this.bobAmt;
    const down = s.downed ? 0.25 : 0;
    const sprintTilt = s.sprinting ? 0.25 : 0;
    // right arm + flashlight. Arm space: +Y forward, +Z up (after the -90° X tilt).
    const base = (this.vmBase ||= m4.create());
    const armPose = (x, y, z, yawIn, tilt) => {
      m4.translate(base, this.camWorld, x + bobX, y - bobY - down, z);
      m4.rotateY(base, base, yawIn);
      m4.rotateX(base, base, -Math.PI / 2 + tilt);
    };
    const part = (item, ox, oy, oz, sx, sy, sz) => {
      const m = item.model;
      m4.translate(m, base, ox, oy, oz);
      m4.scale(m, m, sx, sy, sz);
      item.center = cam.pos;
      item.sky = this.game.world.isIndoorAt(s.pos) ? 0 : 1;
      scene.viewmodel.push(item);
    };
    armPose(0.2, -0.2, -0.44, 0.16, 0.1 + sprintTilt);
    part(vm.sleeve, 0, -0.3, -0.02, 0.085, 0.46, 0.085);
    part(vm.cuff, 0, -0.07, -0.015, 0.09, 0.05, 0.09);
    part(vm.hand, 0, 0.0, 0.0, 0.08, 0.11, 0.085);
    part(vm.thumb, -0.035, 0.03, 0.03, 0.03, 0.05, 0.03);
    part(vm.body, 0, 0.09, 0.045, 0.034, 0.3, 0.034);
    part(vm.head, 0, 0.255, 0.045, 0.05, 0.05, 0.05);
    vm.lens.emissive = s.flashOn && s.battery > 0 ? 4 : 0;
    part(vm.lens, 0, 0.282, 0.045, 0.043, 0.006, 0.043);
    // left hand: held throwable / medkit while healing
    const showLeft = this.vmHeld || this.healProgress > 0;
    if (showLeft) {
      const lx = -0.2, ly = -0.22 + (this.healProgress > 0 ? Math.sin(this.healProgress * 30) * 0.01 : 0), lz = -0.34;
      armPose(lx, ly, lz, -0.2, 0.2);
      part(vm.sleeveL, 0, -0.3, -0.02, 0.085, 0.46, 0.085);
      part(vm.handL, 0, 0, 0, 0.08, 0.11, 0.085);
      const parts = this.healProgress > 0 ? (this.vmMedkit ||= buildVisual(this.game.prims, 'medkit')) : this.vmHeld;
      for (const p of parts) {
        const m = p.item.model;
        m4.translate(m, this.camWorld, lx + bobX, ly + 0.06 - bobY - down, lz - 0.06);
        m4.rotateY(m, m, 0.4);
        m4.scale(m, m, 0.6, 0.6, 0.6);
        m4.translate(m, m, p.t[0], p.t[1], p.t[2]);
        if (p.r) {
          m4.rotateX(m, m, p.r[0]);
          m4.rotateY(m, m, p.r[1]);
          m4.rotateZ(m, m, p.r[2]);
        }
        m4.scale(m, m, p.s[0], p.s[1], p.s[2]);
        p.item.center = cam.pos;
        scene.viewmodel.push(p.item);
      }
    }
  }
}
