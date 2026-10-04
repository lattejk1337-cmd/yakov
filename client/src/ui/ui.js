// Menus, lobby, customisation, settings, pause, results and in-match modal panels.
import { h, clear } from './dom.js';
import { t, getLang } from '../game/i18n.js';
import { MAP_IDS, MODES } from '../game/config.js';
import { ITEMS, SKIN_TONES, HAIR_COLORS, PERKS, randomName } from '../game/catalog.js';
import { MAPS } from '../game/maps/index.js';
import { QUALITY_PRESETS } from '../engine/renderer.js';

const rgb = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const MON_TIP = { warden: 'tip_warden', scarecrow: 'tip_scarecrow', moth: 'tip_moth' };

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.screen = null;
    this.modal = null;
    this.layer = h('div', { class: 'screens' });
    this.modalLayer = h('div', { class: 'modals' });
    root.append(this.layer, this.modalLayer);
    this.customTab = 'jacket';
    this.settingsTab = 'audio';
    this.pendingBuy = null;
  }

  click() {
    this.app.audio?.ui('ui_click', 0.7);
  }
  btn(label, onClick, cls = '') {
    return h('button', {
      class: 'btn ' + cls,
      onclick: (e) => {
        e.stopPropagation();
        this.click();
        onClick(e);
      },
    }, label);
  }

  show(name, el) {
    clear(this.layer);
    this.screen = name;
    if (el) this.layer.append(el);
    this.layer.classList.toggle('hidden', !el);
  }
  hide() {
    this.show(null, null);
  }

  // ------------------------------------------------------------------ loading
  showLoading(progress, label) {
    if (this.screen !== 'loading') {
      this.loadingBar = h('div', { class: 'bar-fill' });
      this.loadingLabel = h('div', { class: 'loading-label' });
      this.show('loading', h('div', { class: 'screen loading' },
        h('div', { class: 'title glitch' }, t('title')),
        h('div', { class: 'subtitle' }, t('subtitle')),
        h('div', { class: 'bar' }, this.loadingBar),
        this.loadingLabel));
    }
    this.loadingBar.style.width = Math.round(progress * 100) + '%';
    this.loadingLabel.textContent = label || t('loading');
  }

  topbar() {
    const p = this.app.profile.data;
    const need = this.app.profile.xpNeeded;
    return h('div', { class: 'topbar' },
      h('div', { class: 'pill name' }, '👤 ', p.name),
      h('div', { class: 'pill level' }, `${t('level')} ${p.level}`, h('div', { class: 'xpbar' }, h('div', { class: 'xpfill', style: { width: Math.min(100, (p.xp / need) * 100) + '%' } }))),
      h('div', { class: 'pill coins' }, '🪙 ', String(p.coins)));
  }

  // ------------------------------------------------------------------ main menu
  showMenu() {
    const net = this.app.net;
    const status = h('div', { class: 'net-status ' + net.state }, net.online ? '● ' + t('online') : net.state === 'connecting' ? '◌ ' + t('connecting') : '○ ' + t('offline'));
    const el = h('div', { class: 'screen menu' },
      this.topbar(),
      h('div', { class: 'menu-left' },
        h('div', { class: 'title glitch big' }, t('title')),
        h('div', { class: 'subtitle' }, t('subtitle')),
        h('div', { class: 'menu-buttons' },
          this.btn(t('play'), () => this.app.openLobby(), 'primary'),
          this.btn(t('customize'), () => this.showCustomize()),
          this.btn(t('progress'), () => this.showProgress()),
          this.btn(t('settings'), () => this.showSettings('menu'))),
        status));
    this.show('menu', el);
    this.app.lobbyScene.focus = null;
  }

  // ------------------------------------------------------------------ lobby
  showLobby() {
    const app = this.app;
    const net = app.net;
    const party = net.online ? net.party : null;
    const lob = app.lobbyState;
    const isLeader = !party || party.leader === net.id;
    const mode = party ? party.mode : lob.mode;
    const map = party ? party.map : lob.map;
    const members = party ? party.members.length : 1;

    const modeTabs = h('div', { class: 'tabs' }, ...Object.keys(MODES).map((m) =>
      h('button', {
        class: 'tab' + (m === mode ? ' active' : '') + (MODES[m].size < members ? ' disabled' : ''),
        onclick: () => {
          if (!isLeader || MODES[m].size < members) return;
          this.click();
          lob.mode = m;
          app.profile.data.lastMode = m;
          app.profile.save();
          if (party) net.setParty({ mode: m });
          this.showLobby();
        },
      }, t('mode_' + m), h('small', {}, ' ' + '●'.repeat(MODES[m].size)))));

    const mapCards = h('div', { class: 'maps' }, ...['random', ...MAP_IDS].map((id) => {
      const def = MAPS[id];
      return h('div', {
        class: 'map-card' + (id === map ? ' active' : '') + ' map-' + id,
        onclick: () => {
          if (!isLeader) return;
          this.click();
          lob.map = id;
          app.profile.data.lastMap = id;
          app.profile.save();
          if (party) net.setParty({ map: id });
          this.showLobby();
        },
      },
      h('div', { class: 'map-name' }, id === 'random' ? '🎲 ' + t('map_random') : t(def.name)),
      id !== 'random' ? h('div', { class: 'map-desc' }, t(def.desc)) : null,
      id !== 'random' ? h('div', { class: 'map-mon' }, '☠ ' + t('mon_' + def.monster) + ': ' + t(MON_TIP[def.monster])) : null);
    }));

    // party panel
    const partyPanel = h('div', { class: 'panel party' }, h('div', { class: 'panel-title' }, t('party')));
    if (party) {
      const codeEl = h('div', { class: 'code' }, party.code);
      partyPanel.append(
        h('div', { class: 'row' }, h('span', { class: 'muted' }, t('invite_code') + ':'), codeEl, this.btn(t('copy'), () => this.copy(party.code), 'small')),
        h('div', { class: 'hint' }, t('invite_hint')));
      const list = h('div', { class: 'members' });
      for (let i = 0; i < MODES[mode].size; i++) {
        const m = party.members[i];
        if (m) {
          list.append(h('div', { class: 'member' + (m.ready ? ' ready' : '') },
            h('span', { class: 'm-name' }, (m.id === party.leader ? '👑 ' : '') + m.name + (m.id === net.id ? ` (${t('you')})` : '')),
            h('span', { class: 'm-lvl' }, `${t('level')} ${m.level || 1}`),
            h('span', { class: 'm-ready' }, m.ready || m.id === party.leader ? '✔' : '…'),
            isLeader && m.id !== net.id ? this.btn('✕', () => net.kick(m.id), 'tiny') : null));
        } else list.append(h('div', { class: 'member empty' }, h('span', { class: 'm-name muted' }, t('empty_slot') + ' — ' + t('bot'))));
      }
      partyPanel.append(list);
      const input = h('input', { class: 'code-input', maxlength: '5', placeholder: t('enter_code'), autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      partyPanel.append(h('div', { class: 'row' }, input, this.btn(t('join'), () => input.value.trim() && net.joinParty(input.value), 'small')));
      if (party.members.length > 1) partyPanel.append(this.btn(t('leave_party'), () => { net.leaveParty(); setTimeout(() => net.createParty(), 100); }, 'small ghost'));
      const fo = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: party.friendsOnly ? 'checked' : null, disabled: !isLeader ? 'disabled' : null, onchange: (e) => net.setParty({ friendsOnly: e.target.checked }) }), ' ' + t('friends_only'));
      partyPanel.append(fo);
    } else {
      partyPanel.append(h('div', { class: 'hint' }, net.state === 'connecting' ? t('connecting') : t('offline')), h('div', { class: 'hint' }, t('bots_fill')));
    }

    // action button
    const searching = party?.searching;
    let action;
    if (searching) action = this.btn(t('cancel'), () => net.cancelSearch(), 'primary big danger');
    else if (mode === 'solo' || !party) action = this.btn(t('start'), () => app.startLocalMatch(mode, map), 'primary big');
    else if (isLeader) action = this.btn(t('find_match'), () => net.startSearch(), 'primary big');
    else {
      const me = party.members.find((m) => m.id === net.id);
      action = this.btn(me?.ready ? t('not_ready') : t('ready'), () => net.setReady(!me?.ready), 'primary big');
    }
    this.searchLabel = h('div', { class: 'search-label' }, searching ? t('searching', { s: party.elapsed }) : !isLeader ? t('waiting_leader') : mode !== 'solo' ? t('bots_fill') : '');

    const el = h('div', { class: 'screen lobby' },
      this.topbar(),
      h('div', { class: 'lobby-top' }, this.btn('← ' + t('back'), () => app.closeLobby(), 'ghost'), h('div', { class: 'lobby-title' }, t('lobby')), modeTabs),
      h('div', { class: 'lobby-main' }, h('div', { class: 'panel maps-panel' }, h('div', { class: 'panel-title' }, t('map')), mapCards), partyPanel),
      h('div', { class: 'lobby-bottom' }, this.btn(t('customize'), () => this.showCustomize('lobby'), 'ghost'), this.searchLabel, action));
    this.show('lobby', el);
    app.lobbyScene.focus = null;
  }

  updateSearch(sec, found, need) {
    if (this.searchLabel) this.searchLabel.textContent = t('searching', { s: sec }) + (need ? ` (${found}/${need})` : '');
  }

  copy(text) {
    const done = () => this.toast(t('copied'));
    try {
      navigator.clipboard.writeText(text).then(done, () => this.fallbackCopy(text, done));
    } catch (e) {
      this.fallbackCopy(text, done);
    }
  }
  fallbackCopy(text, done) {
    const ta = h('textarea', {}, text);
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      /* ignore */
    }
    ta.remove();
  }

  toast(text) {
    const el = h('div', { class: 'ui-toast' }, text);
    this.root.append(el);
    setTimeout(() => el.classList.add('out'), 1600);
    setTimeout(() => el.remove(), 2200);
  }

  // ------------------------------------------------------------------ customisation
  showCustomize(back = 'menu') {
    const app = this.app;
    const prof = app.profile;
    const p = prof.data;
    app.lobbyScene.focus = 'customize';
    const tabs = ['skin', 'hair', 'hat', 'jacket', 'pants', 'mask', 'back', 'light', 'perks'];
    const tabEl = h('div', { class: 'tabs wrap' }, ...tabs.map((tb) =>
      h('button', { class: 'tab' + (tb === this.customTab ? ' active' : ''), onclick: () => { this.click(); this.customTab = tb; this.showCustomize(back); } }, t('c_' + tb))));
    const grid = h('div', { class: 'items' });
    const tab = this.customTab;
    const changed = () => {
      app.onAppearanceChanged();
      this.showCustomize(back);
    };
    if (tab === 'skin') {
      SKIN_TONES.forEach((c, i) => grid.append(h('button', { class: 'swatch' + (p.app.skin === i ? ' active' : ''), style: { background: rgb(c) }, onclick: () => { this.click(); p.app.skin = i; prof.changed(); changed(); } })));
      grid.append(h('div', { class: 'sep' }, t('c_skin') + ' / build'));
      for (const b of [0, 1]) grid.append(h('button', { class: 'item' + (p.app.build === b ? ' active' : ''), onclick: () => { this.click(); p.app.build = b; prof.changed(); changed(); } }, b ? '▮▮' : '▮'));
    } else if (tab === 'perks') {
      grid.append(h('div', { class: 'sep' }, t('perks_hint')));
      for (const pk of PERKS) {
        const locked = p.level < pk.lvl;
        const on = p.perks.includes(pk.id);
        grid.append(h('button', {
          class: 'item perk' + (on ? ' active' : '') + (locked ? ' locked' : ''),
          onclick: () => { if (locked) return; this.click(); prof.togglePerk(pk.id); changed(); },
        }, h('b', {}, t('perk_' + pk.id)), h('small', {}, t('perk_' + pk.id + '_d')), locked ? h('em', {}, '🔒 ' + t('locked_lvl', { n: pk.lvl })) : on ? h('em', {}, '✔ ' + t('equipped')) : null));
      }
    } else {
      if (tab === 'hair') {
        HAIR_COLORS.forEach((c, i) => grid.append(h('button', { class: 'swatch' + (p.app.hairColor === i ? ' active' : ''), style: { background: rgb(c) }, onclick: () => { this.click(); p.app.hairColor = i; prof.changed(); changed(); } })));
        grid.append(h('div', { class: 'sep' }));
      }
      for (const it of ITEMS.filter((x) => x.slot === tab)) {
        const owned = prof.owns(it.id);
        const equipped = p.app[tab] === it.id;
        const lockedLvl = it.lvl && p.level < it.lvl;
        const name = it.n[getLang()] || it.n.en;
        const pending = this.pendingBuy === it.id;
        grid.append(h('button', {
          class: 'item' + (equipped ? ' active' : '') + (lockedLvl ? ' locked' : '') + (!owned ? ' shop' : ''),
          onclick: () => {
            this.click();
            if (owned) {
              prof.equip(tab, it.id);
              changed();
            } else if (lockedLvl) {
              this.toast('🔒 ' + t('locked_lvl', { n: it.lvl }));
            } else if (p.coins < it.price) {
              this.toast(t('not_enough'));
            } else if (!pending) {
              this.pendingBuy = it.id;
              this.showCustomize(back);
            } else {
              this.pendingBuy = null;
              if (prof.buy(it.id)) {
                app.audio?.ui('pickup');
                prof.equip(tab, it.id);
              }
              changed();
            }
          },
        },
        it.color ? h('span', { class: 'dot', style: { background: rgb(it.color) } }) : null,
        h('b', {}, name),
        equipped ? h('em', {}, '✔ ' + t('equipped')) : owned ? h('em', {}, t('equip')) : lockedLvl ? h('em', {}, '🔒 ' + t('locked_lvl', { n: it.lvl })) : h('em', { class: pending ? 'confirm' : '' }, pending ? `${t('buy')}? 🪙${it.price}` : `🪙 ${it.price}`)));
      }
    }
    const adLeft = prof.adCoinsLeft();
    const el = h('div', { class: 'screen customize' },
      this.topbar(),
      h('div', { class: 'side-panel' },
        h('div', { class: 'row' }, this.btn('← ' + t('back'), () => (back === 'lobby' ? this.showLobby() : this.showMenu()), 'ghost'), h('div', { class: 'panel-title' }, t('customize'))),
        h('div', { class: 'row name-row' }, h('span', {}, p.name), this.btn('🎲', () => { p.name = randomName(getLang()); prof.changed(); app.onAppearanceChanged(); this.showCustomize(back); }, 'tiny')),
        tabEl,
        grid,
        adLeft > 0 ? this.btn('▶ ' + t('free_coins', { n: 60 }), async () => {
          const ok = await app.rewardedAd();
          if (ok) {
            prof.useAdCoins();
            prof.addCoins(60);
            prof.changed();
            this.showCustomize(back);
          }
        }, 'ad') : null));
    this.show('customize', el);
  }

  // ------------------------------------------------------------------ progress
  showProgress() {
    const p = this.app.profile.data;
    const need = this.app.profile.xpNeeded;
    const unlocks = [];
    for (const pk of PERKS) unlocks.push({ lvl: pk.lvl, name: t('perk_' + pk.id) });
    for (const it of ITEMS) if (it.lvl) unlocks.push({ lvl: it.lvl, name: it.n[getLang()] || it.n.en });
    unlocks.sort((a, b) => a.lvl - b.lvl);
    const el = h('div', { class: 'screen progress' },
      this.topbar(),
      h('div', { class: 'panel center-panel' },
        h('div', { class: 'row' }, this.btn('← ' + t('back'), () => this.showMenu(), 'ghost'), h('div', { class: 'panel-title' }, t('progress'))),
        h('div', { class: 'big-level' }, `${t('level')} ${p.level}`),
        h('div', { class: 'xpbar wide' }, h('div', { class: 'xpfill', style: { width: (p.xp / need) * 100 + '%' } })),
        h('div', { class: 'muted' }, `${p.xp} / ${need} ${t('xp')}`),
        h('div', { class: 'panel-title' }, t('stats')),
        h('div', { class: 'stats' },
          h('div', {}, t('st_matches'), h('b', {}, p.stats.matches)),
          h('div', {}, t('st_escapes'), h('b', {}, p.stats.escapes)),
          h('div', {}, t('st_revives'), h('b', {}, p.stats.revives)),
          h('div', {}, t('st_puzzles'), h('b', {}, p.stats.puzzles))),
        h('div', { class: 'unlocks' }, ...unlocks.map((u) => h('div', { class: 'unlock' + (p.level >= u.lvl ? ' got' : '') }, h('span', {}, `${t('level')} ${u.lvl}`), h('span', {}, u.name))))));
    this.show('progress', el);
  }

  // ------------------------------------------------------------------ settings
  showSettings(from) {
    const app = this.app;
    const st = app.profile.data.settings;
    const apply = (rebuild = false) => {
      app.applySettings(rebuild);
      app.profile.save();
    };
    const slider = (label, value, min, max, step, onInput, fmt = (v) => Math.round(v * 100) + '%') => {
      const out = h('span', { class: 'val' }, fmt(value));
      const input = h('input', { type: 'range', min, max, step, value });
      input.addEventListener('input', () => {
        out.textContent = fmt(+input.value);
        onInput(+input.value);
      });
      return h('div', { class: 'setting' }, h('label', {}, label), input, out);
    };
    const toggle = (label, key, rebuild = false) =>
      h('div', { class: 'setting' }, h('label', {}, label), h('button', {
        class: 'switch' + (st[key] ? ' on' : ''),
        onclick: (e) => {
          this.click();
          st[key] = !st[key];
          e.currentTarget.classList.toggle('on', st[key]);
          e.currentTarget.textContent = st[key] ? t('on') : t('off');
          apply(rebuild);
        },
      }, st[key] ? t('on') : t('off')));
    const tabs = h('div', { class: 'tabs' }, ...['audio', 'graphics', 'controls'].map((tb) => h('button', { class: 'tab' + (tb === this.settingsTab ? ' active' : ''), onclick: () => { this.click(); this.settingsTab = tb; this.showSettings(from); } }, t('s_' + tb))));
    const body = h('div', { class: 'settings-body' });
    if (this.settingsTab === 'audio') {
      for (const [k, label] of [['master', 's_master'], ['music', 's_music'], ['sfx', 's_sfx'], ['ambience', 's_ambience'], ['ui', 's_ui']]) {
        body.append(slider(t(label), st.vol[k], 0, 1, 0.01, (v) => {
          st.vol[k] = v;
          app.audio.setVolume(k, v);
          app.profile.save();
        }));
      }
      body.append(toggle(t('s_hrtf'), 'hrtf'));
    } else if (this.settingsTab === 'graphics') {
      body.append(h('div', { class: 'setting' }, h('label', {}, t('s_quality')), h('div', { class: 'seg' }, ...Object.keys(QUALITY_PRESETS).map((q) =>
        h('button', {
          class: q === st.quality ? 'active' : '',
          onclick: () => {
            this.click();
            st.quality = q;
            const pr = QUALITY_PRESETS[q];
            st.shadows = pr.shadowTaps > 1;
            st.bloom = pr.bloom;
            st.volumetric = pr.volumetric;
            st.fxaa = pr.fxaa;
            apply(true);
            this.showSettings(from);
          },
        }, t('q_' + q))))));
      body.append(toggle(t('s_shadows'), 'shadows', true), toggle(t('s_bloom'), 'bloom', true), toggle(t('s_volumetric'), 'volumetric', true), toggle(t('s_fxaa'), 'fxaa', true));
      body.append(slider(t('s_resolution'), st.resolution, 0.5, 1, 0.05, (v) => { st.resolution = v; apply(); }));
      body.append(toggle(t('s_dynres'), 'dynres'));
      body.append(slider(t('s_fov'), st.fov, 60, 100, 1, (v) => { st.fov = v; apply(); }, (v) => Math.round(v) + '°'));
      body.append(slider(t('s_brightness'), st.brightness, 0.6, 1.8, 0.05, (v) => { st.brightness = v; apply(); }));
      body.append(toggle(t('s_grain'), 'grain'), toggle(t('s_fps'), 'fps'));
    } else {
      body.append(slider(t('s_sens'), st.sens, 0.2, 3, 0.05, (v) => { st.sens = v; apply(); }, (v) => v.toFixed(2)));
      body.append(toggle(t('s_invert'), 'invertY'), toggle(t('s_bob'), 'bob'));
      body.append(h('div', { class: 'help' }, h('p', {}, t('help_move')), h('p', {}, t('help_act')), h('p', {}, t('help_chat'))));
    }
    const el = h('div', { class: 'screen settings' + (from === 'pause' ? ' over-game' : '') },
      from === 'pause' ? null : this.topbar(),
      h('div', { class: 'panel center-panel' },
        h('div', { class: 'row' }, this.btn('← ' + t('back'), () => (from === 'pause' ? this.showPause() : this.showMenu()), 'ghost'), h('div', { class: 'panel-title' }, t('settings'))),
        tabs,
        body));
    this.show('settings', el);
  }

  // ------------------------------------------------------------------ pause
  showPause() {
    const app = this.app;
    const el = h('div', { class: 'screen pause over-game' },
      h('div', { class: 'panel center-panel small' },
        h('div', { class: 'title' }, t('paused')),
        h('div', { class: 'menu-buttons' },
          this.btn(t('resume'), () => app.resumeMatch(), 'primary'),
          this.btn(t('settings'), () => this.showSettings('pause')),
          this.btn(t('leave_match'), () => app.leaveMatch(), 'danger')),
        h('div', { class: 'help small' }, h('p', {}, t('help_move')), h('p', {}, t('help_act')))));
    this.show('pause', el);
  }

  // ------------------------------------------------------------------ results
  showResults(r) {
    const app = this.app;
    const rows = r.rows.map((row) => h('div', { class: 'res-row' }, h('span', {}, row.label), h('span', { class: 'xp' }, row.xp ? `+${row.xp} ${t('xp')}` : ''), h('span', { class: 'coins' }, row.coins ? `+${row.coins} 🪙` : '')));
    let doubled = false;
    const dbl = this.btn(`▶ ${t('double_reward')} (${t('watch_ad')})`, async () => {
      if (doubled) return;
      const ok = await app.rewardedAd();
      if (ok) {
        doubled = true;
        app.grantBonus(r);
        dbl.disabled = true;
        dbl.textContent = '✔ x2';
      }
    }, 'ad');
    const el = h('div', { class: 'screen results' },
      h('div', { class: 'panel center-panel' },
        h('div', { class: 'title ' + (r.escaped ? 'good' : 'bad') }, r.escaped ? t('you_escaped') : t('you_died')),
        h('div', { class: 'subtitle' }, `${t(MAPS[r.map].name)} — ${t('mon_' + MAPS[r.map].monster)}`),
        h('div', { class: 'res-list' }, ...rows),
        h('div', { class: 'res-total' }, h('span', {}, '='), h('span', { class: 'xp' }, `+${r.xp} ${t('xp')}`), h('span', { class: 'coins' }, `+${r.coins} 🪙`)),
        r.levels.length ? h('div', { class: 'level-up' }, t('level_up', { n: r.levels[r.levels.length - 1] })) : null,
        h('div', { class: 'row center' }, dbl, this.btn(t('continue'), () => app.afterResults(), 'primary'))));
    this.show('results', el);
  }

  // ------------------------------------------------------------------ in-match modals
  get isModalOpen() {
    return !!this.modal;
  }

  openModal(el, onClose) {
    this.closeModal();
    this.app.setInputEnabled(false);
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => e.target === wrap && this.closeModal() }, el);
    this.modal = { wrap, onClose };
    this.modalLayer.append(wrap);
    this.modalKey = (e) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeModal();
      }
    };
    window.addEventListener('keydown', this.modalKey);
  }
  closeModal() {
    if (!this.modal) return;
    const m = this.modal;
    this.modal = null;
    m.wrap.remove();
    window.removeEventListener('keydown', this.modalKey);
    m.onClose && m.onClose();
    this.app.setInputEnabled(true);
  }

  openKeypad(onSubmit) {
    let code = '';
    const display = h('div', { class: 'kp-display' }, '____');
    const update = () => (display.textContent = code.padEnd(4, '_'));
    const press = (d) => {
      this.app.audio?.ui('beep', 0.5);
      if (d === 'C') code = '';
      else if (d === 'OK') {
        if (code.length === 4) {
          onSubmit(code);
          this.closeModal();
        }
        return;
      } else if (code.length < 4) code += d;
      update();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
    const pad = h('div', { class: 'keypad' }, ...keys.map((k) => h('button', { class: 'kp-key' + (k === 'OK' ? ' ok' : k === 'C' ? ' clr' : ''), onclick: () => press(k) }, k)));
    const kb = (e) => {
      if (/^Digit\d$/.test(e.code)) press(e.code.slice(5));
      else if (/^Numpad\d$/.test(e.code)) press(e.code.slice(6));
      else if (e.code === 'Backspace') { code = code.slice(0, -1); update(); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('OK');
    };
    window.addEventListener('keydown', kb);
    this.openModal(h('div', { class: 'panel modal keypad-panel' }, h('div', { class: 'panel-title' }, t('keypad_title')), display, pad, this.btn(t('close'), () => this.closeModal(), 'ghost small')), () => window.removeEventListener('keydown', kb));
  }

  openRadio(onTune) {
    let f = 98.0;
    const audio = this.app.audio;
    const staticSnd = audio?.play('radio', { loop: true, volume: 0.25, bus: 'ui' });
    const disp = h('div', { class: 'radio-display' }, f.toFixed(1) + ' FM');
    const input = h('input', { type: 'range', min: 87.5, max: 108, step: 0.1, value: f, class: 'radio-slider' });
    input.addEventListener('input', () => {
      f = +input.value;
      disp.textContent = f.toFixed(1) + ' FM';
      staticSnd?.setRate(0.8 + Math.random() * 0.4);
    });
    const nudge = (d) => {
      f = Math.min(108, Math.max(87.5, +(f + d).toFixed(1)));
      input.value = f;
      disp.textContent = f.toFixed(1) + ' FM';
    };
    this.openModal(h('div', { class: 'panel modal radio-panel' },
      h('div', { class: 'panel-title' }, t('radio_title')), disp, input,
      h('div', { class: 'row center' }, this.btn('−0.1', () => nudge(-0.1), 'small'), this.btn('+0.1', () => nudge(0.1), 'small')),
      h('div', { class: 'row center' }, this.btn(t('tune'), () => { onTune(f); this.closeModal(); }, 'primary'), this.btn(t('close'), () => this.closeModal(), 'ghost'))),
    () => staticSnd?.stop(0.2));
  }

  showNote(canvas) {
    const img = h('img', { class: 'note-img', src: canvas.toDataURL(), alt: t('note') });
    this.openModal(h('div', { class: 'panel modal note-panel' }, img, this.btn(t('close'), () => this.closeModal(), 'ghost')));
  }

  // DBD-style skill check: a needle sweeps the circle, press in the zone
  skillCheck(widthMul, cb) {
    if (this.skill) return;
    const hud = this.app.hud;
    const size = 0.16 * widthMul;
    const start = 0.35 + Math.random() * 0.45;
    const el = h('div', { class: 'skill' }, h('div', { class: 'skill-ring' }), h('div', { class: 'skill-needle' }), h('div', { class: 'skill-label' }, t('skill_check')));
    const zone = h('div', { class: 'skill-zone' });
    const great = h('div', { class: 'skill-great' });
    el.firstChild.append(zone, great);
    zone.style.background = `conic-gradient(transparent ${start * 360}deg, rgba(255,255,255,0.75) ${start * 360}deg ${(start + size) * 360}deg, transparent ${(start + size) * 360}deg)`;
    great.style.background = `conic-gradient(transparent ${start * 360}deg, rgba(255,230,120,1) ${start * 360}deg ${(start + size * 0.3) * 360}deg, transparent ${(start + size * 0.3) * 360}deg)`;
    hud.root.append(el);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.app.input.press('skill');
    });
    this.app.audio?.ui('beep', 0.8);
    let p = 0;
    const speed = 0.9;
    this.skill = { el, update: null };
    const finish = (res) => {
      if (!this.skill) return;
      this.skill = null;
      el.classList.add(res);
      this.app.audio?.ui(res === 'fail' ? 'error' : 'ui_click', 0.8);
      setTimeout(() => el.remove(), 400);
      cb(res);
    };
    this.skill.update = (dt, input) => {
      p += dt * speed;
      el.children[1].style.transform = `rotate(${p * 360}deg)`;
      if (input.pressed('jump') || input.pressed('skill') || input.pressed('interactTap')) {
        if (p >= start && p <= start + size * 0.3) finish('great');
        else if (p >= start && p <= start + size) finish('good');
        else finish('fail');
      } else if (p > start + size + 0.02) finish('fail');
    };
  }

  openChatWheel(onPick) {
    const wheel = h('div', { class: 'panel modal chat-wheel' }, ...[1, 2, 3, 4].map((i) => this.btn(`${i + 4}. ${t('q' + i)}`, () => { onPick(i); this.closeModal(); })));
    this.openModal(wheel);
  }
}
