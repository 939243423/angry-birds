#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""小鸟技能实证工具。

目的：不是"看截图猜"，而是**量化**每只鸟释放技能前后的世界状态差，
并抓取"技能释放后 0.08s"的画面（FX 最浓的那一帧），用于人眼核对。

用法：
    python tools/skillcheck.py           # 全部 9 只鸟
    python tools/skillcheck.py red blue  # 指定
"""
import os
import sys
import json
import time
import functools
import threading
import http.server
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, ".preview", "shots", "skills")
PORT = 8393

SAVE_KEY = "angrybirds_elemental_save_v1"
SAVE_TEMPLATE = {
    "levels": {}, "unlocked": 7, "feathers": 0,
    "eggUnlocked": True, "eggCleared": [False, False], "muted": True,
    "rescueCount": 0, "rescueResets": 3, "rescueCredit": 0, "rescueActivated": 0,
}

ALL_BIRDS = ["red", "yellow", "blue", "black", "green",
             "violet", "orange", "white", "giant"]

# 注入到页面：同一帧内「建鸟 → 快照 → 释放技能 → 快照」，避免游戏主循环
# 在两次 evaluate 之间推进物理、把 before/after 搅在一起。
# 另外把菜单 / 面板全部隐藏，让 canvas 上的技能特效不被遮挡。
PROBE_JS = """
(type) => {
  const g = window.__game;

  // 隐藏所有覆盖层，露出游戏画面
  for (const el of document.querySelectorAll('.screen, #overlay, .panel')) {
    el.classList.add('hidden');
  }
  const stage = document.getElementById('stage');
  if (stage) stage.classList.remove('menu-scene');

  g.loadLevel(0);
  g.mode = 'birds';
  const b = new (g.currentBird.constructor)(type, 420, 380);
  b.launch(760, -180);
  b.state = 'flying';
  g.birds = [b];
  g.currentBird = b;
  g.phase = 'fly';
  window.__b = b;

  const snap = () => ({
    alive: !b.dead,
    vx: Math.round(b.vx), vy: Math.round(b.vy),
    r: +b.r.toFixed(1),
    power: b.power,
    armedBlast: !!b.armedBlast,
    fuse: +b.fuse.toFixed(2),
    skillUsed: !!b.skillUsed,
    birds: g.birds.filter(x => !x.dead).length,
    wells: (g.wells || []).length,
    drops: (g.drops || []).length,
    fxCount: (g.fx && g.fx.p && g.fx.p.list) ? g.fx.p.list.length : -1,
    shake: g.fx ? +g.fx.shake.toFixed(1) : -1,
    flash: g.fx ? +g.fx.flash.toFixed(2) : -1,
    score: g.score,
  });

  const before = snap();
  const ret = b.useSkill(g);
  const after = snap();
  return { type, ret, before, after };
}
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server():
    handler = functools.partial(QuietHandler, directory=ROOT)
    httpd = Server(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run(birds):
    from playwright.sync_api import sync_playwright

    httpd = start_server()
    time.sleep(0.3)
    os.makedirs(OUTDIR, exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/index.html"

    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 720},
                                  device_scale_factor=1)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.add_init_script(
            "localStorage.setItem(%s, %s);"
            % (json.dumps(SAVE_KEY), json.dumps(json.dumps(SAVE_TEMPLATE)))
        )
        page.goto(url, wait_until="load")
        page.wait_for_timeout(1200)

        for t in birds:
            try:
                r = page.evaluate(PROBE_JS, t)
                rows.append(r)
                # 让 FX 粒子在画面里显形后再截图（0.1s，粒子还没散）
                page.wait_for_timeout(100)
                page.screenshot(path=os.path.join(OUTDIR, f"{t}.png"))
            except Exception as e:
                rows.append({"type": t, "error": str(e)})

        if errs:
            print("⚠ 页面错误：")
            for e in errs[:6]:
                print("  -", e)
        browser.close()

    httpd.shutdown()

    # ---- 输出量化对比 ----
    keys = [("vx", "vx"), ("vy", "vy"), ("r", "r"), ("power", "power"),
            ("fuse", "fuse"), ("armedBlast", "armed"),
            ("birds", "鸟数"), ("wells", "奇点"), ("drops", "空投"),
            ("fxCount", "粒子"), ("shake", "震屏"), ("flash", "闪白")]
    hdr = f"{'鸟':<7}{'ret':<6}" + "".join(f"{lbl:>10}" for _, lbl in keys)
    print("\n" + hdr)
    print("-" * len(hdr))
    for r in rows:
        t = r["type"]
        if r.get("error") or "before" not in r:
            print(f"{t:<7}  ERR {str(r.get('error', ''))[:60]}")
            continue
        b, a = r["before"], r["after"]
        cells = []
        for k, _ in keys:
            bv, av = b.get(k), a.get(k)
            if isinstance(bv, float):
                bv, av = round(bv, 1), round(av, 1)
            mark = "  ←" if bv != av else "    "
            cells.append(f"{str(bv)}>{av}{mark}".rjust(10))
        print(f"{t:<7}{str(r['ret']):<6}" + "".join(cells))

    # ---- 变化摘要 ----
    print("\n变化摘要：")
    for r in rows:
        t = r["type"]
        if r.get("error") or "before" not in r:
            print(f"  {t:<7} 错误 {r.get('error', '')}")
            continue
        b, a = r["before"], r["after"]
        changed = [lbl for (k, lbl) in keys if b.get(k) != a.get(k)]
        ok = r["ret"] and changed
        verdict = "✓ 技能生效" if ok else "✗ 技能未生效"
        print(f"  {t:<7} {verdict}（useSkill→{r['ret']}）：{', '.join(changed) if changed else '—'}")
    print(f"\n截图目录：{OUTDIR}")


def main():
    birds = [a for a in sys.argv[1:] if a in ALL_BIRDS] or ALL_BIRDS
    run(birds)


if __name__ == "__main__":
    main()
