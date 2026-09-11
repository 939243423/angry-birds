#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""主线关卡机制验证 —— 验证每关"该有的机制"真的落了地。

用法：
    python tools/levelcheck.py
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
OUTDIR = os.path.join(ROOT, ".preview", "shots", "levels")
PORT = 8399

SAVE_KEY = "angrybirds_elemental_save_v1"
SAVE_TEMPLATE = {
    "levels": {}, "unlocked": 10, "feathers": 0,
    "eggUnlocked": False, "eggCleared": [False, False], "muted": True,
    "rescueCount": 0, "rescueResets": 3, "rescueCredit": 0, "rescueActivated": 0,
}


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


# 每关的"机制体检表"：每条断言都是一句 expect/want 短语 + js_predicate
# predicate 返回 {ok, got, want}，report 时把 got/want 打出来便于定位
LEVEL_CHECKS = {
    0: {  # L1 初次试飞：基础弹弓 + 红/黄/蓝鸟
        "name": "初次试飞",
        "must": [
            ("only_wood_stone", "材质只用 wood/stone（不引入高级机制）",
             "def.blocks.every(b => ['wood','stone'].includes(b.mat))"),
            ("no_tnt",          "无 TNT（连锁爆炸是 L3 才引入）",
             "!def.blocks.some(b => b.mat === 'tnt')"),
            ("no_spring",       "无弹簧（弹簧是 L4 才引入）",
             "!def.springs || def.springs.length === 0"),
            ("no_portal",       "无传送门（L5 才引入）",
             "!def.portals || def.portals.length === 0"),
            ("no_fan",          "无气流（L7 才引入）",
             "!def.fans || def.fans.length === 0"),
            ("basic_birds",     "鸟种 ∈ {红黄蓝}（基础三色）",
             "def.birds.every(t => ['red','yellow','blue'].includes(t))"),
            ("no_wind",         "无风",
             "def.wind === 0"),
            ("2_pigs",          "2 只猪（教学关最简）",
             "def.pigs.length === 2"),
        ],
    },
    1: {  # L2 木石之塔
        "name": "木石之塔",
        "must": [
            ("has_stone",       "含 stone 砖块（木石材质对比）",
             "def.blocks.some(b => b.mat === 'stone')"),
            ("has_wood",        "含 wood 砖块",
             "def.blocks.some(b => b.mat === 'wood')"),
            ("no_tnt",          "无 TNT",
             "!def.blocks.some(b => b.mat === 'tnt')"),
            ("has_yellow",      "黄鸟在场（题词：'黄鸟穿透木头'）",
             "def.birds.includes('yellow')"),
            ("tall_structure",  "≥2 段垂直堆叠（结构够高，体现'塔'）",
             "def.blocks.filter(b => b.mat === 'stone').length >= 4"),
            ("no_wind",         "无风",
             "def.wind === 0"),
        ],
    },
    2: {  # L3 烈焰引爆
        "name": "烈焰引爆",
        "must": [
            ("has_tnt",         "含 TNT（连锁爆炸核心）",
             "def.blocks.some(b => b.mat === 'tnt')"),
            ("has_black",       "黑鸟在场（定时炸弹）",
             "def.birds.includes('black')"),
            ("multi_pigs",      "≥3 只猪（连锁伤害有收割目标）",
             "def.pigs.length >= 3"),
        ],
    },
    3: {  # L4 弹簧蹦床
        "name": "弹簧蹦床",
        "must": [
            ("has_spring",      "含弹簧（核心机制）",
             "def.springs && def.springs.length >= 1"),
            ("has_helmet",      "含戴钢盔猪（hp 520 的重甲目标）",
             "def.pigs.some(p => p.type === 'helmet')"),
            ("no_portal",       "无传送门（属 L5）",
             "!def.portals || def.portals.length === 0"),
        ],
    },
    4: {  # L5 空间传送
        "name": "空间传送",
        "must": [
            ("has_portal",      "含传送门（核心机制）",
             "def.portals && def.portals.length >= 1"),
            ("portal_pair",     "传送门成对（一进一出 = 6 元组）",
             "def.portals[0].length === 6"),
            ("portal_rotated",  "传送门朝向不同（不能都是 0°）",
             "def.portals[0][2] !== def.portals[0][5]"),
        ],
    },
    5: {  # L6 气球猪与风
        "name": "气球猪与风",
        "must": [
            ("has_balloon",     "含气球猪（balloon:true）",
             "def.pigs.filter(p => p.balloon).length >= 1"),
            ("has_wind",        "风力非零（影响弹道）",
             "def.wind !== 0"),
            ("multi_balloons",  "≥2 只气球猪",
             "def.pigs.filter(p => p.balloon).length >= 2"),
        ],
    },
    6: {  # L7 冰川裂隙
        "name": "冰川裂隙",
        "must": [
            ("has_ice",         "含 ice 砖块（低摩擦冰块）",
             "def.blocks.some(b => b.mat === 'ice')"),
            ("has_fan",         "含上升气流（核心机制）",
             "def.fans && def.fans.length >= 1"),
            ("fan_up",          "气流方向 = up（托住飞行物）",
             "def.fans && def.fans[0][4] === 'up'"),
            ("has_blue",        "蓝鸟在场（题词：'蓝鸟专破冰块'）",
             "def.birds.includes('blue')"),
            ("has_wind",        "附加风力（综合环境）",
             "def.wind !== 0"),
            ("multi_tower",     "≥3 座独立结构（冰塔 + 玻璃柱 + 石柱）",
             "def.blocks.length >= 9"),
        ],
    },
    7: {  # L8 末日要塞
        "name": "末日要塞",
        "must": [
            ("has_king",        "含国王猪（最高 hp 目标）",
             "def.pigs.some(p => p.type === 'king')"),
            ("has_tnt",         "含 TNT（'先炸掉 TNT 打开缺口'）",
             "def.blocks.some(b => b.mat === 'tnt')"),
            ("has_spring",      "含弹簧（综合机制）",
             "def.springs && def.springs.length >= 1"),
            ("has_portal",      "含传送门（综合机制）",
             "def.portals && def.portals.length >= 1"),
            ("has_wind",        "附加风力",
             "def.wind !== 0"),
            ("has_helmet",      "含戴钢盔猪",
             "def.pigs.some(p => p.type === 'helmet')"),
            ("has_ice",         "含冰块（混材质）",
             "def.blocks.some(b => b.mat === 'ice')"),
            ("many_birds",      "≥5 只鸟（最终决战）",
             "def.birds.length >= 5"),
        ],
    },
    8: {  # L9 回旋峡谷
        "name": "回旋峡谷",
        "must": [
            ("behind_pig",      "弹弓后方（x<400）有猪（必须用回旋/引力）",
             "def.pigs.some(p => p.x < 400)"),
            ("has_green",       "回旋绿在场（'折返打身后的猪'）",
             "def.birds.includes('green')"),
            ("has_violet",      "引力紫在场（'把远处目标吸过来'）",
             "def.birds.includes('violet')"),
            ("static_behind",   "后方平台是 static:true（悬空不落）",
             "def.blocks.filter(b => b.x < 400 && b.static === true).length >= 1"),
            ("front_pigs",      "前方（x>1000）也有猪（双面阵地）",
             "def.pigs.some(p => p.x > 1000)"),
            ("no_wind",         "无风（单纯考验回旋判定）",
             "def.wind === 0"),
        ],
    },
    9: {  # L10 引力奇点
        "name": "引力奇点",
        "must": [
            ("three_towers",    "3 座独立塔（x ∈ [800,1000] / [1100,1200] / [1350,1450]）",
             "def.blocks.filter(b => b.mat !== 'stone' || b.w !== 600).filter(b => b.x > 800 && b.x < 1500).length >= 6"),
            ("tower_separation","3 塔 x 中心至少 130px 互不相连",
             "(function(){ const xs = [...new Set(def.blocks.filter(b=>b.x>700&&b.x<1500).map(b=>Math.round(b.x/50)*50))].sort((a,b)=>a-b); return xs.length >= 3; })()"),
            ("has_violet",      "引力紫在场（核心技能）",
             "def.birds.some(t => t === 'violet')"),
            ("two_violets",     "≥2 只紫（'两发引力场合一网打尽'）",
             "def.birds.filter(t => t === 'violet').length >= 2"),
            ("has_king",        "含国王猪（章末 BOSS）",
             "def.pigs.some(p => p.type === 'king')"),
            ("has_helmet",      "含戴钢盔猪",
             "def.pigs.some(p => p.type === 'helmet')"),
            ("multi_mat",       "≥3 种材质（石/冰/木，混合防御）",
             "(function(){ const s = new Set(def.blocks.map(b=>b.mat)); return s.size >= 3; })()"),
        ],
    },
}


def run():
    from playwright.sync_api import sync_playwright

    httpd = start_server()
    time.sleep(0.3)
    os.makedirs(OUTDIR, exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/index.html"

    all_pass = True
    summary_rows = []

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

        for idx, info in LEVEL_CHECKS.items():
            results = []
            checks = info["must"]
            # 把每条 js 包到「LEVELS[idx]() 后取 def」的闭包里
            for key, desc, js in checks:
                expr = """(idx) => {
                  const def = LEVELS[idx]();
                  try { return {ok: !!(%s)}; } catch(e) { return {ok:false, err: String(e)}; }
                }""" % js
                r = page.evaluate(expr, idx)
                results.append((key, r.get("ok", False), desc, r.get("err", "")))
            ok_count = sum(1 for _, ok, _, _ in results if ok)
            mark = "✓" if ok_count == len(results) else "✗"
            if ok_count != len(results):
                all_pass = False
            summary_rows.append((idx, info["name"], ok_count, len(results), mark))

            # 输出每关详情
            print(f"\n{mark} 第 {idx + 1} 关 · {info['name']}（{ok_count}/{len(results)} 通过）")
            for key, ok, desc, err in results:
                status = "✓" if ok else "✗"
                tail = f"  ← {err}" if err else ""
                print(f"   {status} [{key}] {desc}{tail}")

            # 截图存档
            shot = page.evaluate(
                "() => { const g=window.__game; g.loadLevel(%d); g.mode='birds'; g.resetTurn && g.resetTurn(); }" % idx
            )
            page.wait_for_timeout(400)
            page.evaluate(
                "() => { for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden'); }"
            )
            page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(OUTDIR, f"L{idx+1}_{info['name']}.png"))

        if errs:
            print("\n⚠ 页面错误：")
            for e in errs[:5]:
                print("  -", e)
        browser.close()

    httpd.shutdown()

    # 汇总表
    print("\n" + "=" * 60)
    print(f"{'关卡':<10}{'主题':<14}{'机制通过':<12}{'判定':<6}")
    print("-" * 60)
    for idx, name, ok, total, mark in summary_rows:
        print(f"第 {idx + 1} 关    {name:<10}{ok}/{total:<8}    {mark}")
    print("=" * 60)
    print(f"\n{'✅ 全部关卡机制齐全' if all_pass else '✗ 有关卡机制缺失，见上方 ✗ 行'}")
    print(f"\n截图目录：{OUTDIR}")


if __name__ == "__main__":
    run()