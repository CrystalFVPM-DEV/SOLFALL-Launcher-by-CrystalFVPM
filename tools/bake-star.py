#!/usr/bin/env python3
"""Bake the WARM star look into static PNGs so nothing is filtered at runtime.
c-system.css (WARM): .l-star{filter:brightness(.62) saturate(1.25) hue-rotate(-16deg) drop-shadow(0 0 160px rgba(255,140,30,.85))}
displayed at 1536 css px (c-lite fam). A CSS drop-shadow re-rasterises a 160 px Gaussian over a 1.5k px sprite every
time anything above it changes: ~440 ms per update on the software-rendered Linux proxy (bench/README).
Outputs (src/assets/): star-warm.png (sprite, colour filters applied, native 512 px, shown pixelated)
                       star-shadow.png (the drop-shadow alone, 1/4 scale, shown smoothed; 240 css px padding).
Usage: tools/bake-star.py [src/assets/star.png]"""
import sys, math, numpy as np
from PIL import Image, ImageFilter
src = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/star.png'
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float64) / 255.0
rgb, a = im[..., :3], im[..., 3:]
def sat(s): return np.array([[.213+.787*s, .715-.715*s, .072-.072*s], [.213-.213*s, .715+.285*s, .072-.072*s], [.213-.213*s, .715-.715*s, .072+.928*s]])
def hue(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[.213+c*.787-s*.213, .715-c*.715-s*.715, .072-c*.072+s*.928],
                     [.213-c*.213+s*.143, .715+c*.285+s*.140, .072-c*.072-s*.283],
                     [.213-c*.213-s*.787, .715-c*.715+s*.715, .072+c*.928+s*.072]])
rgb = np.clip(rgb * .62, 0, 1)
rgb = np.clip(rgb @ sat(1.25).T, 0, 1)
rgb = np.clip(rgb @ hue(-16).T, 0, 1)
Image.fromarray((np.concatenate([rgb, a], -1) * 255 + .5).astype(np.uint8), 'RGBA').save('src/assets/star-warm.png', optimize=True)
# shadow: alpha of the sprite at display scale/4 (1536/4 = 384), 60 px pad (= 240 css), sigma 160/2/4 = 20
S, PAD = 384, 60
al = Image.open(src).convert('RGBA').getchannel('A').resize((S, S), Image.BOX)
canvas = Image.new('L', (S + 2 * PAD, S + 2 * PAD), 0); canvas.paste(al, (PAD, PAD))
blur = np.asarray(canvas.filter(ImageFilter.GaussianBlur(20))).astype(np.float64) / 255.0
out = np.zeros(blur.shape + (4,)); out[..., 0], out[..., 1], out[..., 2] = 255, 140, 30; out[..., 3] = blur * .85 * 255
Image.fromarray((out + .5).astype(np.uint8), 'RGBA').save('src/assets/star-shadow.png', optimize=True)
print('ok', S + 2 * PAD)
