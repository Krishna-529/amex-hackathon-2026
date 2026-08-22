"""
ZKD Concierge logo generator. One master raster (assets/brand/zkd-logo.png —
the globe + departing-plane mark) rendered at every size the web app, the
website builds and the Android app need.

Previously this script drew a procedural paper-plane dart with PIL primitives;
there was no source image. It now resizes the real master into each output
instead, so replacing the brand mark going forward is "swap the master PNG and
re-run this," not "redraw the polygon math."

Run from the repo root: `python tools/build_logo.py`.
"""
from PIL import Image, ImageDraw

MASTER_PATH = 'assets/brand/zkd-logo.png'
IRIS = (47, 127, 240, 255)   # #2f7ff0 — kept as the adaptive-icon background only


def load_master() -> Image.Image:
    im = Image.open(MASTER_PATH).convert('RGBA')
    if im.width != im.height:
        # Center-crop to square first — every output below assumes a square
        # source. The current master already is square; this just makes a
        # future non-square replacement fail safely instead of distorting.
        side = min(im.size)
        left = (im.width - side) // 2
        top = (im.height - side) // 2
        im = im.crop((left, top, left + side, top + side))
    return im


def resized(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def rounded(master: Image.Image, size: int, radius_ratio: float) -> Image.Image:
    """Full-bleed resize with a rounded-rect alpha mask — the same rounded
    brand-tile look the old procedural icons had."""
    im = resized(master, size).convert('RGBA')
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255,
    )
    im.putalpha(mask)
    return im


def inset_on_transparent(master: Image.Image, canvas: int, scale: float) -> Image.Image:
    """The master scaled to `scale` of `canvas`, centered on a transparent
    square — for Android's adaptive-icon foreground, which the OS masks and
    which must leave room in its safe zone rather than fill edge-to-edge."""
    inner = int(canvas * scale)
    fg = resized(master, inner)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    off = (canvas - inner) // 2
    out.paste(fg, (off, off), fg)
    return out


ANDROID_SIZES = {
    'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192,
}
SPLASH_SIZES = {
    'mdpi': 288, 'hdpi': 432, 'xhdpi': 576, 'xxhdpi': 864, 'xxxhdpi': 1152,
}

ANDROID_RES = 'zkd-android/android/app/src/main/res'

master = load_master()

# Android native launcher icons. ic_launcher.webp full-bleed, ic_launcher_round
# rounded-rect — same pairing the old script used, just swapping what's drawn.
for density, sz in ANDROID_SIZES.items():
    resized(master, sz).save(f'{ANDROID_RES}/mipmap-{density}/ic_launcher.webp', 'WEBP', lossless=True)
    rounded(master, sz, 0.22).save(f'{ANDROID_RES}/mipmap-{density}/ic_launcher_round.webp', 'WEBP', lossless=True)

# Splash-screen logo tile, one per density, composited by the OS over the
# native splash backgroundColor (app.json's #080c14).
for density, sz in SPLASH_SIZES.items():
    resized(master, sz).save(f'{ANDROID_RES}/drawable-{density}/splashscreen_logo.png', 'PNG')

# Expo config assets (app.json), separate from the native res/ tree above.
resized(master, 1024).save('zkd-android/assets/icon.png', 'PNG')
resized(master, 1024).save('zkd-android/assets/splash.png', 'PNG')
# Adaptive icon foreground: Android masks this per-OEM shape, so content must
# sit inside a safe zone rather than fill the canvas — the visible ring is
# app.json's adaptiveIcon.backgroundColor (#2f7ff0).
inset_on_transparent(master, 1024, 0.66).save('zkd-android/assets/adaptive-icon.png', 'PNG')
# The in-app header mark (src/ui.tsx, rendered at 28x28 with borderRadius 9).
resized(master, 168).save('zkd-android/assets/logo.png', 'PNG')

# Web: favicon + rounded brand-mark PNGs used by the app header and manifest.
rounded(master, 512, 0.22).save('zkd-app/public/brand/icon-512.png', 'PNG')
rounded(master, 192, 0.22).save('zkd-app/public/brand/icon-192.png', 'PNG')
rounded(master, 32, 0.28).save('zkd-app/public/favicon-32.png', 'PNG')

print('done')
