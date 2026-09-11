/* ============================================================
 * ui.js — 界面绑定 / 主循环 / 移动端适配
 * ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

const UI = {
  game: null,
  screen: 'menu',
  init() {
    Save.load();
    this.game = new Game($('game'));
    const g = this.game;

    // 菜单背景：预载第一关场景
    g.loadLevel(0);
    g.mode = 'menu';

    this.buildLevels();
    this.buildLegend();

    g.onScore = (s) => {
      const el = $('hud-score');
      el.textContent = s.toLocaleString();
      el.classList.add('pop');
      setTimeout(() => el.classList.remove('pop'), 130);
    };
    g.onState = () => this.updateHud();
    g.onHint = (text) => this.toast(text, text ? 2600 : 0);
    g.onPause = (p) => {
      Music.duck(p);                       // 暂停时把 BGM 压下去，回到游戏再抬起来
      if (p) this.updatePausePanel();
      this.show(p ? 'screen-pause' : null);
    };
    g.onFinish = (res) => this.showResult(res);
    g.onEggFinish = (res) => this.showEggResult(res);
    g.onEggExit = () => { this.show('screen-menu'); this.refreshMenu(); };
    g.onRescueRequest = (info) => this.promptRescue(info);

    // 按钮
    $('btn-play').onclick = () => { Sfx.click(); this.startLevel(Math.min(Save.data.unlocked, LEVELS.length) - 1); };
    $('btn-levels').onclick = () => { Sfx.click(); this.buildLevels(); this.show('screen-levels'); };
    $('btn-howto').onclick = () => { Sfx.click(); this.show('screen-howto'); };
    $('btn-reset').onclick = () => {
      Sfx.init(); Sfx.click();
      const total = Save.totalStars;
      const resetsLeft = Save.data.rescueResets;
      const rescueLeft = Save.rescueLeft;
      // 关键约束：清空次数 = 终身额度 = 3。
      // 若今日救援次数已耗尽 + 清空次数也已耗尽，
      // 此时再清除存档既不能刷救援次数也无意义 —— 引导玩家走激活码申请。
      if (rescueLeft === 0 && resetsLeft === 0) {
        this.confirm({
          icon: '🔑',
          title: '清空机会已用完',
          desc: `今日救援次数与清空机会都已耗尽。\n请前往「激活码申请」获取额外救援次数 —— 清除存档已无法刷新。`,
          okText: '去申请激活码',
          back: 'screen-menu',
          onOk: () => {
            this.promptRescue({ pigsLeft: 0, rescueLeft: 0, resetLeft: 0, forceActivate: true });
          }
        });
        return;
      }
      // 否则正常确认清除，并明确告知：会扣 1 次清空机会（若有救援次数可借此刷新）
      const willRefresh = rescueLeft === 0;
      this.confirm({
        icon: '🗑️',
        title: '清除所有存档？',
        desc:
          `将删除全部关卡进度、${total} 颗星与金羽记录，且无法恢复。\n` +
          (resetsLeft > 0
            ? `将消耗 1 次「清空机会」（剩 ${resetsLeft - 1} / 3）` + (willRefresh ? '，并刷新今日救援次数为 3。' : '')
            : `「清空机会」已耗尽，无法刷新救援次数。`),
        okText: '确认清除',
        danger: true,
        back: 'screen-menu',
        onOk: () => {
          // 坑：Save.reset() 会把所有配额字段一起归位（rescueResets 回到 3）。
          // 若不在这里显式扣回，清档就等于"清空机会无限刷新"，与设计意图完全相反。
          // 另外激活码充入的 credit 是玩家申请的资产，清档只清进度、不没收。
          const keepCredit = Save.rescueCreditLeft;
          Save.reset();
          Save.data.rescueResets = resetsLeft > 0 ? resetsLeft - 1 : 0;
          Save.data.rescueCredit = keepCredit;
          Save.save();
          this.buildLevels();
          this.refreshMenu();
          this.toast(resetsLeft > 0
            ? '存档已清除，进度已重置，救援次数已刷新'
            : '存档已清除，进度已重置');
        }
      });
    };
    // 救援 / 激活码 弹窗按钮
    $('btn-rescue-confirm').onclick = () => { Sfx.click(); this._rescueConfirm(); };
    $('btn-rescue-giveup').onclick = () => { Sfx.click(); this._rescueGiveup(); };
    $('btn-rescue-giveup2').onclick = () => { Sfx.click(); this._rescueGiveup(); };
    $('btn-rescue-activate').onclick = () => { Sfx.click(); this._rescueActivate(); };
    // 激活码输入即时反馈：长度到 8 自动触发激活（键盘友好）
    $('rescue-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._rescueActivate(); }
    });
    $('rescue-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
    });
    // 「用清空次数刷新救援次数」动态按钮（仅在次数已耗尽时显示）
    const resetBtn = $('btn-rescue-reset');
    if (resetBtn) resetBtn.onclick = () => { Sfx.click(); this._rescueUseReset(); };
    $('btn-confirm-ok').onclick = () => {
      Sfx.click();
      const cb = this._confirmCb; this._confirmCb = null;
      this.show(this._confirmBack || 'screen-menu');
      if (cb) cb();
    };
    $('btn-confirm-cancel').onclick = () => {
      Sfx.click();
      this._confirmCb = null;
      this.show(this._confirmBack || 'screen-menu');
    };
    $('btn-back-menu').onclick = () => { Sfx.click(); this.show('screen-menu'); };
    $('btn-back-menu2').onclick = () => { Sfx.click(); this.show('screen-menu'); };
    $('btn-pause').onclick = () => { Sfx.click(); g.togglePause(); };
    $('btn-restart').onclick = () => { Sfx.click(); g.restart(); this.show(null); };
    $('btn-retry').onclick = () => { Sfx.click(); this.show(null); g.restart(); };
    $('btn-tolevels').onclick = () => { Sfx.click(); this.show(null); this.buildLevels(); this.show('screen-levels'); };
    $('btn-next').onclick = () => {
      Sfx.click(); this.show(null);
      const n = g.levelIndex + 1;
      if (n < LEVELS.length) this.startLevel(n); else { this.show('screen-levels'); this.buildLevels(); }
    };
    $('btn-resume').onclick = () => { Sfx.click(); g.togglePause(); };
    $('btn-pause-restart').onclick = () => { Sfx.click(); this.show(null); g.restart(); };
    $('btn-pause-menu').onclick = () => { Sfx.click(); g.paused = false; g.mode = 'menu'; this.show('screen-menu'); this.refreshMenu(); };

    // 彩蛋关
    $('btn-egg').onclick = () => {
      Sfx.init(); Sfx.click();
      $('egg-feathers').textContent = Save.data.feathers;
      this.show('screen-egg');
    };
    $('btn-egg-easy').onclick = () => { Sfx.click(); this.startEgg(0); };
    $('btn-egg-hard').onclick = () => { Sfx.click(); this.startEgg(1); };
    $('btn-egg-back').onclick = () => { Sfx.click(); this.show('screen-menu'); };

    // 彩蛋关解锁庆祝弹窗
    $('btn-unlock-go').onclick = () => { Sfx.click(); this.startEgg(0); };
    $('btn-unlock-later').onclick = () => {
      Sfx.click(); this.show('screen-menu'); this.refreshMenu();
    };

    // 静音
    const muteBtn = $('btn-mute');
    muteBtn.classList.remove('hidden');
    const applyMute = () => {
      muteBtn.textContent = Save.data.muted ? '🔇' : '🔊';
      Sfx.setMuted(Save.data.muted);
    };
    muteBtn.onclick = () => { Save.data.muted = !Save.data.muted; Save.save(); applyMute(); };
    applyMute();

    // 音频解锁：浏览器策略要求先有用户手势才允许出声（BGM 也受此限制）。
    // 首次点按/按键时初始化音频并起播 BGM，之后注销监听。
    const unlockAudio = () => {
      Sfx.init(); Sfx.resume();
      if (!Save.data.muted) Music.arm();
      if (window.removeEventListener) {
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      }
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    this.refreshMenu();
    this.show('screen-menu');
    this.setupMobile();

    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.update(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  /* ---------------- 界面切换 ---------------- */
  show(id) {
    ['screen-menu', 'screen-levels', 'screen-howto', 'screen-result',
     'screen-pause', 'screen-egg', 'screen-unlock', 'screen-confirm',
     'screen-rescue'].forEach(s => {
      $(s).classList.add('hidden');
    });
    $('hud').classList.toggle('hidden', !(id === null && this.game.mode === 'birds'));
    if (id) $(id).classList.remove('hidden');
  },

  /* 通用确认弹窗：替代原生 confirm（系统弹窗样式无法控制，观感割裂） */
  confirm(opts) {
    const o = opts || {};
    this._confirmCb = o.onOk || null;
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('confirm-ico', o.icon || '⚠️');
    set('confirm-title', o.title || '确认操作');
    set('confirm-desc', o.desc || '');
    const ok = $('btn-confirm-ok');
    if (ok) {
      ok.textContent = o.okText || '确定';
      ok.classList.toggle('btn-danger', o.danger !== false);
    }
    this._confirmBack = o.back || 'screen-menu';
    this.show('screen-confirm');
  },

  toast(text, ms = 2000) {
    const el = $('toast');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('toast-level');
    el.textContent = text;
    this._revealToast(ms);
  },

  /** 关卡开场横幅：标题 + 提示分两行。原来拼成一整句，
   *  在手机竖屏里会被撑成一大坨，遮掉半个画面。 */
  levelToast(i, level) {
    const el = $('toast');
    if (!el || !level) return;
    el.innerHTML =
      `<b class="toast-title">第 ${i + 1} 关 · ${esc(level.name)}</b>` +
      `<span class="toast-tip">${esc(level.tip)}</span>`;
    el.classList.add('toast-level');
    this._revealToast(3200);
  },

  _revealToast(ms) {
    const el = $('toast');
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._toastT);
    if (ms) this._toastT = setTimeout(() => el.classList.add('hidden'), ms);
  },

  /* ---------------- 游戏 ---------------- */
  startLevel(i) {
    const g = this.game;
    g.loadLevel(i);
    this.show(null);
    this.updateHud();
    Music.duck(false);
    this.levelToast(i, g.level);
  },
  startEgg(diff) {
    const g = this.game;
    g.mode = 'egg';
    g.egg.start(diff);
    this.show(null);
    $('hud').classList.add('hidden');
  },

  updateHud() {
    const g = this.game;
    if (g.mode !== 'birds' || !g.level) return;
    $('chip-level').textContent = `第 ${g.levelIndex + 1} 关 · ${g.level.name}`;
    const birdsLeft = g.birdQueue.length + (g.currentBird && g.phase === 'aim' ? 1 : 0);
    const pigsLeft = g.pigs.filter(p => !p.dead).length;
    $('chip-birds').textContent = `🐦 ${birdsLeft}　🐷 ${pigsLeft}`;
    const w = g.world.wind;
    const windBox = $('hud-wind');
    const arrow = windBox.querySelector('.wind-arrow');
    const val = windBox.querySelector('.wind-val');
    const calm = Math.abs(w) < 30;
    windBox.classList.toggle('calm', calm);
    windBox.classList.toggle('strong', Math.abs(w) >= 90);
    if (calm) { arrow.style.transform = 'scaleX(0)'; val.textContent = '无风'; }
    else {
      arrow.style.transform = w > 0 ? 'scaleX(1)' : 'scaleX(-1)';
      val.textContent = `${w > 0 ? '东风' : '西风'} ${Math.abs(Math.round(w / 10))} 级`;
    }
    $('hud-score').textContent = g.score.toLocaleString();
  },

  /* 暂停面板：展示本关实时进度，避免暂停后失去方向感 */
  updatePausePanel() {
    const g = this.game;
    const el = $('pause-stats');
    if (!el || g.mode !== 'birds' || !g.level) return;
    this.toast('');   // 清掉关卡提示，避免透过面板模糊层残留
    const pigsLeft = g.pigs.filter(p => !p.dead).length;
    const birdsLeft = g.birdQueue.length + (g.currentBird && g.phase === 'aim' ? 1 : 0);
    const tiers = g.level.stars;
    const next = tiers.findIndex(v => g.score < v);
    el.innerHTML =
      `<span class="ps-item">🐷 剩余猪 <b>${pigsLeft}</b> / ${g.pigs.length}</span>` +
      `<span class="ps-item">🐦 剩余鸟 <b>${birdsLeft}</b></span>` +
      `<span class="ps-item">⭐ <b>${g.score.toLocaleString()}</b>` +
      (next === -1 ? ' · 已满星' : ` · 距下一星还差 ${(tiers[next] - g.score).toLocaleString()}`) +
      '</span>';
  },

  buildLevels() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const unlocked = i < Save.data.unlocked;
      const rec = Save.data.levels[i] || { stars: 0 };
      const cell = document.createElement('div');
      cell.className = 'level-cell' + (unlocked ? (rec.stars > 0 ? ' cleared' : '') : ' locked');
      if (unlocked) {
        cell.innerHTML = `<div class="lv-num">${i + 1}</div><div class="lv-stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</div>`;
        cell.onclick = () => { Sfx.click(); this.startLevel(i); };
        cell.title = LEVELS[i]().name;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `第 ${i + 1} 关 ${LEVELS[i]().name}`);
      } else {
        // 锁定的关卡也响应点击，给出明确的解锁条件提示（此前点了没有任何反馈）
        cell.innerHTML = '<div class="lv-num">🔒</div><div class="lv-stars">未解锁</div>';
        const need = i;   // 需要通关的前一关（1 基序号即 i）
        cell.onclick = () => {
          Sfx.click();
          this.toast(`第 ${i + 1} 关尚未解锁 —— 先通关第 ${need} 关`, 2400);
        };
        cell.title = `通关第 ${need} 关后解锁`;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `第 ${i + 1} 关 未解锁，需先通关第 ${need} 关`);
      }
      grid.appendChild(cell);
    });
    $('total-stars').textContent = Save.totalStars;
    $('max-stars').textContent = LEVELS.length * 3;
  },

  buildLegend() {
    const el = $('bird-legend');
    if (!el) return;
    el.innerHTML = '';
    for (const k in BIRD_TYPES) {
      const d = BIRD_TYPES[k];
      const card = document.createElement('div');
      card.className = 'legend-card' + (d.rescue ? ' rescue' : '');
      const cv = document.createElement('canvas');
      cv.width = 132; cv.height = 132;      // 2x 分辨率，窄屏下也清晰
      cv.className = 'legend-canvas';
      const info = document.createElement('div');
      info.className = 'legend-info';
      const nm = document.createElement('b');
      nm.className = 'legend-name';
      nm.textContent = d.name;
      const sk = document.createElement('span');
      sk.className = 'legend-skill';
      sk.textContent = d.rescue ? `救援 · ${d.skill}` : d.skill;
      info.appendChild(nm); info.appendChild(sk);
      card.appendChild(cv); card.appendChild(info);
      el.appendChild(card);
      this.drawLegendBird(cv, d);
    }
  },

  /** 在图鉴小画布上绘制该小鸟的立绘（复用游戏内的绘制函数，保证风格一致） */
  drawLegendBird(cv, def) {
    const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!ctx || !this.game || !this.game.renderer) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // 统一视觉大小：把不同半径的鸟缩放到同一尺度，泰坦略放大以体现"巨力"
    const base = Math.min(W, H) * 0.5;
    const scale = (base * 0.62 / def.r) * (def.rescue ? 1.14 : 1);
    ctx.save();
    // 鸟的横向范围约为 [-1.75r(尾), +1.24r(喙)]，整体重心偏右，故左移一点才真正居中
    ctx.translate(W * 0.5 + def.r * scale * 0.26, H * 0.53 + def.r * scale * 0.1);
    ctx.scale(scale, scale);
    const fake = {
      def, r: def.r, state: 'idle', blink: 3, squash: 0,
      armedBlast: false, fuse: 0, x: 0, y: 0, vx: 0, vy: 0
    };
    this.game.renderer.birdBody(ctx, fake, 0, 1.6, 0);
    ctx.restore();
  },

  refreshMenu() {
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    const eggBtn = $('btn-egg');
    if (eggBtn) {
      const unlocked = Save.data.eggUnlocked;
      // 未解锁时入口完全不出现；解锁庆祝结束后才登场（带弹入动画）
      eggBtn.classList.toggle('hidden', !unlocked);
      eggBtn.classList.toggle('btn-primary', unlocked);
      eggBtn.textContent = `🥚 彩蛋关 · 蛋了个蛋（${Save.data.feathers}/3）`;
      if (unlocked && !this._eggRevealed) {
        this._eggRevealed = true;
        // 菜单此刻若被结算/庆祝面板遮着，动画会在下次显示菜单时才播
        eggBtn.classList.add('reveal');
        eggBtn.addEventListener('animationend', () => eggBtn.classList.remove('reveal'), { once: true });
      }
    }
    // 彩蛋关未解锁时，连金羽进度也一并隐藏，避免提前剧透
    const feathersStat = $('menu-feathers-stat');
    const statSep = $('menu-stat-sep');
    if (feathersStat) feathersStat.classList.toggle('hidden', !Save.data.eggUnlocked);
    if (statSep) statSep.classList.toggle('hidden', !Save.data.eggUnlocked);

    set('total-stars', Save.totalStars);
    set('max-stars', LEVELS.length * 3);
    set('menu-stars', Save.totalStars);
    set('max-stars-menu', LEVELS.length * 3);
    set('menu-feathers', Save.data.feathers);

    // 救援配额展示：今日剩余 + 激活码额外 + 清空机会。0 时换红色警示
    const rl = Save.rescueDailyLeft;          // 今日剩余（上限 3）
    const rc = Save.rescueCreditLeft;         // 激活码充入的额外次数
    const rs = Save.data.rescueResets;
    const totalLeft = rl + rc;                // 实际可用总次数
    const rlEl = $('menu-rescue-left'); if (rlEl) rlEl.textContent = rl;
    const rcEl = $('menu-credit-left'); if (rcEl) rcEl.textContent = rc;
    const rcWrap = $('menu-credit-inline'); if (rcWrap) rcWrap.classList.toggle('hidden', rc <= 0);
    const rsEl = $('menu-reset-left'); if (rsEl) rsEl.textContent = rs;
    $('menu-rescue-inline') && $('menu-rescue-inline').classList.toggle('exhausted', totalLeft === 0);
    $('menu-reset-inline') && $('menu-reset-inline').classList.toggle('exhausted', rs === 0);
    // 清空机会用完后，"清除存档"按钮改成去激活码申请入口
    const resetBtn = $('btn-reset');
    if (resetBtn) {
      resetBtn.textContent = (rs === 0 && totalLeft === 0) ? '申请救援次数' : '清除存档';
    }
  },

  /* ---------------- 救援请求 / 激活码申请 ---------------- */
  /** 入口：game.afterShot 检测到鸟用尽但还有猪时调用 */
  promptRescue(info) {
    const rescueLeft = Math.max(0, info.rescueLeft | 0);
    const resetLeft = Math.max(0, info.resetLeft | 0);
    const pigsLeft = info.pigsLeft | 0;
    // 状态条永远显示当前额度（让玩家对剩余资源有数）。
    // 拆成两枚徽章：今日剩余 / 3，以及激活码充入的「额外」次数 ——
    // 否则用激活码后合计会超过 3，显示成 "5/3" 很怪。
    const dailyLeft = Save.rescueDailyLeft;
    const creditLeft = Save.rescueCreditLeft;
    const rlEl = $('rescue-left'); if (rlEl) rlEl.textContent = dailyLeft;
    const rcEl = $('rescue-credit'); if (rcEl) rcEl.textContent = creditLeft;
    const rcStat = $('rescue-credit-stat'); if (rcStat) rcStat.classList.toggle('hidden', creditLeft <= 0);
    const rsEl = $('rescue-resets'); if (rsEl) rsEl.textContent = resetLeft;
    $('rescue-stat') && $('rescue-stat').classList.toggle('exhausted', dailyLeft === 0 && creditLeft === 0);
    $('rescue-reset-stat') && $('rescue-reset-stat').classList.toggle('exhausted', resetLeft === 0);
    // 决定走哪个模式
    const forceActivate = !!info.forceActivate;
    if (rescueLeft > 0 && !forceActivate) {
      // 模式 A：还能直接用
      $('rescue-mode-confirm').classList.remove('hidden');
      $('rescue-mode-activate').classList.add('hidden');
      $('rescue-desc').innerHTML =
        `「泰坦巨力」将于本关登场 —— 撞击即引发毁灭冲击，<b>必定清场</b>。<br>` +
        `确认使用后本关将<b>直接判胜</b>，剩余鸟不再发射。` +
        `<br>本关剩余 <b>${pigsLeft}</b> 只猪。`;
    } else {
      // 模式 B：申请激活码（次数耗尽），可选清空次数刷新
      $('rescue-mode-confirm').classList.add('hidden');
      $('rescue-mode-activate').classList.remove('hidden');
      const codeInput = $('rescue-code');
      const noteInput = $('rescue-note');
      const feedback = $('rescue-feedback');
      if (codeInput) codeInput.value = '';
      if (noteInput) noteInput.value = '';
      if (feedback) { feedback.textContent = ''; feedback.className = 'rescue-hint'; }
      const resetRow = $('btn-rescue-reset');
      if (resetRow) resetRow.classList.toggle('hidden', resetLeft <= 0);
      // 描述里明示当前资源
      const intro = rescueLeft === 0
        ? `今日救援次数 <b>已用完</b>（${dailyLeft}/3），清空机会 <b>${resetLeft > 0 ? '剩 ' + resetLeft : '已耗尽'}</b>。`
        : `当前还能用救援，但你想直接申请激活码。`;
      const introEl = $('rescue-mode-activate').querySelector('.rescue-desc');
      if (introEl) {
        introEl.innerHTML =
          intro +
          `<br>激活码 8 位，通过校验立即获得 <b>5</b> 次救援次数。` +
          (resetLeft > 0 ? `<br>你也可以消耗 1 次清空机会把救援次数直接刷回 3 次。` : '');
      }
    }
    this._rescueCtx = { pigsLeft };
    this.show('screen-rescue');
    // 自动聚焦激活码输入框（仅激活码模式）
    if (rescueLeft === 0 || forceActivate) {
      setTimeout(() => { const ci = $('rescue-code'); if (ci) ci.focus(); }, 80);
    }
  },

  /** 玩家点击「使用救援」 */
  _rescueConfirm() {
    const g = this.game;
    if (Save.rescueLeft <= 0) {
      this._rescueFeedback('今日救援次数已用完', 'error');
      return;
    }
    // 走 game.useRescue()：内部生成泰坦、给初速、走物理循环，
    // 泰坦撞击即触发 titanBlast 的斩杀结算特效
    const ok = g.useRescue();
    if (!ok) { this._rescueFeedback('当前状态下无法使用救援', 'error'); return; }
    this.refreshMenu();
    this.show(null);
  },

  /** 玩家点击「放弃救援」—— 直接判负 */
  _rescueGiveup() {
    const g = this.game;
    this.show(null);
    g.phase = 'losing'; g.endTimer = 1.1; Sfx.lose();
  },

  /** 玩家点击「立即激活」 */
  _rescueActivate() {
    const code = ($('rescue-code').value || '').trim();
    if (!code) { this._rescueFeedback('请输入 8 位激活码', 'error'); return; }
    const res = Save.activateRescueCode(code);
    this._rescueFeedback(res.msg, res.ok ? 'success' : 'error');
    if (res.ok) {
      this.refreshMenu();
      // 1 秒后重新弹出确认模式，让玩家再次决定是否使用救援
      setTimeout(() => this.promptRescue({
        pigsLeft: this._rescueCtx && this._rescueCtx.pigsLeft || 0,
        rescueLeft: Save.rescueLeft,
        resetLeft: Save.data.rescueResets
      }), 900);
    }
  },

  /** 玩家点击「用清空次数刷新救援」 */
  _rescueUseReset() {
    if (Save.useResetForRescue()) {
      this._rescueFeedback('已消耗清空次数，今日救援次数刷新为 3', 'success');
      this.refreshMenu();
      setTimeout(() => this.promptRescue({
        pigsLeft: this._rescueCtx && this._rescueCtx.pigsLeft || 0,
        rescueLeft: Save.rescueLeft,
        resetLeft: Save.data.rescueResets
      }), 900);
    } else {
      this._rescueFeedback('无法使用（可能已没有清空机会或今日还有次数）', 'error');
    }
  },

  _rescueFeedback(text, kind) {
    const el = $('rescue-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = 'rescue-hint ' + (kind || '');
  },

  showResult(res) {
    this.toast('');   // 清掉关卡提示，避免透过面板模糊层残留
    this.show('screen-result');
    const panel = $('screen-result');
    $('result-title').textContent = res.win ? (res.stars === 3 ? '完美通关！' : '关卡完成！') : '小鸟用完了…';
    $('result-score').textContent = res.score.toLocaleString();
    const rec = Save.data.levels[res.levelIndex] || { score: 0 };
    const best = Math.max(rec.score, res.score);
    $('result-best').textContent = best.toLocaleString();
    const badge = $('result-newbest');
    if (badge) badge.classList.toggle('hidden', !(res.win && res.score > rec.score));
    // 差星提示：本关未达 2 星时告诉玩家还差多少才能解锁隐藏关卡
    const eggHintEl = $('result-egg-hint');
    if (eggHintEl) {
      eggHintEl.textContent = res.eggHint || '';
      eggHintEl.classList.toggle('hidden', !res.eggHint);
    }
    $('btn-next').style.display = (res.win && res.levelIndex + 1 < LEVELS.length) ? '' : 'none';
    // 星级进度：告诉玩家距离下一颗星还差多少分
    const progEl = $('result-star-progress');
    if (progEl) {
      if (res.win) {
        const tiers = (LEVELS[res.levelIndex] || LEVELS[0])().stars;
        const nextIdx = tiers.findIndex(v => res.score < v);
        progEl.textContent = nextIdx === -1
          ? '已达成 ★★★ 满分评价'
          : `距 ★${nextIdx + 1} 还差 ${(tiers[nextIdx] - res.score).toLocaleString()} 分`;
        progEl.classList.toggle('done', nextIdx === -1);
        progEl.classList.remove('hidden');
      } else {
        progEl.classList.add('hidden');
      }
    }

    const stars = Array.from(document.querySelectorAll('#stars-row .star-big') || []);
    stars.forEach(s => { s.classList.remove('on'); s.style.animation = 'none'; });
    void panel.offsetWidth;
    for (let i = 0; i < res.stars; i++) {
      setTimeout(() => {
        if (!stars[i]) return;
        stars[i].classList.add('on');
        stars[i].style.animation = '';
        Sfx.star(i);
      }, 260 + i * 280);
    }
    if (this.game.justUnlockedEgg) {
      this.game.justUnlockedEgg = false;
      // 等结算面板的星级动画播完，再弹出解锁庆祝
      setTimeout(() => this.showUnlock(), 1750);
    }
    this.buildLevels();
    this.refreshMenu();
  },

  /* ---------------- 彩蛋关解锁庆祝 ---------------- */
  showUnlock() {
    if (!Save.data.eggUnlocked) return;
    this.show('screen-unlock');
    Sfx.win();
    // 光爆动画播两轮后再补一次星音，强化"奖励到手"的听感
    setTimeout(() => { if (!$('screen-unlock').classList.contains('hidden')) Sfx.star(2); }, 900);
  },

  showEggResult(res) {
    this.toast('');
    this.show('screen-result');
    $('result-title').textContent = res.win ? '彩蛋关通关！' : '槽位满了…';
    $('result-score').textContent = res.score.toLocaleString();
    $('result-best').textContent = `金羽 ${Save.data.feathers} / 3`;
    const nBadge = $('result-newbest');
    if (nBadge) nBadge.classList.add('hidden');
    const eHint = $('result-egg-hint');
    if (eHint) eHint.classList.add('hidden');
    const eProg = $('result-star-progress');
    if (eProg) eProg.classList.add('hidden');
    $('btn-next').style.display = 'none';
    const stars = document.querySelectorAll('#stars-row .star-big');
    stars.forEach(s => s.classList.remove('on'));
    if (res.win) {
      const n = res.diff === 0 ? 1 : 2;
      for (let i = 0; i < n; i++) setTimeout(() => { stars[i].classList.add('on'); Sfx.star(i); }, 260 + i * 280);
    }
    this.refreshMenu();
  },

  /* ---------------- 移动端适配 ---------------- */
  setupMobile() {
    const setVH = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };
    const checkOrient = () => {
      const portrait = window.innerHeight > window.innerWidth;
      const tip = $('rotate-tip');
      if (tip) {
        const show = portrait && this.isTouch();
        tip.classList.toggle('hidden', !show);
        // 提示只在前几秒强调一次，之后自动淡出，避免长期遮挡面板标题
        if (show && !tip.dataset.timed) {
          tip.dataset.timed = '1';
          tip.classList.add('autofade');
        } else if (!show) {
          tip.classList.remove('autofade');
          delete tip.dataset.timed;
        }
      }
      document.body && document.body.classList.toggle('portrait', portrait);
    };
    const onResize = () => { setVH(); checkOrient(); this.game.renderer.resize(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    setVH(); checkOrient();

    // 阻止双指缩放与橡皮筋
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', e => e.preventDefault());
  },
  isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }
};

window.addEventListener('DOMContentLoaded', () => UI.init());
