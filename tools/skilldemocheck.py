"""验证 skill-demo.html：页面可加载、9 张卡片齐全、按钮工作、自动测试 9 只鸟全部释放技能并产生粒子/爆炸。"""
import http.server, pathlib, socketserver, threading, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *a): pass


def main():
    with socketserver.TCPServer(('127.0.0.1', 0), H) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{port}'
        bad = 0
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1280, 'height': 1280})
            page.on('console', lambda m: print('  [console]', m.type, m.text))
            page.on('pageerror', lambda e: print('  [PAGEERROR]', e))

            r = page.goto(f'{base}/skill-demo.html', wait_until='load')
            print(f'  {"✓" if r.status==200 else "✗"} skill-demo.html HTTP {r.status}')
            if r.status != 200: bad += 1

            page.wait_for_timeout(400)

            # 9 张卡片齐全
            cards = page.eval_on_selector_all('.bird-card', 'els => els.map(e => e.dataset.type)')
            print(f'  {"✓" if len(cards)==9 else "✗"} 9 张卡片，实际 {len(cards)} 张：{cards}')
            if len(cards) != 9: bad += 1
            expect = ['red','yellow','blue','black','green','violet','orange','white','giant']
            if cards != expect: bad += 1
            print(f'  {"✓" if cards==expect else "✗"} 卡片顺序与 BIRD_LIST 一致')

            # g 暴露在 window（我们的脚本最后没显式 window.__g，但页面内可以 evaluate）
            page.wait_for_timeout(800)
            info = page.evaluate("""() => ({
                currentType: window.__g ? window.__g.currentBird?.type : null,
                mode: window.__g ? window.__g.mode : null,
                pigsAlive: window.__g ? window.__g.pigs.filter(p=>!p.dead).length : null,
                blocksAlive: window.__g ? window.__g.blocks.length : null,
            })""")
            print('  demo state:', info)
            if not info['pigsAlive'] or info['pigsAlive'] < 5:
                print('  ✗ 靶场猪数量异常'); bad += 1

            # 截一张初始截图
            page.screenshot(path=str(ROOT/'.preview'/'skill_demo_initial.png'))

            # 点击"自动测试"
            print('--- 点击自动测试 ---')
            page.click('#btn-auto')
            # 等待所有 9 只鸟跑完（每只约 5s + 间隔，估 60s）
            page.wait_for_function(
                """() => {
                    const log = document.getElementById('log');
                    if (!log) return false;
                    return log.textContent.includes('自动测试完成');
                }""",
                timeout=90000,
            )
            log_text = page.eval_on_selector('#log', 'el => el.textContent')
            print('  最终日志长度:', len(log_text), 'chars')
            page.screenshot(path=str(ROOT/'.preview'/'skill_demo_after_auto.png'))

            # 校验：9 只鸟每只都有"自动放技能成功"日志 + 汇总表
            bird_names = ['烈焰红','闪电黄','寒冰蓝','爆破黑','回旋绿','引力紫','爆胀橙','空投白','泰坦巨力']
            skill_names = ['爆裂冲刺','超音冲刺','一分为三','定时炸弹','回旋折返','引力奇点','膨胀冲击','空投炸弹','毁灭冲击']
            for nm, sk in zip(bird_names, skill_names):
                if nm not in log_text:
                    print(f'  ✗ 缺 {nm} 切换日志'); bad += 1
                if sk not in log_text:
                    print(f'  ✗ 缺 {sk} 技能播报'); bad += 1

            # "自动放技能成功"出现次数应 = 9
            fired = log_text.count('自动放技能成功')
            print(f'  {"✓" if fired == 9 else "✗"} 「自动放技能成功」{fired}/9 次')
            if fired != 9:
                bad += 1

            # 汇总表里不该出现"无签名变化"（那是哑火信号）
            empty_sig = log_text.count('无签名变化')
            print(f'  {"✓" if empty_sig == 0 else "✗"} 哑火计数 "无签名变化" = {empty_sig}（应为 0）')
            if empty_sig != 0:
                bad += 1

            # 从 report 数组里取打击效果（表格文本不方便解析，改从 console.table 抓不到；
            # 用页面内 __g 的侧面证据：终局分数 > 0 且有猪/砖减少）
            end_state = page.evaluate("""() => {
                const g = window.__g;
                return {
                    score: g.score,
                    alivePigs: g.pigs.filter(p => !p.dead).length,
                    aliveBlocks: g.blocks.filter(b => !b.dead).length,
                    totalPigs: g.pigs.length,
                    totalBlocks: g.blocks.length,
                };
            }""")
            print(f'  终局：score={end_state["score"]}, 存活猪={end_state["alivePigs"]}/{end_state["totalPigs"]}, '
                  f'存活砖={end_state["aliveBlocks"]}/{end_state["totalBlocks"]}')
            if end_state['score'] <= 0:
                print('  ✗ 9 只鸟打完零分，靶场或发射有问题'); bad += 1
            if end_state['alivePigs'] >= end_state['totalPigs'] and end_state['aliveBlocks'] >= end_state['totalBlocks']:
                print('  ✗ 靶场毫发无损，9 只鸟都没造成任何伤害'); bad += 1

            browser.close()
        if bad:
            print(f'\n✗ {bad} 项未通过'); return 1
        print('\n✅ skill-demo.html 9 只鸟技能全部触发、靶场有目标、分数正常')
        return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
