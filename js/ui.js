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
    g.onPause = (p) => { if (p) this.updatePausePanel(); this.show(p ? 'screen-pause' : null); };
    g.onFinish = (res) => this.showResult(res);
    g.onEggFinish = (res) => this.showEggResult(res);
    g.onEggExit = () => { this.show('screen-menu'); this.refreshMenu(); };

    // 按钮
    $('btn-play').onclick = () => { Sfx.click(); this.startLevel(Math.min(Save.data.unlocked, LEVELS.length) - 1); };
    $('btn-levels').onclick = () => { Sfx.click(); this.buildLevels(); this.show('screen-levels'); };
    $('btn-howto').onclick = () => { Sfx.click(); this.show('screen-howto'); };
    $('btn-reset').onclick = () => {
      if (confirm('确定要清除所有存档（星星、解锁、金羽）吗？')) {
        Save.reset(); this.buildLevels(); this.refreshMenu(); this.toast('存档已清除');
      }
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
    ['screen-menu', 'screen-levels', 'screen-howto', 'screen-result', 'screen-pause', 'screen-egg', 'screen-unlock'].forEach(s => {
      $(s).classList.add('hidden');
    });
    $('hud').classList.toggle('hidden', !(id === null && this.game.mode === 'birds'));
    if (id) $(id).classList.remove('hidden');
  },

  toast(text, ms = 2000) {
    const el = $('toast');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
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
    this.toast(`第 ${i + 1} 关 · ${g.level.name} — ${g.level.tip}`, 3200);
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
      cell.innerHTML = `<div class="lv-num">${i + 1}</div><div class="lv-stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</div>`;
      if (unlocked) {
        cell.onclick = () => { Sfx.click(); this.startLevel(i); };
        cell.title = LEVELS[i]().name;
      } else cell.innerHTML = `<div class="lv-num">🔒</div><div class="lv-stars">未解锁</div>`;
      grid.appendChild(cell);
    });
    $('total-stars').textContent = Save.totalStars;
    $('max-stars').textContent = LEVELS.length * 3;
  },

  buildLegend() {
    const el = $('bird-legend');
    el.innerHTML = '';
    for (const k in BIRD_TYPES) {
      const d = BIRD_TYPES[k];
      const s = document.createElement('span');
      s.innerHTML = `<b style="color:${d.body}">●</b> ${d.name}：${d.skill}`;
      el.appendChild(s);
    }
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
        tip.classList.toggle('hidden', !(portrait && this.isTouch()));
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
