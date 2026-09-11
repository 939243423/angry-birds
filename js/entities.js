/* ============================================================
 * entities.js — 小鸟 / 猪 / 砖块 / 机关（弹簧·传送门·气流·气球）
 * ============================================================ */
'use strict';

const SLING = { x: 306, y: 612 };     // 弹弓叉口中心
const MAX_STRETCH = 98;
const SLING_POWER = 17.5;    // 满拉 ≈ 1715px/s，45° 射程约 1680px（力度上调 17%，打得更痛快）

/* ---------------- 小鸟 ---------------- */
const BIRD_TYPES = {
  red: {
    name: '烈焰红', skill: '爆裂冲刺', skillKey: 'blast',
    r: 22, mass: 1.05, power: 1.0, restitution: 0.22,
    body: '#e0362c', body2: '#a81f18', belly: '#ffe3b8',
    hint: '空中点击 → 爆裂冲刺，撞到即炸'
  },
  yellow: {
    name: '闪电黄', skill: '超音冲刺', skillKey: 'dash',
    r: 20, mass: 0.82, power: 1.0, restitution: 0.2,
    body: '#ffcf1f', body2: '#e09700', belly: '#fff4c4',
    hint: '空中点击 → 超音冲刺，穿透一切'
  },
  blue: {
    name: '寒冰蓝', skill: '一分为三', skillKey: 'split',
    r: 18, mass: 0.6, power: 0.62, restitution: 0.34,
    body: '#3aa6f0', body2: '#1668b8', belly: '#dff2ff',
    hint: '空中点击 → 分裂成三只，专破冰块'
  },
  black: {
    name: '爆破黑', skill: '定时炸弹', skillKey: 'bomb',
    r: 24, mass: 1.25, power: 0.9, restitution: 0.16,
    body: '#3b3b45', body2: '#191920', belly: '#ffb54a',
    hint: '空中点击 → 引爆炸弹，大范围摧毁'
  },
  green: {
    name: '回旋绿', skill: '回旋折返', skillKey: 'boomerang',
    r: 21, mass: 0.95, power: 1.0, restitution: 0.24,
    body: '#4fc94f', body2: '#2b8f2b', belly: '#e6ffd6',
    hint: '空中点击 → 折返飞行，回打身后的目标'
  },
  violet: {
    name: '引力紫', skill: '引力奇点', skillKey: 'gravity',
    r: 22, mass: 1.1, power: 0.95, restitution: 0.2,
    body: '#9b5cf0', body2: '#5f2ea8', belly: '#ecdcff',
    hint: '空中点击 → 制造引力场，把周围全吸过来'
  },
  orange: {
    name: '爆胀橙', skill: '膨胀冲击', skillKey: 'inflate',
    r: 19, mass: 0.8, power: 0.95, restitution: 0.26,
    body: '#ff8c1a', body2: '#c25a00', belly: '#ffe9c4',
    hint: '空中点击 → 体型膨胀近一倍，撞击力暴增'
  },
  white: {
    name: '空投白', skill: '空投炸弹', skillKey: 'eggdrop',
    r: 22, mass: 0.95, power: 0.95, restitution: 0.22,
    body: '#f2f5f9', body2: '#8b98ab', belly: '#ffffff',
    hint: '空中点击 → 向下投掷炸弹，落地即爆'
  },
  giant: {
    name: '泰坦巨力', skill: '毁灭冲击', skillKey: 'titan',
    r: 40, mass: 2.8, power: 1.3, restitution: 0.16,
    body: '#e0362c', body2: '#8f1a12', belly: '#ffe3b8',
    hint: '救援巨鸟：体型庞大，撞击即引发大范围爆炸',
    rescue: true
  }
};

class Bird {
  constructor(type, x, y) {
    this.def = BIRD_TYPES[type];
    this.type = type;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = this.def.r;
    this.state = 'ready';        // ready | flying | resting | dead
    this.skillUsed = false;
    this.armedBlast = false;     // red：下次撞击爆炸
    this.fuse = 0;               // black：引信倒计时
    this.launched = false;
    this.trail = [];
    this.rot = 0;
    this.blink = rand(2, 5);
    this.dead = false;
    this.fade = 1;
    this.isClone = false;
    this.faceAngle = 0;
    this.squash = 0;
    this.hitCount = 0;
  }
  get color() { return this.def.body; }
  launch(vx, vy) {
    this.vx = vx; this.vy = vy;
    this.state = 'flying'; this.launched = true;
    this.trail.length = 0;
  }
  useSkill(game) {
    if (this.skillUsed || this.state !== 'flying') return false;
    this.skillUsed = true;
    const k = this.def.skillKey;
    Sfx.skill(k === 'blast' ? 'dash' : k);
    if (k === 'dash') {
      const s = Math.max(len(this.vx, this.vy), 320);
      const a = Math.atan2(this.vy, this.vx);
      this.vx = Math.cos(a) * s * 2.35; this.vy = Math.sin(a) * s * 2.35;
      this.power = 2.0;
      game.fx.burst(this.x, this.y, { count: 18, color: '#ffe066', type: 'spark', spMax: 520, grav: 200 });
      game.fx.addShake(6);
    } else if (k === 'blast') {
      const s = Math.max(len(this.vx, this.vy), 340);
      const a = Math.atan2(this.vy, this.vx);
      this.vx = Math.cos(a) * s * 1.65; this.vy = Math.sin(a) * s * 1.65;
      this.armedBlast = true;
      game.fx.burst(this.x, this.y, { count: 20, color: '#ff8a3d', type: 'fire', spMax: 420, grav: 100 });
      game.fx.addShake(5);
    } else if (k === 'bomb') {
      this.fuse = 0.5;
    } else if (k === 'split') {
      const s = len(this.vx, this.vy) || 600;
      const a = Math.atan2(this.vy, this.vx);
      for (const off of [-0.16, 0.16]) {
        const c = new Bird('blue', this.x, this.y);
        c.isClone = true;
        const cvx = Math.cos(a + off) * s * 1.06, cvy = Math.sin(a + off) * s * 1.06;
        c.launch(cvx, cvy);
        c.skillUsed = true;
        game.attachBird(c, cvx, cvy);
        game.birds.push(c);
      }
      const a0 = a;
      this.vx = Math.cos(a0) * s * 1.06; this.vy = Math.sin(a0) * s * 1.06;
      game.fx.burst(this.x, this.y, { count: 14, color: '#9fe0ff', type: 'dot', spMax: 300 });
    } else if (k === 'boomerang') {
      // 回旋绿：原路折返，并向上抬一点以免立刻砸地
      const s = Math.max(len(this.vx, this.vy), 460);
      const a = Math.atan2(this.vy, this.vx);
      this.vx = -Math.cos(a) * s * 1.3;
      this.vy = -Math.abs(Math.sin(a)) * s * 0.45 - 280;
      this.power = 1.15;
      game.fx.burst(this.x, this.y, { count: 18, color: '#9bf09b', type: 'spark', spMax: 480, grav: 120 });
      game.fx.addShake(4);
    } else if (k === 'gravity') {
      // 引力紫：在当前位置制造一个持续吸扯的引力奇点
      game.spawnWell(this.x, this.y, 1.25);
      game.fx.burst(this.x, this.y, { count: 26, color: '#c8a2ff', type: 'dot', spMax: 320, grav: 0 });
      game.fx.addShake(7);
    } else if (k === 'inflate') {
      // 爆胀橙：体型膨胀近一倍，半径 / 质量 / 冲力同步提升
      this.r = this.def.r * 1.9;
      if (this.body) { this.body.r = this.r; this.body.mass = this.def.mass * 2.6; this.body.wake(); }
      this.power = 1.55;
      game.fx.burst(this.x, this.y, { count: 24, color: '#ffb454', type: 'spark', spMax: 430, grav: 140 });
      game.fx.addShake(6);
    } else if (k === 'eggdrop') {
      // 空投白：向下投出一枚炸弹，落地/命中即爆
      game.dropEgg(this.x, this.y);
      game.fx.burst(this.x, this.y, { count: 12, color: '#ffffff', type: 'dot', spMax: 240 });
    } else if (k === 'titan') {
      // 泰坦：手动点击立即引爆（被动撞击 / 超时也会自动引爆），
      // 走毁灭冲击而非普通爆炸，保证"救援即通关"
      game.titanBlast(this);
      return true;
    }
    game.syncBird(this);
    return true;
  }
  damage(game, amount, srcNx, srcNy) { /* 小鸟不会受伤 */ }
}

/* ---------------- 猪 ---------------- */
const PIG_TYPES = {
  small: { r: 19, hp: 150, scale: 0.78 },
  normal: { r: 26, hp: 240, scale: 1 },
  helmet: { r: 28, hp: 520, scale: 1.06, helmet: true },
  king: { r: 46, hp: 800, scale: 1.75, crown: true }
};

class Pig {
  constructor(type, x, y, balloon) {
    const d = PIG_TYPES[type];
    this.type = type; this.def = d;
    this.r = d.r; this.maxHp = d.hp; this.hp = d.hp;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.body = null;
    this.dead = false;
    this.balloon = !!balloon;
    this.balloonHp = balloon ? 60 : 0;
    this.balloonOffset = 0;
    this.blink = rand(1.5, 5);
    this.hurtFlash = 0;
    this.rot = 0; this.angVel = 0;
    this.squash = 0;
    this.score = { small: 3000, normal: 5000, helmet: 7000, king: 12000 }[type];
  }
  get scale() { return this.def.scale; }
  hurt(game, amount) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtFlash = 0.22;
    this.squash = 0.45;
    if (this.hp <= 0) { this.hp = 0; this.die(game); }
    else Sfx.pigHurt();
  }
  popBalloon(game) {
    this.balloon = false;
    if (this.body) this.body.gravityScale = 1;
    game.fx.burst(this.x, this.y - this.r - 40, { count: 14, color: '#ff6b9d', type: 'dot', spMax: 340 });
    Sfx.pop();
  }
  die(game) {
    if (this.dead) return;
    this.dead = true;
    Sfx.pigPop();
    game.addScore(this.score, this.x, this.y);
    game.fx.feathers(this.x, this.y, pick(['#8bd45c', '#6fbf46', '#a8e06f']), 6);
    game.fx.burst(this.x, this.y, { count: 22, color: '#9ade62', type: 'dot', spMax: 380, size: 8 });
    game.fx.burst(this.x, this.y, { count: 8, color: '#ffffff', type: 'smoke', spMax: 140, size: 20 });
    game.fx.addShake(7);
    game.fx.freeze(0.035);
    if (this.body) { this.body.removed = true; this.body = null; }
  }
}

/* ---------------- 砖块 ---------------- */
const MATERIALS = {
  wood: { hpPerArea: 0.062, restitution: 0.16, friction: 0.62, density: 0.9, score: 500 },
  stone: { hpPerArea: 0.19, restitution: 0.1, friction: 0.7, density: 2.2, score: 700 },
  ice: { hpPerArea: 0.034, restitution: 0.3, friction: 0.24, density: 0.75, score: 400 },
  glass: { hpPerArea: 0.026, restitution: 0.36, friction: 0.3, density: 0.6, score: 450 },
  tnt: { hpPerArea: 0.03, restitution: 0.14, friction: 0.6, density: 1.0, score: 1500 }
};

class Block {
  constructor(material, x, y, w, h, opts = {}) {
    this.material = material;
    this.def = MATERIALS[material];
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.angle = opts.angle || 0; this.angVel = 0;
    this.maxHp = w * h * this.def.hpPerArea * (opts.hpMul || 1);
    this.hp = this.maxHp;
    this.dead = false;
    this.static = !!opts.static;
    this.body = null;
    this.flash = 0;
    this.crackSeed = Math.random() * 1000;
    this.score = this.def.score;
  }
  hurt(game, amount, nx, ny) {
    if (this.dead) return;
    this.hp -= amount;
    this.flash = 0.18;
    if (this.material === 'tnt' && this.hp < this.maxHp) { this.explode(game); return; }
    if (this.hp <= 0) this.shatter(game);
  }
  shatter(game) {
    if (this.dead) return;
    this.dead = true;
    game.addScore(this.score, this.x, this.y);
    game.fx.debris(this.x, this.y, this.material, Math.min(16, 5 + Math.floor(this.w * this.h / 900)));
    game.fx.dust(this.x, this.y + this.h / 2, 4);
    if (this.material === 'wood') Sfx.breakWood();
    else if (this.material === 'stone') Sfx.breakStone();
    else Sfx.breakIce();
    if (this.body) { this.body.removed = true; this.body = null; }
  }
  explode(game) {
    if (this.dead) return;
    this.dead = true;
    game.addScore(this.score, this.x, this.y);
    const R = 190;
    game.fx.explosion(this.x, this.y, R);
    Sfx.explode();
    game.explodeAt(this.x, this.y, R, 620);
    if (this.body) { this.body.removed = true; this.body = null; }
  }
}

/* ---------------- 弹簧板 ---------------- */
class Spring {
  constructor(x, y, dir = 'up', w = 84) {
    this.x = x; this.y = y; this.dir = dir; this.w = w; this.h = 20;
    this.compress = 0;
    this.power = 1320;
    this.body = null;
  }
  get nx() { return this.dir === 'up' ? 0 : (this.dir === 'left' ? 1 : -1); }
  get ny() { return this.dir === 'up' ? -1 : 0; }
  bounce(other, game) {
    this.compress = 1;
    Sfx.spring();
    game.fx.burst(this.x, this.y + (this.dir === 'up' ? -10 : 0), { count: 10, color: '#ffe066', type: 'spark', spMax: 300 });
    const p = this.power;
    other.vx = this.nx * p + (this.dir === 'up' ? other.vx * 0.35 : 0);
    other.vy = this.ny * p + (this.dir === 'up' ? 0 : other.vy * 0.3);
    other.wake && other.wake();
  }
}

/* ---------------- 传送门 ---------------- */
class Portal {
  constructor(ax, ay, aAng, bx, by, bAng) {
    this.A = { x: ax, y: ay, ang: aAng };
    this.B = { x: bx, y: by, ang: bAng };
    this.r = 42;
    this.spin = 0;
    this.cool = { A: 0, B: 0 };
  }
  tryTeleport(bird, game) {
    const test = (from, to, key) => {
      if (this.cool[key] > 0) return false;
      if (dist2(bird.x, bird.y, from.x, from.y) > this.r * this.r) return false;
      const va = Math.atan2(bird.vy, bird.vx);
      const sp = len(bird.vx, bird.vy);
      const delta = (to.ang) - (from.ang + Math.PI);
      const na = va + delta;
      bird.x = to.x + Math.cos(to.ang) * (this.r * 0.55);
      bird.y = to.y + Math.sin(to.ang) * (this.r * 0.55);
      bird.vx = Math.cos(na) * sp * 1.02; bird.vy = Math.sin(na) * sp * 1.02;
      this.cool.A = 0.26; this.cool.B = 0.26;
      Sfx.portal();
      game.fx.burst(from.x, from.y, { count: 16, color: '#7ad7ff', type: 'dot', spMax: 260, grav: 0 });
      game.fx.burst(to.x, to.y, { count: 16, color: '#ffb570', type: 'dot', spMax: 260, grav: 0 });
      return true;
    };
    return test(this.A, this.B, 'A') || test(this.B, this.A, 'B');
  }
}

/* ---------------- 气流风扇 ---------------- */
class Fan {
  constructor(x, y, w, h, dir, force = 1400) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.dir = dir;                 // 'up' | 'right' | 'left'
    this.force = force;
    this.t = 0;
  }
  contains(p) {
    return Math.abs(p.x - this.x) < this.w / 2 && Math.abs(p.y - this.y) < this.h / 2;
  }
  apply(p, dt) {
    if (this.dir === 'up') { p.vy -= this.force * dt; p.vx += Math.sin(this.t * 3 + p.y * 0.01) * 60 * dt; }
    else if (this.dir === 'right') p.vx += this.force * dt;
    else p.vx -= this.force * dt;
  }
}
