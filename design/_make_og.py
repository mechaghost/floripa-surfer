"""
Floripa Surfer Open Graph image — top-down minimalist style.
Cream beach above, wavy foam line, teal sea, lone surfer prone on board.
1200x630 PNG.
"""
from PIL import Image, ImageDraw
import random
import math

W, H = 1200, 630
OUT = r"D:\Github\floripa-surfer\public\og-image.png"

rng = random.Random(11)

# --- Palette ---------------------------------------------------------------
CREAM       = (232, 224, 207)  # warm off-white sand/distant
WATER       = (52, 99, 121)    # teal sea
SHADOW      = (40, 82, 100)    # subtle water shadow under board
FOAM        = (245, 240, 226)  # cream-white foam
BOARD       = (246, 242, 232)  # surfboard
SKIN        = (228, 192, 162)
HAIR        = (32, 26, 22)
SUIT        = (176, 60, 52)

# --- Compose ---------------------------------------------------------------
img = Image.new('RGB', (W, H), CREAM)
draw = ImageDraw.Draw(img)

# Wave line — organic undulation made of layered sines
def wave_y(x):
    return (172
            + math.sin(x * 0.0085) * 30
            + math.sin(x * 0.022 + 1.3) * 14
            + math.sin(x * 0.045 + 2.6) * 6)

wave_pts = [(x, wave_y(x)) for x in range(0, W + 4, 4)]

# Water fill (below wave line to bottom)
draw.polygon(list(wave_pts) + [(W, H), (0, H)], fill=WATER)

# Foam band — slightly fluffy edge along the wave line.
# Top edge sits a few pixels above the wave line (gentle wobble against cream);
# bottom edge has soft cusps extending down into the water.
foam_top = [(x, y - 4 + math.sin(x * 0.018) * 3) for x, y in wave_pts]
foam_bot = [(x, y + 10
              + math.sin(x * 0.04 + 0.5) * 8
              + math.sin(x * 0.11 + 1.2) * 5)
            for x, y in wave_pts]
draw.polygon(foam_top + foam_bot[::-1], fill=FOAM)

# Scattered residual foam in the upper sea — fading dispersal of broken wave
for _ in range(34):
    x = rng.randint(20, W - 20)
    y = wave_y(x) + rng.uniform(26, 110)
    if y > H - 20:
        continue
    r = rng.uniform(2, 5)
    draw.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=FOAM)

# --- Surfer + board (overhead) --------------------------------------------
sx, sy = 540, 420
angle = math.radians(-16)  # board tilted: nose toward upper-right
sin_a, cos_a = math.sin(angle), math.cos(angle)

def rotate(x, y):
    dx, dy = x - sx, y - sy
    return (sx + dx * cos_a - dy * sin_a,
            sy + dx * sin_a + dy * cos_a)

BOARD_LEN = 138
BOARD_WID = 40

def board_outline():
    """Surfboard shape — elongated rounded oval, slightly more tapered toward nose."""
    n = 32
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2
        x = math.cos(a) * BOARD_WID / 2
        y = math.sin(a) * BOARD_LEN / 2
        # Sharpen nose taper, soften tail
        if y < 0:
            y *= 1.18
            x *= 0.92 if y < -BOARD_LEN * 0.35 else 1.0
        else:
            y *= 1.02
        pts.append((x, y))
    return pts

def transform(local_pts, dx=0, dy=0):
    out = []
    for x, y in local_pts:
        rx, ry = rotate(sx + x, sy + y)
        out.append((rx + dx, ry + dy))
    return out

# Shadow under board — soft offset
draw.polygon(transform(board_outline(), dx=9, dy=13), fill=SHADOW)

# The board itself
draw.polygon(transform(board_outline()), fill=BOARD)

# --- Surfer body (lying prone, head toward nose) --------------------------
def ellipse_local(cx, cy, w, h, fill):
    n = 26
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ex = cx + math.cos(a) * w / 2
        ey = cy + math.sin(a) * h / 2
        pts.append(rotate(sx + ex, sy + ey))
    draw.polygon(pts, fill=fill)

def polygon_local(pts, fill):
    draw.polygon([rotate(sx + x, sy + y) for x, y in pts], fill=fill)

# Legs — drawn first so the swimsuit overlaps the top edge
ellipse_local(-4, 22, 7, 32, SKIN)
ellipse_local( 4, 22, 7, 32, SKIN)

# Torso silhouette — slimmer, shoulders narrowing to hips, arms tucked at sides
polygon_local([
    (-5,  -42),
    ( 5,  -42),
    (10,  -32),
    (11,  -16),
    (10,   -2),
    ( 9,    6),
    (-9,    6),
    (-10,  -2),
    (-11, -16),
    (-10, -32),
], SKIN)

# Red swimsuit at hips — smaller, snugger
ellipse_local(0, 5, 16, 9, SUIT)

# Hair — small dark patch at the head
ellipse_local(0, -46, 11, 10, HAIR)

img.save(OUT, 'PNG', optimize=True)
print(f"wrote {OUT}  {img.size}")
