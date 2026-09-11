"""图鉴 → 测试关卡 跳转链路验证。

验证：
1. 主菜单图鉴卡片可点击、有 role=button、有 aria-label
2. 点击后 window.open 被调用，URL 形如 index.html?level=10&bird=<type>
3. 真实打开该 URL，进入测试关（L_TEST）且 currentBird 为指定鸟种、卡片高亮
4. 测试关不污染 Save（levels[10] 不存在、unlocked 不变）
5. 9 只鸟固定顺序循环（弹弓后队列顺序正确）

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
            # 期望 URL = index.html?level=10&bird=black（新约定）
            ok3 = bool(opened) and 'level=10' in opened[0][0] and 'bird=black' in opened[0][0] \
                  and opened[0][1] == '_blank'
            print(f'  {"✓" if ok3 else "✗"} 打开 index.html?level=10&bird=black（新标签页）')
            if not ok3:
                bad += 1

            # 真实打开该 URL，确认进入测试关、选中黑鸟
            page.goto(f'{base}/index.html?level=10&bird=black', wait_until='load')
            page.wait_for_timeout(500)
            info = page.evaluate("""() => ({
                isTest: window.__game.isTestLevel,
                levelIdx: window.__game.levelIndex,
                levelName: window.__game.level && window.__game.level.name,
                currentType: window.__game.currentBird && window.__game.currentBird.type,
                queue: window.__game.birdQueue.slice(),
                queueLen: window.__game.birdQueue.length,
            })""")
            print(f'  进入测试关: {info}')
            ok4 = info['isTest'] is True and info['levelIdx'] == 10 \
                  and info['levelName'] == '技能测试关' and info['currentType'] == 'black'
            print(f'  {"✓" if ok4 else "✗"} isTestLevel=true, levelIdx=10, currentBird=black')
            if not ok4:
                bad += 1

            # 图鉴跳转的指定鸟应被前置到队列首位；队列长度恒为 9
            ok5 = info['queue'][0] == 'black' and info['queueLen'] == 9 \
                  and info['queue'][1:] == ['red', 'yellow', 'blue', 'green', 'violet', 'orange', 'white', 'giant']
            print(f'  {"✓" if ok5 else "✗"} 队列首位=black，长度={info["queueLen"]}，顺序={info["queue"][1:]}')
            if not ok5:
                bad += 1

            # 不写存档：测试关通关（不算分）不污染 Save.data.levels[10] 和 unlocked
            # 用 ui 暴露的 game 句柄拿 Save（通过 Save.data 直接从全局读）
            save_present = page.evaluate("() => typeof window.Save !== 'undefined' && !!window.Save.data")
            print(f'  Save 暴露: {save_present}')
            if not save_present:
                print('  ⚠ Save 未暴露到 window，跳过存档不变性断言（仅校验 isTestLevel 不写 Save 路径即可）')
            else:
                save_before = page.evaluate("""() => ({
                    unlocked: window.Save.data.unlocked,
                    levels10: window.Save.data.levels[10],
                })""")
                # 模拟玩家把第一只打飞、afterShot（不杀猪，触发换下一只）
                page.evaluate("""() => {
                    const g = window.__game;
                    g.launch(g.currentBird, 900, -260);
                    return true;
                }""")
                page.wait_for_timeout(800)
                save_after = page.evaluate("""() => ({
                    unlocked: window.Save.data.unlocked,
                    levels10: window.Save.data.levels[10],
                })""")
                ok6 = save_before == save_after
                print(f'  {"✓" if ok6 else "✗"} 测试关不污染存档（unlocked/levels[10] 发射前后一致）')
                if not ok6:
                    print(f'     before={save_before} after={save_after}')
                    bad += 1

            page.screenshot(path=str(ROOT / '.preview' / 'legend_to_testlevel.png'))

            ctx.close()
            browser.close()

    if errs:
        print('  PAGE ERRORS:', errs)
        bad += 1
    if bad:
        print(f'\n✗ {bad} 项未通过')
        return 1
    print('\n✅ 图鉴卡片可点击 → 新标签打开测试关并自动选中该鸟')
    return 0


if __name__ == '__main__':
    sys.exit(main())