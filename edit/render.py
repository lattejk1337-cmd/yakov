#!/usr/bin/env python3
"""Beat-synced photo edit for Destroy Lonely - "how u feel?" (132 BPM).

Every cut, punch-in, flash and glitch is placed on the beat grid, so the
video lines up with the track as long as beat 0 of the video sits on a
downbeat of the song.

Usage:
    python3 render.py                       # silent edit -> out/how_u_feel_edit.mp4
    python3 render.py --audio song.mp3 --offset 41.2
                                            # mux the track, starting it at 41.2s
    python3 render.py --preview             # contact sheet of key frames -> out/preview.png
"""
import argparse
import math
import os
import subprocess
import sys
from functools import lru_cache
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1920
FPS = 30
BPM = 132
B = 60.0 / BPM          # seconds per beat
TOTAL_BEATS = 36
N_FRAMES = int(round(TOTAL_BEATS * B * FPS))
DROP_BEAT = 16          # the white-flash drop; line this up with the hook

FONT_MONO = os.path.join(HERE, "fonts", "SpaceMono-Regular.ttf")
FONT_BOLD = os.path.join(HERE, "fonts", "Anton-Regular.ttf")
FONT_GOTH = os.path.join(HERE, "fonts", "UnifrakturMaguntia-Book.ttf")
RED = np.array([0.86, 0.04, 0.07], np.float32)

# --------------------------------------------------------------------------
# grading (done once, at source resolution)
# --------------------------------------------------------------------------

def _load(name):
    return np.asarray(Image.open(os.path.join(HERE, "src", name)).convert("RGB"),
                      np.float32) / 255.0


def _scurve(x, k=1.0):
    x = np.clip(x, 0, 1)
    s = x * x * (3 - 2 * x)
    return x + (s - x) * k


def _lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def grade_cool(a):
    a = np.clip((a - 0.03) * 1.12, 0, 1)
    l = _lum(a)[..., None]
    a = l + (a - l) * 0.8
    shadow = (1 - l) ** 2
    a = a + shadow * np.array([-0.015, 0.0, 0.035], np.float32)
    return _scurve(a, 0.5)


def grade_bw(a):
    return np.repeat(_scurve(_lum(a), 1.0)[..., None], 3, axis=2)


def grade_bwred(a):
    g = _scurve(_lum(a) * 0.95, 1.2)[..., None]
    red = np.clip((a[..., 0] - np.maximum(a[..., 1], a[..., 2]) - 0.18) * 4.0, 0, 1)[..., None]
    col = _scurve(a, 0.6) * np.array([1.08, 0.8, 0.8], np.float32)
    return g * (1 - red) + col * red


def grade_color(a):
    l = _lum(a)[..., None]
    a = l + (a - l) * 0.85
    a = a * np.array([1.03, 1.0, 0.95], np.float32)
    return _scurve(np.clip((a - 0.04) * 1.08, 0, 1), 0.7)


def grade_inv(a):
    return 1.0 - grade_bw(a)


GRADES = {"cool": grade_cool, "bw": grade_bw, "bwred": grade_bwred,
          "color": grade_color, "inv": grade_inv}

_RAW = {"anime": _load("anime.webp"), "desk": _load("desk.png"),
        "selfie": _load("selfie.webp")}
SRC = {}
for _k, _a in _RAW.items():
    for _g, _f in GRADES.items():
        SRC[(_k, _g)] = Image.fromarray((np.clip(_f(_a), 0, 1) * 255).astype(np.uint8))

# --------------------------------------------------------------------------
# camera
# --------------------------------------------------------------------------

def view(key, cx, cy, zoom=1.0, rot=0.0, ox=0.0, oy=0.0, size=(W, H)):
    """Render `size` pixels looking at source point (cx, cy) with zoom/rotation.
    zoom=1 is cover-fit. ox/oy are output-pixel offsets (camera shake)."""
    img = SRC[key]
    iw, ih = img.size
    sw, sh = size
    s = max(sw / iw, sh / ih) * zoom
    hw, hh = sw / (2 * s), sh / (2 * s)
    cx = min(max(cx, hw), iw - hw) if hw * 2 <= iw else iw / 2
    cy = min(max(cy, hh), ih - hh) if hh * 2 <= ih else ih / 2
    cx -= ox / s
    cy -= oy / s
    c, sn = math.cos(rot) / s, math.sin(rot) / s
    # output (u, v) -> source (x, y)
    a, b_ = c, -sn
    d, e = sn, c
    cu, cv = sw / 2, sh / 2
    data = (a, b_, cx - a * cu - b_ * cv, d, e, cy - d * cu - e * cv)
    out = img.transform(size, Image.AFFINE, data, resample=Image.BICUBIC, fillcolor=(0, 0, 0))
    return np.asarray(out, np.float32) / 255.0

# --------------------------------------------------------------------------
# fx
# --------------------------------------------------------------------------

def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out(t):
    return 1 - (1 - clamp(t)) ** 3


def ease_out_expo(t):
    t = clamp(t)
    return 1.0 if t >= 1 else 1 - 2 ** (-10 * t)


def ease_in_expo(t):
    t = clamp(t)
    return 0.0 if t <= 0 else 2 ** (10 * t - 10)


def punch(b, div=1.0, k=8.0):
    """1 on the hit, decays to ~0 before the next one."""
    step = 1.0 / div
    return math.exp(-((b % step) / step) * k)


def rgb_split(a, d):
    d = int(round(d))
    if d == 0:
        return a
    out = a.copy()
    out[..., 0] = np.roll(a[..., 0], d, axis=1)
    out[..., 2] = np.roll(a[..., 2], -d, axis=1)
    return out


def glitch(a, rng, bands=6, maxshift=120):
    out = a.copy()
    h = a.shape[0]
    for _ in range(bands):
        y0 = rng.integers(0, h - 10)
        bh = int(rng.integers(8, 120))
        out[y0:y0 + bh] = np.roll(out[y0:y0 + bh], int(rng.integers(-maxshift, maxshift)), axis=1)
        if rng.random() < 0.3:
            out[y0:y0 + bh] = out[y0:y0 + bh][..., ::-1]
    return out


def flash(a, k):
    return a + (1 - a) * clamp(k) if k > 0 else a


_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
_r2 = ((_xx - W / 2) / (W / 2)) ** 2 * 0.8 + ((_yy - H / 2) / (H / 2)) ** 2
VIGNETTE = np.clip(1 - 0.45 * _r2, 0.25, 1)[..., None].astype(np.float32)
SCANLINES = (1 - 0.06 * ((_yy.astype(np.int32) // 2) % 2))[..., None].astype(np.float32)
BAND = np.exp(-((_yy - H / 2) / 170) ** 2)[..., None].astype(np.float32)
del _yy, _xx, _r2
_grng = np.random.default_rng(7)
GRAIN = [(_grng.standard_normal((H, W, 1)) * 0.035).astype(np.float32) for _ in range(6)]

# --------------------------------------------------------------------------
# type
# --------------------------------------------------------------------------

@lru_cache(maxsize=256)
def text_mask(text, font_path, size, glow=0):
    font = ImageFont.truetype(font_path, size)
    l, t, r, btm = font.getbbox(text)
    pad = 20 + glow * 3
    im = Image.new("L", (r - l + pad * 2, btm - t + pad * 2), 0)
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=font, fill=255)
    if glow:
        im = im.filter(ImageFilter.GaussianBlur(glow))
    return im


def fit_size(text, font_path, max_w, start):
    size = start
    while size > 10:
        f = ImageFont.truetype(font_path, size)
        l, _, r, _ = f.getbbox(text)
        if r - l <= max_w:
            return size
        size -= 8
    return size


def put_text(a, text, font_path, size, x, y, scale=1.0, alpha=1.0, mode="normal",
             color=(1, 1, 1), glow=0):
    if alpha <= 0 or not text:
        return a
    m = text_mask(text, font_path, size)
    layers = [(m, alpha, mode)]
    if glow:
        layers.insert(0, (text_mask(text, font_path, size, glow), alpha * 0.9, "add"))
    for mi, al, md in layers:
        if scale != 1.0:
            mi = mi.resize((max(1, int(mi.width * scale)), max(1, int(mi.height * scale))),
                           Image.BILINEAR)
        mw, mh = mi.size
        x0, y0 = int(x - mw / 2), int(y - mh / 2)
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        dx1, dy1 = min(W, x0 + mw), min(H, y0 + mh)
        if dx1 <= dx0 or dy1 <= dy0:
            continue
        mm = (np.asarray(mi, np.float32)[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0] / 255.0)[..., None] * al
        reg = a[dy0:dy1, dx0:dx1]
        col = np.array(color, np.float32)
        if md == "diff":
            reg[:] = reg * (1 - mm) + np.abs(col - reg) * mm
        elif md == "add":
            reg[:] = reg + col * mm * 0.8
        else:
            reg[:] = reg * (1 - mm) + col * mm
    return a

# --------------------------------------------------------------------------
# timeline (all times in beats)
# --------------------------------------------------------------------------

def seg_intro(b, rng):
    f = np.zeros((H, W, 3), np.float32)
    if b >= 2.5:
        fade = ease_out((b - 2.5) / 2.0)
        if b < 6:
            z = 1.0 + 0.08 * (b / 6) + (0.025 * punch(b) if b >= 4 else 0)
            img = view(("desk", "cool"), 540, 640, z)
            if b >= 4:
                img = img * (1 + 0.35 * punch(b, k=6))
        else:
            # whip-zoom into the laptop screen, with motion blur
            p = (b - 6) / 2
            acc = np.zeros_like(f)
            n = 5
            for s in range(n):
                pp = clamp(p + (s - n // 2) * 0.012)
                e = ease_in_expo(pp * 0.9 + 0.1 * pp * pp)
                z = 1.08 * (1 + 9 * e)
                acc += view(("desk", "cool"), lerp(540, 545, e), lerp(640, 590, e), z, rot=e * 0.12)
            img = acc / n
            img = flash(img, ease_in_expo(p) * 0.8)
        f = img * fade
    # typewriter title
    if b < 6:
        title = "how u feel?"
        n = int(clamp((b - 0.5) / 0.25 + 1, 0, len(title)))
        cursor = "_" if (b * 2) % 1 < 0.5 else " "
        txt = title[:n] + cursor
        y = 960 if b < 2.5 else lerp(960, 1560, ease_out((b - 2.5) / 1.5))
        f = put_text(f, txt, FONT_MONO, 78, W / 2 + 20, y, glow=10 if n else 0)
        if b > 5.25:
            f = glitch(f, rng, bands=10, maxshift=200)
            f = rgb_split(f, 30)
    return f


BUILD = [  # start, image, grade, cx, cy, z0, z1, rot
    (8.00, "anime", "cool", 220, 360, 2.6, 1.7, 0.00),
    (9.00, "anime", "cool", 640, 1060, 2.0, 2.4, -0.06),
    (10.0, "desk", "color", 760, 880, 1.8, 2.1, 0.00),
    (11.0, "desk", "cool", 60, 785, 3.4, 3.0, 0.05),
    (12.0, "selfie", "bw", 900, 520, 2.8, 3.1, 0.00),
    (12.5, "anime", "cool", 190, 320, 3.2, 3.6, 0.00),
    (13.0, "desk", "inv", 430, 820, 2.4, 2.7, -0.04),
    (13.5, "selfie", "bwred", 890, 740, 2.6, 2.9, 0.00),
    (14.0, "anime", "bw", 290, 195, 3.0, 3.4, 0.03),
    (14.5, "desk", "cool", 620, 385, 3.0, 3.3, 0.00),
    (15.0, "selfie", "bwred", 330, 820, 2.0, 2.2, -0.05),
    (15.25, "selfie", "inv", 900, 520, 3.5, 3.8, 0.00),
    (15.5, None, None, 0, 0, 0, 0, 0),
    (16.0, None, None, 0, 0, 0, 0, 0),
]


def seg_build(b, rng):
    for i in range(len(BUILD) - 1):
        st, key, gr, cx, cy, z0, z1, rot = BUILD[i]
        en = BUILD[i + 1][0]
        if st <= b < en:
            break
    p = (b - st) / (en - st)
    hit = math.exp(-(b - st) * 9)
    heat = clamp((b - 8) / 8)
    if key is None:
        f = np.zeros((H, W, 3), np.float32)
        ox = rng.normal() * 14
        sz = fit_size("HOW U FEEL?", FONT_BOLD, 960, 300)
        f = put_text(f, "HOW U FEEL?", FONT_BOLD, sz, W / 2 + ox, H / 2,
                     scale=lerp(1.15, 1.0, ease_out(p * 2)))
        f = rgb_split(f, 18)
        if b >= 15.75 and int(b * 16) % 2:
            f = 1 - f  # strobe right before the drop
        return f
    z = lerp(z0, z1, p) * (1 + 0.12 * hit)
    shake = 18 * hit * (0.5 + heat)
    f = view((key, gr), cx, cy, z, rot=rot * (1 + hit),
             ox=rng.normal() * shake, oy=rng.normal() * shake)
    if key == "desk" and gr != "inv":
        f = np.clip(f * 1.7, 0, 1)  # the desk shot is very dark; lift its details
    f = rgb_split(f, 3 + 28 * hit * (0.4 + heat))
    if b >= 12 and hit > 0.4:
        f = glitch(f, rng, bands=int(3 + 6 * heat), maxshift=int(60 + 120 * heat))
    f = flash(f, 0.35 * hit * heat)
    return f


DROP_WORDS = {16: "HOW", 17: "U", 18: "FEEL", 19: "?"}


def seg_drop(b, rng):
    bi = int(b)
    k = punch(b, k=7)
    if b < 20:
        cx, cy, z, rot = 900, 640, 1.04, 0.0
        key = ("selfie", "bwred")
    elif b < 23:
        sub = b - bi
        strobe = {20: ("anime", "inv"), 21: ("desk", "inv"), 22: ("anime", "bw")}[bi]
        if 0.5 <= sub < 0.625:
            f = view(strobe, 480, 640, 1.3, rot=0.05)
            return rgb_split(f, 24)
        cx, cy, z, rot = {20: (880, 560, 1.9, 0.0), 21: (900, 640, 1.1, 0.03),
                          22: (880, 560, 2.2, -0.04)}[bi]
        key = ("selfie", "bwred")
    else:
        q = int((b - 23) * 4) % 4
        key = [("selfie", "bwred"), ("anime", "cool"), ("selfie", "inv"), ("desk", "cool")][q]
        cx, cy, z, rot = [(700, 640, 1.3, 0.02), (300, 500, 1.6, -0.03),
                          (880, 560, 1.8, 0.0), (545, 620, 1.9, 0.04)][q]
        k = punch(b, div=4, k=5)
    sgn = 1 if bi % 2 else -1
    shake = 30 * k
    f = view(key, cx, cy, z * (1 + 0.12 * k), rot=rot + sgn * 0.025 * k,
             ox=rng.normal() * shake, oy=rng.normal() * shake)
    f = rgb_split(f, 4 + 30 * k)
    if b >= 23 or (k > 0.6 and bi >= 20):
        f = glitch(f, rng, bands=7, maxshift=160)
    if bi in DROP_WORDS:
        w = DROP_WORDS[bi]
        sz = fit_size(w, FONT_BOLD, 980, 620)
        f = put_text(f, w, FONT_BOLD, sz, W / 2, H / 2,
                     scale=lerp(1.3, 1.0, ease_out((b - bi) * 2.5)), mode="diff")
    f = flash(f, (0.95 if bi == DROP_BEAT else 0.3) * punch(b, k=10))
    return f


PANELS = [  # image, grade, cx, slide-in beat, from (-1 top / +1 bottom)
    ("anime", "cool", 200, 24.0, -1),
    ("selfie", "bwred", 880, 25.0, 1),
    ("desk", "cool", 545, 26.0, -1),
]


def seg_trip(b, rng):
    f = np.zeros((H, W, 3), np.float32)
    pw = W // 3
    for i, (img, gr, cx, st, fr) in enumerate(PANELS):
        if b < st:
            continue
        e = ease_out_expo((b - st) / 0.5)
        dy = fr * H * (1 - e)
        if b >= 27:
            dy += (1 if i % 2 else -1) * 140 * punch(b, k=5) * (1 if b < 28 else 0)
        z = 1.05 + 0.04 * (b - st) + 0.08 * punch(b)
        panel = view((img, gr), cx, 640, z, size=(pw, H))
        y0 = int(round(dy))
        src0, dst0 = max(0, -y0), max(0, y0)
        hgt = H - abs(y0)
        if hgt > 0:
            f[dst0:dst0 + hgt, i * pw:(i + 1) * pw] = panel[src0:src0 + hgt]
    f[:, pw - 3:pw + 3] = 0.92
    f[:, 2 * pw - 3:2 * pw + 3] = 0.92
    if b >= 26:
        a = ease_out((b - 26) / 0.5)
        f *= 1 - 0.6 * a * BAND
        f = put_text(f, "how u feel?", FONT_GOTH, 170, W / 2, H / 2, alpha=a,
                     color=(1, 1, 1), glow=14)
    k = punch(b)
    f = rgb_split(f, 3 + 22 * k)
    if b >= 27 and k > 0.5:
        f = glitch(f, rng, bands=6, maxshift=140)
    f = flash(f, 0.4 * k if b >= 27 else 0.15 * k)
    return f


def seg_full(b, rng):
    bi = int(b)
    if bi < 31:
        key, cx, cy, z0, z1 = {28: (("desk", "cool"), 540, 640, 1.15, 1.05),
                               29: (("anime", "cool"), 420, 560, 1.25, 1.1),
                               30: (("selfie", "color"), 900, 600, 1.08, 1.2)}[bi]
        k = punch(b, k=7)
        z = lerp(z0, z1, b - bi) * (1 + 0.1 * k)
    else:
        q = int((b - 31) * 4) % 4
        key = [("anime", "inv"), ("selfie", "bwred"), ("desk", "bw"), ("selfie", "inv")][q]
        cx, cy = [(200, 360), (880, 560), (545, 600), (880, 560)][q]
        k = punch(b, div=4, k=5)
        z = (1.4 + 0.3 * q) * (1 + 0.12 * k)
    shake = 22 * k
    f = view(key, cx, cy, z, rot=(0.03 if bi % 2 else -0.03) * k,
             ox=rng.normal() * shake, oy=rng.normal() * shake)
    f = rgb_split(f, 3 + (40 if bi == 31 else 24) * k)
    if bi == 31:
        f = glitch(f, rng, bands=10, maxshift=220)
    f = flash(f, 0.3 * punch(b, k=10))
    return f


def seg_outro(b, rng):
    p = (b - 32) / 3
    z = lerp(1.35, 1.04, ease_out(p))
    f = view(("selfie", "bwred"), 900, 640, z, rot=0.02 * (1 - ease_out(p)))
    f = rgb_split(f, 2 + 30 * punch(b - 32, div=0.25, k=4))
    if rng.random() < 0.18 * (1 - p):
        f = glitch(f, rng, bands=3, maxshift=90)
    a = ease_out((b - 32.5) / 1.0)
    f = put_text(f, "how u feel?", FONT_GOTH, 190, W / 2, 1530, alpha=a, color=tuple(RED), glow=16)
    f = put_text(f, "destroy lonely", FONT_MONO, 40, W / 2, 1680, alpha=a * 0.8)
    f = flash(f, 0.9 * punch(b, k=10) if b < 33 else 0)
    f = f * (1 - ease_out((b - 35) / 1.0))
    return f


def render_frame(i):
    t = i / FPS
    b = t / B
    rng = np.random.default_rng(i * 7919 + 13)
    if b < 8:
        f = seg_intro(b, rng)
    elif b < 16:
        f = seg_build(b, rng)
    elif b < 24:
        f = seg_drop(b, rng)
    elif b < 28:
        f = seg_trip(b, rng)
    elif b < 32:
        f = seg_full(b, rng)
    else:
        f = seg_outro(b, rng)
    f = f * VIGNETTE * SCANLINES + GRAIN[i % len(GRAIN)]
    f = rgb_split(f, 2)
    return (np.clip(f, 0, 1) * 255).astype(np.uint8).tobytes()

# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", help="song file to mux under the edit")
    ap.add_argument("--offset", type=float, default=0.0,
                    help="seconds into the song where the edit starts (beat 0)")
    ap.add_argument("--out", default=os.path.join(HERE, "out", "how_u_feel_edit.mp4"))
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    if args.preview:
        beats = [1.5, 3.5, 6.6, 7.6, 8.1, 10.1, 12.6, 15.7,
                 16.05, 17.1, 18.1, 20.2, 22.05, 23.3, 24.3, 26.6,
                 27.05, 28.1, 29.1, 30.1, 31.3, 32.1, 33.8, 35.2]
        thumbs = []
        for bt in beats:
            i = int(bt * B * FPS)
            im = Image.frombytes("RGB", (W, H), render_frame(i)).resize((270, 480))
            ImageDraw.Draw(im).text((8, 8), f"beat {bt}", fill=(255, 255, 0))
            thumbs.append(im)
        cols = 8
        sheet = Image.new("RGB", (270 * cols, 480 * math.ceil(len(thumbs) / cols)))
        for j, im in enumerate(thumbs):
            sheet.paste(im, ((j % cols) * 270, (j // cols) * 480))
        path = os.path.join(os.path.dirname(args.out), "preview.png")
        sheet.save(path)
        print(path)
        return

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    dur = N_FRAMES / FPS
    if args.audio:
        cmd += ["-ss", str(args.offset), "-i", args.audio, "-map", "0:v", "-map", "1:a",
                "-af", f"afade=t=out:st={dur - 1.2:.3f}:d=1.2", "-c:a", "aac", "-b:a", "256k",
                "-shortest"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "25", "-tune", "grain", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", args.out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with Pool(os.cpu_count()) as pool:
        for n, frame in enumerate(pool.imap(render_frame, range(N_FRAMES), chunksize=4)):
            ff.stdin.write(frame)
            if n % 30 == 0:
                print(f"\rframe {n}/{N_FRAMES}", end="", file=sys.stderr)
    ff.stdin.close()
    ff.wait()
    print(f"\n{args.out}  ({dur:.2f}s, {BPM} bpm, drop at {DROP_BEAT * B:.3f}s)")


if __name__ == "__main__":
    main()
