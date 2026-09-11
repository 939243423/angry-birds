"""在真实 Chromium 里校验 favicon 无黑底。

用 Playwright 打开 index.html（起本地静态服务），读取：
  1. favicon.svg / favicon-*.png 是否 200 可达
  2. SVG 里是否还残留 <rect ... fill="#101a2b"> 之类的底板
  3. 抓 SVG 像素：四角 alpha 必须 = 0

跑法：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/faviconcheck.py
"""
import http.server
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *a):
        pass


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('缺 playwright，用 venv 解释器跑本脚本')
        return 1

    with socketserver.TCPServer(('127.0.0.1', 0), QuietHandler) as httpd:
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        base = f'http://127.0.0.1:{port}'
        rc = run_checks(base)
        httpd.shutdown()
        return rc


def run_checks(base: str) -> int:
    from playwright.sync_api import sync_playwright

    bad = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        for name in ['favicon.svg', 'favicon-32.png', 'favicon-180.png']:
            resp = page.goto(f'{base}/{name}')
            status = resp.status if resp else 0
            ok = status == 200
            print(f'  {"✓" if ok else "✗"} {name} HTTP {status}')
            if not ok:
                bad += 1

        # 主页面确实引用了这三个图标
        page.goto(f'{base}/index.html')
        links = page.eval_on_selector_all(
            'link[rel*="icon"]', 'els => els.map(e => e.getAttribute("href"))'
        )
        expect = {'favicon.svg', 'favicon-32.png', 'favicon-180.png'}
        got = set(links or [])
        ok = expect <= got
        print(f'  {"✓" if ok else "✗"} index.html 引用图标 {sorted(got)}')
        if not ok:
            bad += 1

        # SVG 里不能有覆盖全画布的实心底板
        svg_text = page.evaluate(
            "async () => (await fetch('favicon.svg')).text()"
        )
        import re

        full_rects = re.findall(
            r'<rect[^>]*width="64"[^>]*height="64"[^>]*>', svg_text
        )
        ok = not full_rects
        print(
            f'  {"✓" if ok else "✗"} SVG 无全画布底板'
            + (f' —— 残留 {full_rects}' if full_rects else '')
        )
        if not ok:
            bad += 1
        ok2 = '#101a2b' not in svg_text
        print(f'  {"✓" if ok2 else "✗"} SVG 不再出现旧底色 #101a2b')
        if not ok2:
            bad += 1

        # 渲染 SVG 取样四角 alpha
        # 注意：必须把 SVG 内联进页面再画到 canvas。若用 <img src="http://...">，
        # about:blank 页面画跨源图片会让 canvas 被污染，getImageData 抛 SecurityError。
        page2 = browser.new_page(viewport={'width': 256, 'height': 256})
        page2.goto(f'{base}/index.html')  # 先落到同源，再注入内联 SVG
        page2.set_content(
            '<html><body style="margin:0;background:transparent">'
            + svg_text
            + '</body></html>',
            wait_until='load',
        )
        page2.wait_for_timeout(200)
        alphas = page2.evaluate(
            """() => {
                const svg = document.querySelector('svg');
                svg.setAttribute('width', '256');
                svg.setAttribute('height', '256');
                const xml = new XMLSerializer().serializeToString(svg);
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = 256; c.height = 256;
                        const g = c.getContext('2d');
                        g.clearRect(0, 0, 256, 256);
                        g.drawImage(img, 0, 0, 256, 256);
                        const px = (x, y) => g.getImageData(x, y, 1, 1).data[3];
                        resolve([px(0,0), px(255,0), px(0,255), px(255,255), px(128,128)]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = 'data:image/svg+xml;charset=utf-8,'
                              + encodeURIComponent(xml);
                });
            }"""
        )
        if alphas is None:
            print('  ✗ SVG 无法取样（img 加载失败）')
            bad += 1
            corners, center = [-1] * 4, -1
        else:
            corners = alphas[:4]
            center = alphas[4]
            ok = all(a == 0 for a in corners)
            print(f'  {"✓" if ok else "✗"} SVG 四角 alpha={corners} {"透明" if ok else "有底色"}')
            if not ok:
                bad += 1
            ok2 = center > 200
            print(f'  {"✓" if ok2 else "✗"} SVG 中心 alpha={center}（鸟身不透明）')
            if not ok2:
                bad += 1

        page2.screenshot(path=str(ROOT / '.preview' / 'favicon_in_browser.png'),
                         omit_background=True)
        browser.close()

    if bad:
        print(f'\n✗ {bad} 项未通过')
        return 1
    print('\n✅ favicon 校验通过：只有鸟，四周透明')
    return 0


if __name__ == '__main__':
    sys.exit(main())
