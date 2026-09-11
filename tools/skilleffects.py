"""逐鸟技能效果硬断言 —— 回答"9 只鸟的技能是否都真的生效"。

用法（必须用装了 playwright 的 venv 解释器）：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/skilleffects.py

做法：在 skill-demo.html 页面里，对每只鸟执行
  【建鸟 → 记录基线 → 放进飞行状态 → useSkill() → 比对可观测量】
所有操作在**同一次 evaluate 内**完成，避免跨帧时物理推进把 before/after 搅在一起
（skillcheck.py 曾因跨 evaluate 得到 7/9 假阴性，踩过）。
"""
import http.server
import json
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *a):
        pass


# 每只鸟：期望的技能签名。字段名与实测同构，失败时打印实际值便于定位。
EXPECT = {
    'red':    'armedBlast 变为 true（下次撞击爆炸）',
    'yellow': '速度提升到 2.35 倍 & power=2.0',
    'blue':   '鸟数 +2（分裂出两只克隆）',
    'black':  'fuse 置为 0.5（引信点燃）',
    'green':  'vx 反向（折返）& power=1.15',
    'violet': 'wells +1（引力奇点生成）',
    'orange': 'r 变为 1.9 倍 & power=1.55',
    'white':  'drops +1（空投炸弹生成）',
    'giant':  'dead=true（立即引爆，走 titanBlast）',
}

PROBE_JS = """() => {
  const g = window.__g;
  const results = {};
  const TYPES = ['red','yellow','blue','black','green','violet','orange','white','giant'];

  for (const type of TYPES) {
    // 每次都在干净的隔离环境里试：直接用一个临时 Bird 对象探测 useSkill 的即时效果，
    // 不做真实物理飞行（那是自动化通关的另一条路径，见 smoke.js）。
    const b = new Bird(type, 900, 400);
    b.body = null;
    b.launch(700, -200);          // 进入 flying 状态并给出速度
    // blue 分裂要 attachBird，game 会用到 world；用真 game 即可
    const before = {
      armedBlast: b.armedBlast,
      power: b.power,
      fuse: b.fuse,
      r: b.r,
      vx: b.vx,
      birdsLen: g.birds.length,
      wellsLen: g.wells.length,
      dropsLen: g.drops.length,
      dead: b.dead,
    };
    let ret = null, err = null;
    try {
      ret = b.useSkill(g);
    } catch (e) {
      err = String(e);
    }
    const after = {
      armedBlast: b.armedBlast,
      power: b.power,
      fuse: b.fuse,
      r: b.r,
      vx: b.vx,
      birdsLen: g.birds.length,
      wellsLen: g.wells.length,
      dropsLen: g.drops.length,
      dead: b.dead,
    };
    results[type] = { ret, err, before, after,
                      skillUsed: b.skillUsed, skillName: b.def.skill };
    // 清理：把这次探测产生的东西移出世界，避免影响下一只
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
  return results;
}"""


def check(res: dict) -> list:
    """把实测结果翻译成 通过/失败 列表。"""
    lines = []
    bad = []
    for t, exp in EXPECT.items():
        r = res.get(t)
        if not r:
            lines.append(f'  ✗ {t}: 无结果'); bad.append(t); continue
        b, a = r['before'], r['after']
        ok = False
        detail = ''
        if t == 'red':
            ok = (a['armedBlast'] is True and b['armedBlast'] is False)
            detail = f"armedBlast {b['armedBlast']} → {a['armedBlast']}"
        elif t == 'yellow':
            ratio = abs(a['vx']) / max(abs(b['vx']), 1e-9)
            ok = (ratio > 2.0 and a['power'] == 2.0)
            detail = f"|vx| ×{ratio:.2f}, power {b['power']} → {a['power']}"
        elif t == 'blue':
            ok = (a['birdsLen'] - b['birdsLen'] == 2)
            detail = f"birds {b['birdsLen']} → {a['birdsLen']}"
        elif t == 'black':
            ok = (b['fuse'] == 0 and a['fuse'] == 0.5)
            detail = f"fuse {b['fuse']} → {a['fuse']}"
        elif t == 'green':
            ok = (a['vx'] * b['vx'] < 0 and a['power'] == 1.15)
            detail = f"vx {b['vx']:.0f} → {a['vx']:.0f}（变号）, power {b['power']} → {a['power']}"
        elif t == 'violet':
            ok = (a['wellsLen'] - b['wellsLen'] == 1)
            detail = f"wells {b['wellsLen']} → {a['wellsLen']}"
        elif t == 'orange':
            ratio = a['r'] / max(b['r'], 1e-9)
            ok = (abs(ratio - 1.9) < 0.02 and a['power'] == 1.55)
            detail = f"r ×{ratio:.2f}, power {b['power']} → {a['power']}"
        elif t == 'white':
            ok = (a['dropsLen'] - b['dropsLen'] == 1)
            detail = f"drops {b['dropsLen']} → {a['dropsLen']}"
        elif t == 'giant':
            ok = (a['dead'] is True and b['dead'] is False)
            detail = f"dead {b['dead']} → {a['dead']}"

        mark = '✓' if ok else '✗'
        nm = r['skillName']
        lines.append(f'  {mark} {t:7s} 「{nm}」 useSkill={r["ret"]}  {detail}')
        if not ok:
            bad.append(t)
        if r['err']:
            lines.append(f'      ⚠ 异常: {r["err"]}')
            if t not in bad:
                bad.append(t)
    return lines, bad


def main() -> int:
    with socketserver.TCPServer(('127.0.0.1', 0), H) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{port}'
        with __import__('playwright.sync_api', fromlist=['sync_playwright']).sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1280, 'height': 1280})
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(f'{base}/skill-demo.html', wait_until='load')
            page.wait_for_timeout(300)
            res = page.evaluate(PROBE_JS)
            browser.close()

    print('— 九只鸟技能即时效果断言 —')
    lines, bad = check(res)
    print('\n'.join(lines))

    print('\n期望一览：')
    for t, exp in EXPECT.items():
        print(f'  {t:7s} {exp}')

    if errs:
        print('\nPAGE ERRORS:', errs)
        bad.append('pageerror')

    if bad:
        print(f'\n✗ 未通过：{sorted(set(bad))}')
        return 1
    print('\n✅ 9 只鸟技能全部产生各自特有的可观测效果（无哑火、无串味）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
