/* ============================================================
 * music.js — 全局循环 BGM（纯 WebAudio 实时合成）
 *
 * 曲风：欢快上头的进行曲式小调走句（Am - G - F - Em），128 BPM，8 小节循环
 * 配器：方波主旋律 + 三角波低音 + 锯齿和弦垫 + 底鼓/军鼓/踩镲
 *
 * 关于"素材来源"：全部音符由振荡器实时合成，工程里不含任何第三方录音/音频文件。
 * 这样既满足零依赖、离线可用的约束，也避免引入有版权的商业音乐素材。
 * ============================================================ */
'use strict';

const Music = {
  bpm: 128,
  volume: 0.16,        // BGM 总音量（远低于音效，避免抢戏）
  playing: false,
  muted: false,
  ducked: false,
  out: null,           // 输出总线
  _timer: null,
  _step: 0,
  _next: 0,            // 下一个待排程音符的时间
  _noise: null,        // 复用的白噪缓冲（军鼓/踩镲）
  _wasPlaying: false,
  _armed: false,       // 用户已交互、允许自动播放

  /* ---------------- 曲谱 ---------------- */

  /** 音名 → 频率（十二平均律，A4 = 440Hz） */
  _notes: (() => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const m = {};
    for (let o = 1; o <= 6; o++)
      for (let i = 0; i < 12; i++) m[names[i] + o] = 440 * Math.pow(2, (i - 9) / 12 + (o - 4));
    return m;
  })(),
  freqOf(name) { return this._notes[name] || 0; },

  /** 每小节 16 个十六分音符，'.' 为休止 */
  PATTERN: {
    chords: ['Am', 'G', 'F', 'Em', 'Am', 'G', 'F', 'Em'],
    bassRoot: { Am: 'A', G: 'G', F: 'F', Em: 'E' },
    CHORDS: {
      Am: ['A3', 'C4', 'E4'],
      G: ['G3', 'B3', 'D4'],
      F: ['F3', 'A3', 'C4'],
      Em: ['E3', 'G3', 'B3']
    },
    /* 主旋律：前 4 小节铺陈，后 4 小节翻上去做呼应，末小节收尾转身 */
    lead: [
      'A4 . C5 . E5 . D5 C5 A4 . . . E5 . D5 .'.split(' '),
      'G4 . B4 . D5 . C5 B4 G4 . . . D5 . C5 .'.split(' '),
      'F4 . A4 . C5 . B4 A4 F4 . . . C5 . A4 .'.split(' '),
      'E4 . G4 . B4 . A4 B4 C5 . D5 . E5 . . .'.split(' '),
      'A4 . E5 . A5 . G5 E5 C5 . E5 . D5 . C5 .'.split(' '),
      'B4 . D5 . G5 . F#5 D5 B4 . D5 . C5 . B4 .'.split(' '),
      'A4 . C5 . F5 . E5 C5 A4 . C5 . D5 . E5 .'.split(' '),
      'G4 . B4 . E5 . D5 B4 G4 B4 D5 E5 D5 B4 G4 .'.split(' ')
    ],
    /* 低音：每小节的 8 个八分音符，数字是相对根音的八度偏移（0 = 低八度区） */
    bassShape: [
      [0, 0, 1, 0, 0, 1, 0, 1],
      [0, 0, 1, 0, 0, 1, 0, 1],
      [0, 0, 1, 0, 0, 1, 0, 1],
      [0, 0, 1, 0, 0, 1, 0, 1],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [0, 1, 0, 1, 1, 1, 0, 1]
    ],
    kick: [
      [0, 6, 8], [0, 6, 8, 14], [0, 6, 8], [0, 6, 8, 10, 14],
      [0, 6, 8, 14], [0, 6, 8, 14], [0, 6, 8, 14], [0, 4, 6, 8, 10, 14]
    ],
    snare: [
      [4, 12], [4, 12], [4, 12], [4, 12, 14],
      [4, 12], [4, 12], [4, 12], [4, 12, 14]
    ]
  },

  /* ---------------- 生命周期 ---------------- */

  init() {
    Sfx.init();
    if (!Sfx.ctx || !Sfx.ready) return false;
    if (this.out) return true;
    const c = Sfx.ctx;
    this.out = c.createGain();
    this.out.gain.value = this._gain();
    // 走音效同一条压缩链路，避免 BGM 与音效叠加爆音
    this.out.connect(Sfx.comp || c.destination);
    // 0.3s 白噪缓冲，军鼓/踩镲复用（靠包络截断长度）
    const n = Math.floor(c.sampleRate * 0.3);
    this._noise = c.createBuffer(1, n, c.sampleRate);
    const d = this._noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return true;
  },

  /** 用户首次交互后调用：允许音频启动 */
  arm() {
    this._armed = true;
    if (!this.muted) this.start();
  },

  start() {
    if (this.playing || this.muted) return;
    if (!this.init()) return;
    if (Sfx.ctx.state === 'suspended') Sfx.resume();
    this.playing = true;
    this._step = 0;
    this._next = Sfx.ctx.currentTime + 0.06;
    clearInterval(this._timer);
    this._timer = setInterval(() => this.tick(), 40);
    this.tick();
  },

  stop() {
    this.playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  setMuted(m) {
    this.muted = !!m;
    this._applyGain();
    if (this.muted) this.stop();
    else if (this._armed) this.start();
  },

  /** 暂停 / 面板打开时把 BGM 压下去，回来再抬起来 */
  duck(on) {
    if (this.ducked === !!on) return;
    this.ducked = !!on;
    this._applyGain();
  },

  _gain() {
    if (this.muted) return 0;
    return this.volume * (this.ducked ? 0.4 : 1);
  },

  _applyGain() {
    if (!this.out || !Sfx.ctx) return;
    const g = this._gain();
    if (typeof this.out.gain.setTargetAtTime === 'function') {
      this.out.gain.setTargetAtTime(g, Sfx.ctx.currentTime, 0.04);
    } else {
      this.out.gain.value = g;
    }
  },

  /* ---------------- 排程器（look-ahead） ---------------- */

  get totalSteps() { return this.PATTERN.lead.length * 16; },

  tick() {
    if (!this.playing || !Sfx.ctx) return;
    const stepDur = 60 / this.bpm / 4;
    const now = Sfx.ctx.currentTime;
    // 从后台切回来时不要一次性补算上百个音符
    if (this._next < now) this._next = now + 0.02;
    let guard = 0;
    while (this._next < now + 0.18 && guard++ < 64) {
      this._schedule(this._step, this._next, stepDur);
      this._step = (this._step + 1) % this.totalSteps;
      this._next += stepDur;
    }
  },

  _schedule(i, t, dt) {
    const P = this.PATTERN;
    const bar = ((i / 16) | 0) % P.lead.length;
    const s = i % 16;
    const chord = P.chords[bar];

    // 主旋律（方波，最亮，负责"上头"）
    const ln = P.lead[bar][s];
    if (ln !== '.') this._tone(this.freqOf(ln), t, dt * 1.6, 0.22, 'square', 3000);

    // 低音（每八分音符一次，强拍跳八度）
    if (s % 2 === 0) {
      const oct = P.bassShape[bar][s / 2];
      this._tone(this.freqOf(P.bassRoot[chord] + (2 + oct)), t, dt * 1.5, 0.18, 'triangle', 900);
    }

    // 和弦垫（每半小节一次，音量很低，只补厚度）
    if (s === 0 || s === 8) {
      for (const nm of P.CHORDS[chord]) this._tone(this.freqOf(nm), t, dt * 7, 0.032, 'sawtooth', 1500);
    }

    if (P.kick[bar].indexOf(s) >= 0) this._perc(t, 'kick');
    if (P.snare[bar].indexOf(s) >= 0) this._perc(t, 'snare');
    if (s % 2 === 1) this._perc(t, 'hat');
  },

  _tone(freq, t, dur, vol, type, cutoff) {
    if (!freq) return;
    const c = Sfx.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    let head = o;
    if (cutoff) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      o.connect(f); head = f;
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.014);
    g.gain.setValueAtTime(vol, t + Math.max(0.03, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  },

  _perc(t, kind) {
    const c = Sfx.ctx;
    if (kind === 'kick') {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
      g.gain.setValueAtTime(0.42, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + 0.2);
      return;
    }
    const s = c.createBufferSource();
    s.buffer = this._noise;
    const f = c.createBiquadFilter();
    const snare = kind === 'snare';
    f.type = snare ? 'bandpass' : 'highpass';
    f.frequency.setValueAtTime(snare ? 1900 : 7200, t);
    const g = c.createGain();
    const vol = snare ? 0.16 : 0.055;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (snare ? 0.17 : 0.05));
    s.connect(f); f.connect(g); g.connect(this.out);
    s.start(t); s.stop(t + 0.22);
  }
};

/* 后台标签页静音：回来时只在"本来就该响"的情况下恢复 */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      Music._wasPlaying = Music.playing;
      Music.stop();
    } else if (Music._wasPlaying && !Music.muted) {
      Music.start();
    }
  });
}
