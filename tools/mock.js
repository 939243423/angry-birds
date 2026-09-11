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
    // 简单模拟：根据 #id 找出对应元素
    const m = /^#([\w-]+)/.exec(sel);
    if (m) {
      const e = els[m[1]] || (els[m[1]] = makeEl());
      return [e];
    }
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
// 注意：这里刻意不提供 global.confirm —— UI 已改为自绘确认弹窗。
// 若将来代码回归调用原生 confirm，冒烟测试会直接抛 ReferenceError 报错。

const dir = path.join(__dirname, '..', 'js');
for (const f of ['utils.js', 'audio.js', 'particles.js', 'physics.js', 'entities.js', 'levels.js', 'render.js', 'egggame.js', 'game.js'])
  vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });

module.exports = { makeEl, makeCtx };
