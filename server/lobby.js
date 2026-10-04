// Parties (invite codes), DBD-style ready-up, matchmaking by mode, match relay & host migration.
import crypto from 'node:crypto';

export const MODES = { solo: 1, duo: 2, trio: 3, squad: 4 };
export const MAP_IDS = ['prison', 'town', 'backrooms', 'hospital'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = {
  ru: ['Алиса', 'Макс', 'Вера', 'Тимур', 'Соня', 'Гриша', 'Лена', 'Арсений'],
  en: ['Alice', 'Max', 'Vera', 'Tim', 'Sonia', 'Greg', 'Lena', 'Arsen'],
};

const clean = (s, max = 24) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);

export class Lobby {
  constructor(opts = {}) {
    this.timeout = opts.matchmakingTimeout ?? 20;
    this.clients = new Map();
    this.parties = new Map();
    this.matches = new Map();
    this.nextId = 1;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.tickTimer.unref?.();
  }

  stop() {
    clearInterval(this.tickTimer);
  }

  // ------------------------------------------------------------------ connections
  connect(conn) {
    const id = 'p' + (this.nextId++).toString(36) + crypto.randomBytes(2).toString('hex');
    const c = { id, conn, name: 'Survivor', app: null, perks: [], lang: 'ru', party: null, match: null, rate: { t: Date.now(), n: 0 }, hello: false };
    this.clients.set(id, c);
    conn.on('message', (text) => this.onMessage(c, text));
    conn.on('close', () => this.disconnect(c));
    return c;
  }

  send(c, msg) {
    if (c && c.conn.open) c.conn.send(JSON.stringify(msg));
  }

  onMessage(c, text) {
    // rate limit: 150 msgs / second burst window
    const now = Date.now();
    if (now - c.rate.t > 1000) {
      c.rate.t = now;
      c.rate.n = 0;
    }
    if (++c.rate.n > 150) return;
    if (text.length > 16384) return;
    let m;
    try {
      m = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (!c.hello && m.t !== 'hello') return;
    switch (m.t) {
      case 'hello':
        this.applyProfile(c, m);
        c.hello = true;
        this.send(c, { t: 'welcome', id: c.id });
        break;
      case 'profile':
        this.applyProfile(c, m);
        if (c.party) this.broadcastParty(c.party);
        break;
      case 'party.create':
        this.createParty(c, m);
        break;
      case 'party.join':
        this.joinParty(c, clean(m.code, 8).toUpperCase());
        break;
      case 'party.leave':
        this.leaveParty(c);
        break;
      case 'party.set':
        this.setParty(c, m);
        break;
      case 'party.ready':
        if (c.party) {
          c.ready = !!m.ready;
          this.broadcastParty(c.party);
        }
        break;
      case 'party.kick':
        this.kick(c, m.id);
        break;
      case 'mm.start':
        this.startSearch(c);
        break;
      case 'mm.cancel':
        this.cancelSearch(c);
        break;
      case 'g':
        this.relay(c, m);
        break;
      case 'match.leave':
        this.leaveMatch(c);
        break;
      default:
        break;
    }
  }

  applyProfile(c, m) {
    c.name = clean(m.name) || 'Survivor';
    c.app = m.app && typeof m.app === 'object' ? m.app : null;
    c.perks = Array.isArray(m.perks) ? m.perks.slice(0, 2).map((p) => clean(p, 20)) : [];
    c.lang = m.lang === 'ru' ? 'ru' : 'en';
    c.level = Math.max(1, Math.min(999, m.level | 0));
  }

  disconnect(c) {
    this.leaveMatch(c);
    this.leaveParty(c);
    this.clients.delete(c.id);
  }

  // ------------------------------------------------------------------ parties
  newCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 5; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.parties.has(s)) return s;
    }
  }

  createParty(c, m) {
    if (c.match) return;
    if (c.party) this.leaveParty(c);
    const mode = MODES[m.mode] ? m.mode : 'duo';
    const p = { code: this.newCode(), leader: c.id, members: [c.id], mode, map: MAP_IDS.includes(m.map) ? m.map : 'random', friendsOnly: false, searching: false, searchStart: 0 };
    this.parties.set(p.code, p);
    c.party = p;
    c.ready = true;
    this.broadcastParty(p);
  }

  joinParty(c, code) {
    if (c.match) return;
    const p = this.parties.get(code);
    if (!p) return this.send(c, { t: 'party.error', e: 'party_not_found' });
    if (p === c.party) return this.broadcastParty(p);
    if (p.members.length >= 4) return this.send(c, { t: 'party.error', e: 'server_full' });
    if (p.searching || p.members.some((id) => this.clients.get(id)?.match)) return this.send(c, { t: 'party.error', e: 'server_full' });
    if (c.party) this.leaveParty(c);
    p.members.push(c.id);
    c.party = p;
    c.ready = false;
    // grow the mode automatically so everyone fits
    const order = ['solo', 'duo', 'trio', 'squad'];
    if (MODES[p.mode] < p.members.length) p.mode = order[p.members.length - 1];
    this.broadcastParty(p);
  }

  leaveParty(c) {
    const p = c.party;
    if (!p) return;
    p.members = p.members.filter((id) => id !== c.id);
    c.party = null;
    c.ready = false;
    if (!p.members.length) {
      this.parties.delete(p.code);
      return;
    }
    if (p.leader === c.id) p.leader = p.members[0];
    p.searching = false;
    this.broadcastParty(p);
  }

  setParty(c, m) {
    const p = c.party;
    if (!p || p.leader !== c.id || p.searching) return;
    if (MODES[m.mode] && MODES[m.mode] >= p.members.length) p.mode = m.mode;
    if (m.map === 'random' || MAP_IDS.includes(m.map)) p.map = m.map;
    if (typeof m.friendsOnly === 'boolean') p.friendsOnly = m.friendsOnly;
    this.broadcastParty(p);
  }

  kick(c, id) {
    const p = c.party;
    if (!p || p.leader !== c.id || id === c.id) return;
    const t = this.clients.get(id);
    if (!t || t.party !== p) return;
    this.leaveParty(t);
    this.send(t, { t: 'kicked' });
  }

  partyView(p) {
    return {
      code: p.code,
      leader: p.leader,
      mode: p.mode,
      map: p.map,
      friendsOnly: p.friendsOnly,
      searching: p.searching,
      elapsed: p.searching ? Math.floor((Date.now() - p.searchStart) / 1000) : 0,
      members: p.members.map((id) => {
        const m = this.clients.get(id);
        return { id, name: m?.name, app: m?.app, ready: !!m?.ready, level: m?.level || 1 };
      }),
    };
  }

  broadcastParty(p) {
    const view = this.partyView(p);
    for (const id of p.members) this.send(this.clients.get(id), { t: 'party', party: view });
  }

  // ------------------------------------------------------------------ matchmaking
  startSearch(c) {
    const p = c.party;
    if (!p || p.leader !== c.id || p.searching) return;
    if (p.members.length > MODES[p.mode]) return this.send(c, { t: 'party.error', e: 'party_size_exceeds' });
    const notReady = p.members.some((id) => id !== p.leader && !this.clients.get(id)?.ready);
    if (notReady) return this.send(c, { t: 'party.error', e: 'not_ready' });
    p.searching = true;
    p.searchStart = Date.now();
    this.broadcastParty(p);
    this.tick();
  }

  cancelSearch(c) {
    const p = c.party;
    if (!p || !p.searching) return;
    p.searching = false;
    this.broadcastParty(p);
  }

  tick() {
    const searching = [...this.parties.values()].filter((p) => p.searching).sort((a, b) => a.searchStart - b.searchStart);
    const used = new Set();
    for (const p of searching) {
      if (used.has(p)) continue;
      const size = MODES[p.mode];
      const group = [p];
      let total = p.members.length;
      let map = p.map;
      if (!p.friendsOnly) {
        for (const q of searching) {
          if (q === p || used.has(q) || q.friendsOnly || q.mode !== p.mode) continue;
          if (map !== 'random' && q.map !== 'random' && q.map !== map) continue;
          if (total + q.members.length > size) continue;
          group.push(q);
          total += q.members.length;
          if (map === 'random' && q.map !== 'random') map = q.map;
          if (total === size) break;
        }
      }
      const elapsed = (Date.now() - p.searchStart) / 1000;
      if (total === size || elapsed >= this.timeout || p.friendsOnly) {
        group.forEach((g) => used.add(g));
        this.startMatch(group, map, size);
      } else {
        for (const g of group) for (const id of g.members) this.send(this.clients.get(id), { t: 'mm.status', elapsed: Math.floor(elapsed), found: total, need: size });
      }
    }
  }

  startMatch(parties, map, size) {
    const members = parties.flatMap((p) => p.members).map((id) => this.clients.get(id)).filter(Boolean);
    if (!members.length) return;
    const lang = members[0].lang;
    const id = 'm' + crypto.randomBytes(4).toString('hex');
    const seed = crypto.randomInt(1, 2 ** 31 - 1);
    const mapId = map === 'random' ? MAP_IDS[crypto.randomInt(MAP_IDS.length)] : map;
    const players = members.map((c) => ({ id: c.id, name: c.name, app: c.app, perks: c.perks }));
    const names = BOT_NAMES[lang].slice();
    for (let i = players.length; i < size; i++) players.push({ id: 'bot' + i, name: names.splice(crypto.randomInt(names.length), 1)[0], app: null, perks: [], isBot: true });
    const match = { id, seed, map: mapId, mode: parties[0].mode, hostId: members[0].id, members: new Set(members.map((c) => c.id)), players, created: Date.now() };
    this.matches.set(id, match);
    for (const p of parties) p.searching = false;
    for (const c of members) {
      c.match = match;
      this.send(c, { t: 'match.start', match: { id, seed, map: mapId, mode: match.mode, hostId: match.hostId, players } });
    }
    for (const p of parties) this.broadcastParty(p);
  }

  // ------------------------------------------------------------------ in-match relay
  relay(c, m) {
    const match = c.match;
    if (!match || !m.d) return;
    const out = JSON.stringify({ t: 'g', from: c.id, d: m.d });
    if (m.to) {
      if (!match.members.has(m.to)) return;
      const t = this.clients.get(m.to);
      if (t && t.conn.open) t.conn.send(out);
      return;
    }
    for (const id of match.members) {
      if (id === c.id) continue;
      const t = this.clients.get(id);
      if (t && t.conn.open) t.conn.send(out);
    }
  }

  leaveMatch(c) {
    const match = c.match;
    if (!match) return;
    c.match = null;
    match.members.delete(c.id);
    if (!match.members.size) {
      this.matches.delete(match.id);
      return;
    }
    for (const id of match.members) this.send(this.clients.get(id), { t: 'match.left', id: c.id });
    if (match.hostId === c.id) {
      match.hostId = [...match.members][0];
      for (const id of match.members) this.send(this.clients.get(id), { t: 'match.host', hostId: match.hostId });
    }
  }

  stats() {
    return { clients: this.clients.size, parties: this.parties.size, matches: this.matches.size };
  }
}
