'use strict';

/* Procedural WebAudio SFX with camera-relative stereo panning.
   Layered synthesis (mechanism click + report + tail) until real samples land;
   drop decoded AudioBuffers in later and swap at the call sites. */
const Sound = {
  ctx: null,
  master: null,
  muted: false,
  ambient: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this._noiseBuf = this._makeNoise(2);
    } catch (e) { this.ctx = null; }
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  },

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  /* world-x → { pan, att }: position sounds relative to the camera window */
  _spatial(x) {
    if (x == null || typeof Camera === 'undefined') return { pan: 0, att: 1, far: 0 };
    const center = Camera.x + CANVAS_W / 2;
    const dx = x - center;
    const pan = clamp(dx / 850, -1, 1) * 0.75;
    const off = Math.max(0, Math.abs(dx) - CANVAS_W / 2);
    const att = 1 / (1 + off / 700);
    // 0 at your feet, 1 across the map. Distance does not just make a shot
    // quieter — air eats the high frequencies first, so a rifle a long way off
    // is a dull thud, not a small crack. That colouring is most of what makes a
    // battlefield sound wide rather than flat.
    const far = clamp(off / 1100, 0, 1);
    return { pan, att, far };
  },

  /* Sharpness rolls off with distance: full crack up close, muffled thump far. */
  _hi(base, far) { return base * (1 - 0.72 * far) + 220 * far; },

  _bus(pan) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.master);
      return p;
    }
    return this.master;
  },

  _noise(dur, filterType, freq, q, gain, when = 0, pan = 0) {
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.92, 1.08); // decorrelate repeats
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this._bus(pan));
    src.start(t, rand(0, 1.4)); src.stop(t + dur + 0.05);
    return { f, g, src };
  },

  _tone(type, freq, dur, gain, when = 0, slideTo = null, pan = 0) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this._bus(pan));
    o.start(t); o.stop(t + dur + 0.05);
  },

  ok() { return this.ctx && !this.muted; },

  /* layered small-arms: mechanism click + report + decaying tail */
  shot(kind, x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    const j = rand(0.9, 1.12); // pitch jitter so volleys don't machine-copy
    const H = (f) => this._hi(f, far);
    // sound travels: a shot across the map arrives late
    const lag = far * 0.13;
    // and the report rolls back off the treeline
    const echo = far > 0.25;
    if (kind === 'm16') {
      this._noise(0.012, 'highpass', H(6200), 1, 0.10 * att * (1 - far), lag, pan);
      this._noise(0.07, 'bandpass', H(3300 * j), 1.3, 0.17 * att, lag + 0.004, pan);
      this._noise(0.05, 'highpass', H(5200), 1, 0.07 * att * (1 - far), lag + 0.004, pan);
      this._noise(0.22 + far * 0.3, 'lowpass', 900 * j, 0.6, 0.06 * att, lag + 0.02, pan);
    } else if (kind === 'ak') {
      this._noise(0.012, 'highpass', H(4800), 1, 0.08 * att * (1 - far), lag, pan);
      this._noise(0.09, 'bandpass', H(1650 * j), 1.1, 0.21 * att, lag + 0.004, pan);
      this._tone('square', 128 * j, 0.05, 0.05 * att, lag + 0.004, null, pan);
      this._noise(0.28 + far * 0.34, 'lowpass', 700 * j, 0.6, 0.07 * att, lag + 0.03, pan);
    } else if (kind === 'mg') {
      this._noise(0.01, 'highpass', H(5600), 1, 0.07 * att * (1 - far), lag, pan);
      this._noise(0.06, 'bandpass', H(2050 * j), 1, 0.16 * att, lag + 0.003, pan);
      this._tone('square', 96 * j, 0.04, 0.045 * att, lag + 0.003, null, pan);
      this._noise(0.16 + far * 0.3, 'lowpass', 800, 0.6, 0.05 * att, lag + 0.02, pan);
    }
    if (echo) {
      // slap back off the far treeline — the thing that makes a valley a valley
      this._noise(0.30, 'lowpass', 520, 0.5, 0.045 * att * far, lag + 0.10 + far * 0.13, -pan * 0.6);
    }
  },

  /* A round that misses and skips off something hard. Randomised so a burst
   * that goes wide sounds like several rounds, not one sample repeated. */
  ricochet(x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    if (att < 0.25) return;
    const f0 = rand(1500, 3000), f1 = f0 * rand(0.25, 0.5);
    this._noise(0.05, 'bandpass', this._hi(f0, far), 6, 0.09 * att, 0, pan);
    this._tone('sawtooth', f0, rand(0.16, 0.30), 0.045 * att, 0.004, f1, pan);
  },

  /* Rocket leaving the tube: back-blast, then the motor running out. */
  rocket(x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    this._noise(0.10, 'lowpass', this._hi(1400, far), 0.7, 0.30 * att, 0, pan);
    this._noise(0.42, 'bandpass', 900, 0.8, 0.16 * att, 0.02, pan);
    this._tone('sawtooth', 220, 0.34, 0.07 * att, 0.02, 90, pan);
  },

  sniperShot(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(0.014, 'highpass', 5000, 1, 0.12 * att, 0, pan);
    this._noise(0.14, 'bandpass', 2400, 0.8, 0.4 * att, 0.005, pan);
    this._noise(0.8, 'lowpass', 650, 0.5, 0.16 * att, 0.03, pan);
    this._tone('sine', 88, 0.4, 0.13 * att, 0.005, 42, pan);
  },

  explosion(size = 1, x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._tone('sine', 46, 0.9 * size, 0.5 * att, 0, 24, pan);              // sub thump
    this._noise(0.5 * size, 'lowpass', 420, 0.5, 0.55 * att, 0, pan);        // body
    this._noise(1.1 * size, 'lowpass', 150, 0.4, 0.4 * att, 0.05, pan);      // roll
    this._noise(0.2, 'highpass', 3200, 1, 0.12 * att, 0, pan);               // crack
    // debris patter
    for (let i = 0; i < 4; i++) {
      this._noise(0.05, 'bandpass', rand(1200, 3200), 2, 0.05 * att, rand(0.25, 0.8) * size, pan);
    }
  },

  shellWhistle(delay = 0) {
    if (!this.ok()) return;
    this._tone('sine', 1900, 1.1, 0.05, delay, 500);
  },

  napalmWhoosh(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(1.6, 'lowpass', 900, 0.4, 0.42 * att, 0, pan);
    this._noise(2.6, 'bandpass', 500, 0.6, 0.22 * att, 0.3, pan);
    this._noise(3.2, 'bandpass', 300, 0.5, 0.1 * att, 0.8, pan);
  },

  jet() {
    if (!this.ok()) return;
    this._noise(2.2, 'bandpass', 800, 2, 0.25);
    this._tone('sawtooth', 140, 2.0, 0.05, 0, 60);
  },

  chopper(dur = 4) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 11;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.14;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.8);
    g.gain.setValueAtTime(0.16, t + dur - 1);
    g.gain.linearRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur); lfo.start(t); lfo.stop(t + dur);
  },

  bomberRumble(dur = 5) {
    if (!this.ok()) return;
    this._noise(dur, 'lowpass', 120, 0.5, 0.3);
    this._tone('sawtooth', 55, dur, 0.1);
  },

  radio() {
    if (!this.ok()) return;
    this._tone('square', 1100, 0.06, 0.06);
    this._tone('square', 1400, 0.06, 0.06, 0.09);
    this._noise(0.18, 'bandpass', 1800, 3, 0.04, 0.16);
  },

  click() {
    if (!this.ok()) return;
    this._tone('square', 700, 0.04, 0.06);
  },

  deny() {
    if (!this.ok()) return;
    this._tone('square', 220, 0.12, 0.07);
  },

  trapSpring(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(0.15, 'highpass', 2500, 1, 0.2 * att, 0, pan);
    this._tone('sine', 300, 0.25, 0.15 * att, 0.02, 90, pan);
  },

  shovel(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(0.2, 'lowpass', 600, 1, 0.15 * att, 0, pan);
    this._noise(0.15, 'bandpass', 1200, 2, 0.08 * att, 0.12, pan);
  },

  glintPing() {
    if (!this.ok()) return;
    this._tone('sine', 2400, 0.3, 0.04);
  },

  bell(win) {
    if (!this.ok()) return;
    if (win) {
      [523, 659, 784, 1046].forEach((f, i) => this._tone('sine', f, 0.7, 0.12, i * 0.16));
    } else {
      [392, 330, 262, 196].forEach((f, i) => this._tone('sine', f, 0.8, 0.12, i * 0.2));
    }
  },

  ambientStart(map) {
    if (!this.ctx) return;
    this.ambientStop();
    const nodes = [];
    // low jungle air
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = map.weather && map.weather.rain ? 1600 : 500;
    const g = this.ctx.createGain();
    g.gain.value = map.weather && map.weather.rain ? 0.06 : 0.025;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    nodes.push(src);
    // insect shimmer (dry maps only)
    if (!(map.weather && map.weather.rain)) {
      const src2 = this.ctx.createBufferSource();
      src2.buffer = this._noiseBuf; src2.loop = true;
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = 5200; f2.Q.value = 8;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.012;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.4;
      const lg = this.ctx.createGain(); lg.gain.value = 0.008;
      lfo.connect(lg); lg.connect(g2.gain);
      src2.connect(f2); f2.connect(g2); g2.connect(this.master);
      src2.start(); lfo.start();
      nodes.push(src2, lfo);
    }
    this.ambient = nodes;
  },

  ambientStop() {
    if (this.ambient) {
      this.ambient.forEach(n => { try { n.stop(); } catch (e) {} });
      this.ambient = null;
    }
  },
};
