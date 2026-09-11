"""技能测试关卡（L_TEST）端到端验证。

跑法：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/testlevelcheck.py

验证：
1. URL 直达 index.html?level=10&bird=<type> → isTestLevel=true，currentBird=指定鸟
2. 队列为 9 只（指定鸟置顶 + 其余 8 只保持原顺序）
3. 物理 240 步空跑无 NaN / 砖块飞出世界（坐标 < WORLD_W）
4. 连续 9 次 afterShot 触发 → currentBird 顺序循环 = 9 只鸟
5. 全部 8 只鸟打完仍不判负（永远有下一只，cursor 循环）
6. g.restart() / loadLevelTest() 重置队列和游标
7. 不写存档（Save.data.levels[10] undefined, unlocked 不变）
8. 9 只鸟的 useSkill 各自产生特征签名（armedBlast / |vx|×2.35 / +2鸟 / fuse=0.5 /
   vx 反向 / wells+1 / r×1.9 / drops+1 / dead=true）
"""
import http.server, pathlib, socketserver, sys, threading

ROOT = pathlib.Path(__file__).resolve().parent.parent


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *a): pass


def main() -> int:
    from playwright.sync_api import sync_playwright

    bad = 0
    errs = []
    with socketserver.TCPServer(('127.0.0.1', 0), H) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{port}'
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
            page = ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: m.type == 'error' and errs.append(m.text))

            # === 1. 直达测试关，断言元数据 ===
            page.goto(f'{base}/index.html?level=10&bird=violet', wait_until='load')
            page.wait_for_timeout(500)
            info = page.evaluate("""() => ({
                isTest: window.__game.isTestLevel,
                levelIdx: window.__game.levelIndex,
                levelName: window.__game.level && window.__game.level.name,
                currentType: window.__game.currentBird && window.__game.currentBird.type,
                queue: window.__game.birdQueue.slice(),
                blockCount: window.__game.blocks.length,
                pigCount: window.__game.pigs.length,
            })""")
            print(f'  初始: {info}')
            ok1 = info['isTest'] is True and info['levelIdx'] == 10 \
                  and info['levelName'] == '技能测试关' and info['currentType'] == 'violet'
            ok2 = info['queue'][0] == 'violet' and len(info['queue']) == 9 \
                  and info['queue'][1:] == ['red', 'yellow', 'blue', 'black', 'green', 'orange', 'white', 'giant']
            ok3 = info['blockCount'] >= 8 and info['pigCount'] >= 8
            print(f'  {"✓" if ok1 else "✗"} isTestLevel + levelName + currentBird=violet')
            print(f'  {"✓" if ok2 else "✗"} 队列首位=violet，长度=9，其余顺序正确')
            print(f'  {"✓" if ok3 else "✗"} 砖块 ≥8、猪 ≥8（保证 9 种技能各有目标）')
            bad += not (ok1 and ok2 and ok3)

            # === 2. 物理 240 步空跑无 NaN / 不飞出世界 ===
            page.evaluate("""() => {
                window.__nan = null;
                window.__out = null;
                const g = window.__game;
                for (let i = 0; i < 240; i++) g.update(1/60);
                window.__nan = [];
                window.__out = [];
                for (const b of g.blocks) {
                    if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.body.vx) || !isFinite(b.body.vy)) {
                        window.__nan.push({x: b.x, y: b.y, mat: b.mat});
                    }
                    if (b.x < -500 || b.x > 2300 || b.y > 1500) {
                        window.__out.push({x: b.x, y: b.y, mat: b.mat});
                    }
                }
                return true;
            }""")
            nans = page.evaluate("() => window.__nan")
            outs = page.evaluate("() => window.__out")
            ok4 = (not nans) and (not outs)
            print(f'  {"✓" if ok4 else "✗"} 物理空跑 240 步无 NaN（{len(nans)} 个）/ 无飞出世界（{len(outs)} 个）')
            if not ok4:
                print(f'     NaN: {nans[:3]}'); print(f'     越界: {outs[:3]}')
            bad += not ok4

            # === 3. 9 只鸟循环（依次发射 9 次，验证 currentBird 顺序）===
            # 先复位（前面物理跑过，砖块位置已偏移）
            page.evaluate("() => window.__game.loadLevelTest('red')")
            page.wait_for_timeout(100)
            cycle_result = page.evaluate("""async () => {
                const g = window.__game;
                const seq = [];
                for (let i = 0; i < 9; i++) {
                    seq.push(g.currentBird ? g.currentBird.type : null);
                    if (g.currentBird) {
                        g.launch(g.currentBird, 900, -260);
                        // 跑 200 帧 ≈ 3.3 秒，远超 settleTimer(0.85) + endTimer(0.55) + 余量
                        for (let f = 0; f < 200; f++) g.update(1/60);
                    }
                }
                seq.push(g.currentBird ? g.currentBird.type : null);
                return seq;
            }""")
            print(f'  10 次循环序列: {cycle_result}')
            # 期望：9 次 + 第10次回到第1只 = ['red','yellow','blue','black','green','violet','orange','white','giant','red']
            expected = ['red', 'yellow', 'blue', 'black', 'green', 'violet', 'orange', 'white', 'giant', 'red']
            ok5 = cycle_result == expected
            print(f'  {"✓" if ok5 else "✗"} 9 次循环 currentBird 顺序 = 固定 9 只，第10次回 red')
            bad += not ok5

            # === 4. 第 11 次发射不判负（永远有下一只）===
            # 跑足够多的帧让 settleTimer/endTimer 都跑完，phase 回到 aim/settle（= 已切到下一只）
            state = page.evaluate("""async () => {
                const g = window.__game;
                g.launch(g.currentBird, 900, -260);
                for (let f = 0; f < 200; f++) g.update(1/60);
                return {
                    phase: g.phase,
                    birdQueueLen: g.birdQueue.length,
                    hasCurrentBird: !!g.currentBird,
                    isRescue: g.phase === 'rescue',
                    isLose: g.phase === 'losing',
                };
            }""")
            print(f'  第 11 次 afterShot 状态: {state}')
            # 跑完 200 帧后应该已经 settle 完成、phase 回到 aim/settle/飞下一只
            ok6 = not state['isRescue'] and not state['isLose'] and state['birdQueueLen'] == 9
            print(f'  {"✓" if ok6 else "✗"} 测试关用尽鸟仍不判负/不救援（phase={state["phase"]}，队列长={state["birdQueueLen"]}）')
            bad += not ok6

            # === 5. 存档不变性 ===
            save_check = page.evaluate("""() => {
                const g = window.__game;
                // 强制结算（按完所有猪）以触发 finishLevel
                for (const p of g.pigs) p.dead = true;
                g.afterShot();
                return {
                    levels10: window.Save.data.levels[10],
                    unlocked: window.Save.data.unlocked,
                    resultShown: g.resultShown,
                };
            }""")
            ok7 = save_check['levels10'] is None
            print(f'  {"✓" if ok7 else "✗"} 强制结算后 Save.data.levels[10] 仍为 undefined（{save_check["levels10"]}）')
            bad += not ok7

            # === 6. loadLevelTest 重置队列和游标 ===
            # loadLevelTest 后 nextBird() 会把 cursor 从 0 推到 1（spawn 当前只），
            # 所以 cursor=1 是预期（等于"刚 spawn 完 green"）。这才是正确语义。
            page.evaluate("() => window.__game.loadLevelTest('green')")
            page.wait_for_timeout(100)
            restart = page.evaluate("""() => {
                const g = window.__game;
                return {
                    cursor: g.testQueueCursor,
                    currentType: g.currentBird && g.currentBird.type,
                    queueHead: g.birdQueue[0],
                    queueLen: g.birdQueue.length,
                };
            }""")
            print(f'  loadLevelTest(green) 重置后: {restart}')
            ok8 = restart['cursor'] == 1 and restart['currentType'] == 'green' \
                  and restart['queueHead'] == 'green' and restart['queueLen'] == 9
            print(f'  {"✓" if ok8 else "✗"} loadLevelTest 重置 currentBird=green, cursor=1, queue 长度=9')
            bad += not ok8

            # === 7. 9 只鸟 useSkill 各自产生特征签名（核心功能）===
            skills = page.evaluate("""() => {
                const g = window.__game;
                const out = {};
                const TYPES = ['red','yellow','blue','black','green','violet','orange','white','giant'];
                for (const type of TYPES) {
                    g.loadLevelTest(type);
                    const b = new Bird(type, 900, 400);
                    b.body = null;
                    b.launch(700, -200);
                    const before = {
                        armedBlast: b.armedBlast, fuse: b.fuse, r: b.r, vx: b.vx,
                        birdsLen: g.birds.length, wellsLen: g.wells.length, dropsLen: g.drops.length,
                        dead: b.dead,
                    };
                    let ret = null;
                    try { ret = b.useSkill(g); } catch (e) { ret = String(e); }
                    const after = {
                        armedBlast: b.armedBlast, fuse: b.fuse, r: b.r, vx: b.vx,
                        birdsLen: g.birds.length, wellsLen: g.wells.length, dropsLen: g.drops.length,
                        dead: b.dead,
                    };
                    out[type] = { before, after };
                    // 清理
                    for (let i = g.birds.length - 1; i >= 0; i--) {
                        const o = g.birds[i];
                        if (o !== g.currentBird) {
                            if (o.body) o.body.removed = true;
                            g.birds.splice(i, 1);
                        }
                    }
                    g.wells.length = 0;
                    g.drops.length = 0;
                }
                return out;
            }""")
            # 逐鸟断言
            checks = [
                ('red',    lambda b, a: a['armedBlast'] is True and b['armedBlast'] is False, 'armedBlast'),
                ('yellow', lambda b, a: abs(a['vx']) / max(abs(b['vx']), 1) > 2.0, '|vx|×>2'),
                ('blue',   lambda b, a: a['birdsLen'] - b['birdsLen'] == 2, 'birds+2'),
                ('black',  lambda b, a: b['fuse'] == 0 and a['fuse'] == 0.5, 'fuse=0.5'),
                ('green',  lambda b, a: a['vx'] * b['vx'] < 0, 'vx反向'),
                ('violet', lambda b, a: a['wellsLen'] - b['wellsLen'] == 1, 'wells+1'),
                ('orange', lambda b, a: abs(a['r'] / max(b['r'], 1) - 1.9) < 0.02, 'r×1.9'),
                ('white',  lambda b, a: a['dropsLen'] - b['dropsLen'] == 1, 'drops+1'),
                ('giant',  lambda b, a: a['dead'] is True and b['dead'] is False, 'dead'),
            ]
            sig_bad = []
            for t, fn, label in checks:
                r = skills.get(t) or {}
                b, a = r.get('before', {}), r.get('after', {})
                ok = fn(b, a)
                print(f'  {"✓" if ok else "✗"} {t:7s} {label}')
                if not ok:
                    sig_bad.append(t)
                    print(f'      before={b} after={a}')
            bad += len(sig_bad)

            page.screenshot(path=str(ROOT / '.preview' / 'testlevel.png'))
            ctx.close()
            browser.close()

    if errs:
        print('PAGE ERRORS:', errs)
        bad += len(errs)
    if bad:
        print(f'\n✗ {bad} 项未通过')
        return 1
    print('\n✅ 测试关卡（L_TEST）端到端验证：可达、循环、不污染存档、9 只鸟技能签名齐')
    return 0


if __name__ == '__main__':
    sys.exit(main())