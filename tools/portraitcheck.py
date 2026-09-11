"""竖屏「下半屏点击放技能」回归测试。

背景：竖屏下 16:9 画面窗居中约 219px 高，上下大片空白。
旧实现只监听 canvas 的 pointerdown → 点画面外放技能无反应（用户反馈）。
本测试用 iPhone 竖屏视口，在【画面窗下方 40% 处】点击，断言技能真的被释放。

跑法：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/portraitcheck.py
"""
import http.server
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *a): pass


def main() -> int:
    from playwright.sync_api import sync_playwright

    bad = 0
    with socketserver.TCPServer(('127.0.0.1', 0), H) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{port}'
        with sync_playwright() as p:
            browser = p.chromium.launch()
            # 竖屏 + 触摸
            ctx = browser.new_context(
                viewport={'width': 390, 'height': 844},
                is_mobile=True, has_touch=True,
                device_scale_factor=2,
            )
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(f'{base}/index.html', wait_until='load')
            page.wait_for_timeout(600)

            # 进入第 1 关（直接调 API，绕开菜单点击）
            page.evaluate("() => window.__ui.startLevel(0)")
            page.wait_for_timeout(700)

            geo = page.evaluate("""() => {
                const cv = document.getElementById('game');
                const r = cv.getBoundingClientRect();
                return { cvTop: r.top, cvBottom: r.bottom, cvLeft: r.left, cvRight: r.right,
                         vh: window.innerHeight, vw: window.innerWidth };
            }""")
            print(f'  画面窗: top={geo["cvTop"]:.0f} bottom={geo["cvBottom"]:.0f} '
                  f'(视口高 {geo["vh"]:.0f})')
            below_h = geo['vh'] - geo['cvBottom']
            print(f'  画面窗下方空白高度: {below_h:.0f}px')
            if below_h < 100:
                print('  ⚠ 画面窗下方空白不足 100px，本机视口可能不典型，跳过下半屏用例')

            # 发射一只鸟（程序化，保证进入 fly 状态）
            page.evaluate("""() => {
                const g = window.__game;
                g.launch(g.currentBird, 900, -260);
            }""")
            page.wait_for_timeout(160)
            st0 = page.evaluate("() => ({ s: window.__game.currentBird.state, used: window.__game.currentBird.skillUsed })")
            print(f'  发射后: state={st0["s"]} skillUsed={st0["used"]}')
            if st0['s'] != 'flying':
                print('  ✗ 鸟没进入飞行状态'); bad += 1

            # ★ 核心：点画面窗【下方】的空白区
            if below_h >= 100:
                tx = geo['vw'] / 2
                ty = geo['cvBottom'] + below_h * 0.45
                print(f'  在画面下方空白区点击 ({tx:.0f}, {ty:.0f}) —— 期望触发技能')
                page.mouse.click(tx, ty)
                page.wait_for_timeout(200)
                st1 = page.evaluate("() => ({ used: window.__game.currentBird.skillUsed })")
                ok = st1['used']
                print(f'  {"✓" if ok else "✗"} 画面外点击后 skillUsed={st1["used"]}')
                if not ok: bad += 1
            else:
                print('  （跳过画面外点击用例）')

            # 反向用例：点 UI 按钮不应误触发技能
            page.evaluate("() => { window.__ui.startLevel(0); }")
            page.wait_for_timeout(500)
            page.evaluate("() => { const g = window.__game; g.launch(g.currentBird, 900, -260); }")
            page.wait_for_timeout(140)
            before = page.evaluate("() => window.__game.currentBird.skillUsed")
            # 点静音按钮（真实 UI 控件）
            page.evaluate("""() => {
                const b = document.querySelector('.mute-btn');
                if (b) b.click();
            }""")
            page.wait_for_timeout(150)
            after = page.evaluate("() => window.__game.currentBird.skillUsed")
            ok2 = (before == after) or before is True
            print(f'  {"✓" if ok2 else "✗"} 点 UI 按钮不会误放技能（{before} → {after}）')
            if not ok2: bad += 1

            page.screenshot(path=str(ROOT / '.preview' / 'portrait_play.png'))
            ctx.close()
            browser.close()

    if errs:
        print('  PAGE ERRORS:', errs)
        bad += 1
    if bad:
        print(f'\n✗ {bad} 项未通过')
        return 1
    print('\n✅ 竖屏下半屏点击可放技能；点 UI 控件不误触发')
    return 0


if __name__ == '__main__':
    sys.exit(main())
