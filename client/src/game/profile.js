// Player profile: progression, currency, owned cosmetics, settings. Persisted through the SDK
// (cloud) with localStorage fallback.
import { sdk } from './sdk.js';
import { CONFIG } from './config.js';
import { DEFAULT_APPEARANCE, ITEM_BY_ID, PERKS, randomName } from './catalog.js';

export function defaultSettings(isMobile) {
  return {
    quality: isMobile ? 'low' : 'high',
    shadows: true,
    bloom: !isMobile,
    volumetric: !isMobile,
    fxaa: !isMobile,
    resolution: 1,
    dynres: true,
    fov: 75,
    brightness: 1,
    grain: true,
    sens: 1,
    invertY: false,
    bob: true,
    fps: false,
    hrtf: !isMobile,
    vol: { master: 0.8, music: 0.55, sfx: 0.9, ambience: 0.7, ui: 0.6 },
  };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

class Profile {
  constructor() {
    this.data = null;
    this.saveTimer = null;
    this.listeners = [];
  }

  async load(lang, isMobile) {
    const saved = await sdk.loadData();
    const base = {
      v: 1,
      savedAt: 0,
      name: randomName(lang),
      level: 1,
      xp: 0,
      coins: 150,
      owned: [],
      app: { ...DEFAULT_APPEARANCE },
      perks: ['light_feet'],
      stats: { matches: 0, escapes: 0, revives: 0, puzzles: 0, deaths: 0 },
      settings: defaultSettings(isMobile),
      lastDaily: '',
      adCoins: { day: '', n: 0 },
      tutorial: false,
      lastMode: 'solo',
      lastMap: 'random',
    };
    const p = saved?.profile;
    if (p && typeof p === 'object') {
      Object.assign(base, p);
      base.app = { ...DEFAULT_APPEARANCE, ...(p.app || {}) };
      base.settings = { ...defaultSettings(isMobile), ...(p.settings || {}) };
      base.settings.vol = { ...defaultSettings(isMobile).vol, ...(p.settings?.vol || {}) };
      base.stats = { ...base.stats, ...(p.stats || {}) };
    }
    this.data = base;
    return this;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
  changed() {
    for (const fn of this.listeners) fn(this.data);
    this.save();
  }

  save(immediate = false) {
    clearTimeout(this.saveTimer);
    const run = () => {
      this.data.savedAt = Date.now();
      sdk.saveData({ profile: this.data });
    };
    if (immediate) run();
    else this.saveTimer = setTimeout(run, 1500);
  }

  get xpNeeded() {
    return CONFIG.XP_PER_LEVEL(this.data.level);
  }

  owns(id) {
    const it = ITEM_BY_ID[id];
    if (!it) return false;
    if (!it.price && (!it.lvl || this.data.level >= it.lvl)) return true;
    return this.data.owned.includes(id);
  }
  canUnlock(id) {
    const it = ITEM_BY_ID[id];
    return it && (!it.lvl || this.data.level >= it.lvl);
  }
  buy(id) {
    const it = ITEM_BY_ID[id];
    if (!it || this.owns(id) || !this.canUnlock(id)) return false;
    if (this.data.coins < it.price) return false;
    this.data.coins -= it.price;
    this.data.owned.push(id);
    this.changed();
    return true;
  }
  equip(slot, id) {
    if (!this.owns(id)) return false;
    this.data.app[slot] = id;
    this.changed();
    return true;
  }
  togglePerk(id) {
    const perk = PERKS.find((p) => p.id === id);
    if (!perk || this.data.level < perk.lvl) return;
    const list = this.data.perks;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(id);
      while (list.length > 2) list.shift();
    }
    this.changed();
  }
  hasPerk(id) {
    return this.data.perks.includes(id);
  }

  // Returns {levels:[...new levels]}
  addXp(xp) {
    const d = this.data;
    d.xp += xp;
    const levels = [];
    while (d.xp >= CONFIG.XP_PER_LEVEL(d.level)) {
      d.xp -= CONFIG.XP_PER_LEVEL(d.level);
      d.level++;
      levels.push(d.level);
      d.coins += 50;
    }
    return levels;
  }
  addCoins(n) {
    this.data.coins += n;
  }

  claimDailyBonus() {
    if (this.data.lastDaily === today()) return false;
    this.data.lastDaily = today();
    return true;
  }
  adCoinsLeft() {
    if (this.data.adCoins.day !== today()) this.data.adCoins = { day: today(), n: 0 };
    return Math.max(0, 5 - this.data.adCoins.n);
  }
  useAdCoins() {
    this.adCoinsLeft();
    this.data.adCoins.n++;
  }
}

export const profile = new Profile();
