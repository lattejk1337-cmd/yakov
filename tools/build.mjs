// Packages the client for Yandex Games: copies client/ to dist/game and writes
// dist/dead-hour-yandex.zip with index.html at the archive root.
// Optional: SERVER_URL=wss://your-server/ws npm run build
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'client');
const out = path.join(root, 'dist', 'game');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [];
(function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p, r);
    else files.push(r);
  }
})(src);

for (const f of files) {
  if (/[^A-Za-z0-9_./-]/.test(f)) throw new Error(`File name not allowed by Yandex (spaces/non-latin): ${f}`);
  let data = fs.readFileSync(path.join(src, f));
  if (f === 'src/game/config.js' && process.env.SERVER_URL) {
    data = Buffer.from(data.toString().replace("SERVER_URL: ''", `SERVER_URL: ${JSON.stringify(process.env.SERVER_URL)}`));
  }
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.writeFileSync(path.join(out, f), data);
}

// ---- minimal zip writer (deflate)
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunks = [], central = [];
let offset = 0;
for (const f of files.sort()) {
  const data = fs.readFileSync(path.join(out, f));
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  chunks.push(local, name, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += 30 + name.length + comp.length;
}
const cenSize = central.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(root, 'dist', 'dead-hour-yandex.zip');
fs.writeFileSync(zipPath, Buffer.concat([...chunks, ...central, end]));
const size = fs.statSync(zipPath).size;
console.log(`${files.length} files -> ${path.relative(root, zipPath)} (${(size / 1024).toFixed(0)} KB)`);
if (size > 100 * 1024 * 1024) throw new Error('Archive exceeds the 100 MB limit');
