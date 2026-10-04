// Application bootstrap & state machine: loading -> menu/lobby -> match -> results.
import { createContext } from './engine/gl.js';
import { Renderer, QUALITY_PRESETS } from './engine/renderer.js';
import { createPrimitives } from './engine/mesh.js';
import { buildMaterialArrays } from './engine/textures.js';
import { AudioEngine } from './engine/audio.js';
import { Input } from './engine/input.js';
import { mulberry32 } from './engine/math.js';
import { sdk } from './game/sdk.js';
import { setLang, getLang, t } from './game/i18n.js';
import { profile } from './game/profile.js';
import { CONFIG, MODES, MAP_IDS } from './game/config.js';
import { randomAppearance, BOT_NAMES } from './game/catalog.js';
import { LobbyScene } from './game/lobbyscene.js';
import { Match } from './game/match.js';
import { NetClient, NetSession, LocalSession } from './game/net.js';
import { UI } from './ui/ui.js';
import { HUD } from './ui/hud.js';

class App {
  constructor() {
    this.state = 'boot';
    this.match = null;
    this.paused = false;
    this.fpsAvg = 60;
    this.frameAvg = 1 / 60;
    this.dynT = 0;
    this.lobbyState = { mode: 'solo', map: 'random' };
  }

  async boot() {
    this.canvas = document.getElementById('game');
    this.ui = new UI(this, document.getElementById('ui'));
    this.hud = new HUD(document.getElementById('hud'), this);
    this.installPageGuards();
    this.ui.showLoading(0.02, t('loading'));
    await sdk.init();
    setLang(sdk.lang);
    this.ui.screen = null;
    this.ui.showLoading(0.05, t('loading'));
    this.hud.build();
    await profile.load(getLang(), sdk.isMobile);
    this.profile = profile;
    this.lobbyState.mode = profile.data.lastMode || 'solo';
    this.lobbyState.map = profile.data.lastMap || 'random';

    this.gl = createContext(this.canvas);
    if (!this.gl) {
      this.fatal('WebGL 2 is not supported on this device / Ваше устройство не поддерживает WebGL 2');
      return;
    }
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal('Graphics context lost. Please reload the page. / Потерян графический контекст, перезагрузите страницу.');
    });
    this.renderer = new Renderer(this.gl, this.canvas);
    this.applySettings(true);
    this.prims = createPrimitives(this.gl);
    const st = profile.data.settings;
    const texSize = st.quality === 'high' || st.quality === 'ultra' ? 512 : 256;
    const mats = await buildMaterialArrays(this.gl, Math.min(texSize, this.gl.caps.maxTex), (p) => this.ui.showLoading(0.08 + p * 0.55, t('loading_tex')));
    this.renderer.setMaterials(mats);
    this.audio = new AudioEngine();
    await this.audio.generate((p) => this.ui.showLoading(0.63 + p * 0.3, t('loading_snd')));
    this.input = new Input(this.canvas, document.getElementById('touch'));
    document.body.classList.toggle('touch', this.input.isTouch);
    this.input.onPauseRequest = () => {
      if (this.state === 'match' && !this.paused && !this.ui.isModalOpen && !this.input.usingTouch) this.pauseMatch();
    };
    this.ui.showLoading(0.96, t('loading_world'));
    this.lobbyScene = new LobbyScene(this);
    this.refreshLobbyMembers();
    this.applySettings(false);
    this.setupNet();
    this.setupPlatformEvents();
    this.state = 'menu';
    this.ui.showMenu();
    this.last = performance.now();
    requestAnimationFrame((t2) => this.loop(t2));
    // game is loaded & interactive (requirement 1.19.2)
    sdk.ready();
    const unlock = () => {
      this.audio.unlock();
      this.audio.hrtf = profile.data.settings.hrtf;
      this.applyVolumes();
      if (this.state !== 'match') this.audio.setMusicLevels({ music_lobby: 0.6 });
      if (!this.fireSnd) this.fireSnd = this.audio.play('fire', { bus: 'ambience', loop: true, volume: 0.35 });
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
  }

  fatal(msg) {
    const el = document.getElementById('ui');
    el.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'screen fatal';
    d.textContent = msg;
    el.append(d);
  }

  installPageGuards() {
    // no context menu, selection, pinch-zoom or page scrolling (platform requirements)
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('selectstart', (e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
  }

  setupPlatformEvents() {
    const pause = (reason) => {
      this.audio.setMuted(reason, true);
      if (this.state === 'match' && !this.paused && this.isSolo()) this.pauseMatch();
      sdk.gameplayStop();
    };
    const resume = (reason) => {
      this.audio.setMuted(reason, false);
      if (this.state === 'match' && !this.paused) sdk.gameplayStart();
    };
    document.addEventListener('visibilitychange', () => (document.hidden ? pause('hidden') : resume('hidden')));
    window.addEventListener('blur', () => this.input?.downSet.clear());
    sdk.on('pause', () => pause('sdk'));
    sdk.on('resume', () => resume('sdk'));
    sdk.on('adStart', () => pause('ad'));
    sdk.on('adEnd', () => resume('ad'));
  }

  // ------------------------------------------------------------------ settings
  applySettings(rebuild) {
    const st = profile.data.settings;
    const base = QUALITY_PRESETS[st.quality] || QUALITY_PRESETS.medium;
    const q = { ...base };
    q.shadowTaps = st.shadows ? Math.max(4, base.shadowTaps) : 1;
    if (!st.shadows) q.maxShadowed = 1;
    q.bloom = st.bloom;
    q.volumetric = st.volumetric && this.renderer.hdr;
    q.volSteps = base.volSteps || 12;
    q.fxaa = st.fxaa;
    q.scale = base.scale * st.resolution;
    this.baseScale = q.scale;
    if (rebuild || !this.renderer.q) this.renderer.configure(q);
    else Object.assign(this.renderer.q, { scale: q.scale });
    if (!st.dynres) this.renderer.setDynamicScale(q.scale);
    else this.renderer.setDynamicScale(Math.min(this.renderer.dynScale ?? q.scale, q.scale));
    this.renderer.post.brightness = st.brightness;
    this.renderer.post.grain = st.grain ? 0.05 : 0;
    if (this.input) {
      this.input.sensitivity = st.sens;
      this.input.invertY = st.invertY;
    }
    if (this.audio) {
      this.audio.hrtf = st.hrtf;
      this.applyVolumes();
    }
    if (this.match) this.match.settings = st;
  }

  applyVolumes() {
    const v = profile.data.settings.vol;
    for (const k of Object.keys(v)) this.audio.setVolume(k, v[k]);
  }

  // dynamic resolution keeps the frame rate smooth on weak devices
  updateDynamicResolution(dt) {
    this.frameAvg = this.frameAvg * 0.95 + dt * 0.05;
    this.fpsAvg = 1 / this.frameAvg;
    if (!profile.data.settings.dynres) return;
    this.dynT += dt;
    if (this.dynT < 1) return;
    this.dynT = 0;
    const cur = this.renderer.dynScale ?? this.baseScale;
    let next = cur;
    if (this.fpsAvg < 45) next = Math.max(Math.max(0.45, this.baseScale * 0.6), cur - 0.06);
    else if (this.fpsAvg > 57) next = Math.min(this.baseScale, cur + 0.04);
    if (Math.abs(next - cur) > 0.001) this.renderer.setDynamicScale(+next.toFixed(2));
  }

  // ------------------------------------------------------------------ networking
  hello() {
    const p = profile.data;
    return { name: p.name, app: p.app, perks: p.perks, lang: getLang(), level: p.level };
  }

  setupNet() {
    const net = (this.net = new NetClient());
    net.on('status', () => {
      if (this.ui.screen === 'menu') this.ui.showMenu();
      if (this.ui.screen === 'lobby') this.ui.showLobby();
    });
    net.on('welcome', () => net.createParty({ mode: this.lobbyState.mode, map: this.lobbyState.map }));
    net.on('party', (m) => {
      const prev = this.lastParty;
      this.lastParty = m.party;
      this.refreshLobbyMembers();
      if (prev) for (const mem of m.party.members) if (!prev.members.some((x) => x.id === mem.id)) {
        this.lobbyScene.wave(mem.id);
        if (mem.id !== net.id) this.ui.toast(t('player_joined', { name: mem.name }));
        this.audio?.ui('objective', 0.6);
      }
      if (this.ui.screen === 'lobby') this.ui.showLobby();
    });
    net.on('party.error', (m) => this.ui.toast(t(m.e)));
    net.on('kicked', () => {
      this.ui.toast(t('kicked'));
      net.createParty();
    });
    net.on('mm.status', (m) => this.ui.updateSearch(m.elapsed, m.found, m.need));
    net.on('match.start', (m) => {
      if (this.state === 'match') return;
      this.onNetMatchStart(m.match);
    });
    net.connect(this.hello());
  }

  refreshLobbyMembers() {
    const party = this.net?.online ? this.net.party : null;
    const me = { id: this.net?.id || 'local', app: profile.data.app, name: profile.data.name, ready: true, isLocal: true };
    const list = party ? party.members.map((m) => ({ id: m.id, app: m.id === this.net.id ? profile.data.app : sanitize(m.app), name: m.name, ready: m.ready || m.id === party.leader, isLocal: m.id === this.net.id })) : [me];
    this.lobbyScene.setMembers(list);
  }

  onAppearanceChanged() {
    this.refreshLobbyMembers();
    this.net.updateProfile(this.hello());
  }

  openLobby() {
    this.ui.showLobby();
  }
  closeLobby() {
    this.ui.showMenu();
  }

  isSolo() {
    return !this.match || this.match.session instanceof LocalSession || this.match.survivors.every((s) => s.isLocal || s.isBot || s.left);
  }

  // ------------------------------------------------------------------ matches
  startLocalMatch(mode, map) {
    const size = MODES[mode]?.size || 1;
    const seed = (Math.random() * 2 ** 31) | 0;
    const rnd = mulberry32(seed);
    const myId = this.net.id || 'local';
    const players = [{ id: myId, name: profile.data.name, app: profile.data.app, perks: profile.data.perks }];
    const names = (BOT_NAMES[getLang()] || BOT_NAMES.en).slice();
    for (let i = 1; i < size; i++) players.push({ id: 'bot' + i, name: names.splice(Math.floor(rnd() * names.length), 1)[0], app: randomAppearance(rnd), perks: [], isBot: true });
    const mapId = map === 'random' ? MAP_IDS[Math.floor(rnd() * MAP_IDS.length)] : map;
    this.beginMatch({ mapId, seed, mode, players, localId: myId, session: new LocalSession(myId) });
  }

  onNetMatchStart(m) {
    const rnd = mulberry32(m.seed);
    const players = m.players.map((p) => ({ ...p, app: p.app ? sanitize(p.app) : randomAppearance(rnd) }));
    const session = new NetSession(this.net, m);
    this.beginMatch({ mapId: m.map, seed: m.seed, mode: m.mode, players, localId: this.net.id, session });
  }

  beginMatch(cfg) {
    this.state = 'loadingMatch';
    this.ui.showLoading(0.5, t('loading_world'));
    this.audio.setMusicLevels({ music_lobby: 0 });
    this.fireSnd?.stop(0.5);
    this.fireSnd = null;
    setTimeout(() => {
      try {
        this.match = new Match(this, cfg).build();
      } catch (e) {
        console.error(e);
        this.state = 'menu';
        this.ui.showMenu();
        this.ui.toast('Error: ' + e.message);
        return;
      }
      this.state = 'match';
      this.paused = false;
      this.ui.hide();
      this.hud.build();
      this.hud.visible(true);
      this.setInputEnabled(true);
      this.input.resetToggles();
      this.input.requestLock();
      profile.data.stats.matches++;
      profile.save();
      sdk.gameplayStart();
      const def = this.match.def;
      this.hud.banner(t(def.name), '');
      setTimeout(() => this.match && this.hud.toast(t('mon_' + def.monster) + ': ' + t({ warden: 'tip_warden', scarecrow: 'tip_scarecrow', moth: 'tip_moth' }[def.monster])), 1500);
      if (!profile.data.tutorial) {
        profile.data.tutorial = true;
        setTimeout(() => this.match && this.hud.toast(this.input.isTouch ? '🕹' : t('help_move')), 4000);
        setTimeout(() => this.match && !this.input.isTouch && this.hud.toast(t('help_act')), 7000);
      }
    }, 30);
  }

  setInputEnabled(on) {
    if (!this.input) return;
    const want = on && this.state === 'match' && !this.paused && !this.ui.isModalOpen;
    this.input.setEnabled(want);
  }

  pauseMatch() {
    if (this.state !== 'match' || this.paused) return;
    this.paused = true;
    this.ui.closeModal();
    this.input.setEnabled(false);
    this.ui.showPause();
    sdk.gameplayStop();
    if (this.isSolo()) this.audio.setMuted('pause', true);
  }

  resumeMatch() {
    if (this.state !== 'match') return;
    this.paused = false;
    this.ui.hide();
    this.audio.setMuted('pause', false);
    this.setInputEnabled(true);
    this.input.requestLock();
    sdk.gameplayStart();
  }

  leaveMatch() {
    if (!this.match) return;
    this.match.dispose();
    this.match = null;
    this.paused = false;
    this.audio.setMuted('pause', false);
    this.state = 'menu';
    this.hud.visible(false);
    this.input.setEnabled(false);
    sdk.gameplayStop();
    this.audio.setMusicLevels({ music_lobby: 0.6, music_tension: 0, music_chase: 0 });
    this.ui.showLobby();
  }

  onMatchEnd(match, d) {
    if (this.match !== match) return;
    const p = profile.data;
    const s = match.local;
    const escaped = s.escaped;
    const rows = [];
    rows.push({ label: escaped ? t('r_escape') : t('you_died'), xp: escaped ? 150 : 40, coins: escaped ? 60 : 15 });
    const objs = d.obj ?? match.stats.objectives;
    if (objs) rows.push({ label: `${t('r_puzzles')} ×${objs}`, xp: objs * 25, coins: objs * 8 });
    if (match.stats.revives) rows.push({ label: `${t('r_revives')} ×${match.stats.revives}`, xp: match.stats.revives * 40, coins: match.stats.revives * 10 });
    const time = Math.round(match.time);
    rows.push({ label: `${t('r_survived')} ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`, xp: Math.min(120, Math.floor(time / 6)), coins: 0 });
    const humans = match.survivors.filter((o) => !o.isBot).length;
    if (humans > 1) rows.push({ label: t('r_teamwork'), xp: 30 * (humans - 1), coins: 10 * (humans - 1) });
    let xp = rows.reduce((a, r) => a + r.xp, 0);
    let coins = rows.reduce((a, r) => a + r.coins, 0);
    if (profile.claimDailyBonus()) {
      rows.push({ label: t('r_bonus_daily'), xp, coins: 50 });
      xp *= 2;
      coins += 50;
    }
    const levels = profile.addXp(xp);
    profile.addCoins(coins);
    p.stats.escapes += escaped ? 1 : 0;
    p.stats.deaths += escaped ? 0 : 1;
    p.stats.revives += match.stats.revives;
    p.stats.puzzles += objs;
    profile.changed();
    profile.save(true);
    if (escaped) sdk.submitScore('escapes', p.stats.escapes);
    this.results = { rows, xp, coins, levels, escaped, map: match.def.id };
    match.dispose();
    this.match = null;
    this.state = 'results';
    this.hud.visible(false);
    this.input.setEnabled(false);
    sdk.gameplayStop();
    this.audio.setMusicLevels({ music_lobby: 0.5, music_tension: 0, music_chase: 0 });
    this.ui.showResults(this.results);
  }

  grantBonus(r) {
    profile.addXp(r.xp);
    profile.addCoins(r.coins);
    profile.changed();
    profile.save(true);
  }

  async afterResults() {
    this.state = 'menu';
    // fullscreen ad only at this natural break between matches
    await sdk.showFullscreen();
    this.ui.showLobby();
  }

  rewardedAd() {
    return sdk.showRewarded();
  }

  // ------------------------------------------------------------------ main loop
  loop(now) {
    requestAnimationFrame((t2) => this.loop(t2));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    this.updateDynamicResolution(dt);
    try {
      if (this.state === 'match' && this.match) {
        const m = this.match;
        if (this.ui.skill && this.input.enabled) {
          this.ui.skill.update(dt, this.input);
          this.input.pressedSet.delete('jump');
        }
        const simulate = !this.paused || !this.isSolo();
        if (simulate) m.update(dt);
        m.render(simulate ? dt : 0.0001);
      } else if (this.lobbyScene) {
        this.lobbyScene.update(dt);
        this.lobbyScene.render(this.renderer, dt);
      }
    } catch (e) {
      console.error(e);
      if (!this.errorShown) {
        this.errorShown = true;
        this.ui.toast('Error: ' + e.message);
      }
    }
  }
}

function sanitize(app) {
  return app && typeof app === 'object' ? app : randomAppearance();
}

const app = new App();
window.__app = app;
app.boot().catch((e) => {
  console.error(e);
  app.fatal('Failed to start: ' + e.message);
});

void CONFIG;
