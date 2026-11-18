"""Render the Marketplace logo and banners with Chromium. Run: python3 render.py <assets dir> <out dir>"""
import sys, pathlib
from playwright.sync_api import sync_playwright
src, out = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    def shot(html, w, h, scale, name):
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
        pg.goto((src / html).as_uri()); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)
        assert pg.evaluate("document.fonts.check('84px \"Instrument Serif\"') && document.fonts.check('28px Geist')") or html == "logo.html", "fonts not loaded"
        pg.screenshot(path=str(out / name), clip={"x": 0, "y": 0, "width": w, "height": h}); pg.close()
    shot("logo.html", 144, 144, 1, "logo-144.png")
    shot("banner.html", 1120, 548, 1, "banner-1120x548.png")
    shot("banner.html", 1120, 548, 0.5, "banner-560x274.png")
    b.close()
