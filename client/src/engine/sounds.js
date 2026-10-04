// Procedural sound bank: every sound and music loop is synthesised offline into AudioBuffers.

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// RBJ biquad applied in place
function biquad(buf, type, freq, q, sr, gainDb = 0) {
  const w0 = (TAU * Math.min(freq, sr * 0.45)) / sr;
  const cs = Math.cos(w0), sn = Math.sin(w0);
  const alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  const A = Math.pow(10, gainDb / 40);
  switch (type) {
    case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
    default: return buf;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

// time-varying one-pole lowpass (cheap sweeps)
function sweepLP(buf, fFn, sr) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    const f = fFn(i / sr);
    const a = 1 - Math.exp((-TAU * f) / sr);
    y += (buf[i] - y) * a;
    buf[i] = y;
  }
  return buf;
}

function noise(n, r) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  return b;
}

function env(t, a, d) {
  if (t < a) return t / a;
  return Math.exp(-(t - a) / d);
}

function normalize(b, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}

function softclip(b, drive = 1) {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive);
  return b;
}

function mixInto(dst, src, offset, gain = 1) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) if (i + offset >= 0) dst[i + offset] += src[i] * gain;
}

function loopify(b, sr, fade = 0.5) {
  const f = Math.min(Math.floor(fade * sr), Math.floor(b.length / 3));
  const out = new Float32Array(b.length - f);
  out.set(b.subarray(0, out.length));
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = b[out.length + i] * (1 - t) + out[i] * t;
  }
  return out;
}

// ---------------------------------------------------------------- recipes
const R = {};

R.step = (sr, seed, surface) => {
  const r = rng(seed);
  const n = Math.floor(sr * 0.22);
  const b = noise(n, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] *= env(t, 0.003, surface === 'carpet' ? 0.03 : 0.035) * (0.6 + 0.4 * r());
  }
  const lpF = { concrete: 1800, metal: 3000, carpet: 500, wood: 1200, dirt: 2500, grass: 3500, water: 1500, tile: 2600 }[surface] || 1500;
  biquad(b, 'lp', lpF * (0.8 + r() * 0.4), 0.8, sr);
  if (surface === 'dirt' || surface === 'grass') {
    // crunchy grains
    for (let k = 0; k < 14; k++) {
      const p = Math.floor(r() * sr * 0.08);
      for (let j = 0; j < 40 && p + j < n; j++) b[p + j] += (r() * 2 - 1) * Math.exp(-j / 8) * 0.6;
    }
    biquad(b, 'hp', 600, 0.7, sr);
  }
  // body thump
  const f0 = { metal: 110, wood: 140, carpet: 70 }[surface] || 85;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] += Math.sin(TAU * f0 * t * (1 - t * 2)) * env(t, 0.002, 0.03) * (surface === 'carpet' ? 0.5 : 0.8);
  }
  if (surface === 'metal') {
    const fs = [420 + r() * 60, 1130 + r() * 90, 2310 + r() * 100, 3400];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (let k = 0; k < fs.length; k++) s += Math.sin(TAU * fs[k] * t) * Math.exp(-t * (14 + k * 8)) / (k + 1);
      b[i] += s * 0.5;
    }
  }
  if (surface === 'water') {
    biquad(b, 'bp', 900, 1.2, sr);
    for (let k = 0; k < 6; k++) {
      const p = Math.floor((0.01 + r() * 0.1) * sr), f = 600 + r() * 1400;
      for (let j = 0; j < sr * 0.03 && p + j < n; j++) b[p + j] += Math.sin(TAU * f * (j / sr) * (1 + j / sr * 20)) * Math.exp(-j / (sr * 0.008)) * 0.4;
    }
  }
  if (surface === 'wood' && r() > 0.6) {
    // occasional creak
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      b[i] += Math.sin(TAU * (260 + 40 * Math.sin(t * 30)) * t) * Math.exp(-t * 18) * 0.15 * (Math.sin(TAU * 35 * t) > 0 ? 1 : 0.3);
    }
  }
  return normalize(b, 0.8);
};

R.heavyStep = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 0.5);
  const b = noise(n, r);
  biquad(b, 'lp', 400, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = b[i] * env(t, 0.004, 0.08) * 0.6 + Math.sin(TAU * 48 * t * (1 - t)) * env(t, 0.004, 0.15);
  }
  return normalize(softclip(b, 1.5), 0.95);
};

R.creak = (sr, seed, dur = 1.3) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 180 + 140 * Math.sin(t * 2.3 + 1) + 60 * Math.sin(t * 11) + r() * 30;
    ph += (TAU * f) / sr;
    // stick-slip friction: pulse train
    const s = (ph % TAU) < 0.6 ? 1 : -0.15;
    b[i] = s * (0.6 + 0.4 * Math.sin(t * 40)) * Math.sin((Math.PI * t) / dur);
  }
  biquad(b, 'bp', 900, 2.5, sr);
  biquad(b, 'peak', 2200, 3, sr, 6);
  return normalize(b, 0.7);
};

R.thump = (sr, seed, f = 70, dur = 0.5) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'lp', 900, 0.8, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = b[i] * env(t, 0.002, 0.03) * 0.7 + Math.sin(TAU * f * t * (1 - t * 0.5)) * env(t, 0.002, dur * 0.25);
  }
  // latch click
  for (let i = 0; i < sr * 0.01; i++) b[i] += (r() * 2 - 1) * (1 - i / (sr * 0.01)) * 0.5;
  return normalize(b, 0.9);
};

R.clank = (sr, seed, dur = 1.8) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'bp', 1800, 1, sr);
  const fs = [97, 233, 412, 587, 911, 1340, 2120];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < fs.length; k++) s += Math.sin(TAU * fs[k] * (1 + r() * 0.0005) * t) * Math.exp(-t * (2 + k * 1.3)) * (1 / (1 + k * 0.4));
    b[i] = b[i] * env(t, 0.001, 0.05) + s * 0.6;
  }
  return normalize(softclip(b, 1.2), 0.9);
};

R.click = (sr, seed, f = 2500, dur = 0.05) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = b[i] * env(t, 0.0005, 0.004) + Math.sin(TAU * f * t) * env(t, 0.0005, 0.01) * 0.6;
  }
  return normalize(b, 0.7);
};

R.beep = (sr, seed, f = 1200, dur = 0.09, type = 'sine') => {
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = Math.sin(TAU * f * t);
    if (type === 'square') s = Math.sign(s) * 0.6;
    b[i] = s * Math.min(1, t / 0.004) * Math.min(1, (dur - t) / 0.01);
  }
  return normalize(b, 0.5);
};

R.chime = (sr, seed, notes = [523, 659, 784, 1046], spacing = 0.09) => {
  const n = Math.floor(sr * (notes.length * spacing + 1.2));
  const b = new Float32Array(n);
  notes.forEach((f, k) => {
    const off = Math.floor(k * spacing * sr);
    for (let i = 0; off + i < n; i++) {
      const t = i / sr;
      b[off + i] += (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.01 * t) + 0.1 * Math.sin(TAU * f * 3.98 * t)) * env(t, 0.003, 0.35);
    }
  });
  return normalize(b, 0.6);
};

R.whoosh = (sr, seed, dur = 0.35) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  sweepLP(b, (t) => 300 + 3000 * Math.sin((Math.PI * t) / dur), sr);
  for (let i = 0; i < n; i++) b[i] *= Math.sin((Math.PI * i) / n);
  return normalize(b, 0.6);
};

R.glass = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 1.0);
  const b = noise(n, r);
  biquad(b, 'hp', 2500, 0.7, sr);
  for (let i = 0; i < n; i++) b[i] *= env(i / sr, 0.001, 0.06) * 0.6;
  for (let k = 0; k < 30; k++) {
    const p = Math.floor(r() * r() * sr * 0.5), f = 2500 + r() * 6000, a = 0.2 + r() * 0.4;
    for (let j = 0; j < sr * 0.15 && p + j < n; j++) b[p + j] += Math.sin(TAU * f * (j / sr)) * Math.exp(-j / (sr * (0.01 + r() * 0.03))) * a;
  }
  return normalize(b, 0.8);
};

R.can = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 0.5);
  const b = new Float32Array(n);
  const fs = [520 + r() * 80, 1340 + r() * 100, 2890 + r() * 200, 4100];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = (r() * 2 - 1) * env(t, 0.0005, 0.005);
    for (let k = 0; k < fs.length; k++) s += Math.sin(TAU * fs[k] * t) * Math.exp(-t * (10 + k * 6)) * 0.5;
    b[i] = s;
  }
  return normalize(b, 0.7);
};

R.heartbeat = (sr) => {
  const n = Math.floor(sr * 0.9);
  const b = new Float32Array(n);
  for (const [off, a] of [[0, 1], [0.22, 0.7]]) {
    const o = Math.floor(off * sr);
    for (let i = 0; o + i < n; i++) {
      const t = i / sr;
      b[o + i] += Math.sin(TAU * 52 * t * (1 - t * 2)) * env(t, 0.008, 0.06) * a;
    }
  }
  biquad(b, 'lp', 160, 0.7, sr);
  return normalize(b, 0.95);
};

R.breath = (sr, seed) => {
  const r = rng(seed);
  const dur = 1.6;
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'bp', 1100, 0.8, sr);
  biquad(b, 'peak', 2600, 2, sr, 5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inhale = t < 0.6 ? Math.sin((Math.PI * t) / 0.6) * 0.55 : 0;
    const exhale = t > 0.7 && t < 1.5 ? Math.sin((Math.PI * (t - 0.7)) / 0.8) : 0;
    b[i] *= inhale + exhale;
  }
  return normalize(b, 0.6);
};

R.growl = (sr, seed, dur = 2.2, base = 70) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  let ph = 0, ph2 = 0;
  const nz = noise(n, r);
  biquad(nz, 'lp', 600, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = base * (1 + 0.15 * Math.sin(t * 7) + 0.1 * Math.sin(t * 23)) + nz[i] * 20;
    ph += (TAU * f) / sr;
    ph2 += (TAU * f * 1.49) / sr;
    const saw = ((ph / TAU) % 1) * 2 - 1;
    const saw2 = ((ph2 / TAU) % 1) * 2 - 1;
    const rough = 0.6 + 0.4 * Math.abs(nz[i] * 3);
    b[i] = (saw * 0.7 + saw2 * 0.3) * rough * Math.sin((Math.PI * t) / dur) ** 0.6;
  }
  const f1 = b.slice(), f2 = b.slice();
  biquad(f1, 'bp', 420, 3, sr);
  biquad(f2, 'bp', 1050, 4, sr);
  for (let i = 0; i < n; i++) b[i] = b[i] * 0.4 + f1[i] * 1.6 + f2[i] * 0.9;
  biquad(b, 'lp', 2400, 0.7, sr);
  return normalize(softclip(b, 2.5), 0.95);
};

R.scream = (sr, seed, dur = 1.6) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 700 + 900 * Math.min(1, t * 4) - 300 * t + 80 * Math.sin(t * 50) + (r() - 0.5) * 200;
    ph += (TAU * f) / sr;
    const s = Math.sin(ph) + 0.5 * Math.sin(ph * 2.02) + 0.3 * Math.sin(ph * 3.1);
    b[i] = (s + (r() * 2 - 1) * 0.8) * env(t, 0.03, dur * 0.45);
  }
  biquad(b, 'bp', 1800, 1.2, sr);
  biquad(b, 'peak', 3200, 2, sr, 8);
  return normalize(softclip(b, 3), 0.95);
};

R.whisper = (sr, seed, dur = 2.5) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'bp', 3200, 1.5, sr);
  biquad(b, 'peak', 5500, 3, sr, 4);
  let amp = 0, target = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.floor(sr * 0.11) === 0) target = r() > 0.35 ? r() : 0;
    amp += (target - amp) * 0.002;
    b[i] *= amp * Math.sin((Math.PI * i) / n);
  }
  return normalize(b, 0.6);
};

R.flutter = (sr, seed, dur = 2.0) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'bp', 700, 0.9, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const wing = Math.max(0, Math.sin(TAU * 26 * t)) ** 3;
    b[i] = b[i] * wing + Math.sin(TAU * 110 * t) * 0.15 * wing;
  }
  return normalize(loopify(b, sr, 0.3), 0.7);
};

R.woodCreakFig = (sr, seed) => R.creak(sr, seed, 0.9);

R.electricHum = (sr, seed, dur = 4, f = 60, buzz = 0.3) => {
  const r = rng(seed);
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = Math.sin(TAU * f * t) * 0.5 + Math.sin(TAU * f * 2 * t) * 0.35 + Math.sin(TAU * f * 3 * t) * 0.2;
    const bz = Math.sign(Math.sin(TAU * f * 2 * t)) * buzz * (0.7 + 0.3 * r());
    b[i] = s + bz * 0.3;
  }
  biquad(b, 'lp', 1800, 0.7, sr);
  return normalize(b, 0.5);
};

R.powerOn = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 2.5);
  const b = new Float32Array(n);
  const th = R.clank(sr, seed, 1.2);
  mixInto(b, th, 0, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 40 + 20 * Math.min(1, t);
    b[i] += (Math.sin(TAU * f * t) * 0.5 + Math.sign(Math.sin(TAU * f * 2 * t)) * 0.15 + (r() - 0.5) * 0.05) * Math.min(1, t * 2) * Math.exp(-Math.max(0, t - 1.5) * 3);
  }
  return normalize(b, 0.9);
};

R.spark = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 0.9);
  const b = noise(n, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const crackle = r() > 0.97 ? 3 : 1;
    b[i] *= env(t, 0.001, 0.2) * crackle;
  }
  biquad(b, 'hp', 1500, 0.7, sr);
  const bang = R.thump(sr, seed + 3, 60, 0.6);
  mixInto(b, bang, 0, 1.2);
  return normalize(softclip(b, 2), 0.95);
};

R.generator = (sr, seed) => {
  const r = rng(seed);
  const dur = 2.0;
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  const rate = 13;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = (t * rate) % 1;
    const pulse = Math.exp(-ph * 9);
    b[i] = (Math.sin(TAU * 55 * t) * 0.6 + (r() * 2 - 1) * 0.5) * (0.3 + pulse);
  }
  biquad(b, 'lp', 900, 1, sr);
  return normalize(b, 0.7);
};

R.radioStatic = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 3);
  const b = noise(n, r);
  biquad(b, 'bp', 2000, 0.5, sr);
  for (let i = 0; i < n; i++) if (r() > 0.9995) for (let j = 0; j < 200 && i + j < n; j++) b[i + j] *= 3;
  return normalize(loopify(b, sr, 0.3), 0.5);
};

R.bell = (sr, seed, f = 196) => {
  const n = Math.floor(sr * 6);
  const b = new Float32Array(n);
  const partials = [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    partials.forEach((p, k) => (s += Math.sin(TAU * f * p * t) * Math.exp(-t * (0.6 + k * 0.35)) / (1 + k * 0.3)));
    b[i] = s * Math.min(1, t / 0.002);
  }
  return normalize(b, 0.8);
};

R.pickup = (sr) => {
  const n = Math.floor(sr * 0.25);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 500 + 900 * t / 0.25;
    b[i] = Math.sin(TAU * f * t) * env(t, 0.005, 0.08) * 0.6 + Math.sin(TAU * f * 2 * t) * env(t, 0.005, 0.05) * 0.2;
  }
  return normalize(b, 0.5);
};

R.inject = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 1.4);
  const b = noise(n, r);
  biquad(b, 'hp', 4000, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] *= t < 0.5 ? Math.sin((Math.PI * t) / 0.5) * 0.35 : 0;
  }
  const hb = R.heartbeat(sr);
  mixInto(b, hb, Math.floor(sr * 0.5), 0.9);
  return normalize(b, 0.9);
};

R.bandage = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 1.2);
  const b = noise(n, r);
  biquad(b, 'bp', 2500, 0.8, sr);
  let amp = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.floor(sr * 0.07) === 0) amp = r() > 0.3 ? 0.4 + r() * 0.6 : 0.05;
    b[i] *= amp * (1 - (i % Math.floor(sr * 0.07)) / (sr * 0.07));
  }
  return normalize(b, 0.5);
};

R.hurt = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 0.6);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 190 - 60 * t + (r() - 0.5) * 20;
    ph += (TAU * f) / sr;
    b[i] = (((ph / TAU) % 1) * 2 - 1) * env(t, 0.01, 0.15);
  }
  const f1 = b.slice();
  biquad(f1, 'bp', 700, 4, sr);
  const f2 = b.slice();
  biquad(f2, 'bp', 1200, 5, sr);
  for (let i = 0; i < n; i++) b[i] = f1[i] + f2[i] * 0.7;
  const hit = R.thump(sr, seed + 9, 80, 0.3);
  mixInto(b, hit, 0, 0.8);
  return normalize(b, 0.9);
};

// ---------------------------------------------------------------- ambiences / music
R.ambPrison = (sr, seed) => {
  const r = rng(seed);
  const dur = 14;
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'lp', 180, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = b[i] * 1.6 + Math.sin(TAU * 55 * t) * 0.08 + Math.sin(TAU * 55.4 * t) * 0.08 + Math.sin(TAU * 82.4 * t) * 0.04 * (0.5 + 0.5 * Math.sin(t * 0.4));
  }
  for (let k = 0; k < 5; k++) mixInto(b, R.clank(sr, seed + k * 7, 1.5), Math.floor(r() * (dur - 2) * sr), 0.06 + r() * 0.05);
  for (let k = 0; k < 9; k++) {
    // drips
    const p = Math.floor(r() * (dur - 0.5) * sr), f = 1200 + r() * 1500;
    for (let j = 0; j < sr * 0.08; j++) b[p + j] += Math.sin(TAU * f * (j / sr) * (1 + (j / sr) * 8)) * Math.exp(-j / (sr * 0.012)) * 0.08;
  }
  return normalize(loopify(b, sr, 1.5), 0.45);
};

R.ambTown = (sr, seed) => {
  const r = rng(seed);
  const dur = 16;
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  const gust = (t) => 250 + 500 * (0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1));
  const w2 = b.slice();
  sweepLP(b, gust, sr);
  biquad(w2, 'bp', 700, 6, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = b[i] * 1.5 + w2[i] * 0.4 * (0.5 + 0.5 * Math.sin(t * 0.5));
  }
  // distant crows
  for (let k = 0; k < 3; k++) {
    const p = Math.floor(r() * (dur - 1) * sr);
    for (let c = 0; c < 2; c++) {
      const off = p + Math.floor(c * 0.35 * sr);
      let ph = 0;
      for (let j = 0; j < sr * 0.25 && off + j < n; j++) {
        const t = j / sr;
        ph += (TAU * (900 - 500 * t)) / sr;
        b[off + j] += Math.sign(Math.sin(ph)) * Math.sin((Math.PI * t) / 0.25) * 0.025;
      }
    }
  }
  return normalize(loopify(b, sr, 2), 0.5);
};

R.ambBackrooms = (sr, seed) => {
  const r = rng(seed);
  const dur = 10;
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  const hum = R.electricHum(sr, seed, dur, 60, 0.6);
  mixInto(b, hum, 0, 0.6);
  const room = noise(n, r);
  biquad(room, 'lp', 300, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] += room[i] * 0.5 + Math.sin(TAU * 41 * t) * 0.05 * (0.5 + 0.5 * Math.sin(t * 0.3));
  }
  return normalize(loopify(b, sr, 1), 0.4);
};

R.fire = (sr, seed) => {
  const r = rng(seed);
  const dur = 6;
  const n = Math.floor(sr * dur);
  const b = noise(n, r);
  biquad(b, 'lp', 700, 0.7, sr);
  for (let i = 0; i < n; i++) b[i] *= 0.6 + 0.4 * Math.sin(i / sr * 3 + Math.sin(i / sr * 7));
  for (let k = 0; k < 120; k++) {
    const p = Math.floor(r() * (n - 400));
    const a = r() * 0.8;
    for (let j = 0; j < 300; j++) b[p + j] += (r() * 2 - 1) * Math.exp(-j / 30) * a;
  }
  return normalize(loopify(b, sr, 0.5), 0.6);
};

function pad(sr, n, freqs, gain, cutoff) {
  const b = new Float32Array(n);
  for (const f of freqs) {
    for (const det of [-0.003, 0, 0.004]) {
      let ph = Math.random();
      const inc = (f * (1 + det)) / sr;
      for (let i = 0; i < n; i++) {
        ph += inc;
        b[i] += (((ph % 1) * 2 - 1) * gain) / 3;
      }
    }
  }
  biquad(b, 'lp', cutoff, 0.7, sr);
  biquad(b, 'lp', cutoff * 1.5, 0.7, sr);
  return b;
}

R.musicTension = (sr) => {
  const dur = 16;
  const n = Math.floor(sr * dur);
  const b = new Float32Array(n);
  const p1 = pad(sr, n, [55, 82.4, 116.5], 0.4, 500);
  const p2 = pad(sr, n, [58.3, 87.3, 110], 0.4, 450);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = 0.5 + 0.5 * Math.sin((TAU * t) / dur);
    b[i] = p1[i] * x + p2[i] * (1 - x);
    // slow high dissonant glass tone
    b[i] += Math.sin(TAU * 1661 * t) * 0.012 * (0.5 + 0.5 * Math.sin(t * 0.9)) + Math.sin(TAU * 1760 * t) * 0.01 * (0.5 + 0.5 * Math.sin(t * 0.7 + 2));
  }
  return normalize(loopify(b, sr, 2), 0.5);
};

R.musicChase = (sr, seed) => {
  const r = rng(seed);
  const bpm = 150;
  const beat = 60 / bpm;
  const bars = 2;
  const dur = beat * 4 * bars;
  const n = Math.floor(sr * (dur + 0.3));
  const b = new Float32Array(n);
  const kick = R.thump(sr, 5, 50, 0.4);
  for (let k = 0; k < 4 * bars; k++) mixInto(b, kick, Math.floor(k * beat * sr), 0.9);
  const hat = noise(Math.floor(sr * 0.05), r);
  biquad(hat, 'hp', 7000, 0.7, sr);
  for (let i = 0; i < hat.length; i++) hat[i] *= Math.exp(-i / (sr * 0.01));
  for (let k = 0; k < 8 * bars; k++) mixInto(b, hat, Math.floor((k + 0.5) * beat * 0.5 * sr * 2 / 2), 0.25);
  // ostinato bass
  const notes = [55, 55, 58.3, 55, 55, 65.4, 61.7, 58.3];
  for (let k = 0; k < 8 * bars; k++) {
    const f = notes[k % notes.length];
    const off = Math.floor(k * beat * 0.5 * sr);
    let ph = 0;
    for (let j = 0; j < beat * 0.5 * sr && off + j < n; j++) {
      ph += f / sr;
      b[off + j] += (((ph % 1) * 2 - 1) * 0.35) * Math.exp(-j / (sr * 0.18));
    }
  }
  // screeching strings
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] += Math.sin(TAU * (880 + 30 * Math.sin(t * 6)) * t) * 0.03 + Math.sin(TAU * 932 * t) * 0.025;
  }
  const out = b.subarray(0, Math.floor(dur * sr));
  biquad(out, 'lp', 5000, 0.7, sr);
  return normalize(out, 0.7);
};

R.musicLobby = (sr) => {
  // music box in A minor over a dark pad
  const bpm = 72;
  const beat = 60 / bpm;
  const melody = [69, 72, 76, 74, 72, 71, 72, 69, 64, 67, 69, 71, 72, 71, 67, 64];
  const dur = beat * melody.length;
  const n = Math.floor(sr * dur);
  const b = pad(sr, n, [55, 82.4, 130.8], 0.25, 350);
  melody.forEach((m, k) => {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const off = Math.floor(k * beat * sr);
    for (let j = 0; j < n - off && j < sr * 2.5; j++) {
      const t = j / sr;
      b[off + j] += (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 4.02 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.8) * 0.12 * Math.min(1, t / 0.002);
    }
  });
  // tail of last notes wraps around for seamless loop
  return normalize(b, 0.55);
};

R.stinger = (sr, seed) => {
  const r = rng(seed);
  const n = Math.floor(sr * 2.5);
  const b = new Float32Array(n);
  const hit = R.thump(sr, seed, 40, 1.5);
  mixInto(b, hit, 0, 1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (const f of [311, 330, 349, 370, 622, 659]) s += Math.sin(TAU * f * t + r() * 0.01);
    b[i] += s * 0.07 * env(t, 0.01, 0.7) + (r() * 2 - 1) * 0.15 * env(t, 0.005, 0.3);
  }
  return normalize(softclip(b, 1.5), 0.95);
};

// ---------------------------------------------------------------- bank definition
export const SOUND_DEFS = {
  step_concrete: { variants: 4, gen: (sr, s) => R.step(sr, s, 'concrete') },
  step_metal: { variants: 3, gen: (sr, s) => R.step(sr, s, 'metal') },
  step_carpet: { variants: 3, gen: (sr, s) => R.step(sr, s, 'carpet') },
  step_wood: { variants: 3, gen: (sr, s) => R.step(sr, s, 'wood') },
  step_dirt: { variants: 3, gen: (sr, s) => R.step(sr, s, 'dirt') },
  step_grass: { variants: 3, gen: (sr, s) => R.step(sr, s, 'grass') },
  step_water: { variants: 3, gen: (sr, s) => R.step(sr, s, 'water') },
  step_tile: { variants: 3, gen: (sr, s) => R.step(sr, s, 'tile') },
  step_heavy: { variants: 3, gen: (sr, s) => R.heavyStep(sr, s) },
  door_open: { variants: 2, gen: (sr, s) => R.creak(sr, s, 1.2) },
  door_close: { variants: 1, gen: (sr, s) => R.thump(sr, s, 75, 0.5) },
  door_locked: { variants: 1, gen: (sr, s) => R.clank(sr, s + 40, 0.5) },
  gate: { variants: 1, gen: (sr, s) => R.clank(sr, s, 2.4) },
  lever: { variants: 1, gen: (sr, s) => R.thump(sr, s + 17, 140, 0.35) },
  fuse: { variants: 1, gen: (sr, s) => R.click(sr, s, 1800, 0.12) },
  power_on: { variants: 1, gen: (sr, s) => R.powerOn(sr, s) },
  beep: { variants: 1, gen: (sr) => R.beep(sr, 0, 1250, 0.08) },
  error: { variants: 1, gen: (sr) => R.beep(sr, 0, 170, 0.35, 'square') },
  success: { variants: 1, gen: (sr) => R.chime(sr, 0) },
  objective: { variants: 1, gen: (sr) => R.chime(sr, 1, [392, 523, 659], 0.14) },
  pickup: { variants: 1, gen: (sr) => R.pickup(sr) },
  flash_click: { variants: 1, gen: (sr, s) => R.click(sr, s, 3200, 0.04) },
  battery: { variants: 1, gen: (sr, s) => R.click(sr, s + 2, 1500, 0.2) },
  heal: { variants: 1, gen: (sr, s) => R.bandage(sr, s) },
  inject: { variants: 1, gen: (sr, s) => R.inject(sr, s) },
  heartbeat: { variants: 1, gen: (sr) => R.heartbeat(sr) },
  breath: { variants: 2, gen: (sr, s) => R.breath(sr, s) },
  hurt: { variants: 2, gen: (sr, s) => R.hurt(sr, s) },
  growl: { variants: 3, gen: (sr, s) => R.growl(sr, s, 2.2, 60 + (s % 3) * 12) },
  scream: { variants: 2, gen: (sr, s) => R.scream(sr, s) },
  whisper: { variants: 3, gen: (sr, s) => R.whisper(sr, s) },
  flutter: { variants: 1, gen: (sr, s) => R.flutter(sr, s) },
  wood_creak: { variants: 3, gen: (sr, s) => R.creak(sr, s, 0.8) },
  glass: { variants: 2, gen: (sr, s) => R.glass(sr, s) },
  can: { variants: 3, gen: (sr, s) => R.can(sr, s) },
  whoosh: { variants: 1, gen: (sr, s) => R.whoosh(sr, s) },
  spark: { variants: 1, gen: (sr, s) => R.spark(sr, s) },
  generator: { variants: 1, gen: (sr, s) => R.generator(sr, s) },
  radio: { variants: 1, gen: (sr, s) => R.radioStatic(sr, s) },
  bell: { variants: 1, gen: (sr, s) => R.bell(sr, s) },
  hum: { variants: 1, gen: (sr, s) => R.electricHum(sr, s, 2, 120, 0.8) },
  ui_click: { variants: 1, gen: (sr, s) => R.click(sr, s + 5, 1800, 0.03) },
  ui_hover: { variants: 1, gen: (sr) => R.beep(sr, 0, 900, 0.025) },
  stinger: { variants: 1, gen: (sr, s) => R.stinger(sr, s) },
  amb_prison: { variants: 1, gen: (sr, s) => R.ambPrison(sr, s) },
  amb_town: { variants: 1, gen: (sr, s) => R.ambTown(sr, s) },
  amb_backrooms: { variants: 1, gen: (sr, s) => R.ambBackrooms(sr, s) },
  fire: { variants: 1, gen: (sr, s) => R.fire(sr, s) },
  music_tension: { variants: 1, gen: (sr) => R.musicTension(sr) },
  music_chase: { variants: 1, gen: (sr, s) => R.musicChase(sr, s) },
  music_lobby: { variants: 1, gen: (sr) => R.musicLobby(sr) },
};
