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

/* ---- 救援机制配额 ----
 * 设计目标：救援巨鸟是真正会卡关时的兜底，要能救急；但不能无限白给，
 * 否则玩家会懒得练角度。引入"双层配额"：
 *   - 救援次数（每日 3 次）：本日内已触发救援巨鸟的次数，跨日自动重置。
 *   - 清空机会（终身 3 次）：把存档清空并刷新救援次数的次数，用完即不再允许靠"重置"刷新。
 *   - 激活码：用完前两层后，向开发者申请 8 位码（README 给出生成函数），
 *            本地校验通过 +5 救援次数，无次数上限。
 * 注意：用本地日期做日切换，玩家改本地时间可绕过 —— 对小游戏够用，且 README 已说明。
 */
const RESCUE_DAILY_MAX = 3;       // 每日救援次数上限
const RESCUE_RESET_MAX = 3;       // 清空机会总数（终身）
const RESCUE_ACTIVATE_GAIN = 5;   // 单次激活码增加救援次数

const Save = {
  data: null,
  /** 本地日期 YYYYMMDD（如 20260911），与玩家本地时区绑定 */
  _todayKey() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  },
  defaults() {
    return {
      levels: {}, unlocked: 1, feathers: 0, eggUnlocked: false, eggCleared: [false, false], muted: false,
      // 救援配额
      rescueDay: this._todayKey(),   // 上次重置救援次数的日期；不等于今天则 count 清零
      rescueCount: 0,               // 今日已用救援次数
      rescueResets: RESCUE_RESET_MAX, // 剩余清空机会（初始 3）
      rescueCredit: 0,              // 激活码累计充入的额外救援次数（跨日不重置）
      rescueActivated: 0            // 已使用激活码次数（无上限，仅供玩家自检）
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    this._maybeResetDaily();
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { }
  },
  reset() { this.data = this.defaults(); this._maybeResetDaily(); this.save(); },
  /** 跨日重置：仅清救援次数，**不**扣清空机会（清空次数是终身额度），
   *  rescueCredit 也不重置 —— 它是激活码带来的累计额外次数。 */
  _maybeResetDaily() {
    if (!this.data) return;
    if (this.data.rescueDay !== this._todayKey()) {
      this.data.rescueDay = this._todayKey();
      this.data.rescueCount = 0;
      this.save();
    }
  },
  get totalStars() {
    return Object.values(this.data.levels).reduce((s, l) => s + (l.stars || 0), 0);
  },
  get totalFeathers() {
    return (this.data.eggCleared[0] ? 1 : 0) + (this.data.eggCleared[1] ? 2 : 0);
  },
  /** 今日剩余救援次数（不含激活码充入的额外次数） */
  get rescueDailyLeft() {
    this._maybeResetDaily();
    return Math.max(0, RESCUE_DAILY_MAX - this.data.rescueCount);
  },
  /** 激活码带来的额外救援次数（跨日保留） */
  get rescueCreditLeft() {
    return Math.max(0, this.data.rescueCredit || 0);
  },
  /** 当前可用救援次数 = 今日剩余 + 累计额外次数 */
  get rescueLeft() {
    return this.rescueDailyLeft + this.rescueCreditLeft;
  },
  /** 触发一次救援：先扣今日次数、再扣累计额外次数 */
  consumeRescue() {
    if (this.rescueLeft <= 0) return false;
    if (this.data.rescueCount < RESCUE_DAILY_MAX) {
      this.data.rescueCount++;
    } else {
      this.data.rescueCredit = Math.max(0, (this.data.rescueCredit || 0) - 1);
    }
    this.save();
    return true;
  },
  /** 用 1 次清空机会换取救援次数刷新：
   *  - 仅在今日救援次数已用尽时才有意义
   *  - 扣 rescueResets、重置 count 为 0（今天又能用 3 次）
   *  - 返回 true/false，告诉调用方是否成功 */
  useResetForRescue() {
    if (this.data.rescueResets <= 0) return false;
    if (this.rescueLeft > 0) return false;   // 还有救援次数，不应该消耗清空机会
    this.data.rescueResets--;
    this.data.rescueCount = 0;
    this.save();
    return true;
  },
  /** 校验并应用激活码：8 位字符串，第 8 位是前 7 位 ASCII 之和的低位校验 */
  activateRescueCode(code) {
    const RES = {
      ok: false,
      msg: '',
      added: 0,
      leftAfter: this.rescueLeft
    };
    if (typeof code !== 'string') { RES.msg = '激活码无效'; return RES; }
    const c = code.trim().toUpperCase();
    if (!Save._checkRescueCode(c)) { RES.msg = '激活码格式错误或已失效'; return RES; }
    // 加到累计 credit 上，跨日不重置 —— 这样 "+5 次" 是真实可用次数，
    // 而不仅是一次性的"刷新"（老的实现无法在已有 credit 时再加）
    this.data.rescueCredit = (this.data.rescueCredit || 0) + RESCUE_ACTIVATE_GAIN;
    this.data.rescueActivated++;
    this.save();
    RES.ok = true;
    RES.added = RESCUE_ACTIVATE_GAIN;
    RES.leftAfter = this.rescueLeft;
    RES.msg = `激活成功！获得 ${RESCUE_ACTIVATE_GAIN} 次救援次数`;
    return RES;
  },
  /** 校验位算法：前 7 字符 ASCII 之和对 65536 取余，转 base36（截 1 位）。
   *  在 README 同步公布这个函数，开发者可批量生成 */
  _checkRescueCode(code) {
    if (code.length !== 8) return false;
    if (!/^[0-9A-Z]+$/.test(code)) return false;
    const prefix = code.slice(0, 7);
    const check = code.slice(7);
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += prefix.charCodeAt(i);
    const expect = (sum % 65536).toString(36).toUpperCase().padStart(2, '0').slice(0, 1);
    return check === expect;
  }
};

/** 对外暴露的生成函数（README 同步公布）。开发者批量生成激活码：
 *    open DevTools console, run: genRescueCode('PREFIX7')
 *    8-char code with checksum. */
window.genRescueCode = function (prefix7) {
  if (typeof prefix7 !== 'string' || prefix7.length !== 7) {
    return '输入必须为 7 位字符串';
  }
  const p = prefix7.toUpperCase();
  if (!/^[0-9A-Z]+$/.test(p)) return '只能使用 0-9 与 A-Z';
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += p.charCodeAt(i);
  const chk = (sum % 65536).toString(36).toUpperCase().padStart(2, '0').slice(0, 1);
  return p + chk;
};

/* ---------------- 输入（鼠标/触摸统一） ---------------- */
const Input = {
  x: 0, y: 0, down: false, justDown: false, justUp: false, moved: false,
  _downAt: 0,
  reset() { this.justDown = false; this.justUp = false; this.moved = false; }
};

Save.load();   // 立即载入存档，保证任何模块都可直接使用 Save.data
