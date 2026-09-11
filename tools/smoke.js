/* 冒烟自检：mock DOM 后加载全部脚本
 * 1) 关卡构建合法性  2) 物理稳定性  3) 弹道可解性  4) 技能/爆炸  5) 彩蛋关可通关性 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const grad = { addColorStop() { } };
function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 1600, height: 900 };
      return () => { };
    }, set(t, p, v) { t[p] = v; return true; }
  });
}
function makeEl() {
  return {
    width: 1600, height: 900, style: {}, textContent: '', title: '',
    dataset: {}, _attrs: {}, _html: '', _children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this._children.length = 0; },
    get children() { return this._children; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
    appendChild(c) { this._children.push(c); return c; },
    addEventListener() { }, querySelector: () => makeEl(), querySelectorAll: () => [],
    get offsetWidth() { return 100; }
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || makeEl()),
  createElement: () => makeEl(),
  addEventListener() { },
  querySelector: () => makeEl(),
  querySelectorAll: (sel) => {
    const m = /^#([\w-]+)/.exec(sel);
    if (m) { const e = els[m[1]] || (els[m[1]] = makeEl()); return [e]; }
    return [];
  },
  documentElement: { style: { setProperty() { } }, classList: { add() { }, remove() { }, toggle() { } } },
  body: { classList: { add() { }, remove() { }, toggle() { } } }
};
global.window = { addEventListener() { }, devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900 };
global.navigator = { maxTouchPoints: 0 };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
// 刻意不提供 global.confirm：存档清除已改为自绘确认弹窗。
// 若代码回归调用原生 confirm，此处会抛 ReferenceError 让冒烟直接失败。

const dir = path.join(__dirname, '..', 'js');
const files = ['utils.js', 'audio.js', 'particles.js', 'physics.js', 'entities.js', 'levels.js', 'render.js', 'egggame.js', 'game.js', 'ui.js'];
for (const f of files.slice(0, -1))
  vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });

let fail = 0;
const bad = m => { console.log('  ✗ ' + m); fail++; };

/* ---------- 0. DOM 引用完整性 ---------- */
console.log('— DOM 引用完整性 —');
{
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const js = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(dir, 'ui.js'), 'utf8');
  const refs = new Set([
    ...[...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]),
    ...[...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1])
  ]);
  const missing = [...refs].filter(r => !ids.has(r));
  if (missing.length) bad('HTML 中缺少这些 id: ' + missing.join(', '));
  else console.log(`  ✓ 脚本引用的 ${refs.size} 个 id 全部存在`);

  // CSS 中定义但 HTML 未使用的关键类（提示性）
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  for (const cls of ['egg-card', 'egg-diff', 'egg-desc', 'level-cell', 'howto-card', 'star-big', 'bird-legend']) {
    if (!css.includes('.' + cls)) bad('CSS 缺少样式类 .' + cls);
  }
  if (!css.includes('#rotate-tip')) bad('CSS 缺少 #rotate-tip 样式');
  console.log('  ✓ 关键样式类齐全');
}

/* ---------- 1. 关卡构建 ---------- */
console.log('— 关卡构建 —');
for (let i = 0; i < LEVELS.length; i++) {
  const def = buildLevel(i), errs = [];
  for (const b of def.blocks) {
    if (![b.x, b.y, b.w, b.h].every(isFinite)) errs.push('block NaN');
    if (b.y + b.h / 2 > GROUND_Y + 2) errs.push(`block 陷入地面 ${(b.y + b.h / 2).toFixed(0)}`);
    if (b.x - b.w / 2 < 0 || b.x + b.w / 2 > 1800) errs.push('block 越界');
    if (!MATERIALS[b.mat]) errs.push('未知材质 ' + b.mat);
  }
  for (const p of def.pigs) {
    if (!isFinite(p.x) || !isFinite(p.y)) errs.push('pig NaN');
    if (p.y > GROUND_Y + 1 && !p.balloon) errs.push(`pig 陷入地面 ${p.y.toFixed(0)}`);
    if (!PIG_TYPES[p.type]) errs.push('未知猪类型');
  }
  for (const b of def.birds) if (!BIRD_TYPES[b]) errs.push('未知鸟类型 ' + b);
  if (!def.pigs.length) errs.push('没有猪');
  const u = [...new Set(errs)];
  console.log(`  第${i + 1}关 ${def.name}: 砖${def.blocks.length} 猪${def.pigs.length} 鸟${def.birds.length} 机关${def.springs.length + def.portals.length + def.fans.length} ${u.length ? '✗ ' + u.join('; ') : '✓'}`);
  if (u.length) fail++;
}

/* ---------- 2. 物理稳定性 ---------- */
console.log('— 物理空跑（每关 720 步） —');
for (let i = 0; i < LEVELS.length; i++) {
  const g = new Game(makeEl());
  g.loadLevel(i);
  let err = null;
  try {
    for (let s = 0; s < 720; s++) {
      g.stepPhysics(1 / 120);
      if (s % 120 === 0) {
        for (const b of g.blocks) if (!isFinite(b.x) || !isFinite(b.y)) throw new Error('block NaN');
        for (const p of g.pigs) if (!isFinite(p.x) || !isFinite(p.y)) throw new Error('pig NaN');
      }
    }
  } catch (e) { err = e; }
  const drift = g.blocks.reduce((m, b) => Math.max(m, Math.abs(b.y - b.body.y)), 0);
  console.log(`  第${i + 1}关: ${err ? '✗ ' + err.message : '✓'} (同步误差 ${drift.toFixed(4)}px)`);
  if (err) fail++;
}

/* ---------- 3. 弹道可解性（暴力搜索发射参数） ---------- */
console.log('— 弹道可解性（搜索 角度×力度） —');
for (let i = 0; i < LEVELS.length; i++) {
  let best = null, hits = 0, tries = 0;
  for (let ang = 14; ang <= 72; ang += 4) {
    for (let pw = 0.45; pw <= 1.001; pw += 0.05) {
      tries++;
      const g = new Game(makeEl());
      g.loadLevel(i);
      const bird = g.currentBird;
      const a = -ang * Math.PI / 180;
      const v = MAX_STRETCH * pw * SLING_POWER;
      g.launch(bird, Math.cos(a) * v, Math.sin(a) * v);
      let minD = 1e9;
      for (let s = 0; s < 420; s++) {
        g.stepPhysics(1 / 120);
        g.updateGameplay(1 / 120, 1 / 120);
        for (const p of g.pigs) if (!p.dead) minD = Math.min(minD, len(p.x - bird.x, p.y - bird.y) - p.r - bird.r);
        if (bird.dead) break;
      }
      const killed = g.pigs.filter(p => p.dead).length;
      if (killed > 0 || minD < 40) hits++;
      const better = !best || killed > best.killed || (killed === best.killed && g.score > best.score);
      if (better) best = { ang, pw, score: g.score, killed, minD };
    }
  }
  const ok = hits > 0;
  console.log(`  第${i + 1}关: ${ok ? '✓' : '✗ 无解'} 命中组合 ${hits}/${tries}，最佳 角度${best.ang}° 力度${(best.pw * 100) | 0}% 击杀${best.killed} 分${best.score}`);
  if (!ok) fail++;
}

/* ---------- 4. 技能 / 爆炸 ---------- */
console.log('— 技能与连锁 —');
{
  const skills = {};
  for (const t of Object.keys(BIRD_TYPES)) {
    const g = new Game(makeEl());
    g.loadLevel(2);
    const b = new Bird(t, SLING.x, SLING.y - 14);
    g.birds.push(b); g.currentBird = b;
    g.launch(b, 900, -520);
    for (let s = 0; s < 36; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
    const sp0 = len(b.vx, b.vy), n0 = g.birds.length;
    b.useSkill(g);
    const eff = {
      red: b.armedBlast === true,
      yellow: len(b.vx, b.vy) > sp0 * 1.8,
      blue: g.birds.length === n0 + 2,
      black: b.fuse > 0,
      green: b.vx < 0,               // 回旋：水平方向反转（发射时为 +x）
      violet: g.wells.length > 0     // 引力：生成了奇点
    }[t];
    for (let s = 0; s < 420; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
    skills[t] = `${eff ? '生效' : '✗未生效'} 得分${g.score} 击杀${g.pigs.filter(p => p.dead).length}`;
    if (!eff) bad(`${t} 技能未生效`);
  }
  console.log('  技能验证:', JSON.stringify(skills, null, 0));

  const g = new Game(makeEl());
  g.loadLevel(2);
  g.explodeAt(1200, 640, 200, 600);
  for (let s = 0; s < 240; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
  console.log(`  TNT 连锁: 得分 ${g.score}，剩余砖块 ${g.blocks.length}，剩余猪 ${g.pigs.filter(p => !p.dead).length}`);
}

/* ---------- 4.5 自动通关模拟（解析弹道 + 贪心瞄准） ---------- */
console.log('— 自动通关模拟（贪心瞄准，每关最多用尽小鸟） —');
function solveV(x0, y0, x1, y1, angDeg) {
  const th = angDeg * Math.PI / 180;
  const dx = x1 - x0, dy = y1 - y0;
  if (dx <= 10) return null;
  const denom = Math.cos(th) ** 2 * (dy + Math.tan(th) * dx);
  if (denom <= 0) return null;
  return Math.sqrt(0.5 * GRAVITY * dx * dx / denom);
}
for (let i = 0; i < LEVELS.length; i++) {
  const g = new Game(makeEl());
  g.loadLevel(i);
  const maxV = MAX_STRETCH * SLING_POWER;
  let shots = 0;
  while (shots < 10 && g.phase === 'aim' && g.currentBird) {
    const bird = g.currentBird;
    let best = null;
    for (const p of g.pigs.filter(x => !x.dead)) {
      for (const angDeg of [18, 24, 30, 36, 42, 48, 56, 64]) {
        const v = solveV(bird.x, bird.y, p.x, p.y, angDeg);
        if (!v || v > maxV) continue;
        if (!best || v < best.v) best = { v, angDeg, p };
      }
    }
    if (!best) best = { v: maxV * 0.92, angDeg: 42 };
    const a = -best.angDeg * Math.PI / 180;
    const fired = g.birds[g.birds.length - 1];
    const beforeScore = g.score, beforePigs = g.pigs.filter(p => !p.dead).length;
    g.launch(bird, Math.cos(a) * best.v, Math.sin(a) * best.v);
    shots++;
    let guard = 0;
    while (g.phase !== 'aim' && g.phase !== 'win' && g.phase !== 'lose' && guard++ < 4000) g.update(1 / 120);
    if (process.env.AB_TRACE) {
      const d = Math.min(...g.pigs.filter(p => !p.dead).map(p => len(p.x - fired.x, p.y - fired.y)), 9999);
      console.log(`    #${shots} ${bird.type} 角${best.angDeg}° v=${best.v.toFixed(0)} → 停在(${fired.x.toFixed(0)},${fired.y.toFixed(0)}) 最近猪${d.toFixed(0)}px 得分+${g.score - beforeScore} 杀${beforePigs - g.pigs.filter(p => !p.dead).length}`);
    }
  }
  const left = g.pigs.filter(p => !p.dead).length;
  const total = g.level.pigs.length;
  const stars = g.level.stars.reduce((s, v) => s + (g.score >= v ? 1 : 0), 0);
  const ok = left === 0;
  console.log(`  第${i + 1}关 ${g.level.name}: ${ok ? '✓ 通关' : '· 剩余猪 ' + left + '/' + total}  发射${shots}次 分数${g.score} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`);
}

/* ---------- 4.8 UI 初始化与交互流程 ---------- */
console.log('— UI 初始化与交互 —');
{
  try {
    vm.runInThisContext(fs.readFileSync(path.join(dir, 'ui.js'), 'utf8'), { filename: 'ui.js' });
    UI.init();
    console.log('  ✓ UI.init() 通过');
    // 模拟：开始冒险 → 关卡 1
    UI.startLevel(0);
    UI.game.update(1 / 60);
    console.log('  ✓ 开始冒险 → 第1关 渲染一帧通过');
    // 模拟：关卡选择 / 说明 / 暂停 / 结算
    UI.buildLevels(); UI.show('screen-levels'); UI.show('screen-howto');
    UI.game.togglePause(); UI.game.togglePause();
    UI.showResult({ win: true, stars: 2, score: 20000, remaining: 1, levelIndex: 0 });
    console.log('  ✓ 关卡选择/说明/暂停/结算面板通过');
    // 模拟：彩蛋关
    UI.startEgg(0);
    UI.game.update(1 / 60);
    UI.game.egg.onUp(400, 300);
    UI.game.update(1 / 60);
    UI.showEggResult({ win: false, diff: 0, score: 1200 });
    console.log('  ✓ 彩蛋关启动/点击/结算通过');

    // 彩蛋关入口显隐 + 解锁庆祝（通关第 3 关后才会出现）
    const eggEl = document.getElementById('btn-egg');
    Save.data.eggUnlocked = false;
    UI.refreshMenu();
    const hiddenBefore = eggEl.classList.contains('hidden');
    Save.data.eggUnlocked = true;
    UI.game.justUnlockedEgg = true;
    UI.refreshMenu();
    const shownAfter = !eggEl.classList.contains('hidden');
    UI.showUnlock();
    console.log(`  ✓ 彩蛋入口 解锁前隐藏=${hiddenBefore} 解锁后显示=${shownAfter} 庆祝弹窗通过`);
    if (!hiddenBefore) bad('未解锁时彩蛋关入口不应出现');
    if (!shownAfter) bad('解锁后彩蛋关入口未显示');

    // 未解锁关卡：点击必须给出明确提示（此前点了完全没有反馈）
    const keepUnlocked = Save.data.unlocked;
    Save.data.unlocked = 1;
    UI.buildLevels();
    const grid = document.getElementById('level-grid');
    const lockedCell = grid.children[1];          // 第 2 关：未解锁
    const hasHandler = !!(lockedCell && typeof lockedCell.onclick === 'function');
    document.getElementById('toast').textContent = '';
    if (hasHandler) lockedCell.onclick();
    const hintText = document.getElementById('toast').textContent;
    const hinted = /未解锁/.test(hintText) && /第 1 关/.test(hintText);
    console.log(`  ${hinted ? '✓' : '✗'} 未解锁关卡点击提示: ${JSON.stringify(hintText)}`);
    if (!hasHandler) bad('未解锁关卡没有绑定点击处理，点击无反馈');
    if (!hinted) bad('点击未解锁关卡未给出解锁条件提示');
    Save.data.unlocked = keepUnlocked;

    // 存档清除：改为自绘确认弹窗（原生 confirm 样式无法控制，观感割裂）
    let confirmRan = false;
    UI.confirm({ icon: '🗑️', title: '测试确认', desc: '测试文案', okText: '确认', onOk: () => { confirmRan = true; } });
    const cEl = document.getElementById('screen-confirm');
    const confirmShown = !cEl.classList.contains('hidden');
    const confirmTitle = document.getElementById('confirm-title').textContent;
    document.getElementById('btn-confirm-ok').onclick();
    const confirmClosed = cEl.classList.contains('hidden');
    const ok = confirmShown && confirmRan && confirmClosed;
    console.log(`  ${ok ? '✓' : '✗'} 确认弹窗 显示=${confirmShown} 触发回调=${confirmRan} 已关闭=${confirmClosed} 标题=${JSON.stringify(confirmTitle)}`);
    if (!ok) bad('确认弹窗流程异常');
    if (confirmTitle !== '测试确认') bad('确认弹窗标题未按参数渲染');
  } catch (e) {
    bad('UI 流程异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
}

/* ---------- 4.9 得分飘字 / 彩蛋解锁门槛 ---------- */
console.log('— 得分飘字 / 解锁门槛 —');
{
  // 飘字：曾被 Particle 构造函数漏拷贝 text 字段，导致一律画出 "undefined"
  const g = new Game(makeEl());
  g.loadLevel(0);
  g.fx.p.clear();
  g.addScore(500, 700, 400);
  const txt = g.fx.p.list.filter(p => p.type === 'text');
  const hasText = txt.length > 0 &&
    txt.every(p => typeof p.text === 'string' && p.text.length > 0 && p.text.indexOf('undefined') < 0);
  console.log(`  ${hasText ? '✓' : '✗'} 飘字粒子 ${txt.length} 个: ${txt.map(p => JSON.stringify(p.text)).join(', ')}`);
  if (!hasText) bad('得分飘字文案丢失或为 undefined（Particle 未拷贝 text）');

  const flat = txt.every(p => Math.abs(p.rot) < 0.3 && p.vr === 0);
  console.log(`  ${flat ? '✓' : '✗'} 飘字朝向：保持水平（不随机旋转）`);
  if (!flat) bad('飘字被随机角度旋转');

  // 彩蛋关解锁门槛：第 3 关拿到 2 星才算达成
  const probe = (lvlIdx, score) => {
    Save.data.levels = {};
    Save.data.eggUnlocked = false;
    const gg = new Game(makeEl());
    gg.loadLevel(lvlIdx);
    gg.birdQueue.length = 0;          // 屏蔽剩余小鸟奖励，精确控制分数
    gg.score = score;
    gg.finishLevel(true);
    return Save.data.eggUnlocked;
  };
  const tier = LEVELS[2]().stars;
  const at1 = probe(2, tier[0]);      // 恰好 1 星
  const at2 = probe(2, tier[1]);      // 恰好 2 星
  console.log(`  ${!at1 && at2 ? '✓' : '✗'} 解锁门槛：第3关 1星→${at1 ? '解锁' : '未解锁'}，2星→${at2 ? '解锁' : '未解锁'}`);
  if (at1) bad('第 3 关 1 星不应解锁彩蛋关');
  if (!at2) bad('第 3 关 2 星应解锁彩蛋关');
  Save.reset();
}

/* ---------- 5. 彩蛋关 ---------- */
console.log('— 彩蛋关（智能策略模拟 30 局） —');
for (const diff of [0, 1]) {
  let win = 0, lose = 0, stuck = 0;
  for (let run = 0; run < 30; run++) {
    const g = new Game(makeEl());
    g.egg.start(diff);
    let guard = 0;
    while (g.egg.state === 'play' && guard++ < 3000) {
      const inSlot = {};
      for (const c of g.egg.slot) inSlot[c.type] = (inSlot[c.type] || 0) + 1;
      const cands = g.egg.cards.filter(x => x.state === 'stack' && !x.locked);
      if (!cands.length) break;
      // 优先补齐槽中已有的类型（接近 3 的优先），其次高层的
      cands.sort((a, b) => ((inSlot[b.type] || 0) - (inSlot[a.type] || 0)) || (b.layer - a.layer));
      const c = cands[0];
      g.egg.onUp(c.x, c.y);
      for (let s = 0; s < 40; s++) g.egg.update(1 / 60);
    }
    if (g.egg.state === 'win') win++;
    else if (g.egg.state === 'lose') lose++;
    else stuck++;
  }
  console.log(`  ${diff === 0 ? '轻松' : '地狱'}局: 通关 ${win} / 失败 ${lose} / 未结束 ${stuck}`);
  if (stuck > 0) bad(`难度${diff} 有 ${stuck} 局陷入僵局`);
}

console.log(fail ? `\n❌ 存在 ${fail} 个问题` : '\n✅ 全部检查通过');
process.exit(fail ? 1 : 0);
