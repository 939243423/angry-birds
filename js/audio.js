/* ============================================================
 * audio.js — WebAudio 程序化音效（无外部素材）
 * ============================================================ */
'use strict';

const Sfx = {
  ctx: null, master: null, muted: false, ready: false,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    // 轻微压缩，避免爆音
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 8;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.ready = true;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; },

  _env(node, t, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g); g.connect(this.master);
    return g;
  },
  _noiseBuf(dur) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * dur);
    const b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return b;
  },
  tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, delay = 0) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    this._env(o, t, Math.min(0.02, dur * 0.2), dur, vol);
    o.start(t); o.stop(t + dur + 0.06);
  },
  noise(dur, vol = 0.3, filterFreq = 1200, type = 'lowpass', sweepTo = null) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur);
  },

  /* ---- 具体音效 ---- */
  stretch() { this.tone(220, 0.08, 'square', 0.05, 320); },
  launch() {
    this.tone(180, 0.22, 'sawtooth', 0.22, 620);
    this.noise(0.18, 0.22, 2400, 'highpass');
  },
  whistle() { this.tone(700, 0.3, 'sine', 0.12, 1500); },
  hitWood(strength = 1) {
    this.noise(0.09, 0.18 * strength, 900, 'bandpass');
    this.tone(rand(150, 220), 0.09, 'triangle', 0.14 * strength, 90);
  },
  hitStone() {
    this.noise(0.13, 0.24, 420, 'lowpass');
    this.tone(110, 0.12, 'square', 0.12, 60);
  },
  hitIce() {
    this.tone(rand(900, 1400), 0.14, 'sine', 0.16, 400);
    this.noise(0.1, 0.14, 3000, 'highpass');
  },
  breakWood() { this.noise(0.28, 0.3, 1400, 'bandpass', 300); this.tone(160, 0.2, 'square', 0.12, 70); },
  breakStone() { this.noise(0.35, 0.34, 700, 'lowpass', 150); this.tone(90, 0.24, 'square', 0.14, 50); },
  breakIce() { for (let i = 0; i < 4; i++) this.tone(rand(1200, 2200), 0.18, 'sine', 0.1, 700, i * 0.035); },
  explode() {
    this.noise(0.7, 0.5, 1800, 'lowpass', 60);
    this.tone(70, 0.5, 'sawtooth', 0.28, 30);
    this.tone(140, 0.32, 'square', 0.16, 40);
  },
  pigPop() {
    this.tone(520, 0.1, 'square', 0.2, 900);
    this.tone(900, 0.14, 'square', 0.16, 480, null, 0.07);
    this.noise(0.14, 0.2, 2200, 'highpass');
  },
  pigHurt() { this.tone(300, 0.16, 'sawtooth', 0.16, 170); },
  skill(kind) {
    if (kind === 'dash') { this.tone(300, 0.2, 'sawtooth', 0.2, 1400); this.noise(0.2, 0.16, 3000, 'highpass'); }
    else if (kind === 'split') { this.tone(600, 0.1, 'sine', 0.18, 1200); this.tone(900, 0.12, 'sine', 0.15, 1500, null, 0.06); }
    else if (kind === 'bomb') { this.tone(200, 0.3, 'square', 0.16, 60); }
    else { this.tone(420, 0.18, 'triangle', 0.2, 900); }
  },
  spring() { this.tone(300, 0.16, 'sine', 0.24, 1100); this.tone(600, 0.1, 'sine', 0.14, 1400, null, 0.05); },
  portal() { this.tone(400, 0.24, 'sine', 0.18, 1600); this.tone(1600, 0.24, 'sine', 0.12, 400); },
  star(i) { this.tone([660, 830, 990][i % 3], 0.28, 'triangle', 0.24, null, null, 0); this.tone([1320, 1660, 1980][i % 3], 0.22, 'sine', 0.1, null, null, 0.04); },
  win() {[0, 4, 7, 12].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.34, 'triangle', 0.2, null, null, i * 0.11));},
  lose() {[0, -3, -7, -12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.3, 'sawtooth', 0.14, null, null, i * 0.13));},
  click() { this.tone(700, 0.05, 'square', 0.1, 900); },
  pop() { this.tone(520, 0.1, 'sine', 0.18, 900); },
  feather() {[0, 5, 9, 14, 19].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.3, 'sine', 0.16, null, null, i * 0.08));}
};
