// WebAudio engine: buses with user volumes, global mute reasons (tab hidden, ads, pause),
// 3D positional one-shots and loops with occlusion lowpass, music crossfading.
import { SOUND_DEFS } from './sounds.js';

const SYNTH_RATE = 24000;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.raw = new Map(); // name -> [Float32Array]
    this.buffers = new Map(); // name -> [AudioBuffer]
    this.volumes = { master: 0.8, music: 0.6, sfx: 0.9, ambience: 0.7, ui: 0.7 };
    this.muteReasons = new Set();
    this.hrtf = false;
    this.listenerPos = [0, 0, 0];
    this.musicTracks = new Map();
    this.loops = new Set();
    this.ready = false;
  }

  // Synthesise all sounds (can run before the AudioContext exists).
  async generate(onProgress) {
    const names = Object.keys(SOUND_DEFS);
    let i = 0;
    for (const name of names) {
      const def = SOUND_DEFS[name];
      const arr = [];
      for (let v = 0; v < def.variants; v++) arr.push(def.gen(SYNTH_RATE, 1000 + v * 7919 + name.length * 31));
      this.raw.set(name, arr);
      i++;
      if (onProgress) onProgress(i / names.length);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.muteReasons.size) this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(c.destination);
    this.bus = {};
    for (const b of ['music', 'sfx', 'ambience', 'ui']) {
      this.bus[b] = c.createGain();
      this.bus[b].connect(this.master);
    }
    for (const [name, arrs] of this.raw) {
      this.buffers.set(
        name,
        arrs.map((data) => {
          const buf = c.createBuffer(1, data.length, SYNTH_RATE);
          buf.copyToChannel(data, 0);
          return buf;
        })
      );
    }
    this.applyVolumes();
    this.ready = true;
    if (c.state === 'suspended') c.resume().catch(() => {});
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    this.applyVolumes();
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const muted = this.muteReasons.size > 0;
    this.master.gain.setTargetAtTime(muted ? 0 : this.volumes.master, t, 0.05);
    for (const b of ['music', 'sfx', 'ambience', 'ui']) this.bus[b].gain.setTargetAtTime(this.volumes[b], t, 0.05);
  }
  // Mute for a reason ('hidden', 'ad', 'pause'); unmutes when no reasons remain.
  setMuted(reason, on) {
    if (on) this.muteReasons.add(reason);
    else this.muteReasons.delete(reason);
    if (!this.ctx) return;
    this.applyVolumes();
    if (this.muteReasons.size) {
      // fully suspend when the page is hidden or an ad plays (Yandex requirement)
      if (this.muteReasons.has('hidden') || this.muteReasons.has('ad')) this.ctx.suspend().catch(() => {});
    } else if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setListener(pos, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.listenerPos = pos;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos[0], t, 0.02);
      l.positionY.setTargetAtTime(pos[1], t, 0.02);
      l.positionZ.setTargetAtTime(pos[2], t, 0.02);
      l.forwardX.setTargetAtTime(forward[0], t, 0.02);
      l.forwardY.setTargetAtTime(forward[1], t, 0.02);
      l.forwardZ.setTargetAtTime(forward[2], t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
  }

  pick(name) {
    const arr = this.buffers.get(name);
    if (!arr) return null;
    return arr[(Math.random() * arr.length) | 0];
  }

  // opts: {volume, rate, bus, pos, loop, refDistance, maxDistance, occlusion}
  play(name, opts = {}) {
    if (!this.ctx || !this.ready) return null;
    const buf = this.pick(name);
    if (!buf) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    src.playbackRate.value = (opts.rate ?? 1) * (opts.pitchVar ? 1 + (Math.random() - 0.5) * opts.pitchVar : 1);
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    let node = src;
    let filter = null;
    let panner = null;
    if (opts.pos) {
      filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.occluded ? 900 : 20000;
      node.connect(filter);
      node = filter;
      const pan = c.createPanner();
      pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = opts.refDistance ?? 2;
      pan.maxDistance = opts.maxDistance ?? 60;
      pan.rolloffFactor = opts.rolloff ?? 1.2;
      setPannerPos(pan, opts.pos, c.currentTime, true);
      node.connect(pan);
      node = pan;
      panner = pan;
    }
    node.connect(gain);
    gain.connect(this.bus[opts.bus ?? 'sfx']);
    src.start(0, opts.offset ?? 0);
    const handle = {
      src, gain, filter, panner,
      stopped: false,
      stop: (fade = 0.1) => {
        if (handle.stopped) return;
        handle.stopped = true;
        const t = c.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fade);
        try { src.stop(t + fade + 0.02); } catch (e) { /* already stopped */ }
        this.loops.delete(handle);
      },
      setPos: (p) => panner && setPannerPos(panner, p, c.currentTime),
      setVolume: (v, tc = 0.1) => gain.gain.setTargetAtTime(v, c.currentTime, tc),
      setRate: (r) => src.playbackRate.setTargetAtTime(r, c.currentTime, 0.1),
      setOcclusion: (amount) => filter && filter.frequency.setTargetAtTime(20000 * (1 - amount) + 700 * amount, c.currentTime, 0.15),
    };
    src.onended = () => {
      handle.stopped = true;
      this.loops.delete(handle);
      try { gain.disconnect(); } catch (e) { /* ignore */ }
    };
    if (opts.loop) this.loops.add(handle);
    return handle;
  }

  ui(name, volume = 1) {
    return this.play(name, { bus: 'ui', volume });
  }

  // Crossfaded music layers: setMusic({music_tension: 0.5, music_chase: 0})
  setMusicLevels(levels) {
    if (!this.ctx) return;
    for (const [name, level] of Object.entries(levels)) {
      let tr = this.musicTracks.get(name);
      if (!tr && level > 0.001) {
        tr = this.play(name, { bus: 'music', loop: true, volume: 0 });
        if (!tr) continue;
        this.musicTracks.set(name, tr);
      }
      if (tr) tr.setVolume(level, 0.8);
    }
  }
  stopMusic() {
    for (const tr of this.musicTracks.values()) tr.stop(1.0);
    this.musicTracks.clear();
  }
  stopAllLoops() {
    for (const l of [...this.loops]) l.stop(0.3);
    this.musicTracks.clear();
  }
}

function setPannerPos(p, pos, t, immediate = false) {
  if (p.positionX) {
    if (immediate) {
      p.positionX.value = pos[0];
      p.positionY.value = pos[1];
      p.positionZ.value = pos[2];
    } else {
      p.positionX.setTargetAtTime(pos[0], t, 0.03);
      p.positionY.setTargetAtTime(pos[1], t, 0.03);
      p.positionZ.setTargetAtTime(pos[2], t, 0.03);
    }
  } else p.setPosition(pos[0], pos[1], pos[2]);
}
