// Minimal dependency-free WebSocket (RFC 6455) server implementation.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.open = true;
    this.alive = true;
    this.remote = req.headers['x-forwarded-for']?.split(',')[0].trim() || socket.remoteAddress;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.terminate());
    socket.on('error', () => this.terminate());
  }

  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2);
        if (hi !== 0) return this.close(1009);
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(off + 4 + len);
      this.handleFrame(fin, opcode, payload);
      if (!this.open) return;
    }
  }

  handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // continuation
        this.fragments.push(payload);
        if (this.fragments.reduce((a, f) => a + f.length, 0) > MAX_PAYLOAD) return this.close(1009);
        if (fin) {
          const data = Buffer.concat(this.fragments);
          this.fragments = [];
          if (this.fragOpcode === 0x1) this.emit('message', data.toString('utf8'));
        }
        break;
      case 0x1:
      case 0x2:
        if (!fin) {
          this.fragOpcode = opcode;
          this.fragments = [payload];
          return;
        }
        if (opcode === 0x1) this.emit('message', payload.toString('utf8'));
        break;
      case 0x8:
        this.close(1000);
        break;
      case 0x9:
        this.sendFrame(0xa, payload);
        break;
      case 0xa:
        this.alive = true;
        break;
      default:
        this.close(1002);
    }
  }

  sendFrame(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      this.terminate();
    }
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this.sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this.sendFrame(0x8, p);
    this.terminate();
  }

  terminate() {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.end();
      this.socket.destroy();
    } catch (e) {
      /* ignore */
    }
    this.emit('close');
  }
}

export function attachWebSocketServer(httpServer, path, onConnection) {
  const conns = new Set();
  httpServer.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    const conn = new WsConnection(socket, req);
    conns.add(conn);
    conn.on('close', () => conns.delete(conn));
    onConnection(conn);
  });
  // heartbeat
  const timer = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        c.terminate();
        continue;
      }
      c.alive = false;
      c.ping();
    }
  }, 20000);
  timer.unref();
  return { connections: conns, close: () => clearInterval(timer) };
}
