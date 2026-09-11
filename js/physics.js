/* ============================================================
 * physics.js — 轻量 2D 刚体物理（圆 / 轴对齐矩形）
 * 固定时间步 + 冲量法碰撞 + 休眠机制
 * ============================================================ */
'use strict';

let _bodyId = 0;

class Body {
  constructor(o) {
    this.id = ++_bodyId;
    this.x = o.x; this.y = o.y;
    this.vx = o.vx || 0; this.vy = o.vy || 0;
    this.isCircle = !!o.isCircle;
    this.r = o.r || 0;
    this.w = o.w || 0; this.h = o.h || 0;
    this.static = !!o.static;
    this.mass = this.static ? Infinity : (o.mass || 1);
    this.invMass = this.static ? 0 : 1 / this.mass;
    this.restitution = o.restitution === undefined ? 0.28 : o.restitution;
    this.friction = o.friction === undefined ? 0.55 : o.friction;
    this.angle = 0; this.angVel = 0;
    this.sleeping = false; this.sleepTimer = 0;
    this.removed = false;
    this.gravityScale = o.gravityScale === undefined ? 1 : o.gravityScale;
    this.windScale = o.windScale === undefined ? 0 : o.windScale;
    this.tag = o.tag || 'body';
    this.owner = o.owner || null;   // 反向引用游戏实体
    this.grounded = false;
    this.collide = true;
  }
  get hw() { return this.w / 2; }
  get hh() { return this.h / 2; }
  get speed() { return len(this.vx, this.vy); }
  wake() { if (!this.static) { this.sleeping = false; this.sleepTimer = 0; } }
  applyImpulse(ix, iy) {
    if (this.static) return;
    this.vx += ix * this.invMass; this.vy += iy * this.invMass;
    this.wake();
  }
}

class World {
  constructor() {
    this.bodies = [];
    this.gravity = GRAVITY;
    this.wind = 0;
    this.onImpact = null;      // (a, b, nx, ny, impact, px, py)
    this.iterations = 5;
    this.sleepLinear = 16;
    this.impactMap = new Map();  // 每步的碰撞事件（按 body 对去重，保留最大冲量）
    this.impactEvents = [];
  }
  add(b) { this.bodies.push(b); return b; }
  remove(b) { b.removed = true; }
  flush() { this.bodies = this.bodies.filter(b => !b.removed); }
  clear() { this.bodies.length = 0; }

  get awakeCount() {
    let n = 0;
    for (const b of this.bodies) if (!b.static && !b.sleeping && !b.removed) n++;
    return n;
  }

  step(dt) {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.removed || b.static || b.sleeping) continue;
      b.vy += g * b.gravityScale * dt;
      b.vx += this.wind * b.windScale * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.angVel) { b.angle += b.angVel * dt; b.angVel *= Math.exp(-1.4 * dt); }
    }

    for (let it = 0; it < this.iterations; it++) {
      const last = it === this.iterations - 1;
      this.solveGround(last);
      for (let i = 0; i < this.bodies.length; i++) {
        const a = this.bodies[i];
        if (a.removed) continue;
        for (let j = i + 1; j < this.bodies.length; j++) {
          const b = this.bodies[j];
          if (b.removed) continue;
          if (a.static && b.static) continue;
          if (!a.collide || !b.collide) continue;
          this.solvePair(a, b, last);
        }
      }
    }

    // 统一上报碰撞事件（冲量在首次迭代即已施加，故在此统一回调一次）
    if (this.onImpact) {
      for (const ev of this.impactMap.values()) {
        if (ev.impact > 55) this.onImpact(ev.a, ev.b, ev.nx, ev.ny, ev.impact, ev.px, ev.py);
      }
    }
    this.impactMap.clear();

    // 休眠判定
    for (const b of this.bodies) {
      if (b.removed || b.static) continue;
      if (b.speed < this.sleepLinear && Math.abs(b.angVel) < 0.6) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.32) { b.sleeping = true; b.vx = 0; b.vy = 0; b.angVel = 0; b.angle = lerp(b.angle, 0, 0.35); }
      } else b.sleepTimer = 0;
    }
  }

  solveGround(last) {
    for (const b of this.bodies) {
      if (b.removed || b.static) continue;
      const bottom = b.isCircle ? b.y + b.r : b.y + b.hh;
      if (bottom > GROUND_Y) {
        const pen = bottom - GROUND_Y;
        b.y -= pen;
        const vn = b.vy;
        if (vn > 0) {
          const impact = Math.abs(vn);
          if (-vn * b.restitution < 40) { b.vy = 0; b.grounded = true; }
          else b.vy = -vn * b.restitution;
          b.vx *= Math.exp(-b.friction * 3.2 * 0.016);
          b.angVel *= 0.7;
          if (last && impact > 60 && this.onImpact) {
            this.onImpact(b, null, 0, -1, impact, b.x, GROUND_Y);
          }
        }
        b.grounded = true;
        if (Math.abs(b.vx) < 12) b.vx *= 0.9;
      } else b.grounded = false;
    }
  }

  solvePair(a, b, last) {
    if (a.isCircle && b.isCircle) return this.circleCircle(a, b, last);
    if (a.isCircle || b.isCircle) {
      const c = a.isCircle ? a : b;
      const box = a.isCircle ? b : a;
      return this.circleBox(c, box, last);
    }
    return this.boxBox(a, b, last);
  }

  applyImpulsePair(a, b, nx, ny, pen, last, px, py) {
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    const invSum = a.invMass + b.invMass;
    if (invSum === 0) return;

    // 位置分离
    const corr = Math.min(pen, 12) / invSum * 0.85;
    a.x -= nx * corr * a.invMass; a.y -= ny * corr * a.invMass;
    b.x += nx * corr * b.invMass; b.y += ny * corr * b.invMass;

    let impact = 0;
    if (vn < 0) {
      impact = -vn;
      // 记录本步碰撞事件（去重，保留最大冲量）
      const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      const prev = this.impactMap.get(key);
      if (!prev || impact > prev.impact) {
        this.impactMap.set(key, { a, b, nx, ny, impact, px, py });
      }
      const e = Math.min(a.restitution, b.restitution);
      const j = -(1 + e) * vn / invSum;
      a.vx -= j * nx * a.invMass; a.vy -= j * ny * a.invMass;
      b.vx += j * nx * b.invMass; b.vy += j * ny * b.invMass;

      // 摩擦
      const tx = -ny, ty = nx;
      const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
      const mu = Math.sqrt(a.friction * b.friction);
      let jt = -vt / invSum;
      jt = clamp(jt, -j * mu, j * mu);
      a.vx -= jt * tx * a.invMass; a.vy -= jt * ty * a.invMass;
      b.vx += jt * tx * b.invMass; b.vy += jt * ty * b.invMass;

      if (impact > 55) { a.wake(); b.wake(); }
    }
  }

  circleCircle(a, b, last) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    this.applyImpulsePair(a, b, nx, ny, rr - d, last, a.x + nx * a.r, a.y + ny * a.r);
  }

  circleBox(c, box, last) {
    const hx = box.hw, hy = box.hh;
    const cx = clamp(c.x, box.x - hx, box.x + hx);
    const cy = clamp(c.y, box.y - hy, box.y + hy);
    let dx = c.x - cx, dy = c.y - cy;
    let d2 = dx * dx + dy * dy;
    if (d2 > c.r * c.r) return;

    let nx, ny, pen;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      nx = dx / d; ny = dy / d; pen = c.r - d;
    } else {
      // 圆心在矩形内部：沿最小穿透轴弹出
      const ox = hx - Math.abs(c.x - box.x);
      const oy = hy - Math.abs(c.y - box.y);
      if (ox < oy) { nx = Math.sign(c.x - box.x) || 1; ny = 0; pen = ox + c.r; }
      else { nx = 0; ny = Math.sign(c.y - box.y) || 1; pen = oy + c.r; }
    }
    // 法线须由 a(box) 指向 b(circle)
    this.applyImpulsePair(box, c, nx, ny, pen, last, cx, cy);
  }

  boxBox(a, b, last) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ox = a.hw + b.hw - Math.abs(dx);
    if (ox <= 0) return;
    const oy = a.hh + b.hh - Math.abs(dy);
    if (oy <= 0) return;
    let nx = 0, ny = 0, pen;
    if (ox < oy) { nx = Math.sign(dx) || 1; pen = ox; }
    else { ny = Math.sign(dy) || 1; pen = oy; }
    this.applyImpulsePair(a, b, nx, ny, pen, last, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  /** 圆形范围爆炸：返回受影响的 body 及距离 */
  queryCircle(x, y, r) {
    const out = [];
    for (const b of this.bodies) {
      if (b.removed) continue;
      const cx = clamp(x, b.isCircle ? b.x - b.r : b.x - b.hw, b.isCircle ? b.x + b.r : b.x + b.hw);
      const cy = clamp(y, b.isCircle ? b.y - b.r : b.y - b.hh, b.isCircle ? b.y + b.r : b.y + b.hh);
      const d = len(x - cx, y - cy);
      if (d <= r) out.push({ body: b, dist: Math.max(0, d), nx: (b.x - x) || rand(-1, 1), ny: (b.y - y) });
    }
    return out;
  }
}
