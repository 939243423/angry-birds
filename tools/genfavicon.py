"""从 favicon.svg 重新生成 favicon-32.png / favicon-180.png（保留透明通道）。

favicon 必须"只有鸟、其余透明"，否则深色标签栏 / iOS 主屏上会露出一块
黑色方底。Chromium 截图的默认背景是白的，且不透明——所以这里必须：
  1. page.screenshot(omit_background=True)  让根节点透明透出来
  2. html/body 背景显式设为 transparent
  3. 截图裁剪区域贴紧 SVG，不要在四周留白

跑法（必须用装了 playwright 的 venv 解释器，托管 python 没有 playwright）：
  C:/Users/杜若/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/genfavicon.py
"""
import io
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG = ROOT / 'favicon.svg'
OUT = [(32, ROOT / 'favicon-32.png'), (180, ROOT / 'favicon-180.png')]


def main() -> int:
    if not SVG.exists():
        print(f'找不到 {SVG}')
        return 1

    svg_markup = SVG.read_text(encoding='utf-8')

    # 让 SVG 以指定边长铺满整个视口，四周不留白（viewBox 0 0 64 64 已经是满幅图形）
    page_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body {{ margin:0; padding:0; background:transparent; }}
  svg {{ display:block; }}
</style></head><body>{svg_markup}</body></html>"""

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for size, out_path in OUT:
                page = browser.new_page(
                    viewport={'width': size, 'height': size},
                    device_scale_factor=1,
                )
                page.set_content(page_html, wait_until='load')
                # 把 SVG 拉伸到整幅视口
                page.evaluate(
                    """(size) => {
                        const svg = document.querySelector('svg');
                        if (!svg) throw new Error('no svg');
                        svg.setAttribute('width', String(size));
                        svg.setAttribute('height', String(size));
                        svg.style.width = size + 'px';
                        svg.style.height = size + 'px';
                    }""",
                    size,
                )
                page.wait_for_timeout(60)
                buf = page.screenshot(omit_background=True, type='png')
                out_path.write_bytes(buf)
                page.close()
                print(f'✓ {out_path.name}  {size}x{size}  {len(buf)} bytes')
        finally:
            browser.close()

    # 自检：四角必须是透明的
    try:
        from PIL import Image
    except ImportError:
        print('（未装 Pillow，跳过透明自检）')
        return 0

    bad = 0
    for _, out_path in OUT:
        im = Image.open(out_path).convert('RGBA')
        w, h = im.size
        corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        alphas = [im.getpixel(c)[3] for c in corners]
        ok = all(a == 0 for a in alphas)
        print(f'  {out_path.name} 四角 alpha={alphas} {"✓ 透明" if ok else "✗ 有底色"}')
        if not ok:
            bad += 1
    if bad:
        print(f'✗ {bad} 张 PNG 仍带底色')
        return 1
    print('✅ 两张 PNG 均只有红鸟、四周透明')
    return 0


if __name__ == '__main__':
    sys.exit(main())
