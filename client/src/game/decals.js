// Canvas-generated textures: notes with clues, symbols, scrawled wall writings.
import { textureFromCanvas } from '../engine/gl.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export const SYMBOLS = ['◯', '△', '✕', '☐', '☾', '✦'];

export function drawSymbol(ctx, sym, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = size * 0.4;
  ctx.beginPath();
  switch (sym) {
    case '◯': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); break;
    case '△': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); ctx.stroke(); break;
    case '✕': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); break;
    case '☐': ctx.rect(x - r, y - r, r * 2, r * 2); ctx.stroke(); break;
    case '☾': ctx.arc(x, y, r, Math.PI * 0.3, Math.PI * 1.7); ctx.arc(x + r * 0.45, y, r * 0.75, Math.PI * 1.55, Math.PI * 0.45, true); ctx.closePath(); ctx.fill(); break;
    case '✦':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, rr = i % 2 ? r * 0.4 : r;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    default: break;
  }
  ctx.restore();
}

function paper(ctx, w, h, seed = 1) {
  ctx.fillStyle = '#d8d0b8';
  ctx.fillRect(0, 0, w, h);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(90,70,40,${r() * 0.06})`;
    ctx.fillRect(r() * w, r() * h, 2 + r() * 20, 2 + r() * 20);
  }
  ctx.strokeStyle = 'rgba(80,90,140,0.25)';
  ctx.lineWidth = 1;
  for (let y = 40; y < h; y += 22) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
  }
  // stains
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(110,80,40,${0.08 + r() * 0.1})`;
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 10 + r() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Note with a big handwritten clue (e.g. "_ 7 _ _")
export function noteTexture(gl, lines, seed = 1) {
  const c = canvas(256, 320);
  const ctx = c.getContext('2d');
  paper(ctx, 256, 320, seed);
  ctx.fillStyle = '#1c1a2a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.font = `${l.size || 34}px "Courier New", monospace`;
    ctx.fillStyle = l.color || '#1c1a2a';
    ctx.fillText(l.text, 128 + Math.sin(i * 7 + seed) * 4, 60 + i * 56);
  });
  return { tex: textureFromCanvas(gl, c), canvas: c };
}

export function symbolTexture(gl, sym, bg = '#b8b0a0', fg = '#2a0a0a') {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  drawSymbol(ctx, sym, 64, 64, 96, fg);
  return textureFromCanvas(gl, c);
}

export function sequenceTexture(gl, syms) {
  const c = canvas(512, 160);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 160);
  syms.forEach((s, i) => {
    drawSymbol(ctx, s, 70 + i * 124, 70, 110, 'rgba(25,25,30,0.92)');
    ctx.fillStyle = 'rgba(25,25,30,0.9)';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 70 + i * 124, 148);
  });
  return textureFromCanvas(gl, c);
}

// Scrawled wall text (transparent background, alpha-tested)
export function writingTexture(gl, text, color = 'rgba(214,208,192,0.88)') {
  const c = canvas(512, 128);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  ctx.font = `bold ${size}px Impact, "Arial Black", sans-serif`;
  while (ctx.measureText(text).width > 480 && size > 20) {
    size -= 4;
    ctx.font = `bold ${size}px Impact, "Arial Black", sans-serif`;
  }
  ctx.save();
  ctx.translate(256, 64);
  ctx.rotate(-0.04);
  ctx.fillText(text, 0, 0);
  // chalk smudges
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 14; i++) {
    const x = (Math.random() - 0.5) * ctx.measureText(text).width;
    ctx.fillRect(x, (Math.random() - 0.5) * size, 2 + Math.random() * 10, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return textureFromCanvas(gl, c);
}

export function boardTexture(gl, pattern, powered) {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1c1a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 120);
  pattern.forEach((on, i) => {
    const x = 40 + i * (176 / Math.max(1, pattern.length - 1));
    ctx.fillStyle = !powered ? '#222' : on ? '#2f2' : '#d22';
    ctx.beginPath();
    ctx.arc(x, 56, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bbb';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(on ? '▲' : '▼', x, 106);
  });
  return textureFromCanvas(gl, c);
}

export function setCanvasTexture(gl, tex, c) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
}
