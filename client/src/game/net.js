// Client networking: lobby/party/matchmaking connection to the game server, and match sessions
// (networked relay or fully local for solo/offline play).
import { CONFIG } from './config.js';

export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.state = 'offline'; // offline | connecting | online
    this.handlers = new Map();
    this.party = null;
    this.hello = null;
    this.retry = 0;
    this.wantOnline = false;
    this.queue = [];
  }

  url() {
    if (CONFIG.SERVER_URL) return CONFIG.SERVER_URL;
    if (location.protocol === 'file:') return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, d) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of [...hs]) fn(d);
  }

  connect(hello) {
    this.hello = hello;
    this.wantOnline = true;
    this.open();
  }

  open() {
    const url = this.url();
    if (!url || this.ws) return;
    this.state = 'connecting';
    this.emit('status', this.state);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.fail();
      return;
    }
    this.ws = ws;
    const timeout = setTimeout(() => {
      if (ws.readyState !== 1) ws.close();
    }, 6000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.retry = 0;
      this.send({ t: 'hello', ...this.hello, ver: 1 });
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.t === 'welcome') {
        this.id = m.id;
        this.state = 'online';
        this.emit('status', this.state);
        for (const q of this.queue.splice(0)) this.send(q);
      }
      if (m.t === 'party') this.party = m.party;
      if (m.t === 'kicked') this.party = null;
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      this.ws = null;
      this.id = null;
      this.party = null;
      this.fail();
    };
    ws.onerror = () => {};
  }

  fail() {
    this.state = 'offline';
    this.emit('status', this.state);
    this.emit('disconnected', {});
    if (!this.wantOnline) return;
    this.retry++;
    const delay = Math.min(30000, 2000 * Math.pow(1.6, this.retry));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1 && (this.id || msg.t === 'hello')) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    if (msg.t !== 'g') this.queue.push(msg);
    return false;
  }

  get online() {
    return this.state === 'online';
  }

  // party API
  createParty(opts = {}) { this.send({ t: 'party.create', ...opts }); }
  joinParty(code) { this.send({ t: 'party.join', code: String(code).toUpperCase().trim() }); }
  leaveParty() { this.send({ t: 'party.leave' }); this.party = null; }
  setParty(opts) { this.send({ t: 'party.set', ...opts }); }
  setReady(ready) { this.send({ t: 'party.ready', ready }); }
  kick(id) { this.send({ t: 'party.kick', id }); }
  updateProfile(hello) {
    this.hello = hello;
    this.send({ t: 'profile', ...hello });
  }
  startSearch() { this.send({ t: 'mm.start' }); }
  cancelSearch() { this.send({ t: 'mm.cancel' }); }
}

// Match session over the server relay
export class NetSession {
  constructor(net, match) {
    this.net = net;
    this.localId = net.id;
    this.hostId = match.hostId;
    this.handlers = new Map();
    this.hostCb = null;
    this.leftCb = null;
    this.offs = [
      net.on('g', (m) => {
        const d = m.d;
        if (!d || typeof d.type !== 'string') return;
        const fn = this.handlers.get(d.type);
        if (fn) fn(d.data, m.from);
      }),
      net.on('match.host', (m) => {
        this.hostId = m.hostId;
        if (this.hostCb) this.hostCb(m.hostId);
      }),
      net.on('match.left', (m) => this.leftCb && this.leftCb(m.id)),
      net.on('disconnected', () => {
        // lost connection: continue alone as host with whoever is simulated locally
        this.hostId = this.localId;
        this.offline = true;
        if (this.hostCb) this.hostCb(this.localId);
      }),
    ];
  }
  get isHost() {
    return this.hostId === this.localId;
  }
  on(type, fn) {
    this.handlers.set(type, fn);
  }
  onHostChange(fn) {
    this.hostCb = fn;
  }
  onPeerLeft(fn) {
    this.leftCb = fn;
  }
  send(type, data) {
    if (this.offline) return;
    this.net.send({ t: 'g', d: { type, data } });
  }
  sendTo(id, type, data) {
    if (this.offline) return;
    this.net.send({ t: 'g', to: id, d: { type, data } });
  }
  toHost(type, data) {
    this.sendTo(this.hostId, type, data);
  }
  leave() {
    for (const off of this.offs) off();
    this.net.send({ t: 'match.leave' });
  }
}

// Single-player / offline session: this peer is always the host.
export class LocalSession {
  constructor(localId) {
    this.localId = localId;
    this.hostId = localId;
    this.isHost = true;
  }
  on() {}
  onHostChange() {}
  onPeerLeft() {}
  send() {}
  sendTo() {}
  toHost() {}
  leave() {}
}
