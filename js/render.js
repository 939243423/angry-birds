/* ============================================================
 * render.js — 全部绘制逻辑（程序化美术，无外部素材）
 * ============================================================ */
'use strict';

const THEMES = {
  day: {
    sky: ['#3fb9f5', '#8fd8f8', '#cfeeff', '#ffeccb'],
    sun: 'rgba(255,247,200,.95)', sunGlow: 'rgba(255,225,140,.55)', sunPos: [1310, 170],
    hillFar: '#8fc4a8', hillMid: '#63a882', hillNear: '#3f8a5e',
    grass: ['#79cc4d', '#4f9c36'], soil: ['#8a5f36', '#5e3d20'],
    cloud: 'rgba(255,255,255,.92)', fog: 'rgba(255,255,255,.18)', star: false
  },
  sunset: {
    sky: ['#3a3f8f', '#a2579c', '#f2805c', '#ffcf8a'],
    sun: 'rgba(255,230,170,.98)', sunGlow: 'rgba(255,150,80,.55)', sunPos: [1290, 300],
    hillFar: '#7a5a94', hillMid: '#5a3f70', hillNear: '#3a2748',
    grass: ['#8fbf52', '#5c8a36'], soil: ['#7d4f31', '#4f2f1c'],
    cloud: 'rgba(255,214,190,.8)', fog: 'rgba(255,180,140,.16)', star: false
  },
  night: {
    sky: ['#0d1b3e', '#1c2f5e', '#31528a', '#5b7fb5'],
    sun: 'rgba(228,236,255,.95)', sunGlow: 'rgba(180,200,255,.35)', sunPos: [1320, 150],
    hillFar: '#2b3a63', hillMid: '#1e2b4d', hillNear: '#141d38',
    grass: ['#4a8f5c', '#2f6340'], soil: ['#4a3a34', '#2b201c'],
    cloud: 'rgba(180,200,240,.35)', fog: 'rgba(120,160,220,.14)', star: true
  },
  snow: {
    sky: ['#6fb3e0', '#a9d6ef', '#d6ecf8', '#f2fbff'],
    sun: 'rgba(255,255,255,.9)', sunGlow: 'rgba(220,240,255,.5)', sunPos: [1240, 190],
    hillFar: '#dbeaf5', hillMid: '#b9d6e8', hillNear: '#8fb8d0',
    grass: ['#f2fbff', '#cfe4ef'], soil: ['#a9bfcc', '#71889a'],
    cloud: 'rgba(255,255,255,.9)', fog: 'rgba(255,255,255,.25)', star: false
  }
};

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.theme = THEMES.day;
    this.time = 0;
    this.clouds = [];
    this.bgCache = null;
    this.hillCache = {};
    this.grassCache = null;
    this.themeName = null;
    for (let i = 0; i < 9; i++) {
      this.clouds.push({
        x: rand(-200, 2600), y: rand(60, 330), s: rand(0.5, 1.5),
        v: rand(4, 16), depth: rand(0.25, 0.6), a: rand(0.55, 0.95)
      });
    }
    this.stars = [];
    const rng = mulberry32(7);
    for (let i = 0; i < 90; i++) this.stars.push({ x: rng() * 2400, y: rng() * 420, r: rng() * 1.8 + 0.5, p: rng() * 6 });
    this.buildCaches();
  }

  updateAmbient(dt) {
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > 3400) c.x = -600;
    }
  }

  setTheme(name) {
    if (this.themeName === name) return;
    this.themeName = name;
    this.theme = THEMES[name] || THEMES.day;
    this.buildCaches();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.scale = w / VW;
  }

  buildCaches() {
    const th = this.theme;
    /* --- 天空 --- */
    const c = document.createElement('canvas');
    c.width = VW; c.height = VH;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, VH);
    th.sky.forEach((col, i) => grad.addColorStop(i / (th.sky.length - 1), col));
    g.fillStyle = grad; g.fillRect(0, 0, VW, VH);

    if (th.star) {
      for (const s of this.stars) {
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(s.p));
        g.globalAlpha = tw * 0.9;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // 太阳 + 光晕
    const [sx, sy] = th.sunPos;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 330);
    glow.addColorStop(0, th.sunGlow); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, 330, 0, TAU); g.fill();
    const sg = g.createRadialGradient(sx - 12, sy - 12, 4, sx, sy, 62);
    sg.addColorStop(0, '#fff'); sg.addColorStop(0.55, th.sun); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, 62, 0, TAU); g.fill();
    this.bgCache = c;

    /* --- 远山三层 --- */
    this.hillCache = {};
    const makeHill = (color, seed, height, jag) => {
      const hc = document.createElement('canvas');
      hc.width = 2600; hc.height = 460;
      const hg = hc.getContext('2d');
      const r = mulberry32(seed);
      hg.fillStyle = color;
      hg.beginPath(); hg.moveTo(0, 460);
      let x = 0, y = 300;
      hg.lineTo(0, y);
      while (x < 2600) {
        const w = 120 + r() * 260;
        const peak = height - r() * jag;
        hg.quadraticCurveTo(x + w * 0.5, peak, x + w, y + (r() - 0.5) * 40);
        x += w;
      }
      hg.lineTo(2600, 460); hg.closePath(); hg.fill();
      // 顶部积雪/高光
      hg.globalAlpha = 0.18; hg.fillStyle = '#fff';
      hg.beginPath(); hg.moveTo(0, 460); hg.lineTo(0, 302);
      let x2 = 0;
      while (x2 < 2600) {
        const w = 120 + r() * 260;
        hg.quadraticCurveTo(x2 + w * 0.5, height - r() * jag, x2 + w, 302);
        x2 += w;
      }
      hg.lineTo(2600, 460); hg.closePath(); hg.fill();
      hg.globalAlpha = 1;
      return hc;
    };
    this.hillCache.far = makeHill(th.hillFar, 11, 170, 90);
    this.hillCache.mid = makeHill(th.hillMid, 27, 220, 110);
    this.hillCache.near = makeHill(th.hillNear, 53, 280, 120);

    /* --- 草地/土壤 --- */
    const gc = document.createElement('canvas');
    gc.width = VW; gc.height = VH - GROUND_Y + 6;
    const gg = gc.getContext('2d');
    const gg2 = gg.createLinearGradient(0, 0, 0, gc.height);
    gg2.addColorStop(0, th.grass[0]); gg2.addColorStop(0.42, th.grass[1]);
    gg2.addColorStop(0.46, th.soil[0]); gg2.addColorStop(1, th.soil[1]);
    gg.fillStyle = gg2; gg.fillRect(0, 0, VW, gc.height);
    // 草叶
    const r2 = mulberry32(99);
    gg.lineWidth = 2.4; gg.lineCap = 'round';
    for (let i = 0; i < 460; i++) {
      const x = r2() * VW, h = 8 + r2() * 16;
      const lean = (r2() - 0.5) * 8;
      gg.strokeStyle = `rgba(${r2() > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r2() * 0.1})`;
      gg.beginPath(); gg.moveTo(x, 2); gg.quadraticCurveTo(x + lean, -h * 0.5, x + lean * 1.8, -h); gg.stroke();
    }
    // 土壤颗粒
    for (let i = 0; i < 240; i++) {
      const x = r2() * VW, y = 32 + r2() * (gc.height - 32), s = 2 + r2() * 7;
      gg.fillStyle = `rgba(0,0,0,${0.04 + r2() * 0.1})`;
      gg.beginPath(); gg.ellipse(x, y, s, s * 0.6, r2() * 3, 0, TAU); gg.fill();
    }
    // 地表高光
    gg.fillStyle = 'rgba(255,255,255,.25)'; gg.fillRect(0, 0, VW, 3);
    this.grassCache = gc;

    /* --- 云图案 --- */
    const cc = document.createElement('canvas');
    cc.width = 320; cc.height = 150;
    const cg = cc.getContext('2d');
    cg.fillStyle = th.cloud;
    const blobs = [[70, 100, 52], [130, 78, 66], [200, 96, 56], [250, 108, 42], [160, 112, 58], [100, 116, 46]];
    for (const [bx, by, br] of blobs) { cg.beginPath(); cg.arc(bx, by, br, 0, TAU); cg.fill(); }
    cg.globalCompositeOperation = 'source-atop';
    const cg2 = cg.createLinearGradient(0, 20, 0, 140);
    cg2.addColorStop(0, 'rgba(255,255,255,.85)'); cg2.addColorStop(1, 'rgba(150,170,200,.28)');
    cg.fillStyle = cg2; cg.fillRect(0, 0, 320, 150);
    this.cloudCache = cc;
  }

  /* ---------------- 背景 ---------------- */
  drawBackground(ctx, camX) {
    const th = this.theme;
    ctx.drawImage(this.bgCache, 0, 0, VW, VH);

    // 视差：远山
    const layers = [
      { img: this.hillCache.far, p: 0.10, y: 470 },
      { img: this.hillCache.mid, p: 0.20, y: 530 },
      { img: this.hillCache.near, p: 0.34, y: 600 }
    ];
    for (const L of layers) {
      const ox = -(camX * L.p) % 2600;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(L.img, ox, L.y);
      ctx.drawImage(L.img, ox + 2600, L.y);
      if (ox - 2600 + 2600 > 0) ctx.drawImage(L.img, ox - 2600, L.y);
    }
    ctx.globalAlpha = 1;

    // 云
    for (const c of this.clouds) {
      const x = ((c.x - camX * c.depth) % 3000 + 3000) % 3000 - 400;
      ctx.globalAlpha = c.a;
      ctx.drawImage(this.cloudCache, x, c.y, 320 * c.s, 150 * c.s);
    }
    ctx.globalAlpha = 1;

    // 雾气
    ctx.fillStyle = th.fog;
    ctx.fillRect(0, 600, VW, 260);
  }

  drawGround(ctx) {
    ctx.drawImage(this.grassCache, 0, GROUND_Y);
  }

  /* ---------------- 阴影 ---------------- */
  shadow(ctx, x, y, r, groundY = GROUND_Y) {
    const h = clamp((groundY - y) / 420, 0, 1);
    const a = 0.3 * (1 - h * 0.75);
    const s = r * (1 - h * 0.45);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, groundY + 4, s * 1.15, s * 0.34, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ---------------- 小鸟 ---------------- */
  drawBird(ctx, b, t) {
    const d = b.def, r = b.r;
    if (b.state === 'ready') {
      // 待机呼吸
      const br = 1 + Math.sin(t * 3.4) * 0.045;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(br, 2 - br);
      this.birdBody(ctx, b, 0, t, 1);
      ctx.restore();
      return;
    }
    const ang = Math.atan2(b.vy, b.vx);
    const sp = len(b.vx, b.vy);
    const st = clamp(sp / 900, 0, 1);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang * 0.35 * (1 - st * 0.5));
    const sq = 1 + b.squash;
    ctx.scale(1 / sq, sq);
    this.birdBody(ctx, b, ang, t, st);
    ctx.restore();
  }

  birdBody(ctx, b, ang, t, st) {
    const d = b.def, r = b.r;
    // 尾羽
    ctx.save();
    const wag = Math.sin(t * 14) * 0.25 * (b.state === 'flying' ? 1 : 0.35);
    ctx.rotate(wag * 0.25);
    ctx.fillStyle = d.body2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.2);
    ctx.lineTo(-r * 1.75, -r * 0.85);
    ctx.lineTo(-r * 1.45, 0);
    ctx.lineTo(-r * 1.75, r * 0.75);
    ctx.lineTo(-r * 0.55, r * 0.35);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 身体
    const g = ctx.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.12, 0, 0, r * 1.12);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.22, d.body);
    g.addColorStop(1, d.body2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

    // 肚皮
    ctx.fillStyle = d.belly;
    ctx.beginPath(); ctx.ellipse(r * 0.12, r * 0.42, r * 0.62, r * 0.44, 0.2, 0, TAU); ctx.fill();

    // 翅膀（飞行时拍打）
    ctx.save();
    const flap = b.state === 'flying' ? Math.sin(t * 18) * 0.55 : Math.sin(t * 2.6) * 0.12;
    ctx.rotate(flap);
    ctx.fillStyle = d.body2;
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, r * 0.12, r * 0.66, r * 0.34, -0.35, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, r * 0.06, r * 0.5, r * 0.2, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 头顶羽毛
    ctx.fillStyle = d.body2;
    for (const [ox, oy, a] of [[-r * 0.1, -r * 0.92, -0.5], [r * 0.12, -r * 1.0, -0.15], [r * 0.34, -r * 0.86, 0.2]]) {
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.3, r * 0.12, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // 眼睛（看向速度方向）
    const blink = (b.blink -= 0.016) < 0;
    if (blink && b.blink < -0.12) b.blink = rand(2.4, 6);
    const eyeY = -r * 0.28;
    const lookX = b.state === 'flying' ? clamp(Math.cos(ang) * 3, -1, 1) * r * 0.1 : r * 0.06;
    for (const ex of [-r * 0.22, r * 0.26]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(ex, eyeY, r * 0.3, r * 0.32, 0, 0, TAU); ctx.fill();
      if (!(blink)) {
        ctx.fillStyle = '#1b1b22';
        ctx.beginPath(); ctx.arc(ex + lookX + r * 0.05, eyeY + r * 0.02, r * 0.15, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex + lookX + r * 0.1, eyeY - r * 0.08, r * 0.06, 0, TAU); ctx.fill();
      }
    }
    // 愤怒眉毛
    ctx.strokeStyle = d.body2; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.66); ctx.lineTo(-r * 0.06, -r * 0.42);
    ctx.moveTo(r * 0.5, -r * 0.72); ctx.lineTo(r * 0.06, -r * 0.46);
    ctx.stroke();

    // 喙
    const beakY = r * 0.06;
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, beakY - r * 0.2);
    ctx.lineTo(r * 1.24, beakY);
    ctx.lineTo(r * 0.5, beakY + r * 0.22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d98a12';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, beakY + r * 0.02);
    ctx.lineTo(r * 1.24, beakY);
    ctx.lineTo(r * 0.52, beakY + r * 0.22);
    ctx.closePath(); ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.5, r * 0.34, r * 0.18, -0.6, 0, TAU); ctx.fill();

    if (b.armedBlast) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.1);
      gg.addColorStop(0, 'rgba(255,180,60,.75)'); gg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (b.fuse > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 40);
      ctx.fillStyle = '#ff3b1f';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- 猪 ---------------- */
  drawPig(ctx, p, t) {
    const r = p.r, s = p.def.scale;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const sq = 1 + p.squash;
    ctx.scale(s / sq, s * sq);

    const hurtRatio = 1 - p.hp / p.maxHp;
    const hurtFlash = p.hurtFlash > 0 ? 1 : 0;
    const base = hurtFlash ? '#ff6b6b' : `rgb(${Math.round(140 + hurtRatio * 90)},${Math.round(212 - hurtRatio * 70)},${Math.round(92 - hurtRatio * 20)})`;

    // 耳朵
    ctx.fillStyle = hurtFlash ? '#e05a5a' : '#5da63a';
    for (const [ex, ey] of [[-r * 0.72, -r * 0.68], [r * 0.72, -r * 0.68]]) {
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(ex > 0 ? 0.5 : -0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.26, r * 0.18, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // 身体
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.38, r * 0.1, 0, 0, r * 1.1);
    g.addColorStop(0, hurtFlash ? '#ffd0d0' : '#d6f59f');
    g.addColorStop(0.35, base);
    g.addColorStop(1, hurtFlash ? '#c03a3a' : '#4f9633');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

    // 鼻子
    ctx.fillStyle = hurtFlash ? '#f09a9a' : '#8fd45c';
    ctx.beginPath(); ctx.ellipse(0, r * 0.16, r * 0.46, r * 0.36, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.ellipse(-r * 0.17, r * 0.16, r * 0.09, r * 0.13, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.17, r * 0.16, r * 0.09, r * 0.13, 0, 0, TAU); ctx.fill();

    // 眼睛
    const eyeY = -r * 0.2;
    const dying = p.hp / p.maxHp < 0.34;
    if (dying) {
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
      for (const ex of [-r * 0.3, r * 0.3]) {
        ctx.beginPath();
        ctx.moveTo(ex - r * 0.14, eyeY - r * 0.14); ctx.lineTo(ex + r * 0.14, eyeY + r * 0.14);
        ctx.moveTo(ex + r * 0.14, eyeY - r * 0.14); ctx.lineTo(ex - r * 0.14, eyeY + r * 0.14);
        ctx.stroke();
      }
    } else {
      const blink = (p.blink -= 0.016) < 0;
      if (blink && p.blink < -0.12) p.blink = rand(2, 6);
      for (const ex of [-r * 0.3, r * 0.3]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(ex, eyeY, r * 0.28, r * 0.3, 0, 0, TAU); ctx.fill();
        if (!blink) {
          ctx.fillStyle = '#20201f';
          ctx.beginPath(); ctx.arc(ex + r * 0.04, eyeY + r * 0.02, r * 0.14, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(ex + r * 0.09, eyeY - r * 0.06, r * 0.055, 0, 0, TAU); ctx.fill();
        }
      }
      // 眉毛（得意的坏笑）
      ctx.strokeStyle = 'rgba(40,80,20,.75)'; ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.52, -r * 0.55); ctx.lineTo(-r * 0.12, -r * 0.44);
      ctx.moveTo(r * 0.52, -r * 0.6); ctx.lineTo(r * 0.12, -r * 0.44);
      ctx.stroke();
    }

    // 伤痕 / 创可贴
    if (hurtRatio > 0.28) {
      ctx.save(); ctx.rotate(-0.4);
      ctx.fillStyle = '#f4e0b8';
      roundRect(ctx, -r * 0.5, -r * 0.78, r * 0.7, r * 0.26, r * 0.1); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(-r * 0.16, -r * 0.78, r * 0.08, r * 0.26);
      ctx.fillRect(-r * 0.02, -r * 0.78, r * 0.08, r * 0.26);
      ctx.restore();
    }

    // 头盔
    if (p.def.helmet) {
      const hg = ctx.createLinearGradient(0, -r * 1.2, 0, -r * 0.4);
      hg.addColorStop(0, '#e6ecf2'); hg.addColorStop(1, '#8f9aa8');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, -r * 0.32, r * 0.86, Math.PI, TAU); ctx.fill();
      ctx.fillRect(-r * 0.86, -r * 0.34, r * 1.72, r * 0.16);
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(0, -r * 1.12, r * 0.16, 0, TAU); ctx.fill();
    }
    // 王冠
    if (p.def.crown) {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.86);
      ctx.lineTo(-r * 0.42, -r * 1.42); ctx.lineTo(-r * 0.18, -r * 1.0);
      ctx.lineTo(0, -r * 1.56); ctx.lineTo(r * 0.18, -r * 1.0);
      ctx.lineTo(r * 0.42, -r * 1.42); ctx.lineTo(r * 0.6, -r * 0.86);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e2a316'; ctx.fillRect(-r * 0.6, -r * 0.96, r * 1.2, r * 0.14);
    }
    ctx.restore();

    // 气球
    if (p.balloon) {
      const by = p.y - r * s - 46 + Math.sin(t * 2 + p.x) * 6;
      ctx.save();
      ctx.strokeStyle = 'rgba(60,50,40,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - r * s); ctx.quadraticCurveTo(p.x + 6, p.y - r * s - 24, p.x, by + 20); ctx.stroke();
      const bg = ctx.createRadialGradient(p.x - 8, by - 10, 3, p.x, by, 30);
      bg.addColorStop(0, '#ffd0e0'); bg.addColorStop(0.5, '#ff5c8a'); bg.addColorStop(1, '#c02a55');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(p.x, by, 24, 30, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath(); ctx.ellipse(p.x - 8, by - 12, 6, 9, -0.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- 砖块 ---------------- */
  drawBlock(ctx, b) {
    const w = b.w, h = b.h;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    const dmg = 1 - b.hp / b.maxHp;
    const x = -w / 2, y = -h / 2;

    let g, top, bot, edge;
    switch (b.material) {
      case 'wood':
        g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#c68c46'); g.addColorStop(0.45, '#a9702f'); g.addColorStop(1, '#7d4f1d');
        top = 'rgba(255,225,180,.55)'; bot = 'rgba(0,0,0,.28)'; edge = '#5f3a12'; break;
      case 'stone':
        g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#c3c9d1'); g.addColorStop(0.45, '#979ea8'); g.addColorStop(1, '#676e78');
        top = 'rgba(255,255,255,.5)'; bot = 'rgba(0,0,0,.3)'; edge = '#464c55'; break;
      case 'ice':
        g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, 'rgba(226,250,255,.92)'); g.addColorStop(0.5, 'rgba(150,220,245,.82)'); g.addColorStop(1, 'rgba(96,180,215,.9)');
        top = 'rgba(255,255,255,.85)'; bot = 'rgba(40,120,160,.3)'; edge = 'rgba(70,160,200,.85)'; break;
      case 'glass':
        g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, 'rgba(240,255,255,.72)'); g.addColorStop(0.5, 'rgba(170,235,240,.55)'); g.addColorStop(1, 'rgba(110,200,215,.7)');
        top = 'rgba(255,255,255,.9)'; bot = 'rgba(40,140,160,.25)'; edge = 'rgba(90,190,210,.8)'; break;
      case 'tnt':
        g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#e0564a'); g.addColorStop(0.5, '#c02a20'); g.addColorStop(1, '#7d1710');
        top = 'rgba(255,200,180,.5)'; bot = 'rgba(0,0,0,.35)'; edge = '#5c0f0a'; break;
    }

    roundRect(ctx, x, y, w, h, Math.min(6, w * 0.16));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();

    // 材质纹理
    ctx.save();
    roundRect(ctx, x, y, w, h, Math.min(6, w * 0.16)); ctx.clip();
    if (b.material === 'wood') {
      ctx.strokeStyle = 'rgba(90,50,15,.35)'; ctx.lineWidth = 1.6;
      const r = mulberry32(Math.floor(b.crackSeed));
      for (let i = 0; i < Math.max(2, h / 14); i++) {
        const yy = y + 6 + i * 13 + r() * 4;
        ctx.beginPath(); ctx.moveTo(x, yy);
        ctx.bezierCurveTo(x + w * 0.3, yy + (r() - 0.5) * 6, x + w * 0.7, yy + (r() - 0.5) * 6, x + w, yy + (r() - 0.5) * 3);
        ctx.stroke();
      }
    } else if (b.material === 'stone') {
      const r = mulberry32(Math.floor(b.crackSeed));
      for (let i = 0; i < 14; i++) {
        const px = x + r() * w, py = y + r() * h, s = 2 + r() * 5;
        ctx.fillStyle = `rgba(${r() > .5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.12})`;
        ctx.beginPath(); ctx.ellipse(px, py, s, s * 0.7, r() * 3, 0, TAU); ctx.fill();
      }
    } else if (b.material === 'ice' || b.material === 'glass') {
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + h * 0.8); ctx.lineTo(x + w * 0.45, y + h * 0.1); ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x + w * 0.4, y + h * 0.9); ctx.lineTo(x + w * 0.7, y + h * 0.25); ctx.stroke();
    }
    // 上下高光/阴影
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, top); lg.addColorStop(0.3, 'rgba(0,0,0,0)');
    lg.addColorStop(0.75, 'rgba(0,0,0,0)'); lg.addColorStop(1, bot);
    ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);

    // 裂纹
    if (dmg > 0.12) {
      const n = Math.min(4, Math.ceil(dmg * 4));
      const r = mulberry32(Math.floor(b.crackSeed) + 3);
      ctx.strokeStyle = `rgba(20,10,0,${0.35 + dmg * 0.4})`;
      ctx.lineWidth = 1.6 + dmg * 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        let cx2 = x + w * (0.15 + r() * 0.7), cy2 = y + h * (0.1 + r() * 0.8);
        ctx.beginPath(); ctx.moveTo(cx2, cy2);
        for (let k = 0; k < 3; k++) {
          cx2 += (r() - 0.5) * w * 0.42; cy2 += (r() - 0.5) * h * 0.42;
          ctx.lineTo(cx2, cy2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    if (b.material === 'tnt') {
      ctx.fillStyle = 'rgba(255,240,200,.95)';
      ctx.font = `900 ${Math.min(w, h) * 0.34}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 0, 0);
      ctx.fillStyle = '#3a0d08';
      ctx.fillRect(x + 2, y + h * 0.5 - 3, w - 4, 5);
    }
    if (b.flash > 0) {
      ctx.globalAlpha = b.flash * 3;
      ctx.fillStyle = '#fff';
      roundRect(ctx, x, y, w, h, 6); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------------- 机关 ---------------- */
  drawSpring(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    const comp = s.compress;
    // 底座
    ctx.fillStyle = '#6b7280';
    roundRect(ctx, -s.w / 2, 6, s.w, 14, 4); ctx.fill();
    ctx.fillStyle = '#4b5563';
    roundRect(ctx, -s.w / 2 - 4, 16, s.w + 8, 8, 3); ctx.fill();
    // 弹簧圈
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 5;
    const top = -6 - 16 * (1 - comp);
    ctx.beginPath();
    const coils = 5;
    for (let i = 0; i <= coils * 2; i++) {
      const t = i / (coils * 2);
      const yy = lerp(6, top, t);
      const xx = -s.w / 2 + 14 + (i % 2 ? s.w - 28 : 0);
      i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    // 顶板
    const pg = ctx.createLinearGradient(0, top - 14, 0, top + 4);
    pg.addColorStop(0, '#ffe08a'); pg.addColorStop(1, '#f0a028');
    ctx.fillStyle = pg;
    roundRect(ctx, -s.w / 2, top - 14, s.w, 18, 6); ctx.fill();
    ctx.strokeStyle = '#a5681a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    roundRect(ctx, -s.w / 2 + 6, top - 11, s.w - 12, 5, 3); ctx.fill();
    ctx.restore();
  }

  drawPortal(ctx, p, t) {
    const draw = (P, col, col2) => {
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.rotate(P.ang);
      const pulse = 1 + Math.sin(t * 3 + P.x) * 0.05;
      ctx.scale(pulse, pulse);
      // 外框
      ctx.strokeStyle = col; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.r - 6, 0, TAU); ctx.stroke();
      // 内部漩涡
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, p.r - 5, 0, TAU); ctx.clip();
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, p.r);
      g.addColorStop(0, col2); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const a0 = t * 2.2 + i * Math.PI / 2;
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) {
          const rr = (k / 12) * (p.r - 6);
          const aa = a0 + k * 0.32;
          const px = Math.cos(aa) * rr, py = Math.sin(aa) * rr;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    draw(p.A, '#4fc3f7', 'rgba(80,200,255,.6)');
    draw(p.B, '#ffa726', 'rgba(255,170,60,.6)');
    ctx.restore();
  }

  drawFan(ctx, f, t) {
    ctx.save();
    ctx.translate(f.x, f.y);
    const g = ctx.createLinearGradient(0, -f.h / 2, 0, f.h / 2);
    g.addColorStop(0, 'rgba(180,240,255,.02)');
    g.addColorStop(1, 'rgba(180,240,255,.22)');
    ctx.fillStyle = g;
    ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
    // 气流线
    ctx.strokeStyle = 'rgba(200,245,255,.55)';
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const r = mulberry32(Math.floor(t * 2) + 1);
    for (let i = 0; i < 12; i++) {
      const px = -f.w / 2 + r() * f.w;
      const prog = ((t * 1.1 + r()) % 1);
      const py = f.h / 2 - prog * f.h;
      ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.8;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 34); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 风扇本体
    ctx.fillStyle = '#7b8794';
    roundRect(ctx, -f.w / 2, f.h / 2 - 4, f.w, 22, 6); ctx.fill();
    ctx.fillStyle = '#4b5563';
    roundRect(ctx, -f.w / 2 + 4, f.h / 2 + 2, f.w - 8, 10, 4); ctx.fill();
    ctx.save();
    ctx.translate(0, f.h / 2 - 2);
    ctx.rotate(t * 16);
    ctx.fillStyle = '#cbd5e1';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath(); ctx.ellipse(0, -16, 7, 18, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  /* ---------------- 弹弓 ---------------- */
  drawSlingshot(ctx, bird, stretchVec, back) {
    const sx = SLING.x, sy = SLING.y;
    // 木桩
    ctx.save();
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 22; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, sy + 20); ctx.lineTo(sx - 16, GROUND_Y + 6); ctx.stroke();
    ctx.strokeStyle = '#8a5a2c'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(sx, sy + 20); ctx.lineTo(sx - 16, GROUND_Y + 2); ctx.stroke();
    // 叉子
    ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(sx - 20, sy + 26); ctx.lineTo(sx - 30, sy - 34); ctx.stroke();
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(sx + 4, sy + 26); ctx.lineTo(sx + 26, sy - 40); ctx.stroke();
    ctx.restore();
  }

  drawBands(ctx, bird, behind) {
    if (!bird || bird.state !== 'ready') return;
    const sx = SLING.x, sy = SLING.y;
    const bx = bird.x, by = bird.y;
    const forkA = { x: sx - 30, y: sy - 34 }, forkB = { x: sx + 26, y: sy - 40 };
    const draw = (f) => {
      ctx.strokeStyle = behind ? '#3a2415' : '#5a3a22';
      ctx.lineWidth = behind ? 12 : 8;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(bx, by); ctx.stroke();
    };
    if (behind) { draw(forkA); draw(forkB); }
    else { draw(forkB); }
  }

  /* ---------------- 瞄准辅助 ---------------- */
  drawTrajectory(ctx, pts, alpha = 0.75) {
    if (!pts.length) return;
    ctx.save();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = alpha * (1 - i / pts.length) * 0.9;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.2 - i / pts.length * 1.6, 0, TAU); ctx.fill();
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = '#ffd36e';
      ctx.beginPath(); ctx.arc(p.x, p.y, 7 - i / pts.length * 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawPrevPath(ctx, pts) {
    if (!pts || !pts.length) return;
    ctx.save();
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i];
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawAimUI(ctx, bird, drag, t) {
    if (!bird || bird.state !== 'ready' || !drag.active) return;
    const sx = SLING.x, sy = SLING.y;
    const ex = bird.x, ey = bird.y;
    // 力度圆弧
    const pull = len(sx - ex, sy - ey);
    const p = clamp(pull / MAX_STRETCH, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = `hsl(${lerp(90, 0, p)},85%,55%)`;
    ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx, sy, MAX_STRETCH + 22, Math.PI * 0.62, Math.PI * 0.62 + Math.PI * 0.76 * p);
    ctx.stroke();
    ctx.restore();
  }
}
