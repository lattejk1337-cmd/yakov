// A running match. One peer is the host: it simulates the monster, bots and objectives and
// replicates authoritative world state. Every peer simulates its own player.
import { World } from './world.js';
import { MAPS } from './maps/index.js';
import { Items, PERSONAL, TEAM_ITEMS } from './items.js';
import { Puzzles } from './puzzles.js';
import { Monster } from './monsters.js';
import { Survivor } from './survivor.js';
import { LocalPlayer } from './player.js';
import { BotBrain } from './bots.js';
import { Camera } from '../engine/renderer.js';
import { v3, mulberry32, clamp, damp } from '../engine/math.js';
import { CONFIG } from './config.js';
import { t, getLang } from './i18n.js';
import { sanitizeAppearance } from './catalog.js';

export class Match {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.gl = app.gl;
    this.prims = app.prims;
    this.audio = app.audio;
    this.input = app.input;
    this.ui = app.ui;
    this.hud = app.hud;
    this.settings = app.profile.data.settings;
    this.lang = getLang();
    this.session = cfg.session;
    this.seed = cfg.seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x1234);
    this.time = 0;
    this.noises = [];
    this.def = MAPS[cfg.mapId];
    this.cam = new Camera();
    this.scene = { static: [], dynamic: [], viewmodel: [], pointLights: [], spotLights: [], glows: [], env: this.def.env, lampState: null };
    this.ended = false;
    this.exitOpen = false;
    this.stateDirty = true;
    this.stateT = 0;
    this.snapT = 0;
    this.sendT = 0;
    this.lastNoiseSent = 0;
    this.messages = [];
    this.stats = { objectives: 0, revives: 0, startTime: 0 };
  }

  get isHost() {
    return this.session.isHost;
  }

  build() {
    const cfg = this.cfg;
    this.world = new World(this.gl, this.def, this.seed, this.prims).build();
    this.scene.lampState = this.world.lampState;
    this.items = new Items(this, this.seed);
    this.items.populate();
    this.puzzles = new Puzzles(this, this.def, this.seed);
    this.puzzles.build();
    // survivors
    this.survivors = [];
    const spawns = this.world.spawns.length ? this.world.spawns : [this.world.center(2, 2)];
    cfg.players.forEach((p, i) => {
      const s = new Survivor(this, { ...p, app: sanitizeAppearance(p.app), isLocal: p.id === cfg.localId });
      const sp = spawns[i % spawns.length];
      s.pos[0] = sp[0] + (i >= spawns.length ? 0.6 : 0);
      s.pos[2] = sp[2];
      s.net.pos = s.pos.slice();
      s.yaw = Math.PI;
      if (this.def.id === 'town') s.yaw = 0;
      if (cfg.players.length === 1) s.bleed = 18; // solo: short bleed-out, adrenaline is the only hope
      this.survivors.push(s);
    });
    this.local = this.survivors.find((s) => s.isLocal);
    this.player = new LocalPlayer(this, this.local);
    this.local.inv.medkit = 1;
    // monster
    this.monster = new Monster(this.def.monster, this);
    const ms = this.world.monsterSpawns[0] || this.world.randomFloorPoint(this.rnd);
    v3.copy(this.monster.pos, ms);
    this.monster.netPos = ms.slice();
    this.setupBots();
    this.bindNet();
    // ambience
    this.ambience = this.audio.play(this.def.ambience, { bus: 'ambience', loop: true, volume: 0.9 });
    this.audio.setMusicLevels({ music_lobby: 0, music_tension: 0.35, music_chase: 0 });
    this.stats.startTime = 0;
    this.applySettings();
    return this;
  }

  applySettings() {
    const st = this.settings;
    this.renderer = this.app.renderer;
    this.renderer.post.brightness = st.brightness;
    this.renderer.post.grain = st.grain ? 0.05 : 0;
  }

  setupBots() {
    for (const s of this.survivors) {
      if (s.isBot && this.isHost && !s.brain) s.brain = new BotBrain(this, s);
    }
  }

  survivorById(id) {
    return this.survivors.find((s) => s.id === id);
  }

  isObjectiveDone(id) {
    return this.puzzles.isDone(id);
  }

  // ------------------------------------------------------------------ networking
  bindNet() {
    const ses = this.session;
    ses.on('ps', (d, from) => {
      const s = this.survivorById(from);
      if (s && !s.isLocal) {
        const wasDowned = s.downed;
        s.applyNet(d);
        if (!wasDowned && s.downed) this.hud.toast(`${s.name}: ${t('health_downed')}`, 'bad');
      }
    });
    ses.on('rq', (d, from) => {
      if (!this.isHost) return;
      const s = this.survivorById(from);
      if (s) this.hostRequest(d, s);
    });
    ses.on('nz', (d, from) => {
      if (this.isHost && Array.isArray(d.p)) this.noises.push({ pos: d.p, radius: clamp(+d.r || 0, 0, 30), source: from, t: this.time, lure: !!d.l });
    });
    ses.on('ws', (d) => {
      if (!this.isHost) this.applyWorldState(d);
    });
    ses.on('ms', (d) => {
      if (this.isHost) return;
      if (d.m) this.monster.applySnapshot(d.m);
      if (d.b)
        for (const [id, st] of Object.entries(d.b)) {
          const s = this.survivorById(id);
          if (s && s.isBot) s.applyNet(st);
        }
    });
    ses.on('fx', (d) => this.playFx(d));
    ses.on('hit', (d) => {
      if (d.id === this.local.id) this.applyHit(this.local, !!d.h);
    });
    ses.on('revived', (d) => {
      const s = this.survivorById(d.id);
      if (s === this.local && s.downed) {
        s.downed = false;
        s.health = 1;
        s.bleed = CONFIG.PLAYER.bleedOutTime;
        this.hud.toast(t('health_injured'));
      }
    });
    ses.on('th', (d) => {
      const pr = this.items.byId.get(d.id);
      if (pr && pr.throw) {
        const holder = this.survivorById(pr.holder);
        if (holder && holder.inv.held === d.id) holder.inv.held = null;
        pr.holder = null;
        pr.throw(d.p, d.v, 1);
        pr.vel = d.v.slice();
      }
    });
    ses.on('end', (d) => this.onEnd(d));
    ses.onHostChange?.((hostId) => {
      if (hostId === this.local.id) {
        this.hud.toast(t('host_left'));
        this.setupBots();
        this.stateDirty = true;
      }
    });
    ses.onPeerLeft?.((id) => {
      const s = this.survivorById(id);
      if (s && !s.left) {
        s.left = true;
        this.hud.toast(t('player_left', { name: s.name }));
        if (this.isHost) this.checkEnd();
      }
    });
  }

  request(req) {
    if (this.isHost) this.hostRequest(req, this.local);
    else this.session.toHost('rq', req);
  }

  // Host-side request handling (from local player, remote players or bots)
  hostRequest(req, s) {
    if (!s || !req) return;
    const a = req.a;
    if (a === 'door') {
      const door = this.world.doors[req.id | 0];
      if (!door || door.locked) return;
      if (v3.distXZ(door.pos, s.authPos) > 5) return;
      this.hostSetDoor(door, door.target > 0.5 ? 0 : 1);
    } else if (a === 'pickup') {
      const it = this.items.byId.get(req.id);
      if (!it) return;
      if (v3.distXZ(it.pos, s.authPos) > 4.5) return;
      if (it instanceof Object && 'taken' in it) {
        if (!this.items.isAvailable(it)) return;
        it.taken = true;
        if (TEAM_ITEMS.has(it.kind)) this.puzzles.hostPickupTeamItem(it.kind);
        this.stateDirty = true;
        if (PERSONAL.has(it.kind)) this.giveItem(s, it.kind);
        this.fx('pickup', it.pos, null, it.kind);
        this.fxTo(s.id, 'got', { kind: it.kind });
      } else if (it.holder === null || it.holder === undefined) {
        // throwable prop
        if (s.inv.held) return;
        it.holder = s.id;
        s.inv.held = it.id;
        this.stateDirty = true;
        this.fxTo(s.id, 'held', { id: it.id });
      }
    } else if (a === 'revive') {
      const o = this.survivorById(req.id);
      if (!o || !o.downed || v3.distXZ(o.authPos, s.authPos) > 4) return;
      this.applyRevive(o);
      s.stats.revives++;
      if (s === this.local) this.stats.revives++;
      else this.fxTo(s.id, 'reviveDone');
    } else if (a === 'selfrevive') {
      // adrenaline: nothing for the host to validate, keeps hit cooldown fair
    } else if (a === 'hide') {
      // occupancy only
    } else if (this.puzzles.hostHandle(req, s)) {
      this.stateDirty = true;
    }
  }

  giveItem(s, kind) {
    const inv = s.inv;
    if (kind === 'medkit') inv.medkit = Math.min(CONFIG.PLAYER.maxMedkits, inv.medkit + 1);
    if (kind === 'adrenaline') inv.adrenaline = Math.min(CONFIG.PLAYER.maxAdrenaline, inv.adrenaline + 1);
    if (kind === 'battery') inv.battery = Math.min(CONFIG.PLAYER.maxBatteries, inv.battery + 1);
  }

  applyRevive(o) {
    if (o.isLocal) {
      o.downed = false;
      o.health = 1;
      o.bleed = CONFIG.PLAYER.bleedOutTime;
      this.hud.toast(t('health_injured'));
    } else if (o.isBot) {
      o.downed = false;
      o.health = 1;
      o.bleed = CONFIG.PLAYER.bleedOutTime;
    } else this.session.sendTo(o.id, 'revived', { id: o.id });
    this.fx('success', o.pos);
  }

  hostSetDoor(door, target, byMonster = false) {
    if (door.target === target) return;
    door.target = target;
    this.stateDirty = true;
    this.fx(target > 0.5 ? 'door_open' : 'door_close', door.pos, null, door.kind);
    if (byMonster) this.addNoise(door.pos.slice(), 6, null);
  }

  // Inventory pickups for remote players arrive as fx targeted messages
  fxTo(id, kind, data = {}) {
    if (!id) return;
    if (id === this.local.id) this.playFx({ k: kind, ...data, to: id });
    else if (!this.survivorById(id)?.isBot) this.session.sendTo(id, 'fx', { k: kind, ...data, to: id });
  }

  fx(name, pos, toId = null, extra = null) {
    const d = { k: 'snd', n: name, p: pos ? [pos[0], pos[1] || 1, pos[2]] : null, x: extra };
    this.playFx(d);
    this.session.send('fx', d);
  }

  playFx(d) {
    const a = this.audio;
    if (d.to && d.to !== this.local.id) return;
    switch (d.k) {
      case 'snd': {
        const map = {
          door_open: d.x === 'bars' || d.x === 'gate' ? 'gate' : 'door_open',
          door_close: d.x === 'bars' || d.x === 'gate' ? 'gate' : 'door_close',
          pickup: 'pickup', fuse: 'fuse', lever: 'lever', success: 'success', error: 'error', beep: 'beep',
          spark: 'spark', valve: 'door_open', inject: 'inject', radio_wrong: 'radio',
        };
        const snd = map[d.n] || d.n;
        if (d.p) a?.play(snd, { pos: d.p, volume: 1, refDistance: 2.5, maxDistance: 35 });
        else a?.play(snd, { volume: 0.8 });
        if (d.n === 'spark') this.hud.toast('⚡', 'bad');
        break;
      }
      case 'got': {
        const s = this.local;
        if (PERSONAL.has(d.kind) && !this.isHost) this.giveItem(s, d.kind);
        s.stats.pickups++;
        this.hud.toast(`+ ${t('it_' + d.kind)}`);
        break;
      }
      case 'held':
        this.local.inv.held = d.id;
        this.hud.toast(`+ ${t('it_' + (this.items.byId.get(d.id)?.kind || 'bottle'))}`);
        break;
      case 'ping':
        if (Array.isArray(d.p)) this.hud.addPing(d.p, String(d.n || '').slice(0, 24));
        this.audio?.ui('beep', 0.4);
        break;
      case 'chat':
        if (d.i >= 1 && d.i <= 4) this.hud.chat(String(d.n || '').slice(0, 24), t('q' + d.i));
        break;
      case 'wrongcode':
        this.hud.toast(t('wrong_code'), 'bad');
        break;
      case 'reviveDone':
        this.stats.revives++;
        break;
      default:
        break;
    }
  }

  addNoise(pos, radius, source = null, lure = false) {
    if (this.isHost) {
      this.noises.push({ pos, radius, source, t: this.time, lure });
    } else if (this.time - this.lastNoiseSent > 0.25 || radius > 10) {
      this.lastNoiseSent = this.time;
      this.session.toHost('nz', { p: pos.map((v) => Math.round(v * 10) / 10), r: radius, l: lure ? 1 : 0 });
    }
  }

  throwProp(id, from, dir, speed) {
    const pr = this.items.byId.get(id);
    if (!pr) return;
    const v = [dir[0] * speed, dir[1] * speed + 1.5, dir[2] * speed];
    pr.holder = null;
    pr.throw(from, dir, speed);
    pr.vel = v.slice();
    this.session.send('th', { id, p: from, v });
  }

  onPropImpact(pr, v) {
    const snd = pr.kind === 'bottle' ? (v > 4 ? 'glass' : 'can') : 'can';
    this.audio?.play(snd, { pos: pr.pos, volume: Math.min(1, v / 6), refDistance: 2.5, maxDistance: 40 });
    if (this.isHost && v > 2.5) this.noises.push({ pos: pr.pos.slice(), radius: 20, source: null, t: this.time, lure: true });
  }

  hitSurvivor(s, monster, fromHide = false) {
    if (!s.active || s.downed) return;
    this.fx('hurt', s.pos);
    this.audio?.play('scream', { pos: [monster.pos[0], 2, monster.pos[2]], volume: 0.8, refDistance: 4, maxDistance: 40 });
    if (s.isLocal) this.applyHit(s, fromHide);
    else if (s.isBot) {
      s.health -= fromHide ? 2 : 1;
      if (s.health <= 0) {
        s.health = 0;
        s.downed = true;
        s.bleed = CONFIG.PLAYER.bleedOutTime;
      }
      s.hidden = null;
    } else this.session.sendTo(s.id, 'hit', { id: s.id, h: fromHide ? 1 : 0 });
  }

  applyHit(s, fromHide) {
    if (!s.active || s.downed) return;
    s.health -= fromHide ? 2 : 1;
    this.audio?.play('hurt', { volume: 1 });
    this.audio?.play('stinger', { volume: 0.6 });
    if (s.health <= 0) {
      s.health = 0;
      s.downed = true;
      s.bleed = this.cfg.players.length === 1 ? 18 : CONFIG.PLAYER.bleedOutTime;
      this.hud.toast(t('downed_msg'), 'bad');
    }
    this.player.onHit(s.downed);
    this.sendT = 0; // push state immediately
  }

  localDied() {
    const s = this.local;
    if (s.dead) return;
    s.dead = true;
    s.downed = false;
    this.hud.banner(t('you_died'), 'bad');
    this.audio?.play('stinger', { volume: 0.8 });
    this.sendT = 0;
    if (this.isHost) this.onSurvivorDied(s);
  }

  localEscaped() {
    const s = this.local;
    if (s.escaped) return;
    s.escaped = true;
    this.hud.banner(t('you_escaped'), 'good');
    this.audio?.play('success', { volume: 1 });
    this.sendT = 0;
    if (this.isHost) this.onSurvivorEscaped(s);
  }

  onSurvivorEscaped(s) {
    if (s !== this.local) this.hud.toast(`${s.name}: ${t('health_escaped')}`, 'good');
    this.checkEnd();
  }
  onSurvivorDied(s) {
    if (s !== this.local) this.hud.toast(`${s.name}: ${t('health_dead')}`, 'bad');
    this.checkEnd();
  }

  checkEnd() {
    if (!this.isHost || this.ended) return;
    if (this.survivors.some((s) => s.active)) return;
    const res = {};
    for (const s of this.survivors) res[s.id] = { e: s.escaped ? 1 : 0 };
    const d = { r: res, t: Math.round(this.time), obj: this.puzzles.objectives.filter((o) => this.puzzles.isDone(o.id)).length };
    this.session.send('end', d);
    this.onEnd(d);
  }

  onEnd(d) {
    if (this.ended) return;
    this.ended = true;
    this.endData = d;
    setTimeout(() => this.app.onMatchEnd(this, d), 2500);
  }

  onObjectiveDone(o) {
    const w = this.world;
    for (const g of o.power || []) w.setPowerGroup(g, true);
    if (o.power?.length) this.audio?.play('power_on', { volume: 0.9 });
    for (const door of w.doors) {
      if (door.locked === o.id) {
        door.locked = null;
        door.target = 1;
        if (this.isHost) this.stateDirty = true;
      }
    }
    if (o.type === 'exit') {
      this.exitOpen = true;
      this.hud.banner(t('exit_open'), 'good');
      this.audio?.play('bell', { volume: 0.6 });
      this.audio?.play('stinger', { volume: 0.5 });
      if (this.def.id === 'town' && w.busPos) {
        this.busLights = [
          { pos: [w.busPos[0] + 7.8, 1.2, w.busPos[2] - 0.8], dir: [1, -0.1, 0], color: [1, 0.95, 0.8], intensity: 4, range: 30, outer: 0.5, inner: 0.25, shadow: false },
        ];
        this.audio?.play('generator', { pos: w.busPos, loop: true, volume: 0.8, rate: 0.7 });
      }
      // the monster gets angry when the exit opens
      if (this.isHost && this.monster) this.monster.def = { ...this.monster.def, chase: this.monster.def.chase * 1.1 };
    } else {
      this.hud.toast('✔ ' + t(o.text, { n: o.count ?? 0, m: o.count ?? 0 }), 'good');
      this.audio?.play('objective', { volume: 0.8 });
      this.stats.objectives++;
    }
  }

  // ------------------------------------------------------------------ state replication
  worldState() {
    return {
      pz: this.puzzles.serialize(),
      tk: this.items.pickups.filter((p) => p.taken).map((p) => p.id),
      ph: this.items.props.filter((p) => p.holder).map((p) => [p.id, p.holder]),
      dr: this.world.doors.map((d) => (d.target > 0.5 ? 1 : 0)),
      t: Math.round(this.time),
    };
  }

  applyWorldState(d) {
    if (d.pz) this.puzzles.applyState(d.pz);
    if (d.tk) {
      const set = new Set(d.tk);
      for (const p of this.items.pickups) p.taken = set.has(p.id);
    }
    if (d.ph) {
      const held = new Map(d.ph);
      for (const p of this.items.props) {
        const h = held.get(p.id);
        if (h) p.holder = h;
        else if (p.holder && !held.has(p.id)) p.holder = null;
      }
    }
    if (d.dr) d.dr.forEach((v, i) => this.world.doors[i] && (this.world.doors[i].target = v));
  }

  // ------------------------------------------------------------------ interactables
  interactables() {
    const list = (this._inter ||= []);
    list.length = 0;
    const s = this.local;
    for (const door of this.world.doors) {
      if (!door._inter) {
        door._inter = {
          id: 'door' + door.id,
          door,
          pos: [door.pos[0], 1.2, door.pos[2]],
          radius: 2.3,
          label: () => (door.locked ? t('i_locked') : door.target > 0.5 ? t('i_close') : t('i_open')),
          available: () => door.kind !== 'gate',
          enabled: () => !door.locked,
          action: () => this.request({ a: 'door', id: door.id }),
        };
      }
      list.push(door._inter);
    }
    for (const p of this.items.pickups) {
      if (!this.items.isAvailable(p)) continue;
      if (!p._inter)
        p._inter = {
          id: 'pick' + p.id,
          pos: [p.pos[0], p.pos[1] + 0.1, p.pos[2]],
          radius: 2.1,
          label: () => `${t('i_pickup')}: ${t('it_' + p.kind)}`,
          available: () => this.items.isAvailable(p),
          action: () => {
            this.request({ a: 'pickup', id: p.id });
            p.taken = true; // optimistic hide; host state corrects it
          },
        };
      list.push(p._inter);
    }
    for (const pr of this.items.props) {
      if (pr.holder || !pr.sleeping) continue;
      if (!pr._inter)
        pr._inter = {
          id: 'prop' + pr.id,
          pos: pr.pos,
          radius: 2.0,
          label: () => `${t('i_pickup')}: ${t('it_' + pr.kind)}`,
          available: () => !pr.holder && !this.local.inv.held,
          action: () => this.request({ a: 'pickup', id: pr.id }),
        };
      list.push(pr._inter);
    }
    for (const it of this.puzzles.interactables) list.push(it);
    for (const o of this.survivors) {
      if (o === s || !o.active || !o.downed) continue;
      if (!o._inter)
        o._inter = {
          id: 'rev' + o.id,
          pos: [0, 0.4, 0],
          radius: 2.0,
          revive: o.id,
          hold: () => CONFIG.PLAYER.reviveTime * (s.perks.includes('medic') ? 0.65 : 1),
          label: () => `${t('i_revive')}: ${o.name}`,
          available: () => o.downed && o.active,
          action: () => this.request({ a: 'revive', id: o.id }),
        };
      o._inter.pos[0] = o.pos[0];
      o._inter.pos[2] = o.pos[2];
      list.push(o._inter);
    }
    for (const spot of this.world.hideSpots) {
      if (!spot._inter)
        spot._inter = {
          id: 'hide' + spot.id,
          pos: [spot.front[0] * 0.6 + spot.pos[0] * 0.4, 1.2, spot.front[2] * 0.6 + spot.pos[2] * 0.4],
          radius: 1.9,
          label: () => t('i_hide'),
          available: () => !this.survivors.some((o) => o.hidden === spot.id),
          action: () => this.player.enterHide(spot),
        };
      list.push(spot._inter);
    }
    return list;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    const input = this.input;
    input.update();
    if (input.pressed('pause')) this.app.pauseMatch();
    if (input.pressed('ping')) this.ping();
    for (let i = 1; i <= 4; i++) if (input.pressed('chat' + i)) this.quickChat(i);
    if (input.pressed('chat')) this.ui.openChatWheel((i) => this.quickChat(i));

    this.player.update(dt, input, this.cam);
    // host simulation
    if (this.isHost) {
      for (const s of this.survivors) if (s.brain) s.brain.update(dt);
      this.monster.hostUpdate(dt);
      if (this.puzzles.hostUpdate(dt)) this.stateDirty = this.stateDirty || this.stateT > 0.5;
      // prune noises
      this.noises = this.noises.filter((n) => this.time - n.t < 2);
      // host-side end checks for remote players
      this.checkEnd();
    } else {
      this.monster.clientUpdate(dt);
    }
    for (const s of this.survivors) {
      if (!s.isLocal && !s.isBot) s.interpolate(dt);
      if (s.isBot && !this.isHost) s.interpolate(dt);
    }
    this.items.update(dt);
    this.world.update(dt, this.time);
    this.puzzles.update(dt, this.time);
    this.netTick(dt);
    this.updateAudio(dt);
    input.endFrame();
  }

  netTick(dt) {
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / CONFIG.NET_SEND_RATE;
      this.session.send('ps', this.local.netState());
    }
    if (!this.isHost) return;
    this.stateT += dt;
    if (this.stateDirty || this.stateT > 3) {
      this.stateDirty = false;
      this.stateT = 0;
      this.session.send('ws', this.worldState());
    }
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 1 / CONFIG.NET_WORLD_RATE;
      const b = {};
      for (const s of this.survivors) if (s.isBot) b[s.id] = s.netState();
      this.session.send('ms', { m: this.monster.snapshot(), b });
    }
  }

  ping() {
    const s = this.local;
    const dir = v3.fromYawPitch([0, 0, 0], s.yaw, s.pitch);
    const hit = this.world.physics.raycast(this.cam.pos, dir, 40);
    const p = hit ? v3.addScaled([0, 0, 0], this.cam.pos, dir, hit.t - 0.2) : v3.addScaled([0, 0, 0], this.cam.pos, dir, 10);
    this.session.send('fx', { k: 'ping', p, n: s.name });
    this.hud.addPing(p, s.name);
    this.audio?.ui('beep', 0.5);
  }

  quickChat(i) {
    const msg = t('q' + i);
    this.session.send('fx', { k: 'chat', i, n: this.local.name });
    this.hud.chat(this.local.name, msg);
  }

  updateAudio(dt) {
    const a = this.audio;
    if (!a) return;
    a.setListener(this.cam.pos, this.cam.forward);
    const m = this.monster;
    const d = v3.distXZ(m.pos, this.local.pos);
    const chase = m.state === 'chase' && (m.target === this.local.id || d < 18) ? 1 : 0;
    this.chaseLevel = damp(this.chaseLevel || 0, chase, chase ? 3 : 0.5, dt);
    const tension = clamp(0.25 + (1 - d / 40) * 0.5, 0.2, 0.75);
    a.setMusicLevels({ music_tension: tension * (1 - this.chaseLevel * 0.7), music_chase: this.chaseLevel * 0.9 });
  }

  // ------------------------------------------------------------------ render
  render(dt) {
    const sc = this.scene;
    sc.static.length = 0;
    sc.dynamic.length = 0;
    sc.viewmodel.length = 0;
    sc.pointLights.length = 0;
    sc.spotLights.length = 0;
    sc.glows.length = 0;
    this.world.collect(sc);
    this.items.collect(sc);
    this.puzzles.collect(sc);
    const local = this.local;
    // local flashlight first (gets the first shadow tile)
    if (local.active) sc.spotLights.push(local.flash);
    for (const s of this.survivors) {
      if (s === local && local.active) continue;
      s.updateVisual(dt, this.cam);
      s.collect(sc);
      if (s.flash.intensity > 0) sc.spotLights.push(s.flash);
    }
    if (this.busLights) sc.spotLights.push(...this.busLights);
    this.monster.update(dt, this.cam);
    this.monster.collect(sc);
    this.player.collectViewmodel(sc, this.cam);
    // post effects
    const post = this.renderer.post;
    post.fear = this.player.fear;
    post.damage = Math.max(this.player.damageFlash, local.health === 1 ? 0.25 + Math.sin(this.time * 3) * 0.08 : 0, local.downed ? 0.6 : 0);
    post.desat = local.downed ? 0.6 : local.dead ? 1 : 0;
    post.vignette = 0.4 + (local.hidden !== null ? 1.2 : 0);
    sc.env = this.def.env;
    this.renderer.render(sc, this.cam, dt);
    this.hud.update(this, dt);
  }

  dispose() {
    this.ambience?.stop(0.5);
    this.monster?.dispose();
    this.player?.repairSound?.stop(0.2);
    this.audio?.stopAllLoops();
    this.session.leave?.();
  }
}
