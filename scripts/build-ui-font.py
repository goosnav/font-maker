"""Build the square-pixel Goosnav UI face from the bundled OFL Liberation Sans.

Developer-only: python -m pip install pillow fonttools, then npm run assets.
Run this script to regenerate the checked-in WOFFs. No runtime dependency.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 64
for style in ("Regular", "Bold"):
    source = ROOT / f"node_modules/.cache/liberation-fonts-ttf-2.1.5/LiberationSans-{style}.ttf"
    original = TTFont(source)
    raster = ImageFont.truetype(str(source), 11, layout_engine=ImageFont.Layout.BASIC)
    cmap = {cp: f"uni{cp:04X}" for cp in original.getBestCmap() if cp >= 32}
    order = [".notdef", *cmap.values()]
    glyphs, metrics = {}, {}
    for cp, name in [(0xFFFD, ".notdef"), *cmap.items()]:
        image = Image.new("L", (48, 40))
        ImageDraw.Draw(image).text((12, 24), chr(cp), font=raster, fill=255, anchor="ls")
        pen = TTGlyphPen(None)
        for y in range(image.height):
            x = 0
            while x < image.width:
                if image.getpixel((x, y)) < 112:
                    x += 1
                    continue
                left = x
                while x < image.width and image.getpixel((x, y)) >= 112:
                    x += 1
                x0, x1 = (left - 12) * SCALE, (x - 12) * SCALE
                y0, y1 = (24 - y - 1) * SCALE, (24 - y) * SCALE
                pen.moveTo((x0, y0)); pen.lineTo((x0, y1))
                pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
        glyph = pen.glyph()
        glyphs[name] = glyph
        glyph.recalcBounds({name: glyph})
        metrics[name] = (round(raster.getlength(chr(cp))) * SCALE, getattr(glyph, "xMin", 0))
    fb = FontBuilder(11 * SCALE, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=11 * SCALE, descent=-3 * SCALE)
    fb.setupNameTable({
        "familyName": "Goosnav UI", "styleName": style,
        "uniqueFontIdentifier": f"Goosnav UI 1.0 {style}",
        "fullName": f"Goosnav UI {style}", "psName": f"GoosnavUI-{style}",
        "version": "Version 1.000", "copyright": original["name"].getDebugName(0),
        "licenseDescription": "Derived from Liberation Sans 2.1.5. Licensed under the SIL Open Font License 1.1. See Liberation-LICENSE.txt.",
        "licenseInfoURL": "https://openfontlicense.org/",
    })
    fb.setupOS2(sTypoAscender=11*SCALE, sTypoDescender=-3*SCALE, sTypoLineGap=0,
                usWinAscent=14*SCALE, usWinDescent=4*SCALE,
                usWeightClass=700 if style == "Bold" else 400)
    fb.setupPost()
    fb.setupMaxp()
    fb.font.flavor = "woff"
    path = ROOT / f"public/fonts/goosnav-ui-{style.lower()}.woff"
    fb.font.save(path)
    print(path.name, path.stat().st_size)
