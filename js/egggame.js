/* ============================================================
 * egggame.js — 彩蛋奖励关「蛋了个蛋」
 * 羊了个羊式堆叠三消：7 格槽位 / 遮挡判定 / 三种道具
 * ============================================================ */
'use strict';

const EGG_ICONS = ['egg', 'pig', 'bird', 'bomb', 'tnt', 'star', 'feather', 'stone'];
const EGG_ICON_NAME = { egg: '鸟蛋', pig: '猪头', bird: '小鸟', bomb: '炸弹', tnt: 'TNT', star: '星星', feather: '羽毛', stone: '石块' };
const EGG_TINT = {
  egg: ['#fff6e0', '#ffd9a0', '#e0a15c'],
  pig: ['#d6f59f', '#8ed45c', '#4f9633'],
  bird: ['#ffd0cc', '#f0685c', '#b0261c'],
  bomb: ['#8e97a8', '#4b5464', '#262b36'],
  tnt: ['#ffb3a8', '#e03a2a', '#8e1a10'],
  star: ['#fff3c4', '#ffd04a', '#d99a10'],
  feather: ['#e8f6ff', '#a8d8f5', '#5a9ec9'],
  stone: ['#dfe3e8', '#a3abb5', '#6b7480']
};

const EGG_DIFF = [
  { name: '轻松局', types: 5, groups: 18, layers: [22, 14, 11, 7], card: 100, undo: 3, shuffle: 1, extract: 1 },
  { name: '地狱局', types: 8, groups: 34, layers: [32, 24, 19, 14, 9, 4], card: 88, undo: 2, shuffle: 1, extract: 1 }
];

class EggGame {
  constructor(game) {
    this.game = game;
    this.cards = [];
    this.slot = [];
    this.state = 'idle';      // idle | play | win | lose
    this.diff = 0;
    this.time = 0;
    this.anims = [];
    this.dirty = true;
    this.score = 0;
    this.hover = null;
    this.btns = [];
    this.featherParticles = [];
    this.comboFx = 0;
    this.message = null;
    this.messageT = 0;
  }

  /* ---------------- 初始化 ---------------- */
  start(diff) {
    const D = EGG_DIFF[diff];
    this.diff = diff; this.D = D;
    this.cards = []; this.slot = []; this.anims = [];
    this.state = 'play';
    this.score = 0;
    this.undoLeft = D.undo; this.shuffleLeft = D.shuffle; this.extractLeft = D.extract;
    this.message = null;
    this.time = 0;
    this.game.camX = 0; this.game.camZoom = 1;

    const types = EGG_ICONS.slice(0, D.types);
    // 同组 3 张在池中相邻，便于控制难度
    const groupTypes = [];
    for (let i = 0; i < D.groups; i++) groupTypes.push(types[i % types.length]);
    for (let i = groupTypes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[groupTypes[i], groupTypes[j]] = [groupTypes[j], groupTypes[i]]; }
    const pool = [];
    for (const t of groupTypes) pool.push(t, t, t);
    const groupCount = groupTypes.length;

    // 为每张卡分配层：轻松局同组相邻层，地狱局同组层号相近但不保证
    const caps = D.layers.slice();
    const assign = new Array(pool.length).fill(0);
    if (diff === 0) {
      let i = 0;
      for (let L = caps.length - 1; L >= 0; L--)
        for (let k = 0; k < D.layers[L]; k++) if (i < pool.length) assign[i++] = L;
    } else {
      const take = (pref) => {
        for (let d = 0; d < caps.length + 2; d++) {
          for (const L of [pref + d, pref - d]) {
            if (L >= 0 && L < caps.length && caps[L] > 0) { caps[L]--; return L; }
          }
        }
        return 0;
      };
      for (let gi = 0; gi < groupCount; gi++) {
        const base = Math.floor(Math.random() * caps.length);
        for (let k = 0; k < 3; k++) assign[gi * 3 + k] = take(base);
      }
    }
    const byLayer = {};
    pool.forEach((t, i) => { (byLayer[assign[i]] = byLayer[assign[i]] || []).push(t); });

    const AX = 250, AY = 150, AW = 1100, AH = 470;
    const cw = D.card, ch = D.card * 0.82;
    let idx = 0;
    for (const L in byLayer) {
      const layer = +L, arr = byLayer[L];
      const count = arr.length;
      const cols = Math.max(2, Math.round(Math.sqrt(count * (AW / AH) * 1.15)));
      const rows = Math.ceil(count / cols) + 1;
      const gx = AW / cols, gy = AH / rows;
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
      for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[cells[i], cells[j]] = [cells[j], cells[i]]; }
      arr.forEach((type, i) => {
        const [c, r] = cells[i % cells.length];
        const x = AX + c * gx + gx / 2 + rand(-gx * 0.2, gx * 0.2) + layer * 11;
        const y = AY + r * gy + gy / 2 + rand(-gy * 0.2, gy * 0.2) + layer * 8;
        this.cards.push({
          id: idx, type, layer,
          x: clamp(x, AX + cw / 2, AX + AW - cw / 2), y: clamp(y, AY + ch / 2, AY + AH - ch / 2),
          w: cw, h: ch, state: 'stack', locked: false, flyT: 0, from: null, slotI: -1, pop: 0
        });
        idx++;
      });
    }
    this.total = this.cards.length;
    this.dirty = true;
    this.recomputeLocks();
    Sfx.init(); Sfx.resume();
  }

  get remaining() { return this.cards.filter(c => c.state !== 'gone').length; }
  get slotFull() { return this.slot.length >= 7; }

  recomputeLocks() {
    for (const c of this.cards) c.locked = false;
    for (let i = 0; i < this.cards.length; i++) {
      const a = this.cards[i];
      if (a.state !== 'stack') continue;
      for (let j = 0; j < this.cards.length; j++) {
        const b = this.cards[j];
        if (b.state !== 'stack' || b.layer <= a.layer) continue;
        const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
        if (ox > a.w * 0.22 && oy > a.h * 0.22) { a.locked = true; break; }
      }
    }
    this.dirty = false;
  }

  /* ---------------- 槽位 ---------------- */
  slotPos(i) {
    const cw = this.D.card * 0.92, gap = 14;
    const total = 7 * cw + 6 * gap;
    const x0 = (VW - total) / 2 + cw / 2;
    return { x: x0 + i * (cw + gap), y: 742, w: cw, h: cw * 0.82 };
  }

  takeCard(c) {
    if (this.slot.length >= 7 || c.state !== 'stack' || c.locked) return false;
    c.state = 'flying'; c.flyT = 0;
    c.from = { x: c.x, y: c.y };
    let ins = -1;
    for (let i = this.slot.length - 1; i >= 0; i--) if (this.slot[i].type === c.type) { ins = i; break; }
    if (ins >= 0) this.slot.splice(ins + 1, 0, c); else this.slot.push(c);
    this.dirty = true;
    Sfx.click();
    return true;
  }

  refreshSlotTargets() {
    this.slot.forEach((c, i) => {
      c.slotI = i;
      const p = this.slotPos(i);
      c.target = p;
      if (c.state === 'slot' && (Math.abs(c.x - p.x) > 1 || Math.abs(c.y - p.y) > 1)) {
        c.from = { x: c.x, y: c.y };
        c.flyT = 0; c.state = 'flying';
      }
    });
  }

  checkMatch() {
    const counts = {};
    for (const c of this.slot) counts[c.type] = (counts[c.type] || 0) + 1;
    for (const t in counts) {
      if (counts[t] >= 3) {
        const trio = this.slot.filter(c => c.type === t).slice(0, 3);
        for (const c of trio) {
          const i = this.slot.indexOf(c);
          if (i >= 0) this.slot.splice(i, 1);
          c.state = 'gone';
          this.game.fx.burst(c.x, c.y, { count: 14, color: EGG_TINT[t][1], type: 'star', spMax: 320, size: 12, grav: 500 });
        }
        this.score += 1000;
        this.comboFx = 1;
        Sfx.star(this.slot.length % 3);
        this.game.fx.scoreText(VW / 2, 660, `+1000`, '#ffd93d', 34);
        this.checkEnd();
        return true;
      }
    }
    return false;
  }

  checkEnd() {
    if (this.remaining === 0 && this.slot.length === 0) {
      this.state = 'win';
      this.score += 8000 + this.undoLeft * 600 + this.shuffleLeft * 400 + this.extractLeft * 400;
      Sfx.feather();
      this.game.fx.confetti(VW / 2, 300, 80);
      const D = Save.data;
      if (!D.eggCleared[this.diff]) D.eggCleared[this.diff] = true;
      D.feathers = Save.totalFeathers;
      Save.save();
      setTimeout(() => { if (this.game.onEggFinish) this.game.onEggFinish({ win: true, diff: this.diff, score: this.score }); }, 1100);
    } else if (this.slot.length >= 7) {
      // 满槽：先尝试消除一次，仍凑不出三连才算失败
      if (this.checkMatch()) return;
      this.state = 'lose';
      Sfx.lose();
      setTimeout(() => { if (this.game.onEggFinish) this.game.onEggFinish({ win: false, diff: this.diff, score: this.score }); }, 700);
    }
  }

  /* ---------------- 道具 ---------------- */
  useUndo() {
    if (this.undoLeft <= 0 || this.state !== 'play' || !this.slot.length) return;
    const c = this.slot.pop();
    this.undoLeft--;
    c.state = 'stack'; c.flyT = 0;
    c.from = { x: c.x, y: c.y };
    c.target = { x: c.homeX || c.x, y: c.homeY || c.y };
    c.state = 'flying'; c.flyT = 0; c.backHome = true;
    this.dirty = true;
    Sfx.pop();
    this.refreshSlotTargets();
  }
  useShuffle() {
    if (this.shuffleLeft <= 0 || this.state !== 'play') return;
    this.shuffleLeft--;
    const stack = this.cards.filter(c => c.state === 'stack');
    const byLayer = {};
    for (const c of stack) (byLayer[c.layer] = byLayer[c.layer] || []).push(c);
    const AX = 250, AY = 150, AW = 1100, AH = 470;
    for (const L in byLayer) {
      const arr = byLayer[L];
      const count = arr.length;
      const cols = Math.max(2, Math.round(Math.sqrt(count * (AW / AH) * 1.15)));
      const rows = Math.ceil(count / cols) + 1;
      const gx = AW / cols, gy = AH / rows;
      for (let i = 0; i < count; i++) {
        const c = Math.floor(i % cols), r = Math.floor(i / cols);
        const c2 = arr[i];
        c2.from = { x: c2.x, y: c2.y };
        c2.x = clamp(AX + c * gx + gx / 2 + rand(-gx * 0.2, gx * 0.2) + L * 11, AX + c2.w / 2, AX + AW - c2.w / 2);
        c2.y = clamp(AY + r * gy + gy / 2 + rand(-gy * 0.2, gy * 0.2) + L * 8, AY + c2.h / 2, AY + AH - c2.h / 2);
        c2.state = 'flying'; c2.flyT = 0; c2.backHome = true; c2.target = { x: c2.x, y: c2.y };
      }
    }
    this.dirty = true;
    Sfx.skill('split');
    this.flashMsg('洗牌完成！');
  }
  useExtract() {
    if (this.extractLeft <= 0 || this.state !== 'play' || this.slot.length < 3) return;
    this.extractLeft--;
    const out = this.slot.splice(0, 3);
    const maxLayer = Math.max(...this.cards.map(c => c.layer));
    out.forEach((c, i) => {
      c.layer = maxLayer + 1;
      c.from = { x: c.x, y: c.y };
      c.target = { x: clamp(rand(320, 1280), 300, 1300), y: rand(200, 560) };
      c.state = 'flying'; c.flyT = 0; c.backHome = true;
    });
    this.dirty = true;
    Sfx.skill('bomb');
    this.refreshSlotTargets();
    this.flashMsg('移出 3 张到顶层');
  }
  flashMsg(t) { this.message = t; this.messageT = 1.6; }

  /* ---------------- 输入 ---------------- */
  hitTest(x, y) {
    // 从上（最高层）往下找
    const sorted = this.cards.slice().sort((a, b) => b.layer - a.layer || b.y - a.y);
    for (const c of sorted) {
      if (c.state !== 'stack') continue;
      if (Math.abs(x - c.x) < c.w / 2 && Math.abs(y - c.y) < c.h / 2) return c;
    }
    return null;
  }
  onDown(x, y) { this.press = { x, y }; }
  onMove(x, y) { this.hover = this.hitTest(x, y); }
  onUp(x, y) {
    if (this.state !== 'play') {
      if (this.state === 'win' || this.state === 'lose') return;
    }
    // 按钮
    for (const b of this.btns) {
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
        Sfx.click();
        if (b.act === 'undo') this.useUndo();
        else if (b.act === 'shuffle') this.useShuffle();
        else if (b.act === 'extract') this.useExtract();
        else if (b.act === 'back') { this.game.mode = 'menu'; if (this.game.onEggExit) this.game.onEggExit(); }
        return;
      }
    }
    const c = this.hitTest(x, y);
    if (!c) return;
    if (c.locked) { Sfx.tone(160, 0.08, 'square', 0.08, 120); c.shakeT = 0.3; return; }
    c.homeX = c.x; c.homeY = c.y;
    this.takeCard(c);
    this.refreshSlotTargets();
  }
  onKey(code) { if (code === 'KeyZ') this.useUndo(); if (code === 'KeyX') this.useShuffle(); if (code === 'KeyC') this.useExtract(); }

  /* ---------------- 更新 ---------------- */
  update(dt) {
    this.time += dt;
    if (this.messageT > 0) this.messageT -= dt;
    if (this.comboFx > 0) this.comboFx -= dt * 2;
    if (this.dirty) this.recomputeLocks();

    let anyFly = false;
    for (const c of this.cards) {
      if (c.shakeT > 0) c.shakeT -= dt;
      if (c.state === 'flying') {
        anyFly = true;
        c.flyT += dt / 0.3;
        const t = clamp(c.flyT, 0, 1);
        const e = easeOutCubic(t);
        const tgt = c.target || { x: c.x, y: c.y };
        c.x = lerp(c.from.x, tgt.x, e);
        c.y = lerp(c.from.y, tgt.y, e) - Math.sin(t * Math.PI) * 60;
        if (t >= 1) {
          c.state = c.backHome ? 'stack' : 'slot';
          c.backHome = false;
          if (c.state === 'slot') { this.checkMatch(); this.refreshSlotTargets(); }
          if (c.state === 'stack') { this.dirty = true; }
        }
      }
    }
    if (!anyFly && this.state === 'play') this.checkEnd();
    this.game.particles.update(dt, 0);
  }

  /* ---------------- 渲染 ---------------- */
  render(ctx) {
    const r = this.game.renderer;
    ctx.setTransform(r.scale, 0, 0, r.scale, 0, 0);
    ctx.clearRect(0, 0, VW, VH);

    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#4a2f6b'); g.addColorStop(0.45, '#7a3f6a'); g.addColorStop(1, '#c2603f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    // 光斑
    for (let i = 0; i < 5; i++) {
      const x = 300 + i * 260 + Math.sin(this.time * 0.4 + i) * 30;
      const rg = ctx.createRadialGradient(x, 180, 0, x, 180, 240);
      rg.addColorStop(0, 'rgba(255,220,150,.16)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, 180, 240, 0, TAU); ctx.fill();
    }
    // 漂浮羽毛
    for (let i = 0; i < 16; i++) {
      const t = this.time * 0.25 + i * 1.7;
      const x = ((i * 197 + t * 40) % (VW + 200)) - 100;
      const y = 120 + ((i * 271 + this.time * 26) % 700);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.translate(x, y); ctx.rotate(Math.sin(t) * 0.6);
      ctx.fillStyle = '#ffe9b8';
      ctx.beginPath(); ctx.ellipse(0, 0, 14, 6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // 标题
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 52px "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#ffe9b8';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillText(`蛋了个蛋 · ${this.D ? this.D.name : ''}`, VW / 2, 84);
    ctx.font = '700 22px "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(`剩余 ${this.remaining} 张　·　三个相同即消除　·　槽位仅 7 格`, VW / 2, 118);
    ctx.restore();

    // 堆叠卡片
    const layers = [...new Set(this.cards.map(c => c.layer))].sort((a, b) => a - b);
    for (const L of layers) {
      for (const c of this.cards) {
        if (c.layer !== L || c.state === 'gone') continue;
        this.drawCard(ctx, c, c.state === 'stack' && c.locked);
      }
    }

    // 槽位
    for (let i = 0; i < 7; i++) {
      const p = this.slotPos(i);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = 3;
      roundRect(ctx, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, 12);
      ctx.setLineDash([10, 8]); ctx.stroke();
      ctx.restore();
    }
    for (const c of this.slot) this.drawCard(ctx, c, false, true);

    // 按钮
    this.btns = [];
    const btn = (x, y, w, h, label, sub, act, enabled) => {
      ctx.save();
      const bg = ctx.createLinearGradient(0, y, 0, y + h);
      bg.addColorStop(0, enabled ? '#ffe9b8' : '#9c9c9c'); bg.addColorStop(1, enabled ? '#f0b45a' : '#707070');
      ctx.fillStyle = bg;
      roundRect(ctx, x, y, w, h, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = enabled ? '#5a3708' : '#3a3a3a';
      ctx.textAlign = 'center';
      ctx.font = '900 24px "PingFang SC", system-ui, sans-serif';
      ctx.fillText(label, x + w / 2, y + (sub ? h * 0.44 : h * 0.62));
      if (sub) {
        ctx.font = '700 16px "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = enabled ? 'rgba(90,55,8,.7)' : 'rgba(40,40,40,.7)';
        ctx.fillText(sub, x + w / 2, y + h * 0.78);
      }
      ctx.restore();
      this.btns.push({ x, y, w, h, act });
    };
    const bx = 1362, bw = 190;
    btn(bx, 300, bw, 62, '撤回', `剩余 ${this.undoLeft}`, 'undo', this.undoLeft > 0);
    btn(bx, 380, bw, 62, '洗牌', `剩余 ${this.shuffleLeft}`, 'shuffle', this.shuffleLeft > 0);
    btn(bx, 460, bw, 62, '移出', `剩余 ${this.extractLeft}`, 'extract', this.extractLeft > 0);
    btn(48, 300, 150, 56, '← 返回', '', 'back', true);

    // 分数 & 提示
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '900 34px "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#ffe9b8';
    ctx.fillText(`分数 ${this.score}`, 48, 640);
    ctx.font = '700 18px "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText('快捷键 Z / X / C', 48, 672);
    ctx.restore();

    if (this.messageT > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.messageT, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = '900 34px "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#fff3c4';
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12;
      ctx.fillText(this.message, VW / 2, 690);
      ctx.restore();
    }

    this.game.particles.draw(ctx);

    if (this.state === 'win' || this.state === 'lose') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, VW, VH);
      ctx.textAlign = 'center';
      ctx.font = '900 76px "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = this.state === 'win' ? '#ffe066' : '#ff8a8a';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 20;
      ctx.fillText(this.state === 'win' ? '彩蛋通关！' : '槽位满了…', VW / 2, VH / 2);
      ctx.font = '700 28px "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(this.state === 'win' ? `获得金羽 x${this.diff === 0 ? 1 : 2}` : '再试一次吧', VW / 2, VH / 2 + 56);
      ctx.restore();
    }
  }

  drawCard(ctx, c, locked, inSlot) {
    const [c1, c2, c3] = EGG_TINT[c.type];
    const sh = c.shakeT > 0 ? Math.sin(c.shakeT * 60) * 4 : 0;
    ctx.save();
    ctx.translate(c.x + sh, c.y);
    const hov = this.hover === c && !locked && !inSlot;
    ctx.scale(hov ? 1.05 : 1, hov ? 1.05 : 1);

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    roundRect(ctx, -c.w / 2 + 3, -c.h / 2 + 6, c.w, c.h, 14); ctx.fill();
    // 底
    const g = ctx.createLinearGradient(0, -c.h / 2, 0, c.h / 2);
    g.addColorStop(0, c1); g.addColorStop(0.55, c2); g.addColorStop(1, c3);
    ctx.fillStyle = g;
    roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 14); ctx.fill();
    // 内框
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
    roundRect(ctx, -c.w / 2 + 6, -c.h / 2 + 6, c.w - 12, c.h - 12, 10); ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    roundRect(ctx, -c.w / 2 + 10, -c.h / 2 + 10, c.w - 20, c.h * 0.3, 8); ctx.fill();

    this.drawIcon(ctx, c.type, 0, 2, c.h * 0.52);

    if (locked) {
      ctx.fillStyle = 'rgba(20,14,30,.5)';
      roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 14); ctx.fill();
    } else if (hov) {
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 4;
      roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 14); ctx.stroke();
    }
    ctx.restore();
  }

  drawIcon(ctx, type, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    switch (type) {
      case 'egg':
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.78, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(190,140,90,.5)';
        ctx.beginPath(); ctx.arc(-s * 0.16, s * 0.16, s * 0.13, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.22, -s * 0.08, s * 0.1, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.78, 0, 0, TAU); ctx.stroke();
        break;
      case 'pig':
        ctx.fillStyle = '#8ed45c';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.72, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6fbf46';
        ctx.beginPath(); ctx.ellipse(-s * 0.52, -s * 0.55, s * 0.22, s * 0.15, -0.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(s * 0.52, -s * 0.55, s * 0.22, s * 0.15, 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#a8e06f';
        ctx.beginPath(); ctx.ellipse(0, s * 0.14, s * 0.33, s * 0.26, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2c4a1c';
        ctx.beginPath(); ctx.arc(-s * 0.12, s * 0.14, s * 0.07, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.12, s * 0.14, s * 0.07, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1b1b22';
        ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.16, s * 0.09, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.16, s * 0.09, 0, TAU); ctx.fill();
        break;
      case 'bird':
        ctx.fillStyle = '#e0362c';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.72, 0, TAU); ctx.fill();
        ctx.fillStyle = '#a81f18';
        ctx.beginPath(); ctx.moveTo(-s * 0.6, -s * 0.1); ctx.lineTo(-s * 0.95, -s * 0.5); ctx.lineTo(-s * 0.5, -s * 0.42); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-s * 0.24, -s * 0.2, s * 0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.24, -s * 0.2, s * 0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1b1b22';
        ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.18, s * 0.1, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.28, -s * 0.18, s * 0.1, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffb02e';
        ctx.beginPath();
        ctx.moveTo(s * 0.16, s * 0.06); ctx.lineTo(s * 0.85, s * 0.24); ctx.lineTo(s * 0.16, s * 0.42); ctx.closePath(); ctx.fill();
        break;
      case 'bomb':
        ctx.fillStyle = '#2f3542';
        ctx.beginPath(); ctx.arc(0, s * 0.12, s * 0.66, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.1, s * 0.17, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#c8a05a'; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s * 0.16, -s * 0.4); ctx.quadraticCurveTo(s * 0.6, -s * 0.72, s * 0.44, -s * 0.98); ctx.stroke();
        ctx.fillStyle = '#ffcf3a';
        ctx.beginPath(); ctx.arc(s * 0.44, -s * 1.02, s * 0.14, 0, TAU); ctx.fill();
        break;
      case 'tnt':
        ctx.fillStyle = '#c02a20';
        roundRect(ctx, -s * 0.62, -s * 0.5, s * 1.24, s * 1.0, 6); ctx.fill();
        ctx.fillStyle = '#f5e6c8';
        ctx.fillRect(-s * 0.62, -s * 0.1, s * 1.24, s * 0.2);
        ctx.fillStyle = '#7d1710';
        ctx.font = `900 ${s * 0.4}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('TNT', 0, 0);
        break;
      case 'star':
        ctx.fillStyle = '#ffd04a';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? s * 0.34 : s * 0.8;
          const a = i * Math.PI / 5 - Math.PI / 2;
          i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.24, s * 0.16, 0, TAU); ctx.fill();
        break;
      case 'feather':
        ctx.save(); ctx.rotate(-0.4);
        ctx.fillStyle = '#dff0ff';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.28, s * 0.78, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#7fb8d8'; ctx.lineWidth = s * 0.1;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.78); ctx.lineTo(0, s * 0.85); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,170,200,.6)'; ctx.lineWidth = s * 0.05;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(0, i * s * 0.2);
          ctx.lineTo(-s * 0.24, i * s * 0.2 - s * 0.1);
          ctx.moveTo(0, i * s * 0.2);
          ctx.lineTo(s * 0.24, i * s * 0.2 - s * 0.1);
          ctx.stroke();
        }
        ctx.restore();
        break;
      case 'stone':
        ctx.fillStyle = '#9aa2ad';
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, s * 0.3); ctx.lineTo(-s * 0.5, -s * 0.5);
        ctx.lineTo(s * 0.35, -s * 0.66); ctx.lineTo(s * 0.75, s * 0.1);
        ctx.lineTo(s * 0.3, s * 0.62); ctx.lineTo(-s * 0.4, s * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.5); ctx.lineTo(s * 0.35, -s * 0.66); ctx.lineTo(s * 0.2, -s * 0.16); ctx.lineTo(-s * 0.44, -s * 0.1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        ctx.beginPath(); ctx.arc(s * 0.16, s * 0.18, s * 0.12, 0, TAU); ctx.fill();
        break;
    }
    ctx.restore();
  }
}
