"""
ZKD Concierge logo generator. One master vector shape (a paper-plane dart,
evoking "departure"), rendered at every size Android and the web app need.
Brand colors pulled directly from zkd-app/app/globals.css and app.json —
iris blue #2f7ff0 accent, #080c14 near-black background.
"""
from PIL import Image, ImageDraw, ImageFont
import math

IRIS = (47, 127, 240, 255)      # #2f7ff0
NAVY = (8, 12, 20, 255)         # #080c14
WHITE = (255, 255, 255, 255)

# Plane silhouette in a 100x100 box: classic paper-plane/dart shape (nose at
# top-right, concave notch at the tail) pointing up-right — "departure".
PLANE_PTS = [
    (94, 12),   # nose tip
    (8, 42),    # back, top wingtip
    (52, 56),   # tail notch (concave point)
    (30, 92),   # back, bottom wingtip
]

def plane_polygon(size, scale=0.62, dx=0, dy=0):
    """Return PLANE_PTS scaled/centered into a `size`x`size` canvas."""
    cx = cy = 50
    pts = []
    for x, y in PLANE_PTS:
        # center on origin, scale, then place at canvas center + offset
        px = (x - cx) * scale
        py = (y - cy) * scale
        pts.append((size / 2 + px + dx, size / 2 + py + dy))
    return pts


def draw_plane(d, size, scale, color, dx=0, dy=0):
    d.polygon(plane_polygon(size, scale=scale, dx=dx, dy=dy), fill=color)


def icon_square(size, bg=IRIS, fg=WHITE):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size, size], fill=bg)
    draw_plane(d, size, scale=size * 0.72 / 100, color=fg)
    return im


def icon_rounded(size, bg=IRIS, fg=WHITE, radius_ratio=0.22):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=bg)
    draw_plane(d, size, scale=size * 0.66 / 100, color=fg)
    return im


def splash_logo(size, color=IRIS):
    """Transparent background (composited over the native white splash bg)."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    draw_plane(d, size, scale=size * 0.62 / 100, color=color)
    return im


ANDROID_SIZES = {
    'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192,
}
SPLASH_SIZES = {
    'mdpi': 288, 'hdpi': 432, 'xhdpi': 576, 'xxhdpi': 864, 'xxxhdpi': 1152,
}

ANDROID_RES = 'zkd-android/android/app/src/main/res'

for density, sz in ANDROID_SIZES.items():
    icon_square(sz).save(f'{ANDROID_RES}/mipmap-{density}/ic_launcher.webp', 'WEBP', lossless=True)
    icon_rounded(sz).save(f'{ANDROID_RES}/mipmap-{density}/ic_launcher_round.webp', 'WEBP', lossless=True)

for density, sz in SPLASH_SIZES.items():
    splash_logo(sz).save(f'{ANDROID_RES}/drawable-{density}/splashscreen_logo.png', 'PNG')

# Web: favicon + a standalone brand mark PNG for reference/social use
icon_rounded(512, radius_ratio=0.22).save('zkd-app/public/brand/icon-512.png', 'PNG')
icon_rounded(192, radius_ratio=0.22).save('zkd-app/public/brand/icon-192.png', 'PNG')
icon_rounded(32, radius_ratio=0.28).save('zkd-app/public/favicon-32.png', 'PNG')

print('done')
