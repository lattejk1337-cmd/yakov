// In-match HUD. Elements are created once and only touched when values change.
import { h, clear } from './dom.js';
import { t } from '../game/i18n.js';
import { CONFIG } from '../game/config.js';
import { m4 } from '../engine/math.js';

const HEALTH_ICON = ['☠', '✚', '♥'];

export class HUD {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.cache = new Map();
    this.pings = [];
    this.build();
    this.visible(false);
  }

  build() {
    const r = this.root;
    clear(r);
    this.cache = new Map();
    this.pings = [];
    this.objectives = h('div', { class: 'hud-obj' });
    this.team = h('div', { class: 'hud-team' });
    this.prompt = h('div', { class: 'hud-prompt' });
    this.promptText = h('span', {});
    this.ring = h('div', { class: 'hud-ring' });
    this.prompt.append(this.ring, this.promptText);
    this.cross = h('div', { class: 'hud-cross' });
    this.staminaFill = h('div', { class: 'fill' });
    this.batteryFill = h('div', { class: 'fill' });
    this.healthEl = h('div', { class: 'hud-health' });
    this.inv = h('div', { class: 'hud-inv' });
    this.status = h('div', { class: 'hud-status' },
      this.healthEl,
      h('div', { class: 'hud-bars' },
        h('div', { class: 'hud-bar stamina' }, h('span', {}, '⚡'), h('div', { class: 'track' }, this.staminaFill)),
        h('div', { class: 'hud-bar battery' }, h('span', {}, '🔦'), h('div', { class: 'track' }, this.batteryFill))),
      this.inv);
    this.toasts = h('div', { class: 'hud-toasts' });
    this.bannerEl = h('div', { class: 'hud-banner' });
    this.center = h('div', { class: 'hud-center' });
    this.chatLog = h('div', { class: 'hud-chat' });
    this.fps = h('div', { class: 'hud-fps' });
    this.lockHint = h('div', { class: 'hud-lock' }, t('controls_hint_click'));
    this.pingLayer = h('div', { class: 'hud-pings' });
    this.hpVignette = h('div', { class: 'hud-vignette' });
    r.append(this.hpVignette, this.pingLayer, this.objectives, this.team, this.cross, this.prompt, this.status, this.toasts, this.bannerEl, this.center, this.chatLog, this.fps, this.lockHint);
  }

  visible(on) {
    this.root.classList.toggle('hidden', !on);
  }

  set(el, key, value, fn) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    fn(el, value);
  }

  toast(text, kind = '') {
    const el = h('div', { class: 'toast ' + kind }, text);
    this.toasts.prepend(el);
    while (this.toasts.children.length > 5) this.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  banner(text, kind = '') {
    this.bannerEl.textContent = text;
    this.bannerEl.className = 'hud-banner show ' + kind;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => (this.bannerEl.className = 'hud-banner ' + kind), 3500);
  }

  chat(name, msg) {
    const el = h('div', { class: 'chat-line' }, h('b', {}, name + ': '), msg);
    this.chatLog.append(el);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 7000);
    setTimeout(() => el.remove(), 7600);
  }

  addPing(p, name) {
    const el = h('div', { class: 'ping' }, h('div', { class: 'ping-icon' }, '📍'), h('div', { class: 'ping-name' }, name));
    this.pingLayer.append(el);
    this.pings.push({ p, el, t: 8 });
  }

  update(g, dt) {
    const s = g.local;
    const pl = g.player;
    const st = g.settings;
    // objectives
    const lines = g.puzzles.hudLines();
    const objKey = lines.map((l) => l.text + l.done).join('|');
    this.set(this.objectives, 'obj', objKey, (el) => {
      clear(el);
      el.append(h('div', { class: 'hud-title' }, t('objectives')));
      for (const l of lines) el.append(h('div', { class: 'obj' + (l.done ? ' done' : '') }, (l.done ? '✔ ' : '◇ ') + l.text));
    });
    // team
    const teamKey = g.survivors.map((o) => o.id + o.health + o.downed + o.dead + o.escaped + o.left + Math.ceil(o.bleed / 5)).join('|');
    this.set(this.team, 'team', teamKey, (el) => {
      clear(el);
      for (const o of g.survivors) {
        const state = o.left ? '—' : o.escaped ? '🚪' : o.dead ? '☠' : o.downed ? `⬇ ${Math.max(0, Math.ceil(o.bleed))}` : HEALTH_ICON[o.health];
        el.append(h('div', { class: 'mate' + (o.downed ? ' downed' : '') + (o.dead ? ' dead' : '') + (o.escaped ? ' escaped' : '') + (o === s ? ' me' : '') }, h('span', { class: 'st' }, state), h('span', {}, o.name + (o.isBot ? ' 🤖' : ''))));
      }
    });
    // stamina & battery
    this.set(this.staminaFill, 'sta', Math.round(pl.stamina), (el, v) => {
      el.style.width = v + '%';
      el.parentElement.parentElement.classList.toggle('exhausted', pl.exhausted);
    });
    this.set(this.batteryFill, 'bat', Math.round(s.battery), (el, v) => {
      el.style.width = v + '%';
      el.parentElement.parentElement.classList.toggle('low', v < 15);
    });
    this.set(this.healthEl, 'hp', `${s.health}${s.downed}${s.dead}`, (el) => {
      el.textContent = s.dead ? '☠' : s.downed ? '⬇' : HEALTH_ICON[s.health];
      el.className = 'hud-health h' + (s.downed ? 0 : s.health);
      el.title = t(s.downed ? 'health_downed' : s.health === 2 ? 'health_healthy' : 'health_injured');
    });
    const held = s.inv.held ? g.items.byId.get(s.inv.held)?.kind : null;
    const invKey = `${s.inv.medkit}|${s.inv.adrenaline}|${s.inv.battery}|${held}|${pl.boost > 0}`;
    this.set(this.inv, 'inv', invKey, (el) => {
      clear(el);
      const slot = (icon, n, key, title) => h('div', { class: 'slot' + (n ? '' : ' empty'), title }, h('span', { class: 'ic' }, icon), h('span', { class: 'n' }, String(n)), h('span', { class: 'key' }, key));
      el.append(slot('✚', s.inv.medkit, 'Q', t('it_medkit')), slot('💉', s.inv.adrenaline, 'X', t('it_adrenaline')), slot('🔋', s.inv.battery, 'R', t('it_battery')));
      if (held) el.append(slot(held === 'bottle' ? '🍾' : '🥫', 1, 'G', t('it_' + held)));
    });
    // touch buttons
    const inp = g.input;
    if (inp.isTouch) {
      inp.setTouchVisible('throw', !!held);
      inp.setTouchVisible('heal', s.inv.medkit > 0 && s.health === 1);
      inp.setTouchVisible('adrenaline', s.inv.adrenaline > 0);
      inp.setTouchVisible('reload', s.inv.battery > 0);
      inp.setTouchVisible('interact', !!pl.focus || s.hidden !== null || !s.active);
    }
    // interaction prompt
    const f = pl.focus;
    let promptKey = '';
    let progress = 0;
    if (s.active && f) {
      const enabled = !f.enabled || f.enabled(s);
      const hold = typeof f.hold === 'function' ? f.hold(s) : f.hold;
      const key = inp.usingTouch ? '✋' : 'E';
      promptKey = `${enabled ? key : '✕'}  ${f.label(s)}${hold ? ' (' + t('hold') + ')' : ''}${f.repair ? ' (' + t('hold') + ')' : ''}`;
      progress = hold && pl.hold.target === f.id ? pl.hold.t / hold : 0;
    } else if (s.hidden !== null) promptKey = `E  ${t('i_leave_hide')}`;
    else if (pl.healProgress > 0) {
      promptKey = t('healing');
      progress = pl.healProgress;
    }
    this.set(this.promptText, 'prompt', promptKey, (el, v) => {
      el.textContent = v;
      this.prompt.classList.toggle('show', !!v);
    });
    this.ring.style.setProperty('--p', Math.round(progress * 100));
    this.ring.classList.toggle('active', progress > 0);
    // center status (downed / spectate)
    let centerKey = '';
    if (s.downed) centerKey = t('downed_msg') + '\n' + t('bleedout', { s: Math.max(0, Math.ceil(s.bleed)) });
    else if (!s.active && pl.spectating) centerKey = t('spectating', { name: pl.spectating.name });
    else if (pl.exhausted) centerKey = t('exhausted');
    this.set(this.center, 'center', centerKey, (el, v) => {
      el.textContent = v;
      el.className = 'hud-center' + (s.downed ? ' bad' : '');
    });
    this.cross.classList.toggle('focus', !!f);
    this.cross.classList.toggle('hidden', !s.active || s.hidden !== null);
    // fps
    if (st.fps) this.set(this.fps, 'fps', Math.round(this.app.fpsAvg), (el, v) => (el.textContent = `${v} FPS · ${Math.round(this.app.renderer.appliedScale * 100)}%`));
    else this.set(this.fps, 'fps', -1, (el) => (el.textContent = ''));
    this.lockHint.classList.toggle('show', !inp.isTouch && !inp.locked && !g.ui.isModalOpen && !g.ended);
    // pings projected to screen
    const cam = g.cam;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    this.pings = this.pings.filter((pg) => {
      pg.t -= dt;
      if (pg.t <= 0) {
        pg.el.remove();
        return false;
      }
      const c = [0, 0, 0];
      const vp = cam.viewProj;
      const x = pg.p[0], y = pg.p[1], z = pg.p[2];
      const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      c[0] = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
      c[1] = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
      const on = w > 0;
      pg.el.style.display = on ? '' : 'none';
      if (on) pg.el.style.transform = `translate(${((Math.max(-0.95, Math.min(0.95, c[0])) + 1) / 2) * W}px, ${((1 - Math.max(-0.9, Math.min(0.9, c[1]))) / 2) * H}px)`;
      pg.el.style.opacity = Math.min(1, pg.t);
      return true;
    });
    void m4;
    void CONFIG;
  }
}
