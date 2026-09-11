/* 冒烟自检：mock DOM 后加载全部脚本
 * 1) 关卡构建合法性  2) 物理稳定性  3) 弹道可解性  4) 技能/爆炸  5) 彩蛋关可通关性 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const grad = { addColorStop() { } };
function makeStyle() {
  // 任意属性赋值都允许（el.style.top = 'x'），并补上 setProperty / removeProperty
  // —— 主菜单 syncMenuScene() 会把 css 变量写到 #stage.style，冒烟测试要走通。
  return new Proxy({}, {
    get(t, p) {
      if (p === 'setProperty' || p === 'removeProperty' || p === 'getPropertyValue') return () => '';
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
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
    width: 1600, height: 900, style: makeStyle(), textContent: '', title: '',
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
  documentElement: { style: makeStyle(), classList: { add() { }, remove() { }, toggle() { } } },
  body: { classList: { add() { }, remove() { }, toggle() { } } }
};
global.window = {
  addEventListener() { }, devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900,
  matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } })
};
global.navigator = { maxTouchPoints: 0 };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };

/* 最小可用的 WebAudio 假实现：让 audio.js / music.js 的音符排程能被真实执行 */
function makeAudioCtx() {
  const param = () => ({
    value: 0,
    setValueAtTime() { }, exponentialRampToValueAtTime() { },
    linearRampToValueAtTime() { }, setTargetAtTime() { }
  });
  const node = extra => Object.assign({ connect() { }, disconnect() { }, start() { }, stop() { } }, extra);
  return {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: node(),
    resume() { },
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ type: 'sine', frequency: param(), detune: param() }),
    createBufferSource: () => node({ buffer: null, playbackRate: param() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(), Q: param() }),
    createDynamicsCompressor: () => node({
      threshold: param(), ratio: param(), knee: param(), attack: param(), release: param()
    }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) })
  };
}
global.window.AudioContext = makeAudioCtx;
// 刻意不提供 global.confirm：存档清除已改为自绘确认弹窗。
// 若代码回归调用原生 confirm，此处会抛 ReferenceError 让冒烟直接失败。

const dir = path.join(__dirname, '..', 'js');
const files = ['utils.js', 'audio.js', 'music.js', 'particles.js', 'physics.js', 'entities.js', 'levels.js', 'render.js', 'egggame.js', 'game.js', 'ui.js'];
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
      violet: g.wells.length > 0,    // 引力：生成了奇点
      orange: b.r > BIRD_TYPES.orange.r * 1.5,   // 膨胀：半径显著变大
      white: g.drops.length > 0,                 // 空投：生成了一枚炸弹
      giant: b.dead === true                     // 泰坦：点击立即引爆自身
    }[t];
    for (let s = 0; s < 420; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
    skills[t] = `${eff ? '生效' : '✗未生效'} 得分${g.score} 击杀${g.pigs.filter(p => p.dead).length}`;
    if (!eff) bad(`${t} 技能未生效`);
  }
  console.log('  技能验证:', JSON.stringify(skills, null, 0));

  /* 技能可感知性：释放时必须 (1) 播报技能名 (2) 全屏轻闪 (3) 产生粒子
     —— 这三条是"九只鸟手感趋同"的防回归护栏 */
  {
    let announceOk = 0, flashOk = 0, fxOk = 0;
    const names = [];
    for (const t of Object.keys(BIRD_TYPES)) {
      const g = new Game(makeEl());
      g.loadLevel(2);
      const b = new Bird(t, SLING.x, SLING.y - 14);
      g.birds.push(b); g.currentBird = b;
      g.launch(b, 900, -520);
      for (let s = 0; s < 36; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
      const fx0 = g.fx.p.list.length;
      g.fx.flash = 0;
      // 记录播报文本
      const seen = [];
      const origScoreText = g.fx.scoreText.bind(g.fx);
      g.fx.scoreText = (x, y, text, ...rest) => { seen.push(text); return origScoreText(x, y, text, ...rest); };
      b.useSkill(g);
      g.fx.scoreText = origScoreText;
      if (seen.includes(BIRD_TYPES[t].skill)) { announceOk++; names.push(t); }
      if (g.fx.flash > 0) flashOk++;
      if (g.fx.p.list.length > fx0) fxOk++;
    }
    if (announceOk !== 9) bad(`技能播报缺失：仅 ${announceOk}/9 只鸟播报了技能名（${names.join(',')}）`);
    else console.log(`  ✓ 9 只鸟释放技能均播报技能名`);
    if (flashOk !== 9) bad(`技能闪屏缺失：仅 ${flashOk}/9 只鸟触发全屏轻闪`);
    else console.log(`  ✓ 9 只鸟释放技能均触发全屏轻闪`);
    if (fxOk !== 9) bad(`技能粒子缺失：仅 ${fxOk}/9 只鸟产生粒子特效`);
    else console.log(`  ✓ 9 只鸟释放技能均产生粒子特效`);
  }

  const g = new Game(makeEl());
  g.loadLevel(2);
  g.explodeAt(1200, 640, 200, 600);
  for (let s = 0; s < 240; s++) { g.stepPhysics(1 / 120); g.updateGameplay(1 / 120, 1 / 120); }
  console.log(`  TNT 连锁: 得分 ${g.score}，剩余砖块 ${g.blocks.length}，剩余猪 ${g.pigs.filter(p => !p.dead).length}`);
}

/* ---------- 4.2 救援巨鸟 / 瞄准命中 ---------- */
console.log('— 救援机制与瞄准辅助 —');
{
  // 救援触发：鸟用尽但猪还在 → 不再默给，要走 UI 确认回调
  let rescueInfo = null;
  const g = new Game(makeEl());
  g.onRescueRequest = (info) => { rescueInfo = info; };
  g.loadLevel(0);
  g.birdQueue.length = 0;
  g.currentBird = null;
  const pigsLeft = g.pigs.filter(p => !p.dead).length;
  g.afterShot();
  const fired = g.phase === 'rescue' && rescueInfo &&
    rescueInfo.pigsLeft === pigsLeft &&
    rescueInfo.rescueLeft === 3 &&         // 默认每日 3 次
    rescueInfo.resetLeft === 3;            // 默认清空 3 次
  console.log(`  ${fired ? '✓' : '✗'} 鸟用尽触发救援回调（剩猪 ${pigsLeft}，救援 ${rescueInfo ? rescueInfo.rescueLeft : '?'}/3）`);
  if (!fired) bad('救援未走回调路径：要么 phase 没设为 rescue，要么回调参数错误');

  // UI 走完「使用救援」流程：game.useRescue() 应把泰坦挂上弹弓（phase='aim'），
  // 玩家接下来自己拉弓发射。绝不能再自动 launch —— 否则玩家没参与感、且斩杀特效被盖。
  const beforeRescue = Save.rescueLeft;
  g.useRescue();
  const giant = g.birds.find(b => b.type === 'giant');
  const onSlingshot = giant && Math.abs(giant.x - SLING.x) < 1 && Math.abs(giant.y - (SLING.y - 14)) < 1;
  const awaitingAim = g.phase === 'aim' && g.currentBird === giant;
  const notAutoFired = !giant || giant.state === 'ready';     // 没被 .launch()
  const countConsumed = Save.rescueLeft === beforeRescue - 1;
  const ok = !!giant && onSlingshot && awaitingAim && notAutoFired && countConsumed;
  console.log(`  ${ok ? '✓' : '✗'} useRescue：泰坦挂弹弓=${!!giant}（位置${giant ? `(${giant.x.toFixed(0)},${giant.y.toFixed(0)})` : '-'}）phase=aim=${g.phase === 'aim'} 未自动发射=${notAutoFired}，救援次数 ${beforeRescue} → ${Save.rescueLeft}`);
  if (!giant) bad('game.useRescue() 没有生成泰坦');
  else if (!onSlingshot) bad('泰坦没有挂在弹弓叉口');
  else if (g.phase !== 'aim') bad('useRescue 不应自动切到 phase=fly，必须等玩家拉弓');
  else if (!notAutoFired) bad('useRescue 自动发射了泰坦，玩家没有拉弓机会');
  if (!countConsumed) bad('useRescue 没有扣救援次数');

  // 玩家拉弓发射 → 泰坦物理飞行 → 接近猪自动引爆 → 斩杀特效 → 关卡胜利。
  // 这里直接给泰坦一个朝最近猪的初速模拟「拉弓松手」，验证整条链路通畅。
  // 关键：循环必须等到 phase 切到 winning / win / lose —— 即便 giant 已死，
  // 也要让 settleTimer 累到 0.85s 触发 afterShot，再让 winning 1.25s 计时走完。
  if (giant && g.pigs.some(p => !p.dead)) {
    const nearest = g.pigs.find(p => !p.dead);
    const dx = nearest.x - giant.x, dy = (nearest.y - 80) - giant.y;
    const d = len(dx, dy) || 1;
    g.launch(giant, dx / d * 1100, dy / d * 1100);
    let frames = 0;
    while (!['winning', 'win', 'lose'].includes(g.phase) && frames++ < 1200) {
      g.update(1 / 120);
    }
    const won = g.phase === 'winning' || g.phase === 'win';
    const seeFinish = g.particles.list.some(p => p.type === 'bigtext' && p.text === 'FINISH!');
    console.log(`  ${won && seeFinish ? '✓' : '✗'} 救援发射链路：phase 落到 ${g.phase}，大字 FINISH! ${seeFinish ? '已播' : '未播'}，剩猪 ${g.pigs.filter(p => !p.dead).length}`);
    if (!won) bad('救援发射后未走到 winning / win');
    if (!seeFinish) bad('救援发射后 titanBlast 没有把「FINISH!」大字粒子推入队列');
  }

  // 救援次数耗尽时回调应带上 resetLeft = 实际剩余
  Save.data.rescueCount = 3; Save.save();                // 今日次数耗尽
  Save.data.rescueResets = 1; Save.save();               // 剩 1 次清空
  const g2 = new Game(makeEl());
  let info2 = null;
  g2.onRescueRequest = (info) => { info2 = info; };
  g2.loadLevel(0);
  g2.birdQueue.length = 0;
  g2.currentBird = null;
  g2.afterShot();
  const exhausted = info2 && info2.rescueLeft === 0 && info2.resetLeft === 1;
  console.log(`  ${exhausted ? '✓' : '✗'} 次数耗尽时回调参数：rescueLeft=${info2 ? info2.rescueLeft : '?'} resetLeft=${info2 ? info2.resetLeft : '?'}`);
  if (!exhausted) bad('次数耗尽时回调应明确告知剩余清空机会');

  // 泰坦引爆：保底清场 + 斩杀结算特效（顿帧 + 慢放 + 全屏白闪 + 大字飘字）
  const g3 = new Game(makeEl());
  g3.loadLevel(7);
  const tb = new Bird('giant', 1150, 620);
  g3.birds.push(tb); g3.currentBird = tb;
  const p0 = g3.pigs.filter(p => !p.dead).length;
  g3.particles.clear();                          // 干净起点才能精确统计大数字粒子
  g3.titanBlast(tb);
  const flashOk = g3.fx.flash >= 0.9;
  const slowOk = g3.fx.timeScale <= 0.2 || g3.fx.slowTimer > 0;
  const freezeOk = g3.fx.hitStop > 0;
  const bigText = g3.particles.list.filter(p => p.type === 'bigtext');
  for (let s = 0; s < 360; s++) { g3.stepPhysics(1 / 120); g3.updateGameplay(1 / 120, 1 / 120); }
  const p1 = g3.pigs.filter(p => !p.dead).length;
  const titanOk = p1 < p0;
  const finLabels = bigText.map(p => p.text).join('|');
  const finOk = bigText.length >= 2 && /FINISH/.test(finLabels) && /救援成功/.test(finLabels);
  console.log(`  ${titanOk && flashOk && slowOk && freezeOk && finOk ? '✓' : '✗'} 泰坦斩杀：剩猪 ${p0} → ${p1}，白闪=${flashOk} 慢放=${slowOk} 顿帧=${freezeOk} 大字 "${finLabels}"`);
  if (!titanOk) bad('泰坦爆炸未造成伤害');
  if (!flashOk) bad('泰坦斩杀特效：全屏白闪未触发（fx.flash < 0.9）');
  if (!slowOk) bad('泰坦斩杀特效：时间慢放未触发（fx.timeScale 没掉到 0.2 以下）');
  if (!freezeOk) bad('泰坦斩杀特效：顿帧未触发（fx.hitStop）');
  if (!finOk) bad('泰坦斩杀特效：大字飘字缺失或文案错：' + finLabels);

  // 瞄准预测：轨迹足够长，且能给出命中点
  const g4 = new Game(makeEl());
  g4.loadLevel(0);
  g4.updateAimPreview(1150, -780);
  const longEnough = g4.aimPoints.length > 8;
  const hasHit = !!g4.aimHit;
  console.log(`  ${longEnough && hasHit ? '✓' : '✗'} 轨迹预测：采样 ${g4.aimPoints.length} 点，命中点 ${g4.aimHit ? g4.aimHit.kind : '无'}`);
  if (!longEnough) bad('瞄准轨迹过短');
  if (!hasHit) bad('瞄准轨迹未给出命中点');

  // 必须存在"轨迹直接压在猪头上"的角度
  let pigAngle = null;
  for (let a = 4; a <= 82; a += 2) {
    const th = a * Math.PI / 180;
    g4.updateAimPreview(Math.cos(th) * 1250, -Math.sin(th) * 1250);
    if (g4.aimHit && g4.aimHit.kind === 'pig') { pigAngle = a; break; }
  }
  console.log(`  ${pigAngle !== null ? '✓' : '✗'} 存在可命中猪的瞄准角${pigAngle !== null ? `（${pigAngle}°）` : ''}`);
  if (pigAngle === null) bad('没有任何角度能命中猪，轨迹停止逻辑可能有误');

  // 真实拖拽路径：预览必须按"发射速度"积分。
  // 曾经这里传的是拉杆位移本身（约 98px/s 而不是 98×SLING_POWER），
  // 被重力一拽就变成一条直插地面的短线 —— 上面两处断言因为直接传速度所以全都测不到。
  {
    const g5 = new Game(makeEl());
    g5.loadLevel(0);
    const pull = { x: -60, y: 66 };                     // 往左下拽 → 朝右上发射
    const v = g5.pullToVelocity(pull.x, pull.y);
    const want = len(pull.x, pull.y) * SLING_POWER;
    const speedOk = Math.abs(len(v.vx, v.vy) - want) < 1e-6;
    g5.updateAimPreview(v.vx, v.vy);
    const pts = g5.aimPoints, n = pts.length;
    const longEnough = n > 10;
    const rises = n > 3 && pts[Math.floor(n * 0.3)].y < pts[0].y - 40;   // 中段在爬升 = 抛物线
    const reachOk = n > 0 && pts[n - 1].x > 700;
    console.log(`  ${speedOk && longEnough && rises && reachOk ? '✓' : '✗'} 真实拖拽弹道：初速 ${len(v.vx, v.vy).toFixed(0)}px/s，采样 ${n} 点，末端 x=${n ? pts[n - 1].x.toFixed(0) : '-'}`);
    if (!speedOk) bad('拖拽位移 → 发射速度换算错误，预览与实际发射不一致');
    if (!longEnough) bad('真实拖拽下瞄准轨迹采样点过少（疑似被重力瞬间拽到地面）');
    if (!rises) bad('真实拖拽下轨迹不是抛物线');
    if (!reachOk) bad('真实拖拽下轨迹打不到远处');
  }

  // 重置 Save 以免影响后续断言
  Save.reset();
}

/* ---------- 4.4 物理：失去支撑则下落 ---------- */
console.log('— 物理：失去支撑则下落 —');
{
  // 经典「下层柱子 + 上层木块」场景：
  // 1) 先把上层 settle 到下层顶部、让其进入 sleeping
  // 2) 拆除下层支撑后，跑物理看上层是否能被自动唤醒并落到地面
  // 旧实现中 sleeping body 一旦失去支撑会"浮空"，与真实物理严重不符。
  const g = new Game(makeEl());
  g.loadLevel(0);
  g.birdQueue.length = 0; g.currentBird = null;
  // 下层（static，作为稳定支撑）：y=770, h=80 → 上端 730，下端 810 紧贴地面（GROUND_Y=812）
  const lower = new Block('wood', 1000, 770, 80, 80, { static: true });
  const lowerBody = new Body({ x: 1000, y: 770, w: 80, h: 80, static: true, restitution: 0.02, friction: 0.92, tag: 'block' });
  lowerBody.owner = lower; lower.body = lowerBody;
  g.world.add(lowerBody); g.blocks.push(lower);
  // 上层（非 static，起始紧贴 lower 顶部）：y=700, h=60 → 下端 730 正好贴上下层顶端
  const upper = new Block('wood', 1000, 700, 60, 60);
  const upperBody = new Body({ x: 1000, y: 700, w: 60, h: 60, mass: 2.4, restitution: 0.02, friction: 0.92, tag: 'block' });
  upperBody.owner = upper; upper.body = upperBody;
  g.world.add(upperBody); g.blocks.push(upper);

  // 让上层坐下。哪怕跑 360 步，重力 + 弹力让 vy 仍在 16px/s 附近抖动很难进入 sleeping；
  // 直接强制把它设为 sleeping，只为构造「支撑消失」的测试场景 —— 这里要验证的是
  // 「sleeping body 脚下失去支撑能否被唤醒并下落」，而不验证 sleeping 自身如何达成。
  for (let s = 0; s < 240; s++) g.stepPhysics(1 / 120);
  upperBody.vx = 0; upperBody.vy = 0;
  upperBody.sleeping = true;
  const settleY = upperBody.y;
  const wasSleeping = upperBody.sleeping;

  // 拆除下层支撑（被小鸟撞飞后的真实情况：下层 body 被标记为 removed）
  lowerBody.removed = true; lower.dead = true;
  g.world.flush();
  // 跑物理看上层是否能落到地面（120 步 ≈ 1s，自由落体可掉约 138px）
  for (let s = 0; s < 120; s++) g.stepPhysics(1 / 120);
  const fellTo = upperBody.y;
  const dropped = fellTo > settleY + 60;       // 至少下落 60px
  const nearGround = (fellTo + upperBody.hh) >= GROUND_Y - 8;
  const ok = wasSleeping && dropped && nearGround;
  console.log(`  ${ok ? '✓' : '✗'} 下层拆除后上层木块下落：settleY=${settleY.toFixed(0)} 此前 sleep=${wasSleeping} 拆后 y=${fellTo.toFixed(0)} 接近地面=${nearGround}`);
  if (!wasSleeping) bad('场景构造失败：上层木块未进入 sleeping，可能没贴住下层顶部');
  if (!dropped) bad('下层拆除后上层木块没有失去支撑下落');
  if (!nearGround) bad('上层木块唤醒后没真正落到地面');
  Save.reset();
}

/* ---------- 4.3 救援配额：每日次数 / 清空机会 / 激活码 ---------- */
console.log('— 救援配额（每日次数 / 清空机会 / 激活码） —');
{
  Save.reset();
  const initial = {
    rescueLeft: Save.rescueLeft,
    resetLeft: Save.data.rescueResets,
    activated: Save.data.rescueActivated
  };
  const defaultOk = initial.rescueLeft === 3 && initial.resetLeft === 3 && initial.activated === 0;
  console.log(`  ${defaultOk ? '✓' : '✗'} 默认配额：救援 ${initial.rescueLeft}/3，清空 ${initial.resetLeft}/3，已激活 ${initial.activated}`);
  if (!defaultOk) bad('新存档默认救援次数应为 3/3，清空机会 3/3，激活次数 0');

  // 消耗救援次数
  Save.consumeRescue(); Save.consumeRescue();
  const after2 = Save.rescueLeft;
  console.log(`  ${after2 === 1 ? '✓' : '✗'} 消耗 2 次救援后剩 ${after2}/3`);
  if (after2 !== 1) bad('消耗救援次数后剩余值错误');

  // 救援次数耗尽后清空机会可刷新
  Save.consumeRescue();                                // 0/3
  const beforeReset = Save.useResetForRescue();
  const afterReset = Save.rescueLeft;
  const resetUsed = Save.data.rescueResets === 2;
  console.log(`  ${beforeReset && afterReset === 3 && resetUsed ? '✓' : '✗'} 清空机会刷新救援：成功=${beforeReset} 救援次数 → ${afterReset}，清空次数 → ${Save.data.rescueResets}/3`);
  if (!beforeReset) bad('useResetForRescue 在次数耗尽时返回 false');
  if (afterReset !== 3) bad('清空后救援次数应回到 3');
  if (!resetUsed) bad('使用清空机会后剩余次数应减 1');

  // 还有救援次数时不应允许用清空机会
  const refused = Save.useResetForRescue();
  console.log(`  ${!refused ? '✓' : '✗'} 救援还有次数时拒绝消耗清空机会=${!refused}`);
  if (refused) bad('还有救援次数时不应允许消耗清空机会');

  // 激活码：合法码 + 校验位匹配
  const good = Save.activateRescueCode('DEMORESE');
  console.log(`  ${good.ok && good.added === 5 ? '✓' : '✗'} 合法激活码 DEMORESE：ok=${good.ok} added=${good.added} msg=${JSON.stringify(good.msg)}`);
  if (!good.ok) bad('合法激活码 DEMORESE 应通过');

  // 激活码：长度错
  const short = Save.activateRescueCode('SHORT');
  console.log(`  ${!short.ok ? '✓' : '✗'} 长度过短拒绝：${JSON.stringify(short.msg)}`);
  if (short.ok) bad('长度错的激活码应被拒绝');

  // 激活码：校验位错
  const badCode = Save.activateRescueCode('XXXXXXXX');
  console.log(`  ${!badCode.ok ? '✓' : '✗'} 校验位错拒绝：${JSON.stringify(badCode.msg)}`);
  if (badCode.ok) bad('校验位错误的激活码应被拒绝');

  // 激活码：纯小写应被自动归一为大写
  const lower = Save.activateRescueCode('demorese');
  console.log(`  ${lower.ok ? '✓' : '✗'} 小写激活码自动归一化：${JSON.stringify(lower.msg)}`);
  if (!lower.ok) bad('小写激活码应自动归一为大写并通过');

  // 激活码：今日耗尽时激活 → credit 增加 → 今日 left = credit
  Save.reset();
  Save.data.rescueCount = 3; Save.save();             // 今日已用 3 次
  const r = Save.activateRescueCode('DEMORESE');
  const leftNow = Save.rescueLeft;
  console.log(`  ${r.ok && r.added === 5 && leftNow === 5 && Save.data.rescueCredit === 5 ? '✓' : '✗'} 今日耗尽激活：left=${leftNow}（count=${Save.data.rescueCount} credit=${Save.data.rescueCredit}）`);
  if (!r.ok || r.added !== 5 || leftNow !== 5 || Save.data.rescueCredit !== 5) bad('激活码应在今日耗尽时把 credit 加 5，今日 left=5');

  // 展示拆分：UI 不能把「合计」直接除以 3 显示（否则激活后会变成 5/3 这种怪值）
  const dsp = { daily: Save.rescueDailyLeft, credit: Save.rescueCreditLeft };
  const showOk = dsp.daily === 0 && dsp.daily <= 3 && dsp.credit === 5;
  console.log(`  ${showOk ? '✓' : '✗'} 面板展示拆分：今日 ${dsp.daily}/3 + 额外 ${dsp.credit}（合计 ${Save.rescueLeft}）`);
  if (!showOk) bad('展示应拆成「今日(≤3)」+「额外」，不能直接显示合计/3');

  // credit 跨日不重置 + 与今日配额叠加（跨日同时恢复今日 3 次额度）
  const origToday2 = Save._todayKey;
  Save._todayKey = () => origToday2() + 1;
  const afterDay = Save.rescueLeft;
  Save._todayKey = origToday2;
  console.log(`  ${afterDay === 8 ? '✓' : '✗'} 跨日恢复：left=${afterDay}（今日 3 + credit 5 = 8）`);
  if (afterDay !== 8) bad('跨日应恢复今日 3 次额度 + 保留 credit 5，总 left=8');

  // 消耗时优先扣今日次数、再扣 credit
  Save.reset();
  Save.data.rescueCredit = 3; Save.save();           // 假设之前激活过一次
  Save.consumeRescue();
  const c1 = Save.data.rescueCount, cr1 = Save.data.rescueCredit;
  console.log(`  ${c1 === 1 && cr1 === 3 ? '✓' : '✗'} 优先扣今日：消耗 1 次 → count=${c1} credit=${cr1}（今日还能用 2 次 + credit 3）`);
  if (c1 !== 1 || cr1 !== 3) bad('今日有配额时应优先扣今日，credit 不动');

  // 今日用完后继续消耗 → 扣 credit
  Save.data.rescueCount = 3; Save.save();
  Save.consumeRescue();
  const c2 = Save.data.rescueCount, cr2 = Save.data.rescueCredit;
  console.log(`  ${c2 === 3 && cr2 === 2 ? '✓' : '✗'} 今日耗尽扣 credit：消耗 → count=${c2} credit=${cr2}`);
  if (c2 !== 3 || cr2 !== 2) bad('今日已满时应转扣 credit');

  // 清空次数耗尽时无法再用
  Save.reset();

  // window.genRescueCode 必须存在并能生成可校验的码
  const sample = window.genRescueCode('SAMPLE1');
  console.log(`  ${typeof sample === 'string' && sample.length === 8 && Save._checkRescueCode(sample) ? '✓' : '✗'} genRescueCode('SAMPLE1') = ${sample}`);
  if (typeof sample !== 'string' || sample.length !== 8) bad('genRescueCode 未返回 8 位字符串');
  if (!Save._checkRescueCode(sample)) bad('genRescueCode 生成的码校验失败');

  // 弹窗里摆出的演示码必须真的能激活（直接读 index.html，避免"文档写了但页面展示的是别的"）
  const rootDir = path.join(__dirname, '..');
  const htmlForDemo = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const demoMatch = /id="btn-rescue-demo"[^>]*>\s*([0-9A-Za-z]+)\s*</.exec(htmlForDemo);
  const demoCode = demoMatch ? demoMatch[1].trim().toUpperCase() : '';
  const demoOk = demoCode.length === 8 && Save._checkRescueCode(demoCode);
  console.log(`  ${demoOk ? '✓' : '✗'} 弹窗演示码 ${demoCode || '(未找到)'} 校验通过=${demoOk}`);
  if (!demoOk) bad('index.html 救援弹窗里展示的演示码无法通过校验');

  // README「演示可用的码」一行里列出的码也必须全部有效
  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  const demoLine = /演示可用的码：([^\n]+)/.exec(readme);
  const readmeCodes = demoLine ? (demoLine[1].match(/[0-9A-Z]{8}/g) || []) : [];
  const badCodes = readmeCodes.filter(c => !Save._checkRescueCode(c));
  console.log(`  ${readmeCodes.length && !badCodes.length ? '✓' : '✗'} README 演示码 ${readmeCodes.join('/') || '(未找到)'} 全部有效=${!badCodes.length}`);
  if (!readmeCodes.length) bad('README 里没有列出演示用激活码');
  if (badCodes.length) bad('README 列出的激活码校验失败: ' + badCodes.join(', '));

  Save.reset();
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

/* ---------- 4.7 音频：音效 + 循环 BGM ---------- */
console.log('— 音频（音效 + BGM） —');
{
  Sfx.init();
  Music.init();
  const sfxReady = Sfx.ready === true, busOk = !!Music.out;

  // 曲谱自检：每小节 16 步、低音 8 步，所有音名都能解析成有效频率
  const P = Music.PATTERN, bars = P.lead.length, noteErr = [];
  for (let b = 0; b < bars; b++) {
    if (P.lead[b].length !== 16) noteErr.push(`lead[${b}] ${P.lead[b].length} 步`);
    if (P.bassShape[b].length !== 8) noteErr.push(`bassShape[${b}] ${P.bassShape[b].length} 步`);
    for (const nm of P.lead[b]) if (nm !== '.' && !(Music.freqOf(nm) > 0)) noteErr.push(`未知音名 ${nm}`);
    for (const nm of P.CHORDS[P.chords[b]]) if (!(Music.freqOf(nm) > 0)) noteErr.push(`未知和弦音 ${nm}`);
    if (!P.bassRoot[P.chords[b]]) noteErr.push(`和弦 ${P.chords[b]} 没有低音根音`);
  }
  console.log(`  ${sfxReady && busOk && !noteErr.length ? '✓' : '✗'} 音频总线：音效=${sfxReady} BGM=${busOk}，曲谱 ${bars} 小节 × 16 步，问题 ${noteErr.length}`);
  if (!sfxReady) bad('音效模块未初始化');
  if (!busOk) bad('BGM 输出总线未建立');
  if (noteErr.length) bad('BGM 曲谱有非法音符：' + noteErr.slice(0, 5).join('; '));

  // 排程器：推进 currentTime 后应连续排入音符并步进
  Music.arm();
  const playing = Music.playing === true;
  Sfx.ctx.currentTime = 1.0;
  const s0 = Music._step;
  Music.tick();
  const advanced = Music._step > s0;
  console.log(`  ${playing && advanced ? '✓' : '✗'} BGM 起播=${playing}，排程步进 ${s0} → ${Music._step}`);
  if (!playing) bad('BGM 未起播');
  if (!advanced) bad('BGM 排程器没有推进');

  // 静音是全局的：一键同时管住音效与 BGM
  Sfx.setMuted(true);
  const mutedOff = Music.muted === true && Music.playing === false;
  Sfx.setMuted(false);
  const backOn = Music.muted === false && Music.playing === true;
  console.log(`  ${mutedOff && backOn ? '✓' : '✗'} 静音联动：静音停 BGM=${mutedOff}，取消静音自动恢复=${backOn}`);
  if (!mutedOff) bad('静音没有停掉 BGM');
  if (!backOn) bad('取消静音后 BGM 没有恢复');

  Music.stop();
  Music._armed = false;      // 别让后面的 UI 初始化把定时器再拉起来
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
    // 关卡开场横幅：标题 + 提示分两行（原来拼成一整句，竖屏下会撑成一大坨）
    const tEl = document.getElementById('toast');
    const bannerOk = tEl.classList.contains('toast-level') &&
      /toast-title/.test(tEl.innerHTML) && /第 1 关/.test(tEl.innerHTML) && /toast-tip/.test(tEl.innerHTML);
    console.log(`  ${bannerOk ? '✓' : '✗'} 关卡横幅双行结构: ${JSON.stringify(tEl.innerHTML.slice(0, 72))}`);
    if (!bannerOk) bad('关卡开场横幅没有渲染成"标题+提示"两行结构');
    // 普通提示必须退回单行样式，不能残留横幅布局
    UI.toast('普通提示');
    const plainOk = !tEl.classList.contains('toast-level') && tEl.textContent === '普通提示';
    console.log(`  ${plainOk ? '✓' : '✗'} 普通 toast 不残留横幅样式`);
    if (!plainOk) bad('普通 toast 残留了关卡横幅的布局类');
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

    // 清档必须真的扣 1 次清空机会：Save.reset() 会把 rescueResets 复位成 3，
    // 若 UI 层不显式扣回，清档就等于"清空机会无限刷新"，三次限制形同虚设。
    // 另：激活码充入的 credit 是玩家申请来的额度，清档只清进度、不没收。
    Save.reset();
    Save.data.rescueResets = 2;
    Save.data.rescueCount = 3;            // 今日已用完 → 清档可刷新救援次数
    Save.data.rescueCredit = 4;
    Save.save();
    document.getElementById('btn-reset').onclick();            // 打开自绘确认框
    document.getElementById('btn-confirm-ok').onclick();       // 点「确认清除」
    const resetsNow = Save.data.rescueResets;
    const dailyNow = Save.rescueDailyLeft;
    const creditNow = Save.rescueCreditLeft;
    const resetRuleOk = resetsNow === 1 && dailyNow === 3 && creditNow === 4;
    console.log(`  ${resetRuleOk ? '✓' : '✗'} 清档配额结算：清空 2→${resetsNow}，今日救援→${dailyNow}/3，credit 保留 ${creditNow}`);
    if (resetsNow !== 1) bad('清档必须消耗 1 次清空机会（Save.reset 会复位，UI 需显式扣回）');
    if (dailyNow !== 3) bad('清档后今日救援次数应恢复为 3');
    if (creditNow !== 4) bad('清档不应没收激活码充入的额外次数');

    // 回归：从主菜单「清除存档 / 申请救援次数」入口打开弹窗后点「放弃」，
    // 必须回到主菜单、菜单可见。曾经不区分来源就 show(null) + phase='losing'：
    // 主菜单场景下 game.mode 还是 'menu'，show(null) 会把所有面板一起隐藏，
    // 而 HUD 只在 play 模式显示 → 整屏空白、点什么都没反应。
    Save.reset();
    Save.data.rescueCount = 3; Save.data.rescueResets = 0; Save.save();   // 今日用完 + 清空耗尽 → 走 forceActivate 路径
    UI.promptRescue({ pigsLeft: 0, rescueLeft: 0, resetLeft: 0, forceActivate: true });
    const rescueShown = !document.getElementById('screen-rescue').classList.contains('hidden');
    UI.game.mode = 'menu';                       // 模拟"从主菜单进来申请"的场景
    UI.game.phase = 'aim';
    UI._rescueGiveup();
    const backToMenu = !document.getElementById('screen-menu').classList.contains('hidden');
    const rescueHidden = document.getElementById('screen-rescue').classList.contains('hidden');
    const giveupOk = rescueShown && backToMenu && rescueHidden;
    console.log(`  ${giveupOk ? '✓' : '✗'} 放弃救援回主菜单：弹窗显示=${rescueShown} 主菜单可见=${backToMenu} 弹窗关闭=${rescueHidden}`);
    if (!giveupOk) bad('从主菜单申请救援次数后点「放弃」没有回到主菜单（会导致整屏空白卡死）');

    // 关卡内点「放弃救援」仍应走判负结算（不能误伤成回主菜单）
    Save.reset();
    UI.game.mode = 'birds';
    UI.game.phase = 'rescue';
    UI.promptRescue({ pigsLeft: 2, rescueLeft: 3, resetLeft: 3 });
    UI._rescueGiveup();
    const losingOk = UI.game.phase === 'losing';
    console.log(`  ${losingOk ? '✓' : '✗'} 关卡内放弃救援走判负：phase=${UI.game.phase}`);
    if (!losingOk) bad('关卡内放弃救援没有走判负流程');

    // 主菜单背景必须跟随当前进度关卡（旧实现写死 loadLevel(0)，
    // 玩家打到第 8 关时封面还停在第 1 关，与进度脱节）。
    Save.reset();
    Save.data.unlocked = 7; Save.save();
    UI.show('screen-menu');
    const menuLvl = UI.game.levelIndex;
    const menuName = UI.game.level && UI.game.level.name;
    const menuMode = UI.game.mode;
    const followOk = menuLvl === 6 && menuMode === 'menu';
    console.log(`  ${followOk ? '✓' : '✗'} 菜单背景跟随进度：unlocked=7 → 关卡#${menuLvl}「${menuName}」mode=${menuMode}`);
    if (!followOk) bad('主菜单背景没有跟随「开始冒险」将要进入的关卡');

    // 竖屏菜单：舞台加 .menu-scene，场景窗位置写入 --scene-cy/--scene-hh/--scene-w
    // （mock 的 matchMedia 返回 false，即非竖屏，应清空变量且不加类）
    const stageEl = document.getElementById('stage');
    const portraitOk = !stageEl.classList.contains('menu-scene');
    UI.show('screen-levels');
    const notMenuOk = !stageEl.classList.contains('menu-scene');
    console.log(`  ${notMenuOk && portraitOk ? '✓' : '✗'} 非竖屏/非菜单不挂 .menu-scene（离开菜单即摘掉）`);
    if (!notMenuOk) bad('.menu-scene 未在离开主菜单时摘掉，游戏内布局会被撑成满屏');
    if (!portraitOk) bad('非竖屏下不应给舞台挂 .menu-scene');
    Save.reset();
    UI.show('screen-menu');
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

  // 彩蛋关解锁门槛：累计 EGG_UNLOCK_STARS 颗星（不限关卡，任意关都能贡献）
  // 旧条件「第 3 关 2 星」把门槛绑死在单关，玩家卡在那关就永远解锁不了。
  const probe = (lvlIdx, score, preStars) => {
    Save.data.levels = {};
    Save.data.eggUnlocked = false;
    // 预置"之前已打过的关"的星数（跳过目标关，避免被本次通关结算覆盖）
    let need = preStars | 0, i = 0;
    while (need > 0 && i < LEVELS.length) {
      if (i !== lvlIdx) {
        const s = Math.min(3, need);
        Save.data.levels[i] = { stars: s, score: 999999 };
        need -= s;
      }
      i++;
    }
    const gg = new Game(makeEl());
    gg.loadLevel(lvlIdx);
    gg.birdQueue.length = 0;          // 屏蔽剩余小鸟奖励，精确控制分数
    gg.score = score;
    gg.finishLevel(true);
    return Save.data.eggUnlocked;
  };
  const t0 = LEVELS[0]().stars;
  const below = probe(0, t0[0], EGG_UNLOCK_STARS - 2);   // 前置 4 星 + 本关 1 星 = 5 < 6 → 不解锁
  const reach = probe(0, t0[0], EGG_UNLOCK_STARS - 1);   // 前置 5 星 + 本关 1 星 = 6 → 解锁
  console.log(`  ${!below && reach ? '✓' : '✗'} 解锁门槛：累计 ${EGG_UNLOCK_STARS - 1} 星→${below ? '解锁' : '未解锁'}，累计 ${EGG_UNLOCK_STARS} 星→${reach ? '解锁' : '未解锁'}`);
  if (below) bad(`累计星数不足 ${EGG_UNLOCK_STARS} 时不应解锁彩蛋关`);
  if (!reach) bad(`累计 ${EGG_UNLOCK_STARS} 星应解锁彩蛋关`);

  // 未达门槛时的提示文案应说明"累计多少星、还差几颗"
  Save.data.levels = {}; Save.data.eggUnlocked = false;
  const gg2 = new Game(makeEl());
  gg2.loadLevel(0);
  gg2.birdQueue.length = 0;
  gg2.score = t0[0];
  let hintText = '';
  gg2.onFinish = (res) => { hintText = res.eggHint || ''; };
  gg2.finishLevel(true);
  const hintOk = /累计/.test(hintText) && /还差/.test(hintText);
  console.log(`  ${hintOk ? '✓' : '✗'} 未达门槛提示文案: ${JSON.stringify(hintText)}`);
  if (!hintOk) bad('未达解锁门槛时应提示"累计 N 颗星、还差几颗"');
  Save.reset();
}

/* ---------- 4.95 通关必得星（1 星门槛 < 最低通关分） ---------- */
console.log('— 通关必得星（1 星门槛 vs 最低通关分） —');
{
  // 最低通关分 = 全场猪分 + 全部砖块分（即用尽所有鸟才通关也能拿到的分数）。
  // 1 星门槛必须低于它，否则会出现"打通了却 0 星"的挫败感 ——
  // L1 曾踩过：最低通关 9500，而 1 星门槛设成 13000。
  const PIG_SCORE = { small: 3000, normal: 5000, helmet: 7000, king: 12000 };
  let allOk = true;
  for (let i = 0; i < LEVELS.length; i++) {
    const d = LEVELS[i]();
    const pigScore = d.pigs.reduce((s, p) => s + PIG_SCORE[p.type], 0);
    const blkScore = d.blocks.reduce((s, b) => s + MATERIALS[b.mat].score, 0);
    const lowest = pigScore + blkScore;
    const oneBird = lowest + (d.birds.length - 1) * 10000;      // 1 只鸟通关（理论最高）
    const ok1 = d.stars[0] < lowest;                            // 通关必得 ≥1 星
    const ok3 = d.stars[2] < oneBird;                           // 3 星可达
    const inc = d.stars[0] < d.stars[1] && d.stars[1] < d.stars[2];
    if (!ok1 || !ok3 || !inc) allOk = false;
    console.log(`  第${i + 1}关: 1星门槛 ${d.stars[0]} < 最低通关 ${lowest} ${ok1 ? '✓' : '✗'} | 3星 ${d.stars[2]} < 满鸟 ${oneBird} ${ok3 ? '✓' : '✗'} | 递增 ${inc ? '✓' : '✗'}`);
  }
  if (!allOk) bad('存在星级门槛异常（通关可能 0 星 / 3 星不可达 / 门槛不递增）');
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
