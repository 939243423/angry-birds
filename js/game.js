/* ============================================================
 * game.js — 主循环 / 状态机 / 关卡逻辑 / 输入
 * ============================================================ */
'use strict';

const WORLD_W = 1800;

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.particles = new ParticleSystem();
    this.fx = new Fx(this.particles);
    this.world = new World();
    this.world.onImpact = (a, b, nx, ny, imp, px, py) => this.onImpact(a, b, nx, ny, imp, px, py);

    this.mode = 'menu';          // menu | birds | egg
    this.phase = 'aim';
    this.paused = false;
    this.time = 0;
    this.acc = 0;

    this.blocks = []; this.pigs = []; this.birds = [];
    this.springs = []; this.portals = []; this.fans = [];
    this.pendingBooms = [];
    this.wells = [];             // 引力奇点（引力紫技能）
    this.drops = [];             // 空投炸弹（空投白技能）
    this.birdQueue = [];
    this.currentBird = null;
    this.prevPath = [];
    this.level = null;
    this.score = 0;
    this.camX = 0; this.camZoom = 1;
    this.settleTimer = 0;
    this.endTimer = 0;
    this.rescueUsed = false;     // 每关一次的救援巨鸟
    this.combo = 0; this.comboTimer = 0;
    this.drag = { active: false, id: null };
    this.pointer = { x: 0, y: 0 };
    this.aimPoints = [];
    this.aimHit = null;
    this.resultShown = false;
    this.launchCount = 0;
    this.egg = new EggGame(this);

    this.bindInput();
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
  }

  /* ---------------- 输入 ---------------- */
  bindInput() {
    const cv = this.canvas;
    const toWorld = (e) => {
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * VW;
      const py = (e.clientY - r.top) / r.height * VH;
      return { x: px + this.camX - (this.camX) * 0 + (this.camX ? 0 : 0), y: py };
    };
    this.toWorld = (e) => {
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * VW;
      const py = (e.clientY - r.top) / r.height * VH;
      // 反算相机：worldX = camX + (screenX - VW/2)/zoom + VW/2
      return { x: this.camX + (px - VW / 2) / this.camZoom + VW / 2, y: (py - VH / 2) / this.camZoom + VH / 2 };
    };
    const down = (e) => {
      Sfx.init(); Sfx.resume();
      const p = this.toWorld(e);
      this.pointer = p;
      this.downPos = p;
      if (this.mode === 'egg') { this.egg.onDown(p.x, p.y); return; }
      if (this.mode !== 'birds' || this.paused) return;
      if (this.phase === 'fly' && this.currentBird && this.currentBird.state === 'flying') {
        this.pendingSkill = true;
        return;
      }
      if (this.phase === 'aim' && this.currentBird) {
        const b = this.currentBird;
        if (dist2(p.x, p.y, b.x, b.y) < 200 * 200 || dist2(p.x, p.y, SLING.x, SLING.y) < 170 * 170) {
          this.drag.active = true; this.drag.id = e.pointerId;
          b.dragging = true;
          Sfx.stretch();
        }
      }
    };
    const move = (e) => {
      const p = this.toWorld(e);
      this.pointer = p;
      if (this.mode === 'egg') { this.egg.onMove(p.x, p.y); return; }
      if (this.drag.active && this.currentBird) {
        const b = this.currentBird;
        let dx = p.x - SLING.x, dy = p.y - SLING.y;
        const d = len(dx, dy);
        if (d > MAX_STRETCH) { dx = dx / d * MAX_STRETCH; dy = dy / d * MAX_STRETCH; }
        b.x = SLING.x + dx; b.y = SLING.y + dy;
        // 注意：这里必须传"发射速度"（拉杆位移 × SLING_POWER）。
        // 曾经误传了拉杆位移本身，模拟初速只有 ~98px/s，被重力瞬间拽下去，
        // 画出来的是一条直插地面的短线而不是抛物线。
        const v = this.pullToVelocity(dx, dy);
        this.updateAimPreview(v.vx, v.vy);
      }
    };
    const up = (e) => {
      const p = this.toWorld(e);
      if (this.mode === 'egg') { this.egg.onUp(p.x, p.y); return; }
      if (this.pendingSkill) {
        this.pendingSkill = false;
        if (this.currentBird && this.currentBird.state === 'flying') this.currentBird.useSkill(this);
      }
      if (this.drag.active && this.currentBird) {
        const b = this.currentBird;
        const pullX = b.x - SLING.x, pullY = b.y - SLING.y;
        const d = len(pullX, pullY);
        this.drag.active = false; b.dragging = false;
        if (d > 16) {
          const v = this.pullToVelocity(pullX, pullY);
          this.launch(b, v.vx, v.vy);
        } else {
          b.x = SLING.x; b.y = SLING.y - 14;
          this.aimPoints.length = 0;
        }
      }
      this.downPos = null;
    };
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.mode === 'birds' && this.currentBird && this.currentBird.state === 'flying') this.currentBird.useSkill(this);
        if (this.mode === 'egg') this.egg.onKey(e.code);
      }
      if (e.code === 'Escape') { if (this.mode === 'birds') this.togglePause(); }
    });
  }

  /* ---------------- 关卡 ---------------- */
  loadLevel(index) {
    const def = buildLevel(index);
    this.level = def;
    this.levelIndex = index;
    this.mode = 'birds';
    this.paused = false;
    this.renderer.setTheme(def.decor);
    this.world.clear();
    this.particles.clear();
    this.blocks = []; this.pigs = []; this.birds = [];
    this.springs = []; this.portals = []; this.fans = [];
    this.pendingBooms = [];
    this.wells = [];
    this.drops = [];
    this.prevPath = [];
    this.score = 0;
    this.combo = 0;
    this.launchCount = 0;
    this.rescueUsed = false;
    this.resultShown = false;
    this.world.wind = def.wind || 0;
    this.fx.shake = 0; this.fx.flash = 0; this.fx.timeScale = 1;

    for (const b of def.blocks) this.addBlock(b);
    for (const p of def.pigs) this.addPig(p);
    for (const s of def.springs) this.addSpring(s[0], s[1], s[2]);
    for (const p of def.portals) this.portals.push(new Portal(p[0], p[1], p[2], p[3], p[4], p[5]));
    for (const f of def.fans) this.fans.push(new Fan(f[0], f[1], f[2], f[3], f[4], f[5]));

    this.birdQueue = def.birds.slice();
    this.phase = 'aim';
    this.nextBird();
    this.camX = 0; this.camZoom = 1;
    this.emitState();
  }

  addBlock(def) {
    const b = new Block(def.mat, def.x, def.y, def.w, def.h, { static: def.static });
    const m = MATERIALS[def.mat];
    const body = new Body({
      x: b.x, y: b.y, w: b.w, h: b.h, static: b.static,
      mass: Math.max(0.35, b.w * b.h / 1000 * m.density),
      restitution: m.restitution, friction: m.friction, tag: 'block'
    });
    body.owner = b; b.body = body;
    this.world.add(body);
    this.blocks.push(b);
    return b;
  }
  addPig(def) {
    const p = new Pig(def.type, def.x, def.y, def.balloon);
    const body = new Body({
      x: p.x, y: p.y, r: p.r, isCircle: true,
      mass: Math.max(0.4, p.r * p.r / 700),
      restitution: 0.24, friction: 0.6, tag: 'pig'
    });
    body.owner = p; p.body = body;
    if (p.balloon) { body.gravityScale = 0; body.vy = 0; p.homeY = p.y; }
    this.world.add(body);
    this.pigs.push(p);
    return p;
  }
  addSpring(x, y, dir) {
    const s = new Spring(x, y, dir);
    const body = new Body({
      x, y: dir === 'up' ? y + 6 : y, w: dir === 'up' ? s.w : 20, h: dir === 'up' ? 20 : s.w,
      static: true, restitution: 0.2, friction: 0.4, tag: 'spring'
    });
    body.owner = s; s.body = body;
    this.world.add(body);
    this.springs.push(s);
    return s;
  }

  nextBird() {
    if (!this.birdQueue.length) { this.currentBird = null; return; }
    const type = this.birdQueue.shift();
    const b = new Bird(type, SLING.x, SLING.y - 14);
    this.birds.push(b);
    this.currentBird = b;
    this.phase = 'aim';
    this.emitState();
  }

  /** 为小鸟挂接物理刚体 */
  attachBird(bird, vx, vy) {
    const body = new Body({
      x: bird.x, y: bird.y, vx, vy, r: bird.r, isCircle: true,
      mass: bird.def.mass, restitution: bird.def.restitution, friction: 0.5,
      tag: 'bird', windScale: 0.42
    });
    body.owner = bird; bird.body = body;
    this.world.add(body);
    return body;
  }
  /** 把实体速度写回刚体（技能改变速度后调用） */
  syncBird(bird) {
    if (!bird.body || bird.body.removed) return;
    bird.body.vx = bird.vx; bird.body.vy = bird.vy;
    bird.body.wake();
  }

  launch(bird, vx, vy) {
    bird.launch(vx, vy);
    this.attachBird(bird, vx, vy);
    this.phase = 'fly';
    this.settleTimer = 0;
    this.launchCount++;
    this.prevPath = [];
    this.aimPoints = [];
    this.aimHit = null;
    this.hasSkillHintShown = false;
    Sfx.launch(); Sfx.whistle();
    this.fx.dust(SLING.x, GROUND_Y, 5);
    this.emitState();
  }

  /* ---------------- 碰撞 ---------------- */
  onImpact(a, b, nx, ny, impact, px, py) {
    if (impact < 85) return;
    // 泰坦巨鸟：任何有效撞击都立即引发毁灭爆炸（救援保底，确保能清场）
    for (const o of [a, b]) {
      if (o && o.tag === 'bird' && o.owner && o.owner.def.skillKey === 'titan' && !o.owner.dead) {
        this.titanBlast(o.owner);
        return;
      }
    }
    // 弹簧
    for (const [x, y] of [[a, b], [b, a]]) {
      if (x && x.tag === 'spring' && y && y !== x) {
        x.owner.bounce(y, this);
        return;
      }
    }
    // 撞地面：猪会摔伤（经典机制），砖块重摔受损，红鸟引爆炸裂
    if (!b && a && a.owner) {
      const own = a.owner;
      if (a.tag === 'pig') { own.hurt(this, impact * 0.55); this.fx.dust(own.x, GROUND_Y, 4); }
      else if (a.tag === 'block' && impact > 320) own.hurt(this, impact * 0.14);
      else if (a.tag === 'bird' && own.armedBlast) { this.boom(own); own.armedBlast = false; }
      return;
    }
    if (!a || !b || !a.owner || !b.owner) return;

    const isBird = (o) => o && o.tag === 'bird';
    const isPig = (o) => o && o.tag === 'pig';
    const isBlock = (o) => o && o.tag === 'block';
    const dmgBird = o => o.owner ? o.owner.def.power * (o.owner.power || 1) : 1;

    for (const [src, dst] of [[a, b], [b, a]]) {
      const S = src.owner, D = dst.owner;
      if (!S || !D) continue;
      if (isBird(src) && isBlock(dst)) {
        const dmg = impact * 0.34 * dmgBird(src);
        D.hurt(this, dmg);
        if (src.owner.armedBlast) { this.boom(src.owner); src.owner.armedBlast = false; }
        Sfx[dst.owner.material === 'stone' ? 'hitStone' : (dst.owner.material === 'ice' || dst.owner.material === 'glass' ? 'hitIce' : 'hitWood')](clamp(impact / 700, .4, 1.4));
        this.fx.addShake(clamp(impact / 130, 1, 9) * (src.owner && src.owner.power === 2 ? 1.6 : 1));
      } else if (isBird(src) && isPig(dst)) {
        const dmg = impact * 0.52 * dmgBird(src);
        D.hurt(this, dmg);
        if (src.owner.armedBlast) { this.boom(src.owner); src.owner.armedBlast = false; }
        this.fx.addShake(clamp(impact / 110, 2, 12));
        this.fx.freeze(0.03);
      } else if (isBlock(src) && isPig(dst)) {
        const dmg = impact * 0.26 * clamp(src.mass / 2, 0.5, 2.4);
        if (impact > 200) D.hurt(this, dmg);
      } else if (isBlock(src) && isBlock(dst)) {
        const dmg = impact * 0.05;
        if (impact > 260) { D.hurt(this, dmg); }
      } else if (isPig(src) && isPig(dst)) {
        if (impact > 320) D.hurt(this, impact * 0.2);
      }
    }
  }

  boom(bird) {
    const x = bird.x, y = bird.y;
    bird.dead = true;
    if (bird.body) { bird.body.removed = true; bird.body = null; }
    this.fx.explosion(x, y, 165);
    Sfx.explode();
    this.explodeAt(x, y, 175, 520);
    this.fx.feathers(x, y, bird.def.body, 8);
  }

  /** 泰坦巨鸟的毁灭冲击：超大范围 + 高伤害，作为"一定打得过"的保底手段 */
  titanBlast(bird) {
    if (bird.dead) return;
    const x = bird.x, y = bird.y;
    bird.dead = true;
    if (bird.body) { bird.body.removed = true; bird.body = null; }
    this.fx.explosion(x, y, 430);
    this.fx.flash = Math.max(this.fx.flash || 0, 0.6);
    Sfx.explode();
    this.fx.addShake(20);
    this.fx.freeze(0.07);
    this.explodeAt(x, y, 430, 3400);
    this.fx.feathers(x, y, bird.def.body, 16);
    // 全场余波：主爆炸范围外的猪也吃一发震击（900 足以秒掉含猪王在内的所有猪），
    // 避免出现"已经救援了、却还差一只猪没清掉"的尴尬
    for (const p of this.pigs) {
      if (p.dead) continue;
      if (len(p.x - x, p.y - y) <= 430) continue;
      p.hurt(this, 900);
    }
    // 二次冲击波：把爆炸边缘的残余也一并震掉
    this.pendingBooms.push({ x: x + 70, y: y + 30, t: 0.2 });
    this.pendingBooms.push({ x: x - 70, y: y - 10, t: 0.34 });
    this.pendingBooms.push({ x: x + 10, y: y - 80, t: 0.46 });
  }

  /** 空投白投下的炸弹：自由落体，碰到猪 / 砖块 / 地面即爆 */
  dropEgg(x, y) {
    this.drops.push({ x: x + 8, y: y + 14, vx: 0, vy: 140, r: 13, t: 0 });
    Sfx.pop();
  }

  explodeAt(x, y, radius, damage) {
    for (const b of this.blocks) {
      if (b.dead) continue;
      const d = len(b.x - x, b.y - y) - Math.max(b.w, b.h) * 0.35;
      if (d > radius) continue;
      const f = 1 - clamp(d / radius, 0, 1);
      const ang = Math.atan2(b.y - y, b.x - x);
      if (b.body) {
        b.body.applyImpulse(Math.cos(ang) * 900 * f * b.body.mass, Math.sin(ang) * 900 * f * b.body.mass - 260 * f * b.body.mass);
      }
      b.hurt(this, damage * f);
      if (b.material === 'tnt' && !b.dead) this.pendingBooms.push({ x: b.x, y: b.y, t: 0.14 });
    }
    for (const p of this.pigs) {
      if (p.dead) continue;
      const d = len(p.x - x, p.y - y) - p.r;
      if (d > radius) continue;
      const f = 1 - clamp(d / radius, 0, 1);
      const ang = Math.atan2(p.y - y, p.x - x);
      if (p.body) p.body.applyImpulse(Math.cos(ang) * 700 * f * p.body.mass, Math.sin(ang) * 700 * f * p.body.mass - 200 * f * p.body.mass);
      p.hurt(this, damage * f * 1.15);
    }
  }

  addScore(v, x, y) {
    this.combo++;
    this.comboTimer = 1.6;
    const mult = 1 + Math.min(this.combo - 1, 6) * 0.16;
    const add = Math.round(v * mult);
    this.score += add;
    if (x !== undefined) {
      this.fx.scoreText(x, y - 10, '+' + add, this.combo > 1 ? '#ffd93d' : '#fff3c4', this.combo > 1 ? 38 : 32);
      if (this.combo > 1) this.fx.scoreText(x, y - 48, `连击 x${this.combo}`, '#ff9f1c', 24);
    }
    this.emitScore();
  }

  /* ---------------- 主更新 ---------------- */
  update(rdt) {
    this.fx.update(rdt);
    this.renderer.updateAmbient(rdt);
    if (this.mode === 'egg') { this.egg.update(rdt); this.egg.render(this.renderer.ctx); return; }
    if (this.mode === 'menu') {
      this.time += rdt;
      this.particles.update(rdt, 0);
      if (this.level) this.renderScene(rdt);
      return;
    }
    if (this.paused) { this.renderScene(0); return; }

    const dt = rdt * this.fx.timeScale;
    this.time += dt;
    if (this.comboTimer > 0) { this.comboTimer -= rdt; if (this.comboTimer <= 0) this.combo = 0; }

    // 固定步长物理
    this.acc += dt;
    let steps = 0;
    const FIXED = 1 / 120;
    while (this.acc >= FIXED && steps < 6) {
      this.stepPhysics(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    this.particles.update(dt, this.world.wind * 0.5);
    this.updateGameplay(dt, rdt);
    this.renderScene(dt);
  }

  /** 制造一个引力奇点（引力紫的技能） */
  spawnWell(x, y, life = 1.2, power = 1500) {
    this.wells.push({ x, y, r: 280, life, maxLife: life, power });
  }

  stepPhysics(dt) {
    // 同步外部力
    for (const b of this.blocks) {
      if (b.body && !b.body.removed) {
        for (const f of this.fans) if (f.contains(b.body)) f.apply(b.body, dt);
      }
    }
    for (const bd of this.birds) {
      if (bd.body && !bd.body.removed) {
        // 轻微空气阻力（过大会显著缩短射程）
        bd.body.vx *= Math.exp(-0.1 * dt);
        bd.body.vy *= Math.exp(-0.03 * dt);
        for (const f of this.fans) if (f.contains(bd)) f.apply(bd.body, dt);
      }
    }
    // 引力奇点：把范围内刚体持续拉向中心
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.life -= dt;
      if (w.life <= 0) { this.wells.splice(i, 1); continue; }
      const fade = clamp(w.life / w.maxLife * 1.5, 0, 1);
      for (const bd of this.world.bodies) {
        if (bd.static || bd.removed) continue;
        const dx = w.x - bd.x, dy = w.y - bd.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > w.r * w.r || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const pull = w.power * fade * (1 - d / w.r) * dt;
        bd.vx += (dx / d) * pull;
        bd.vy += (dy / d) * pull;
        if (bd.wake) bd.wake();
      }
    }

    this.world.step(dt);
    // 回写
    for (const b of this.blocks) {
      if (!b.body || b.body.removed) continue;
      b.x = b.body.x; b.y = b.body.y; b.vx = b.body.vx; b.vy = b.body.vy;
      if (b.body.sleeping) { b.angle = lerp(b.angle, 0, 0.2); }
      else if (b.vx || b.vy) { b.angle += (b.body.angVel || 0) * dt; }
      b.flash = Math.max(0, b.flash - dt * 4);
    }
    for (const p of this.pigs) {
      if (!p.body || p.body.removed) continue;
      p.x = p.body.x; p.y = p.body.y; p.vx = p.body.vx; p.vy = p.body.vy;
      p.rot += p.body.angVel * dt * 0.02;
      p.hurtFlash = Math.max(0, p.hurtFlash - dt * 4);
      p.squash = lerp(p.squash, 0, 0.12);
      if (p.balloon) {
        // 气球猪：悬停在初始高度并轻微上下摆动
        const target = p.homeY + Math.sin(this.time * 1.4 + p.x * 0.01) * 10;
        p.body.vy += ((target - p.y) * 6 - p.body.vy * 2.6) * dt;
        p.body.vx *= Math.exp(-1.6 * dt);
      }
    }
    for (const bd of this.birds) {
      if (!bd.body || bd.body.removed) continue;
      bd.x = bd.body.x; bd.y = bd.body.y; bd.vx = bd.body.vx; bd.vy = bd.body.vy;
      bd.squash = lerp(bd.squash, 0, 0.14);
    }
  }

  updateGameplay(dt, rdt) {
    const t = this.time;
    for (const s of this.springs) s.compress = Math.max(0, s.compress - rdt * 4);
    for (const p of this.portals) { p.cool.A = Math.max(0, p.cool.A - rdt); p.cool.B = Math.max(0, p.cool.B - rdt); }
    for (const f of this.fans) f.t += rdt;

    // 延迟爆炸（连锁）
    for (let i = this.pendingBooms.length - 1; i >= 0; i--) {
      const pb = this.pendingBooms[i];
      pb.t -= rdt;
      if (pb.t <= 0) {
        this.pendingBooms.splice(i, 1);
        this.fx.explosion(pb.x, pb.y, 175);
        Sfx.explode();
        this.explodeAt(pb.x, pb.y, 190, 520);
      }
    }

    // 空投炸弹下落（空投白技能）
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy += GRAVITY * 1.4 * rdt;
      d.x += d.vx * rdt;
      d.y += d.vy * rdt;
      d.t += rdt;
      let hit = d.y > GROUND_Y - d.r * 0.5;
      if (!hit) {
        for (const p of this.pigs) {
          if (!p.dead && dist2(d.x, d.y, p.x, p.y) < (p.r + d.r) * (p.r + d.r)) { hit = true; break; }
        }
      }
      if (!hit) {
        for (const b of this.blocks) {
          if (!b.dead && Math.abs(d.x - b.x) < b.w / 2 + d.r && Math.abs(d.y - b.y) < b.h / 2 + d.r) { hit = true; break; }
        }
      }
      if (hit || d.t > 4) {
        this.drops.splice(i, 1);
        this.fx.explosion(d.x, d.y, 170);
        Sfx.explode();
        this.explodeAt(d.x, d.y, 185, 560);
      }
    }

    // 小鸟逻辑
    for (const bd of this.birds) {
      if (bd.dead) continue;
      if (bd.state === 'resting') {
        bd.restT = (bd.restT || 0) + rdt;
        if (bd.restT > 2.4) {
          bd.dead = true;
          this.fx.feathers(bd.x, bd.y, bd.def.body, 5);
          this.fx.burst(bd.x, bd.y, { count: 8, color: '#ffffff', type: 'smoke', spMax: 120, size: 14 });
        }
        continue;
      }
      if (bd.state === 'flying') {
        bd.flyT = (bd.flyT || 0) + rdt;
        // 泰坦（救援巨鸟）保证一定引爆：水平接近任意猪时立即引爆，
        // 或飞行超过 2.4 秒强制引爆 —— 否则可能被强风吹出界而白白浪费救援
        if (bd.def.skillKey === 'titan') {
          let fire = bd.flyT > 2.4;
          if (!fire && bd.flyT > 0.5) {
            for (const p of this.pigs) {
              if (!p.dead && Math.abs(p.x - bd.x) < 220) { fire = true; break; }
            }
          }
          if (fire) { this.titanBlast(bd); continue; }
        }
        if (bd.flyT > 9) {   // 保险：卡住太久强制收场
          bd.dead = true;
          if (bd.body) { bd.body.removed = true; bd.body = null; }
        }
        bd.trail.push({ x: bd.x, y: bd.y });
        if (bd.trail.length > 26) bd.trail.shift();
        if (this.launchCount > 0) {
          this.prevPath.push({ x: bd.x, y: bd.y });
          if (this.prevPath.length > 260) this.prevPath.shift();
        }
        for (const p of this.portals) p.tryTeleport(bd, this);
        if (bd.fuse > 0) {
          bd.fuse -= rdt;
          if (bd.fuse <= 0) { this.boom(bd); continue; }
        }
        // 拖尾火花
        if (this.particles.list.length < 400 && len(bd.vx, bd.vy) > 500) {
          this.particles.add(new Particle({
            x: bd.x, y: bd.y, vx: rand(-30, 30), vy: rand(-30, 30),
            life: 0.35, size: 6, type: 'dot', color: bd.def.body, grav: 0, drag: 2
          }));
        }
        // 出界
        if (bd.x > WORLD_W + 260 || bd.x < -260 || bd.y > VH + 400) {
          bd.dead = true;
          if (bd.body) { bd.body.removed = true; bd.body = null; }
        }
      } else if (bd.state === 'ready' && !bd.dragging) {
        bd.x = damp(bd.x, SLING.x, 12, rdt);
        bd.y = damp(bd.y, SLING.y - 14, 12, rdt);
      }
    }

    // 清除死亡
    this.birds = this.birds.filter(b => !b.dead);
    this.blocks = this.blocks.filter(b => !b.dead);
    this.world.flush();

    // 阶段推进
    if (this.phase === 'fly') {
      const bird = this.currentBird;
      const alive = bird && !bird.dead;
      // 任一飞行中的小鸟仍在移动就不结算：低速 + 接地/休眠/静止超时 都算停下
      const anyMoving = this.birds.some(b => {
        if (b.dead || b.state !== 'flying' || !b.body) return false;
        if (b.body.sleeping) return false;
        const sp = len(b.body.vx, b.body.vy);
        if (sp > 40) return true;
        if (b.body.grounded) return false;
        return (b.flyT || 0) < 0.7;          // 刚出手或处于高点，继续等
      });
      let resting = !anyMoving;
      if (!alive) resting = true;
      if (resting) {
        this.settleTimer += rdt;
        if (this.settleTimer > 0.85) this.afterShot();
      } else this.settleTimer = 0;

      // 技能提示
      if (alive && bird.state === 'flying' && !bird.skillUsed && bird.fuse <= 0) {
        if (!this.hasSkillHintShown && this.launchCount <= 2 && this.levelIndex < 2) {
          this.showSkillHint(`${bird.def.name}：点击画面释放「${bird.def.skill}」`);
          this.hasSkillHintShown = true;
        }
      }
    } else if (this.phase === 'settle') {
      this.endTimer -= rdt;
      if (this.endTimer <= 0) this.resolveTurn();
    } else if (this.phase === 'winning' || this.phase === 'losing') {
      this.endTimer -= rdt;
      if (this.endTimer <= 0) {
        this.phase = this.phase === 'winning' ? 'win' : 'lose';
        this.finishLevel(this.phase === 'win');
      }
    }

    // 相机
    let targetX = 0, targetZ = 1;
    if (this.phase === 'fly' && this.currentBird && !this.currentBird.dead) {
      targetX = clamp(this.currentBird.x - VW * 0.46, 0, WORLD_W - VW);
      if (this.currentBird.y < 320) targetZ = 1.04;
    }
    this.camX = damp(this.camX, targetX, 3.2, rdt);
    this.camZoom = damp(this.camZoom, targetZ, 3, rdt);
  }

  afterShot() {
    if (this.currentBird && !this.currentBird.dead) {
      this.currentBird.state = 'resting';
      if (this.currentBird.body) { this.currentBird.body.removed = true; this.currentBird.body = null; }
    }
    const pigsLeft = this.pigs.filter(p => !p.dead).length;
    if (pigsLeft === 0) {
      this.phase = 'winning'; this.endTimer = 1.25;
      Sfx.win();
      this.fx.slow(1.1, 0.4);
      this.fx.confetti(VW / 2, 260, 60);
      return;
    }
    if (!this.birdQueue.length) {
      // 救援机制：小鸟用尽但猪还在 —— 赠送一只泰坦巨鸟（每关限一次），
      // 确保玩家不会因为差一点点就卡关重来
      if (!this.rescueUsed) {
        this.rescueUsed = true;
        this.birdQueue.push('giant');
        this.phase = 'settle';
        this.endTimer = 0.9;
        this.showSkillHint('🚁 救援巨鸟登场！「泰坦巨力」撞击即引发毁灭爆炸，这一击必定清场');
        Sfx.win();
        this.fx.confetti(SLING.x, SLING.y - 150, 42);
        this.emitState();
        return;
      }
      this.phase = 'losing'; this.endTimer = 1.1;
      Sfx.lose();
      return;
    }
    this.phase = 'settle';
    this.endTimer = 0.55;
    this.hideSkillHint();
  }

  resolveTurn() {
    if (this.pigs.filter(p => !p.dead).length === 0) {
      this.phase = 'winning'; this.endTimer = 1.0; Sfx.win();
      this.fx.confetti(VW / 2, 260, 60);
      return;
    }
    if (this.birdQueue.length) { this.nextBird(); }
    else { this.phase = 'losing'; this.endTimer = 0.9; Sfx.lose(); }
  }

  finishLevel(win) {
    if (this.resultShown) return;
    this.resultShown = true;
    const remaining = this.birdQueue.length;
    if (win) {
      this.score += remaining * 10000;
      if (remaining) this.fx.scoreText(VW / 2, 300, `剩余小鸟 +${remaining * 10000}`, '#7bd389', 40);
    }
    const stars = win ? this.level.stars.reduce((s, v) => s + (this.score >= v ? 1 : 0), 0) : 0;
    const rec = Save.data.levels[this.levelIndex] || { stars: 0, score: 0 };
    Save.data.levels[this.levelIndex] = {
      stars: Math.max(rec.stars, stars),
      score: Math.max(rec.score, win ? this.score : rec.score)
    };
    if (win && this.levelIndex + 1 >= Save.data.unlocked) {
      Save.data.unlocked = Math.min(LEVELS.length, this.levelIndex + 2);
    }
    // 彩蛋关解锁条件：在第 3 关拿到 2 星及以上
    let eggHint = '';
    if (win && this.levelIndex === 2 && !Save.data.eggUnlocked) {
      if (stars >= 2) {
        Save.data.eggUnlocked = true;
        this.justUnlockedEgg = true;
      } else {
        eggHint = `隐藏关卡解锁条件：本关拿到 2 星（本次 ${stars} 星，还差 ${2 - stars} 星）`;
      }
    }
    Save.save();
    this.emitScore();
    if (this.onFinish) this.onFinish({ win, stars, score: this.score, remaining, levelIndex: this.levelIndex, eggHint });
  }

  restart() { this.loadLevel(this.levelIndex); }
  togglePause() {
    if (this.mode !== 'birds' || this.phase === 'win' || this.phase === 'lose') return;
    this.paused = !this.paused;
    if (this.onPause) this.onPause(this.paused);
  }

  /* ---------------- 瞄准预测 ---------------- */
  /** 拉杆位移（小鸟相对弹弓的偏移）→ 发射速度。
   *  预览与真实发射共用这一份换算，从根上杜绝"画的轨迹和实际飞行不一致"。 */
  pullToVelocity(pullX, pullY) {
    return { vx: -pullX * SLING_POWER, vy: -pullY * SLING_POWER };
  }

  /** 用发射速度前向积分出一条抛物线轨迹，遇到猪/砖块/地面即停并记录命中点 */
  updateAimPreview(vx, vy) {
    let x = SLING.x, y = SLING.y - 14, dx = vx, dy = vy;
    const pts = [];
    const step = 1 / 60;
    this.aimHit = null;
    // 模拟步数放大到 300（≈5 秒），保证远距离目标也能完整画出轨迹
    for (let i = 0; i < 300; i++) {
      dx += this.world.wind * 0.42 * step;
      dy += GRAVITY * step;
      dx *= Math.exp(-0.1 * step); dy *= Math.exp(-0.03 * step);
      for (const f of this.fans) {
        if (Math.abs(x - f.x) < f.w / 2 && Math.abs(y - f.y) < f.h / 2) f.apply({ get vx() { return dx; }, set vx(v) { dx = v; }, get vy() { return dy; }, set vy(v) { dy = v; }, x, y }, step);
      }
      x += dx * step; y += dy * step;
      if (i % 3 === 0) pts.push({ x, y });
      // 轨迹一旦压到猪 / 砖块就停在那里：末端即命中点，玩家能直观看到"打不打得中"
      let hit = false;
      for (const p of this.pigs) {
        if (p.dead) continue;
        if (dist2(x, y, p.x, p.y) < p.r * p.r) {
          this.aimHit = { x: p.x, y: p.y, kind: 'pig' };
          pts.push({ x: p.x, y: p.y });      // 让轨迹直接连到猪身上，不留空白
          hit = true; break;
        }
      }
      if (!hit) {
        for (const bl of this.blocks) {
          if (bl.dead) continue;
          if (Math.abs(x - bl.x) < bl.w / 2 && Math.abs(y - bl.y) < bl.h / 2) {
            this.aimHit = { x, y, kind: 'block' };
            pts.push({ x, y });
            hit = true; break;
          }
        }
      }
      if (hit) break;
      if (y > GROUND_Y - 8) {
        this.aimHit = { x, y: GROUND_Y - 8, kind: 'ground' };
        pts.push({ x, y: GROUND_Y - 8 });
        break;
      }
      if (x > WORLD_W || x < -100) break;
    }
    this.aimPoints = pts;
  }

  /* ---------------- 渲染 ---------------- */
  renderScene(dt) {
    const ctx = this.renderer.ctx;
    const r = this.renderer;
    ctx.setTransform(r.scale, 0, 0, r.scale, 0, 0);
    ctx.clearRect(0, 0, VW, VH);

    r.setTheme(this.level ? this.level.decor : 'day');
    r.drawBackground(ctx, this.camX);

    const sh = this.fx.shakeOffset();
    ctx.save();
    ctx.translate(VW / 2, VH / 2);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-VW / 2 - this.camX + sh.x, -VH / 2 + sh.y);

    // 弹弓（后层）
    r.drawSlingshot(ctx);

    // 机关
    for (const f of this.fans) r.drawFan(ctx, f, this.time);
    for (const p of this.portals) r.drawPortal(ctx, p, this.time);
    for (const s of this.springs) r.drawSpring(ctx, s);

    // 引力奇点（画在物体下层，形成"场"的包裹感）
    for (const w of this.wells) r.drawWell(ctx, w, this.time);

    // 阴影
    for (const b of this.blocks) if (!b.dead) r.shadow(ctx, b.x, b.y, Math.max(b.w, b.h) * 0.4);
    for (const p of this.pigs) if (!p.dead && !p.balloon) r.shadow(ctx, p.x, p.y, p.r * p.def.scale);
    for (const b of this.birds) if (!b.dead && b.state !== 'ready') r.shadow(ctx, b.x, b.y, b.r);

    // 皮筋后层
    r.drawBands(ctx, this.currentBird && this.currentBird.state === 'ready' ? this.currentBird : null, true);

    // 砖块
    for (const b of this.blocks) if (!b.dead) r.drawBlock(ctx, b);
    // 猪
    for (const p of this.pigs) if (!p.dead) r.drawPig(ctx, p, this.time);
    // 空投炸弹（空投白）
    for (const d of this.drops) r.drawEgg(ctx, d, this.time);
    // 鸟的拖尾
    for (const b of this.birds) {
      if (b.dead || b.state === 'ready') continue;
      ctx.save();
      for (let i = 0; i < b.trail.length; i++) {
        const p = b.trail[i];
        const a = i / b.trail.length;
        ctx.globalAlpha = a * 0.3;
        ctx.fillStyle = b.def.body;
        ctx.beginPath(); ctx.arc(p.x, p.y, b.r * a * 0.85, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // 剩余鸟队列（弹弓后方排队）—— 间距自适应，保证队列再长也不出画
    const qn = this.birdQueue.length;
    if (qn) {
      const qy = GROUND_Y - 26;
      const head = SLING.x - 92;              // 最靠近弹弓的一只
      const edge = 46;                        // 画面左侧安全线
      const gap = qn > 1 ? Math.min(52, (head - edge) / (qn - 1)) : 52;
      const sc = gap < 44 ? 0.66 : 0.82;      // 挤的时候整体缩小
      for (let i = 0; i < qn; i++) {
        const type = this.birdQueue[i];
        const d = BIRD_TYPES[type];
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.translate(head - i * gap, qy + Math.sin(this.time * 2 + i) * 3);
        ctx.scale(sc, sc);
        const fake = { def: d, r: d.r, state: 'idle', blink: 3, squash: 0, armedBlast: false, fuse: 0, x: 0, y: 0, vx: 0, vy: 0 };
        r.birdBody(ctx, fake, 0, this.time + i, 0);
        ctx.restore();
      }
    }
    // 当前鸟
    for (const b of this.birds) if (!b.dead) r.drawBird(ctx, b, this.time);

    // 皮筋前层
    r.drawBands(ctx, this.currentBird && this.currentBird.state === 'ready' ? this.currentBird : null, false);

    // 地面
    r.drawGround(ctx);

    // 轨迹
    if (this.phase === 'aim' && this.drag.active) r.drawTrajectory(ctx, this.aimPoints);
    if (this.phase === 'aim' && this.drag.active && this.aimHit) r.drawAimHit(ctx, this.aimHit, this.time);
    if (this.phase === 'aim' && this.prevPath.length) r.drawPrevPath(ctx, this.prevPath);
    r.drawAimUI(ctx, this.currentBird, this.drag, this.time);

    // 粒子
    this.particles.draw(ctx);

    // 风的可视化
    this.drawWind(ctx);

    ctx.restore();

    this.fx.drawFlash(ctx);
    this.drawVignette(ctx);
  }

  drawWind(ctx) {
    const w = this.world.wind;
    if (Math.abs(w) < 30) return;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const dir = Math.sign(w);
    for (let i = 0; i < 9; i++) {
      const seed = i * 137.5;
      const y = 90 + (seed * 7.3) % 620;
      const prog = ((this.time * 0.35 * (Math.abs(w) / 200) + i * 0.31) % 1);
      const x = dir > 0 ? prog * VW : VW - prog * VW;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * 60, y + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawVignette(ctx) {
    if (!this._vig) {
      const c = document.createElement('canvas');
      c.width = VW; c.height = VH;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.92);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, 'rgba(0,0,0,.34)');
      g.fillStyle = rg; g.fillRect(0, 0, VW, VH);
      this._vig = c;
    }
    ctx.drawImage(this._vig, 0, 0, VW, VH);
  }

  /* ---------------- UI 回调 ---------------- */
  emitScore() { if (this.onScore) this.onScore(this.score); }
  emitState() { if (this.onState) this.onState(this); }
  showSkillHint(text) { if (this.onHint) this.onHint(text); }
  hideSkillHint() { if (this.onHint) this.onHint(null); }
}
