"""图鉴 → 靶场 跳转链路验证。

验证：
1. 主菜单图鉴卡片可点击、有 role=button、有 aria-label
2. 点击后 window.open 被调用，URL 形如 skill-demo.html#bird=<type>
3. 真实打开该 URL，靶场确实切到对应鸟、卡片高亮

跑法：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/legendcheck.py
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
            ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(f'{base}/index.html', wait_until='load')
            page.wait_for_timeout(500)

            # 打开「玩法说明 / 图鉴」面板（buildLegend 的宿主）
            has_legend = page.evaluate("() => !!document.getElementById('bird-legend')")
            print(f'  {"✓" if has_legend else "✗"} 存在 #bird-legend 容器')
            if not has_legend:
                bad += 1

            # 触发 buildLegend（走 UI API），并把「玩法说明」面板打开让卡片可见
            ok = page.evaluate("""() => {
                try {
                    window.__ui.buildLegend();
                    window.__ui.show('screen-howto');
                    return true;
                } catch (e) { return String(e); }
            }""")
            print(f'  buildLegend() + show(screen-howto) -> {ok}')
            if ok is not True:
                bad += 1
            page.wait_for_timeout(250)

            cards = page.eval_on_selector_all('.legend-card', """els => els.map(e => ({
                role: e.getAttribute('role'),
                aria: e.getAttribute('aria-label'),
                tab: e.getAttribute('tabindex'),
                hasGoto: !!e.querySelector('.legend-goto'),
                title: e.title,
            }))""")
            print(f'  图鉴卡片数: {len(cards)}')
            ok2 = len(cards) == 9 and all(c['role'] == 'button' and c['aria'] and c['tab'] for c in cards)
            print(f'  {"✓" if ok2 else "✗"} 9 张卡片都有 role=button / aria-label / tabindex')
            if not ok2:
                bad += 1
                for c in cards[:3]:
                    print('     ', c)

            # 拦截 window.open，点第 4 张卡片（黑鸟）
            page.evaluate("""() => {
                window.__opened = [];
                window.open = (u, t) => { window.__opened.push([u, t]); return null; };
            }""")
            page.click('.legend-card:nth-child(4)')
            page.wait_for_timeout(150)
            opened = page.evaluate("() => window.__opened")
            print(f'  点击第 4 张卡片 → window.open 调用: {opened}')
            ok3 = bool(opened) and 'bird=black' in opened[0][0] and opened[0][1] == '_blank'
            print(f'  {"✓" if ok3 else "✗"} 打开 skill-demo.html#bird=black（新标签页）')
            if not ok3:
                bad += 1

            # 真实打开该 URL，确认靶场选中黑鸟
            page.goto(f'{base}/skill-demo.html#bird=black', wait_until='load')
            page.wait_for_timeout(400)
            cur = page.evaluate("() => window.__g.currentBird.type")
            active = page.eval_on_selector('.bird-card.active', 'el => el.dataset.type')
            ok4 = cur == 'black' and active == 'black'
            print(f'  {"✓" if ok4 else "✗"} 靶场实开：currentBird={cur}, 高亮={active}')
            if not ok4:
                bad += 1
            page.screenshot(path=str(ROOT / '.preview' / 'legend_to_demo.png'))

            ctx.close()
            browser.close()

    if errs:
        print('  PAGE ERRORS:', errs)
        bad += 1
    if bad:
        print(f'\n✗ {bad} 项未通过')
        return 1
    print('\n✅ 图鉴卡片可点击 → 新标签打开靶场并自动选中该鸟')
    return 0


if __name__ == '__main__':
    sys.exit(main())
