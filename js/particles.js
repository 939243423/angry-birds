/* ============================================================
 * particles.js — 粒子系统 / 特效 / 屏幕震动
 * ============================================================ */
'use strict';

class Particle {
  constructor(o) {
    this.x = o.x; this.y = o.y;
    this.vx = o.vx || 0; this.vy = o.vy || 0;
    this.life = o.life || 1; this.maxLife = this.life;
    this.size = o.size || 6;
    this.type = o.type || 'spark';
    // 注意：rot / vr 的 0 是合法取值（例如飘字要水平且不自旋），
    // 不能用 || 兜底，否则显式传入的 0 会被随机值覆盖
    this.rot = o.rot === undefined ? rand(0, TAU) : o.rot;
    this.vr = o.vr === undefined ? rand(-6, 6) : o.vr;
    this.grav = o.grav === undefined ? 900 : o.grav;
    this.drag = o.drag === undefined ? 0.6 : o.drag;
    this.color = o.color || '#fff';
    this.color2 = o.color2 || null;
    this.floor = o.floor === undefined ? GROUND_Y : o.floor;
    this.dead = false;
    this.fade = o.fade === undefined ? 1 : o.fade;
    this.glow = o.glow || false;
    this.text = o.text;   // text 类型粒子的文案（此前漏拷贝，导致飘字一律显示 undefined）
  }
  update(dt, wind) {
    this.vx += (wind || 0) * dt * 0.5;
    this.vy += this.grav * dt;
    const d = Math.exp(-this.drag * dt);
    this.vx *= d; this.vy *= d;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot += this.vr * dt;
    if (this.y > this.floor && this.grav > 0) {
      this.y = this.floor;
      this.vy *= -0.32; this.vx *= 0.7; this.vr *= 0.5;
      if (Math.abs(this.vy) < 24) { this.vy = 0; this.grav = 0; this.vx *= 0.86; }
    }
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

class ParticleSystem {
  constructor() { this.list = []; this.max = 900; }
  clear() { this.list.length = 0; }
  add(p) { if (this.list.length < this.max) this.list.push(p); }
  update(dt, wind) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.update(dt, wind);
      if (p.dead) this.list.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const t = p.life / p.maxLife;
      const a = p.fade ? clamp(t * 1.4, 0, 1) : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      switch (p.type) {
        case 'feather': {
          const s = p.size * (0.6 + t * 0.4);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.42, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
          break;
        }
        case 'chip': {
          const s = p.size;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(-s, -s * 0.7); ctx.lineTo(s * 0.9, -s); ctx.lineTo(s, s * 0.8); ctx.lineTo(-s * 0.7, s * 0.6);
          ctx.closePath(); ctx.fill();
          if (p.color2) { ctx.fillStyle = p.color2; ctx.fillRect(-s, -s * 0.2, s * 2, s * 0.35); }
          break;
        }
        case 'smoke': {
          const s = p.size * (1.6 - t);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
          g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
          break;
        }
        case 'fire': {
          const s = p.size * (0.4 + t * 1.1);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
          g.addColorStop(0, '#fff8c8'); g.addColorStop(0.4, p.color); g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size * 0.5, -p.size * 0.16, p.size * (0.5 + t), p.size * 0.32);
          break;
        }
        case 'ring': {
          const s = p.size * (1 - t) * 3 + p.size * 0.4;
          ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, 8 * t);
          ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke();
          break;
        }
        case 'star': {
          const s = p.size * (0.5 + t * 0.8);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? s * 0.44 : s;
            const a2 = i * Math.PI / 5 - Math.PI / 2;
            i ? ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r) : ctx.moveTo(Math.cos(a2) * r, Math.sin(a2) * r);
          }
          ctx.closePath(); ctx.fill();
          break;
        }
        case 'dot': {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(0, 0, p.size * (0.4 + t * 0.6), 0, TAU); ctx.fill();
          break;
        }
        case 'text': {
          if (!p.text) break;   // 防御：无文案时绝不绘制，避免出现 "undefined"
          ctx.fillStyle = p.color;
          ctx.font = `900 ${p.size}px "PingFang SC", system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(60,30,0,.55)';
          ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0);
          break;
        }
        case 'bigtext': {
          // 终结大字：90+ 像素、双层描边 + 轻微下沉浮现动效，
          // 让「FINISH! 救援成功」之类文字压住画面但不抢角色戏。
          if (!p.text) break;
          const t = p.life / p.maxLife;
          const pop = t < 0.18 ? easeOutBack(1 - (0.18 - t) / 0.18) : 1;
          ctx.save();
          ctx.translate(0, (1 - pop) * -22);
          ctx.scale(pop, pop);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = `900 ${p.size}px "PingFang SC", system-ui, sans-serif`;
          ctx.lineJoin = 'round';
          // 外层深色描边（厚）—— 让任何背景都能看清
          ctx.lineWidth = Math.max(8, p.size * 0.18);
          ctx.strokeStyle = p.stroke || '#5a2a06';
          ctx.strokeText(p.text, 0, 0);
          // 内层暖色描边（薄）—— 增加质感
          ctx.lineWidth = Math.max(2, p.size * 0.04);
          ctx.strokeStyle = 'rgba(255,255,255,.35)';
          ctx.strokeText(p.text, 0, 0);
          // 填充
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, 0, 0);
          ctx.restore();
          break;
        }
        case 'confetti': {
          const s = p.size;
          ctx.fillStyle = p.color;
          ctx.fillRect(-s * 0.5, -s * 0.28, s, s * 0.56);
          break;
        }
      }
      ctx.restore();
    }
  }
}

/* ---------------- 屏幕特效管理器 ---------------- */
class Fx {
  constructor(particles) {
    this.p = particles;
    this.shake = 0; this.shakeDecay = 6;
    this.flash = 0;
    this.timeScale = 1; this.slowTimer = 0;
    this.hitStop = 0;
  }
  addShake(v) { this.shake = Math.min(34, this.shake + v); }
  addFlash(v) { this.flash = Math.min(1, this.flash + v); }
  slow(dur, scale = 0.32) { this.slowTimer = dur; this.slowScale = scale; }
  freeze(dur) { this.hitStop = Math.max(this.hitStop, dur); }
  update(rdt) {
    this.shake = Math.max(0, this.shake - this.shakeDecay * rdt * 14);
    this.flash = Math.max(0, this.flash - rdt * 3.2);
    if (this.hitStop > 0) { this.hitStop -= rdt; this.timeScale = 0.04; return; }
    if (this.slowTimer > 0) { this.slowTimer -= rdt; this.timeScale = lerp(this.timeScale, this.slowScale, 0.25); }
    else this.timeScale = lerp(this.timeScale, 1, 0.12);
  }
  shakeOffset() {
    if (this.shake <= 0.1) return { x: 0, y: 0 };
    return { x: rand(-this.shake, this.shake), y: rand(-this.shake, this.shake) * 0.7 };
  }
  drawFlash(ctx) {
    if (this.flash <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = this.flash * 0.75;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  /* ---- 预设特效 ---- */
  burst(x, y, opts = {}) {
    const n = opts.count || 12, color = opts.color || '#fff';
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(opts.spMin || 80, opts.spMax || 340);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.lift || 60),
        life: rand(0.4, 0.9), size: opts.size || 7,
        type: opts.type || 'dot', color, color2: opts.color2,
        grav: opts.grav === undefined ? 800 : opts.grav
      }));
    }
  }
  explosion(x, y, radius = 130) {
    this.addShake(16); this.addFlash(0.55); this.freeze(0.05);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), sp = rand(120, 620);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        life: rand(0.3, 0.62), size: rand(16, 46), type: 'fire',
        color: pick(['#ffb020', '#ff6a10', '#ffe066']), grav: -80, drag: 2.2, glow: true
      }));
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU), sp = rand(40, 240);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.7, 1.5), size: rand(26, 60), type: 'smoke',
        color: 'rgba(60,50,45,.55)', grav: -120, drag: 1.4
      }));
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), sp = rand(300, 760);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.25, 0.5), size: rand(8, 18), type: 'spark',
        color: pick(['#fff3b0', '#ffcc33', '#ff8c1a']), grav: 340, drag: 1.1, glow: true
      }));
    }
    this.p.add(new Particle({ x, y, vx: 0, vy: 0, life: 0.42, size: radius * 0.45, type: 'ring', color: 'rgba(255,220,150,.9)', grav: 0, drag: 0 }));
  }
  feathers(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(60, 260);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        life: rand(1.0, 2.0), size: rand(8, 15), type: 'feather',
        color, grav: 210, drag: 1.5, vr: rand(-4, 4)
      }));
    }
  }
  debris(x, y, mat, n = 8) {
    const cols = {
      wood: ['#a9702f', '#8a5620', '#c68c46'],
      stone: ['#9aa0a8', '#7b828b', '#b6bcc4'],
      ice: ['#a8e4f5', '#d8f4ff', '#7cc9e8'],
      glass: ['#cbeef7', '#eafaff', '#9fd8ea'],
      tnt: ['#c8342a', '#8e1f18', '#e05a4a']
    }[mat] || ['#ccc'];
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(90, 420);
      this.p.add(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160,
        life: rand(0.7, 1.5), size: rand(5, 13), type: 'chip',
        color: pick(cols), color2: 'rgba(0,0,0,.16)', grav: 1250, drag: 0.4
      }));
    }
  }
  dust(x, y, n = 6, groundY = GROUND_Y) {
    for (let i = 0; i < n; i++) {
      this.p.add(new Particle({
        x: x + rand(-16, 16), y, vx: rand(-90, 90), vy: rand(-130, -20),
        life: rand(0.4, 0.9), size: rand(10, 26), type: 'smoke',
        color: 'rgba(196,178,140,.45)', grav: -20, drag: 2.4, floor: groundY
      }));
    }
  }
  scoreText(x, y, text, color = '#ffe066', size = 34) {
    this.p.add(new Particle({
      x, y, vx: rand(-20, 20), vy: -170, life: 1.05, size,
      type: 'text', text, color, grav: 300, drag: 1.1,
      rot: rand(-0.05, 0.05),   // 默认 rot 是 0~2π 随机角，会把飘字转歪，这里收敛为轻微倾斜
      vr: 0                     // 飘字不自旋
    }));
  }
  /** 大字飘字：专用于结算 / 斩杀 / 通关类提示。60+ 像素、双层描边、轻微上飘后停住。 */
  bigText(x, y, text, color = '#fff4d6', size = 72, stroke = '#7a3008') {
    this.p.add(new Particle({
      x, y, vx: 0, vy: -32, life: 1.55, size,
      type: 'bigtext', text, color, stroke,
      grav: 36, drag: 2.4,
      rot: 0, vr: 0
    }));
  }
  confetti(x, y, n = 40) {
    for (let i = 0; i < n; i++) {
      this.p.add(new Particle({
        x: x + rand(-300, 300), y: y + rand(-160, 0),
        vx: rand(-160, 160), vy: rand(-520, -180),
        life: rand(1.4, 2.6), size: rand(8, 18), type: 'confetti',
        color: pick(['#ffd93d', '#ff6b6b', '#4ecdc4', '#a06cd5', '#ff9f1c', '#7bd389']),
        grav: 520, drag: 0.5, vr: rand(-9, 9)
      }));
    }
  }
}
