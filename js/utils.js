/* ============================================================
 * utils.js — 数学 / 随机 / 缓动 / 存档 / 通用工具
 * ============================================================ */
'use strict';

const VW = 1600, VH = 900;          // 逻辑设计分辨率
const GROUND_Y = 812;               // 地面顶部
const GRAVITY = 1750;               // 重力加速度 px/s^2

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
const len = (x, y) => Math.sqrt(x * x + y * y);
const TAU = Math.PI * 2;

/** HTML 转义（四处拼 innerHTML 时统一走它） */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { const c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInQuad = t => t * t;
const easeOutElastic = t => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
};

/** 平滑阻尼插值（与帧率无关） */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** 确定性伪随机（用于程序化生成背景，保证每次一致） */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 点是否落在旋转矩形内 */
function pointInOBB(px, py, cx, cy, w, h, ang) {
  const dx = px - cx, dy = py - cy;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/* ---------------- 存档 ---------------- */
const SAVE_KEY = 'angrybirds_elemental_save_v1';

const Save = {
  data: null,
  defaults() {
    return { levels: {}, unlocked: 1, feathers: 0, eggUnlocked: false, eggCleared: [false, false], muted: false };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { }
  },
  reset() { this.data = this.defaults(); this.save(); },
  get totalStars() {
    return Object.values(this.data.levels).reduce((s, l) => s + (l.stars || 0), 0);
  },
  get totalFeathers() {
    return (this.data.eggCleared[0] ? 1 : 0) + (this.data.eggCleared[1] ? 2 : 0);
  }
};

/* ---------------- 输入（鼠标/触摸统一） ---------------- */
const Input = {
  x: 0, y: 0, down: false, justDown: false, justUp: false, moved: false,
  _downAt: 0,
  reset() { this.justDown = false; this.justUp = false; this.moved = false; }
};

Save.load();   // 立即载入存档，保证任何模块都可直接使用 Save.data
