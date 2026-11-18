#!/usr/bin/env python3
"""Background fleet sprites (0.4.0 animated background): Solfall's ship art (branding/hero, from the public solfall.online site),
pre-rotated to fly RIGHT, scaled and pre-tinted for the background (so no CSS filter runs while they move)."""
import sys
from PIL import Image, ImageEnhance
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/solfall/branding/hero'
OUT = 'src/assets/fleet'
for name, scale in [('dart', .42), ('barracuda', .36), ('toad', .40), ('pirate', .38)]:
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.NEAREST)
    im = im.rotate(-90, expand=True)                       # nose up → nose right
    rgb, a = im.convert('RGB'), im.getchannel('A')
    rgb = ImageEnhance.Brightness(rgb).enhance(.62)       # background depth (≈ .ship filter in c-system.css)
    warm = Image.new('RGB', rgb.size, (255, 170, 80))
    rgb = Image.blend(rgb, warm, .10)
    out = rgb.convert('RGBA'); out.putalpha(a)
    out.save(f'{OUT}/{name}.png', optimize=True)
    out.transpose(Image.FLIP_LEFT_RIGHT).save(f'{OUT}/{name}-l.png', optimize=True)
    print(name, out.size)
