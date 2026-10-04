// Objective/puzzle system (Escape-the-Backrooms style chains). The host owns the state; clients
// receive the full state and replay transitions locally (sounds, doors, power).
import { DrawItem } from '../engine/renderer.js';
import { MAT } from '../engine/textures.js';
import { m4, v3, mulberry32 } from '../engine/math.js';
import { t } from './i18n.js';
import { noteTexture, symbolTexture, sequenceTexture, boardTexture, SYMBOLS, writingTexture } from './decals.js';

const LAMP_OFF = [0.25, 0.02, 0.02];
const LAMP_ON = [0.1, 1, 0.25];

export class Puzzles {
  constructor(game, def, seed) {
    this.game = game;
    this.def = def;
    this.rnd = mulberry32(seed ^ 0xabcdef);
    this.objectives = def.objectives;
    this.state = { obj: {}, team: { fuse: 0, key: 0, gas: 0, keycard: 0, tape: 0 } };
    this.items = []; // draw items
    this.interactables = [];
    this.visual = {};
    this.prevDone = {};
    this.messages = [];
  }

  isDone(id) {
    return !!this.state.obj[id]?.done;
  }
  reqsDone(o) {
    return (o.requires || []).every((r) => this.isDone(r));
  }
  objDef(id) {
    return this.objectives.find((o) => o.id === id);
  }

  // ------------------------------------------------------------------ build
  build() {
    const w = this.game.world;
    for (const o of this.objectives) {
      const st = (this.state.obj[o.id] = { done: false });
      const anchors = (c) => (w.anchors[c] || []).slice();
      switch (o.type) {
        case 'collect': {
          st.delivered = 0;
          if (o.revealsCode) st.code = this.randomCode();
          const spawns = this.rnd.shuffle(anchors(o.spawn));
          const n = o.late ? o.count - 1 : o.count;
          for (let i = 0; i < n && i < spawns.length; i++) this.game.items.addPickup(o.item, this.game.items.jitter(spawns[i].pos));
          if (o.late) {
            const la = anchors(o.late.anchor)[0];
            if (la) this.game.items.addPickup(o.item, [la.pos[0] + 0.6, 0.9, la.pos[2]], { hiddenUntil: o.late.after });
            if (la) this.buildPump(la);
          }
          if (o.deliver) {
            const a = anchors(o.deliver)[0];
            if (a) this.buildDeliver(o, a);
          }
          break;
        }
        case 'keypad': {
          st.code = o.codeFrom ? null : this.randomCode();
          const a = anchors(o.keypad)[0];
          if (a) this.buildKeypad(o, a);
          if (o.notes && st.code) {
            const notes = this.rnd.shuffle(anchors(o.notes)).slice(0, 4);
            const digits = st.code.split('');
            notes.forEach((na, i) => {
              // each note reveals one or more digits with their position
              const mask = digits.map((d, k) => (k % notes.length === i ? d : '_')).join(' ');
              this.buildNote(na, [{ text: t('note') + ' #' + (i + 1), size: 26 }, { text: mask, size: 46 }, { text: '— ? —', size: 22 }], o.id);
            });
          }
          break;
        }
        case 'levers': {
          const list = anchors(o.anchor);
          let pattern;
          do pattern = list.map(() => this.rnd() < 0.5);
          while (pattern.every((p) => !p));
          st.pattern = pattern;
          st.levers = list.map(() => false);
          list.forEach((a, i) => this.buildLever(o, a, i));
          const b = anchors(o.board)[0];
          if (b) this.buildBoard(o, b);
          break;
        }
        case 'generator': {
          st.progress = 0;
          const a = anchors(o.anchor)[0];
          if (a) this.buildGenerator(o, a);
          break;
        }
        case 'radio': {
          st.freq = +(88 + Math.floor(this.rnd() * 190) / 10).toFixed(1);
          st.code = this.randomCode();
          const a = anchors(o.anchor)[0];
          if (a) this.buildRadio(o, a);
          const notes = anchors(o.notes);
          if (notes.length) this.buildNote(notes[Math.floor(this.rnd() * notes.length)], [{ text: 'FM', size: 30 }, { text: st.freq.toFixed(1), size: 56 }, { text: t('radio_hint'), size: 22 }], o.id);
          // keypads whose code comes from this radio
          for (const k of this.objectives) if (k.codeFrom === o.id) this.state.obj[k.id] && (this.state.obj[k.id].code = st.code);
          break;
        }
        case 'valves': {
          const list = anchors(o.anchor);
          st.valves = list.map(() => false);
          list.forEach((a, i) => this.buildValve(o, a, i));
          break;
        }
        case 'symbols': {
          const list = anchors(o.anchor).slice(0, 4);
          const syms = this.rnd.shuffle(SYMBOLS.slice()).slice(0, list.length);
          st.syms = syms;
          st.order = this.rnd.shuffle(list.map((_, i) => i));
          st.progress = 0;
          list.forEach((a, i) => this.buildSymbol(o, a, i, syms[i]));
          const c = anchors(o.clue)[0];
          if (c) this.buildClue(c, st.order.map((i) => syms[i]));
          break;
        }
        case 'exit':
          break;
        default:
          break;
      }
    }
    // keypad codes depending on radios created after them
    for (const o of this.objectives) {
      if (o.type === 'keypad' && o.codeFrom) this.state.obj[o.id].code = this.state.obj[o.codeFrom]?.code;
    }
    this.buildWritings();
    for (const o of this.objectives) this.prevDone[o.id] = false;
  }

  randomCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += Math.floor(this.rnd() * 10);
    return s;
  }

  item(mesh, mat, color, emissive = 0) {
    const it = new DrawItem(mesh, mat, color);
    it.emissive = emissive;
    it.radius = 1.5;
    it.castShadow = false;
    this.items.push(it);
    return it;
  }
  place(it, pos, yaw, scale, offset = [0, 0, 0], rot = null) {
    const m = it.model;
    m4.identity(m);
    m4.translate(m, m, pos[0], pos[1], pos[2]);
    m4.rotateY(m, m, yaw);
    m4.translate(m, m, offset[0], offset[1], offset[2]);
    if (rot) {
      m4.rotateX(m, m, rot[0]);
      m4.rotateY(m, m, rot[1]);
      m4.rotateZ(m, m, rot[2]);
    }
    m4.scale(m, m, scale[0], scale[1], scale[2]);
    it.center = pos.slice();
    it.sky = this.game.world.isIndoorAt(pos) ? 0 : 1;
    return it;
  }
  mount(anchor, h = 1.3) {
    if (anchor.wall) return this.game.world.wallMount(anchor, h, 0.02);
    return { pos: [anchor.pos[0], h, anchor.pos[2]], normal: [0, 0, 1], yaw: 0 };
  }
  addInteract(def) {
    this.interactables.push({ radius: 2.0, hold: 0, ...def });
  }

  // ------------------------------------------------------------------ visuals per type
  buildDeliver(o, a) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.25);
    const n = o.count;
    const panel = this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.3, 0.32, 0.3]), mt.pos, mt.yaw, [0.46, 0.6, 0.14], [0, 0, 0.07]);
    void panel;
    const lamps = [];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.13;
      this.place(this.item(P.cube, MAT.RUST_METAL, [0.1, 0.1, 0.1]), mt.pos, mt.yaw, [0.09, 0.2, 0.03], [x, -0.05, 0.15]);
      lamps.push(this.place(this.item(P.sphere, MAT.LAMP, LAMP_OFF, 1.5), mt.pos, mt.yaw, [0.05, 0.05, 0.05], [x, 0.2, 0.15]));
    }
    this.visual[o.id] = { lamps };
    const focus = v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.2);
    this.addInteract({
      id: 'pz_' + o.id,
      pos: focus,
      label: () => {
        const have = this.state.team[o.item] || 0;
        const itemName = t('it_' + o.item);
        return have > 0 ? `${t('i_place')}: ${itemName} (${have})` : t('i_need_item', { item: itemName });
      },
      available: () => !this.isDone(o.id) && this.reqsDone(o),
      enabled: () => (this.state.team[o.item] || 0) > 0,
      action: () => this.game.request({ a: 'deliver', o: o.id }),
      bot: { type: 'deliver', o: o.id, item: o.item },
    });
  }

  buildPump(a) {
    const P = this.game.prims;
    this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.7, 0.15, 0.1]), [a.pos[0], 0, a.pos[2]], 0, [0.6, 1.6, 0.4], [0, 0.8, 0]);
    this.place(this.item(P.cube, MAT.LAMP, [1, 0.9, 0.6], 0), [a.pos[0], 0, a.pos[2]], 0, [0.4, 0.3, 0.02], [0, 1.2, -0.21]);
    this.game.world.physics.add({ min: [a.pos[0] - 0.3, 0, a.pos[2] - 0.2], max: [a.pos[0] + 0.3, 1.6, a.pos[2] + 0.2] });
  }

  buildKeypad(o, a) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.35);
    this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.25, 0.26, 0.27]), mt.pos, mt.yaw, [0.24, 0.34, 0.06], [0, 0, 0.03]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.7, 0.7, 0.65], 0.05), mt.pos, mt.yaw, [0.05, 0.045, 0.02], [(c - 1) * 0.065, 0.06 - r * 0.06, 0.065]);
    const lamp = this.place(this.item(P.sphere, MAT.LAMP, LAMP_OFF, 1.5), mt.pos, mt.yaw, [0.03, 0.03, 0.03], [0, 0.14, 0.065]);
    this.visual[o.id] = { lamps: [lamp] };
    this.addInteract({
      id: 'pz_' + o.id,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.15),
      label: () => t('i_keypad'),
      available: () => !this.isDone(o.id) && this.reqsDone(o),
      action: () => this.game.ui.openKeypad((code) => this.game.request({ a: 'code', o: o.id, code })),
    });
  }

  buildNote(a, lines, objId) {
    const mt = this.mount(a, 1.45);
    const { tex, canvas } = noteTexture(this.game.gl, lines, Math.floor(this.rnd() * 1000) + 1);
    const it = this.place(this.item(this.game.prims.quad, MAT.PAPER, [1, 1, 1]), mt.pos, mt.yaw, [0.42, 0.52, 1], [0, 0, 0.012]);
    it.decal = tex;
    this.addInteract({
      id: 'note_' + a.x + '_' + a.z,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.05),
      label: () => t('i_read'),
      available: () => true,
      action: () => this.game.ui.showNote(canvas),
      noteFor: objId,
    });
  }

  buildLever(o, a, i) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.2);
    this.place(this.item(P.cube, MAT.RUST_METAL, [0.5, 0.48, 0.45]), mt.pos, mt.yaw, [0.22, 0.45, 0.06], [0, 0, 0.03]);
    const handle = this.item(P.cylinder, MAT.PAINTED_METAL, [0.6, 0.1, 0.08]);
    const lamp = this.place(this.item(P.sphere, MAT.LAMP, LAMP_OFF, 1.2), mt.pos, mt.yaw, [0.04, 0.04, 0.04], [0, 0.27, 0.07]);
    const vis = (this.visual[o.id] ||= { levers: [], lamps: [] });
    vis.levers[i] = { handle, mt, angle: -0.7 };
    vis.lamps[i] = lamp;
    this.addInteract({
      id: 'pz_' + o.id + '_' + i,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.2),
      label: () => (this.reqsDone(o) ? t('i_lever') : t('i_locked')),
      available: () => !this.isDone(o.id),
      enabled: () => this.reqsDone(o),
      action: () => this.game.request({ a: 'lever', o: o.id, i }),
      bot: { type: 'lever', o: o.id, i },
    });
  }

  buildBoard(o, a) {
    const mt = this.mount(a, 1.9);
    const it = this.place(this.item(this.game.prims.quad, MAT.PAINTED_METAL, [1, 1, 1], 0.6), mt.pos, mt.yaw, [1.1, 0.55, 1], [0, 0, 0.015]);
    it.decal = boardTexture(this.game.gl, this.state.obj[o.id].pattern, false);
    this.visual[o.id].board = it;
    this.visual[o.id].boardPowered = false;
  }

  buildGenerator(o, a) {
    const P = this.game.prims;
    const pos = [a.pos[0], 0, a.pos[2]];
    this.place(this.item(P.cube, MAT.RUST_METAL, [0.45, 0.42, 0.36]), pos, 0, [1.3, 0.8, 0.8], [0, 0.4, 0]);
    this.place(this.item(P.cylinder, MAT.PAINTED_METAL, [0.5, 0.15, 0.1]), pos, 0, [0.5, 0.9, 0.5], [0.2, 0.9, 0], [0, 0, Math.PI / 2]);
    this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.15, 0.15, 0.15]), pos, 0, [0.3, 0.5, 0.3], [-0.45, 1.05, 0]);
    const lamp = this.place(this.item(P.sphere, MAT.LAMP, LAMP_OFF, 1.5), pos, 0, [0.07, 0.07, 0.07], [-0.45, 1.35, 0]);
    this.game.world.physics.add({ min: [pos[0] - 0.7, 0, pos[2] - 0.45], max: [pos[0] + 0.7, 1.3, pos[2] + 0.45] });
    this.visual[o.id] = { lamps: [lamp], pos };
    this.addInteract({
      id: 'pz_' + o.id,
      pos: [pos[0], 0.9, pos[2]],
      radius: 2.3,
      label: () => `${t('i_repair')} ${Math.floor((this.state.obj[o.id].progress || 0) * 100)}%`,
      available: () => !this.isDone(o.id),
      repair: o.id,
      bot: { type: 'repair', o: o.id },
    });
  }

  buildRadio(o, a) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.0);
    this.place(this.item(P.cube, MAT.WOOD, [0.5, 0.35, 0.22]), mt.pos, mt.yaw, [0.55, 0.32, 0.26], [0, 0, 0.14]);
    this.place(this.item(P.cube, MAT.LAMP, [1, 0.7, 0.3], 0), mt.pos, mt.yaw, [0.3, 0.08, 0.01], [-0.05, 0.06, 0.275]);
    this.place(this.item(P.cylinder, MAT.PAINTED_METAL, [0.15, 0.15, 0.15]), mt.pos, mt.yaw, [0.07, 0.03, 0.07], [0.2, -0.05, 0.28], [Math.PI / 2, 0, 0]);
    this.place(this.item(P.cylinder, MAT.RUST_METAL, [0.5, 0.5, 0.5]), mt.pos, mt.yaw, [0.01, 0.5, 0.01], [0.22, 0.4, 0.1], [0, 0, -0.3]);
    this.visual[o.id] = { lamps: [] };
    this.addInteract({
      id: 'pz_' + o.id,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.3),
      label: () => t('i_radio'),
      available: () => !this.isDone(o.id),
      action: () => this.game.ui.openRadio((f) => this.game.request({ a: 'radio', o: o.id, f }), this.state.obj[o.id].freq),
    });
  }

  buildValve(o, a, i) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.3);
    this.place(this.item(P.cylinder, MAT.RUST_METAL, [0.5, 0.45, 0.4]), mt.pos, mt.yaw, [0.12, 3.0, 0.12], [0, 0.2, 0.12]);
    const wheel = [];
    for (let k = 0; k < 4; k++) wheel.push(this.item(P.cube, MAT.PAINTED_METAL, [0.7, 0.1, 0.08]));
    const rim = this.item(P.cylinder, MAT.PAINTED_METAL, [0.7, 0.1, 0.08]);
    const lamp = this.place(this.item(P.sphere, MAT.LAMP, LAMP_OFF, 1.2), mt.pos, mt.yaw, [0.04, 0.04, 0.04], [0.3, 0.3, 0.05]);
    const vis = (this.visual[o.id] ||= { valves: [], lamps: [] });
    vis.valves[i] = { wheel, rim, mt, angle: 0 };
    vis.lamps[i] = lamp;
    this.addInteract({
      id: 'pz_' + o.id + '_' + i,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.3),
      label: () => t('i_valve'),
      hold: 2.5,
      holdSound: 'door_open',
      available: () => !this.isDone(o.id) && !this.state.obj[o.id].valves[i],
      action: () => this.game.request({ a: 'valve', o: o.id, i }),
      bot: { type: 'valve', o: o.id, i },
    });
  }

  buildSymbol(o, a, i, sym) {
    const P = this.game.prims;
    const mt = this.mount(a, 1.4);
    this.place(this.item(P.cube, MAT.PAINTED_METAL, [0.2, 0.2, 0.2]), mt.pos, mt.yaw, [0.42, 0.42, 0.05], [0, 0, 0.025]);
    const face = this.place(this.item(P.quad, MAT.PAINTED_METAL, [1, 1, 1], 0.15), mt.pos, mt.yaw, [0.36, 0.36, 1], [0, 0, 0.055]);
    face.decal = symbolTexture(this.game.gl, sym);
    const vis = (this.visual[o.id] ||= { faces: [] });
    vis.faces[i] = face;
    this.addInteract({
      id: 'pz_' + o.id + '_' + i,
      pos: v3.addScaled([0, 0, 0], mt.pos, mt.normal, 0.15),
      label: () => t('i_button') + ' ' + sym,
      available: () => !this.isDone(o.id) && this.reqsDone(o),
      action: () => this.game.request({ a: 'sym', o: o.id, i }),
    });
  }

  buildClue(a, syms) {
    const mt = this.mount(a, 1.7);
    const it = this.place(this.item(this.game.prims.quad, MAT.PLASTER, [1, 1, 1]), mt.pos, mt.yaw, [1.7, 0.53, 1], [0, 0, 0.012]);
    it.decal = sequenceTexture(this.game.gl, syms);
  }

  buildWritings() {
    const w = this.game.world;
    const lang = this.game.lang === 'ru' ? 'ru' : 'en';
    const texts = this.def.writings?.[lang] || [];
    if (!texts.length) return;
    const cells = [];
    for (let z = 1; z < w.h - 1; z++) {
      for (let x = 1; x < w.w - 1; x++) {
        const c = w.at(x, z);
        if (!'.,l'.includes(c)) continue;
        const ws = w.wallSide(x, z);
        if (ws) cells.push({ x, z, pos: w.center(x, z), wall: ws });
      }
    }
    this.rnd.shuffle(cells);
    const n = Math.min(cells.length, 10);
    for (let i = 0; i < n; i++) {
      const a = cells[i];
      const mt = w.wallMount(a, 1.4 + this.rnd() * 0.6, 0.01);
      const it = this.place(this.item(this.game.prims.quad, MAT.PAINTED_METAL, [1, 1, 1]), mt.pos, mt.yaw, [1.6, 0.4, 1], [0, 0, 0.01]);
      it.decal = writingTexture(this.game.gl, texts[i % texts.length]);
    }
  }

  // ------------------------------------------------------------------ host logic
  hostHandle(req, survivor) {
    const o = this.objDef(req.o);
    if (!o) return false;
    const st = this.state.obj[o.id];
    if (st.done || !this.reqsDone(o)) return false;
    const near = (pos, r = 5) => !survivor || v3.distXZ(survivor.authPos, pos) < r;
    switch (req.a) {
      case 'deliver': {
        if ((this.state.team[o.item] || 0) <= 0) return false;
        const a = this.game.world.anchors[o.deliver]?.[0];
        if (a && !near(a.pos)) return false;
        this.state.team[o.item]--;
        st.delivered++;
        this.game.fx('fuse', a?.pos);
        if (st.delivered >= o.count) this.complete(o);
        return true;
      }
      case 'code': {
        if (String(req.code) === st.code) {
          this.complete(o);
          this.game.fx('success', null, survivor?.id);
        } else {
          this.game.fx('error', survivor?.pos);
          if (survivor) this.game.addNoise(survivor.pos, 10, survivor.id);
          this.game.fxTo(survivor?.id, 'wrongcode');
        }
        return true;
      }
      case 'lever': {
        const i = req.i | 0;
        if (i < 0 || i >= st.levers.length) return false;
        st.levers[i] = !st.levers[i];
        const a = this.game.world.anchors[o.anchor][i];
        this.game.fx('lever', a.pos);
        if (st.levers.every((v, k) => v === st.pattern[k])) this.complete(o);
        return true;
      }
      case 'repfail': {
        st.progress = Math.max(0, (st.progress || 0) - 0.08);
        const pos = this.visual[o.id]?.pos;
        this.game.fx('spark', pos);
        if (pos) this.game.addNoise(pos, 28, survivor?.id);
        return true;
      }
      case 'repgreat': {
        st.progress = Math.min(1, (st.progress || 0) + 0.02);
        return true;
      }
      case 'radio': {
        const f = +req.f;
        if (Math.abs(f - st.freq) < 0.15) {
          this.complete(o);
        } else {
          this.game.fx('radio_wrong', null, survivor?.id);
        }
        return true;
      }
      case 'valve': {
        const i = req.i | 0;
        if (!st.valves || st.valves[i]) return false;
        st.valves[i] = true;
        const a = this.game.world.anchors[o.anchor][i];
        this.game.fx('valve', a.pos);
        if (st.valves.every(Boolean)) this.complete(o);
        return true;
      }
      case 'sym': {
        const i = req.i | 0;
        const a = this.game.world.anchors[o.anchor][i];
        if (st.order[st.progress] === i) {
          st.progress++;
          this.game.fx('beep', a?.pos);
          if (st.progress >= st.order.length) this.complete(o);
        } else {
          st.progress = 0;
          this.game.fx('error', a?.pos);
          if (a) this.game.addNoise(a.pos, 12, survivor?.id);
        }
        return true;
      }
      default:
        return false;
    }
  }

  // team item pickup (host)
  hostPickupTeamItem(kind) {
    this.state.team[kind] = (this.state.team[kind] || 0) + 1;
    for (const o of this.objectives) {
      if (o.type === 'collect' && o.item === kind && !o.deliver && !this.isDone(o.id)) {
        const st = this.state.obj[o.id];
        st.delivered = (st.delivered || 0) + 1;
        if (st.delivered >= o.count) this.complete(o);
      }
    }
  }

  complete(o) {
    const st = this.state.obj[o.id];
    if (st.done) return;
    st.done = true;
    this.checkExit();
  }

  checkExit() {
    for (const o of this.objectives) {
      if (o.type === 'exit' && !this.isDone(o.id) && this.reqsDone(o)) this.state.obj[o.id].done = true;
    }
  }

  hostUpdate(dt) {
    let changed = false;
    for (const o of this.objectives) {
      if (o.type !== 'generator' || this.isDone(o.id)) continue;
      const st = this.state.obj[o.id];
      let rate = 0;
      for (const s of this.game.survivors) if (s.active && !s.downed && s.repairing === o.id) rate += s.repairRate || 1;
      if (rate > 0) {
        st.progress = Math.min(1, st.progress + (dt / 45) * rate);
        changed = true;
        if (st.progress >= 1) this.complete(o);
      }
    }
    return changed;
  }

  // ------------------------------------------------------------------ state sync
  serialize() {
    return JSON.parse(JSON.stringify(this.state));
  }
  applyState(s) {
    this.state = s;
  }

  // Called every frame on all peers: replays transitions & updates visuals
  update(dt, time) {
    const g = this.game;
    for (const o of this.objectives) {
      const done = this.isDone(o.id);
      if (done && !this.prevDone[o.id]) {
        this.prevDone[o.id] = true;
        g.onObjectiveDone(o);
      }
      const st = this.state.obj[o.id];
      const vis = this.visual[o.id];
      if (!vis) continue;
      switch (o.type) {
        case 'collect':
          vis.lamps?.forEach((l, i) => l.setColor(i < (st.delivered || 0) ? LAMP_ON : LAMP_OFF));
          break;
        case 'keypad':
        case 'generator':
          vis.lamps.forEach((l) => l.setColor(done ? LAMP_ON : o.type === 'generator' && st.progress > 0 ? [1, 0.6, 0.1] : LAMP_OFF));
          if (o.type === 'generator' && done && vis.pos) {
            // vibrating engine
            vis.lamps[0].emissive = 2 + Math.sin(time * 30) * 0.3;
          }
          break;
        case 'levers': {
          const powered = this.reqsDone(o);
          if (vis.board && vis.boardPowered !== powered) {
            vis.boardPowered = powered;
            vis.board.decal = boardTexture(g.gl, st.pattern, powered);
          }
          vis.levers.forEach((lv, i) => {
            const target = st.levers[i] ? 0.7 : -0.7;
            lv.angle += (target - lv.angle) * Math.min(1, dt * 10);
            this.place(lv.handle, lv.mt.pos, lv.mt.yaw, [0.03, 0.32, 0.03], [0, 0, 0.1], [lv.angle, 0, 0]);
            const m = lv.handle.model;
            // pivot: shift so the handle rotates around its base
            m4.translate(m, m, 0, 0.5, 0);
          });
          vis.lamps.forEach((l, i) => l.setColor(!powered ? [0.05, 0.05, 0.05] : st.levers[i] === st.pattern[i] ? LAMP_ON : LAMP_OFF));
          break;
        }
        case 'valves':
          vis.valves.forEach((v, i) => {
            const target = st.valves[i] ? Math.PI * 4 : 0;
            v.angle += (target - v.angle) * Math.min(1, dt * 1.5);
            this.place(v.rim, v.mt.pos, v.mt.yaw, [0.42, 0.03, 0.42], [0, 0, 0.25], [Math.PI / 2, 0, 0]);
            v.wheel.forEach((sp, k) => this.place(sp, v.mt.pos, v.mt.yaw, [0.4, 0.035, 0.035], [0, 0, 0.26], [0, 0, v.angle + (k * Math.PI) / 4]));
          });
          vis.lamps.forEach((l, i) => l.setColor(st.valves[i] ? LAMP_ON : LAMP_OFF));
          break;
        case 'symbols':
          vis.faces.forEach((f, i) => {
            const pressed = st.order.slice(0, st.progress).includes(i);
            f.emissive = done ? 0.8 : pressed ? 0.6 : 0.12;
          });
          break;
        default:
          break;
      }
    }
  }

  collect(scene) {
    for (const it of this.items) scene.dynamic.push(it);
  }

  // HUD objective lines
  hudLines() {
    const out = [];
    for (const o of this.objectives) {
      const st = this.state.obj[o.id];
      if (!this.reqsDone(o) && !st.done) continue;
      let text = t(o.text, { n: st.delivered ?? 0, m: o.count ?? 0 });
      if (o.type === 'valves') text = t(o.text, { n: st.valves.filter(Boolean).length, m: st.valves.length });
      if (o.type === 'generator' && !st.done) text += ` — ${Math.floor(st.progress * 100)}%`;
      if ((o.type === 'radio' || o.revealsCode) && st.done) text += ` → ${t('keypad_title')}: ${st.code}`;
      if (o.type === 'collect' && o.deliver && !st.done) {
        const have = this.state.team[o.item] || 0;
        if (have) text += ` (+${have})`;
      }
      out.push({ text, done: st.done, id: o.id });
    }
    return out;
  }
}
