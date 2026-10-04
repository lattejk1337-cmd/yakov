// Integration test for the lobby server using Node's built-in WebSocket client.
import assert from 'node:assert/strict';
import { createServer } from '../server/server.js';

const app = createServer({ static: false, matchmakingTimeout: 2 });
const port = await app.listen(0);
const url = `ws://127.0.0.1:${port}/ws`;

function client(name) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  };
  const api = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 4000) => new Promise((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return res(hit); }
      const w = { pred, res };
      waiters.push(w);
      setTimeout(() => rej(new Error('timeout waiting in ' + name)), ms);
    }),
  };
  return new Promise((r) => (ws.onopen = () => r(api)));
}

const a = await client('a');
const b = await client('b');
a.send({ t: 'hello', name: 'Alice<script>', lang: 'ru', app: { skin: 1 } });
b.send({ t: 'hello', name: 'Bob', lang: 'ru' });
const wa = await a.wait((m) => m.t === 'welcome');
const wb = await b.wait((m) => m.t === 'welcome');
assert.ok(wa.id && wb.id && wa.id !== wb.id);

a.send({ t: 'party.create', mode: 'trio', map: 'prison' });
const pa = await a.wait((m) => m.t === 'party');
assert.equal(pa.party.members.length, 1);
assert.equal(pa.party.members[0].name, 'Alicescript', 'name sanitised');
const code = pa.party.code;
assert.match(code, /^[A-Z0-9]{5}$/);

b.send({ t: 'party.join', code: code.toLowerCase() });
const pb = await b.wait((m) => m.t === 'party' && m.party.members.length === 2);
assert.equal(pb.party.leader, wa.id);

b.send({ t: 'party.join', code: 'ZZZZZ' });
const err = await b.wait((m) => m.t === 'party.error');
assert.equal(err.e, 'party_not_found');

// leader cannot start until everyone is ready
a.send({ t: 'mm.start' });
await a.wait((m) => m.t === 'party.error' && m.e === 'not_ready');
b.send({ t: 'party.ready', ready: true });
await a.wait((m) => m.t === 'party' && m.party.members.every((x) => x.ready));
a.send({ t: 'mm.start' });
const sa = await a.wait((m) => m.t === 'match.start', 6000);
const sb = await b.wait((m) => m.t === 'match.start', 6000);
assert.equal(sa.match.id, sb.match.id);
assert.equal(sa.match.players.length, 3, 'trio filled with a bot');
assert.ok(sa.match.players[2].isBot);
assert.equal(sa.match.map, 'prison');
assert.equal(sa.match.hostId, wa.id);

// relay
a.send({ t: 'g', d: { type: 'ps', data: { p: [1, 2, 3] } } });
const g = await b.wait((m) => m.t === 'g');
assert.equal(g.from, wa.id);
assert.deepEqual(g.d.data.p, [1, 2, 3]);
b.send({ t: 'g', to: wa.id, d: { type: 'rq', data: { a: 'door', id: 1 } } });
const g2 = await a.wait((m) => m.t === 'g');
assert.equal(g2.d.type, 'rq');

// host migration
a.ws.close();
const hb = await b.wait((m) => m.t === 'match.host');
assert.equal(hb.hostId, wb.id);

b.ws.close();
await new Promise((r) => setTimeout(r, 100));
assert.equal(app.lobby.stats().matches, 0);
await app.close();
console.log('server tests: OK');
