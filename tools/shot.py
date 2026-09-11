#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""移动端 / 桌面截图工具。

起一个本地静态服务，用 Playwright 打开页面并按场景截图，输出到 .preview/shots/。

用法：
    python tools/shot.py                      # 全部场景，默认竖屏 390x844
    python tools/shot.py menu levels          # 只截指定场景
    python tools/shot.py menu 390 844 2       # 指定 宽 高 dpr
    python tools/shot.py --desktop            # 桌面 1280x720
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
OUTDIR = os.path.join(ROOT, ".preview", "shots")
PORT = 8391

# 彩蛋关入口默认隐藏（需累计 6 星解锁）；截图时预置存档，省得为了看一个面板刷星
SAVE_KEY = "angrybirds_elemental_save_v1"
SAVE_TEMPLATE = {
    "levels": {}, "unlocked": 7, "feathers": 0,
    "eggUnlocked": True, "eggCleared": [False, False], "muted": True,
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


# 场景：名字 -> 点击序列（None 表示不点击）
SCENES = {
    "menu": [],
    "levels": ["#btn-levels"],
    "howto": ["#btn-howto"],
    "egg": ["#btn-egg"],
}


def run(names, width, height, dpr):
    from playwright.sync_api import sync_playwright

    httpd = start_server()
    time.sleep(0.3)
    os.makedirs(OUTDIR, exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/index.html"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=dpr,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        # 预置存档：解锁彩蛋关 + 进度推到第 7 关，菜单背景才能反映"跟随进度"
        page.add_init_script(
            "localStorage.setItem(%s, %s);"
            % (json.dumps(SAVE_KEY), json.dumps(json.dumps(SAVE_TEMPLATE)))
        )
        page.goto(url, wait_until="load")
        page.wait_for_timeout(1500)

        for name in names:
            for sel in SCENES.get(name, []):
                page.click(sel)
                page.wait_for_timeout(600)
            path = os.path.join(OUTDIR, f"{name}.png")
            page.screenshot(path=path)
            print(f"  截图 {name}.png  ({width}x{height} @{dpr}x)")
            # 回到主菜单，便于下一个场景
            page.wait_for_timeout(150)
            js = """() => {
                const btns = ['btn-back-menu','btn-back-menu2','btn-egg-back'];
                for (const id of btns) { const el = document.getElementById(id); if (el && el.offsetParent) el.click(); }
            }"""
            page.evaluate(js)
            page.wait_for_timeout(400)

        if errs:
            print("  ⚠ 页面错误:")
            for e in errs[:5]:
                print("   -", e)
        else:
            print("  ✓ 无页面错误")
        browser.close()

    httpd.shutdown()
    print(f"\n输出目录：{OUTDIR}")


def main():
    args = sys.argv[1:]
    if "--desktop" in args:
        args.remove("--desktop")
        run(list(SCENES), 1280, 720, 2)
        return

    names = [a for a in args if not a.isdigit()]
    nums = [int(a) for a in args if a.isdigit()]
    if not names:
        names = ["menu"]
    width = nums[0] if len(nums) > 0 else 390
    height = nums[1] if len(nums) > 1 else 844
    dpr = nums[2] if len(nums) > 2 else 2
    run(names, width, height, dpr)


if __name__ == "__main__":
    main()
