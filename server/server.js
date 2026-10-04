// Game server: serves the client (for self-hosting / development) and the multiplayer
// lobby over WebSocket at /ws. Zero dependencies: `node server/server.js`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocketServer } from './ws.js';
import { Lobby } from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.CLIENT_DIR || path.join(__dirname, '..', 'client'));
const PORT = +process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function createServer(opts = {}) {
  const lobby = new Lobby(opts);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
      return;
    }
    if (opts.static === false) {
      res.writeHead(404);
      res.end();
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'cross-origin-opener-policy': 'same-origin',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  const wss = attachWebSocketServer(server, '/ws', (conn) => lobby.connect(conn));
  return {
    server,
    lobby,
    listen: (port = PORT) => new Promise((r) => server.listen(port, () => r(server.address().port))),
    close: () =>
      new Promise((r) => {
        lobby.stop();
        wss.close();
        for (const c of wss.connections) c.terminate();
        server.close(() => r());
      }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = createServer();
  app.listen(PORT).then((port) => console.log(`Dead Hour server: http://localhost:${port}  (ws: /ws)`));
}
