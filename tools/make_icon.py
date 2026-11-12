"""Builds DeBarrier's icon: Materia's orb recolored red, green and blue, with a broken
barrier hexagon on top. Usage: make_icon.py SRC_256.png OUTDIR"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src = Image.open(sys.argv[1]).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
a = np.asarray(src).astype(np.float32) / 255
rgb, alpha = a[..., :3], a[..., 3:]
lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])
# Red, green and blue in three equal parts around the orb (red on top),
# blurring into each other through the hues between them.
h, w = lum.shape
yy, xx = np.mgrid[0:h, 0:w]
ang = (np.degrees(np.arctan2(yy - h / 2, xx - w / 2)) + 90) % 360  # 0 = top, clockwise
# Each color holds a solid zone, then fades into its neighbor over a
# soft seam (red on top, green lower right, blue lower left).
def zone(center):
    d = np.abs((ang - center + 180) % 360 - 180)
    x = np.clip((d - 28) / 64, 0, 1)          # solid within 28 deg, gone by 92
    return 1 - x * x * (3 - 2 * x)
wts = np.stack([zone(0), zone(120), zone(240)], -1)
base = wts / np.maximum(wts.max(-1, keepdims=True), 1e-6)
# Shade with the orb's own lighting: dark edge, full color, white highlight.
t = np.clip(lum, 0, 1)[..., None]
dark = base * 0.18
full = base
light = 0.55 * base + 0.45
out = np.where(t < 0.55, dark + (full - dark) * (t / 0.55),
      np.where(t < 0.85, full + (light - full) * ((t - 0.55) / 0.30),
               light + (1 - light) * ((t - 0.85) / 0.15)))
orb = Image.fromarray((np.concatenate([out, alpha], -1) * 255).round().astype(np.uint8), "RGBA")

# Broken hexagon: a barrier with a gap and a crack.
S, cx, cy, r = 1024, 512, 512, 250
import math
pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in range(-90, 270, 60)]
def lerp(p, q, t): return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
# Open on the right side: the barrier is broken through.
segs = [
    [lerp(pts[1], pts[2], 0.38), pts[1], pts[0], pts[5], pts[4], pts[3], lerp(pts[3], pts[2], 0.30)],
]
crack = [lerp(pts[1], pts[2], 0.38), (cx + 120, cy - 20), (cx + 175, cy + 30), (cx + 118, cy + 92)]
layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
for img, col, w, off in [(shadow, (10, 10, 30, 170), 52, 10), (layer, (255, 250, 232, 255), 40, 0)]:
    d = ImageDraw.Draw(img)
    for s in segs:
        d.line([(x + off, y + off) for x, y in s], fill=col, width=w, joint="curve")
        for x, y in s:
            d.ellipse([x + off - w / 2, y + off - w / 2, x + off + w / 2, y + off + w / 2], fill=col)
    d.line([(x + off, y + off) for x, y in crack], fill=col, width=int(w * 0.6), joint="curve")
shadow = shadow.filter(ImageFilter.GaussianBlur(10))
icon = Image.alpha_composite(Image.alpha_composite(orb, shadow), layer)

d = sys.argv[2]; os.makedirs(d, exist_ok=True)
icon.resize((512, 512), Image.LANCZOS).save(f"{d}/icon_512.png")
for p in [16, 24, 32, 48, 64, 72, 256]:
    icon.resize((p, p), Image.LANCZOS).save(f"{d}/icon_{p}.png")
