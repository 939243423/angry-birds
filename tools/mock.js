/* 统一的 mock 环境：加载全部游戏脚本，供调试脚本使用 */
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
    width: 1600, height: 900, style: {}, textContent: '', innerHTML: '', title: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
    appendChild() { }, addEventListener() { }, querySelector: () => makeEl(), querySelectorAll: () => [],
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
    // 简单模拟：根据 #id 找出对应元素
    const m = /^#([\w-]+)/.exec(sel);
    if (m) {
      const e = els[m[1]] || (els[m[1]] = makeEl());
      return [e];
    }
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
global.confirm = () => false;

const dir = path.join(__dirname, '..', 'js');
for (const f of ['utils.js', 'audio.js', 'particles.js', 'physics.js', 'entities.js', 'levels.js', 'render.js', 'egggame.js', 'game.js'])
  vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });

module.exports = { makeEl, makeCtx };
