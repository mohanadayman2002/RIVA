"""Lift the contact card's ornament out of the reference design screenshot.

Usage:  [LIFT=n] python scripts/make-card-pattern.py [reference.jpg]

Writes public/card-wave.png and public/card-dots.png. Only needed if the
reference design changes; both assets are committed, so a normal checkout never
runs this. Needs pillow and numpy, which are not project dependencies.

Why an asset and not CSS: the wave down the left edge is a family of nested
J-curves that pinch around 40% of the card's height and then flare along the
bottom. No repeating-radial-gradient describes that, and several attempts to
approximate one only ever got the direction of the curvature right.

Why per-pixel colour: the two ornaments look nothing alike up close. The wave
is neutral grey a whisker off the card's white -- about 17/255 at its darkest.
The dot field is a solid mid-green, rgb(60,125,91), a dip of nearly 190. One
ink colour and one alpha ramp cannot carry both, so each pixel keeps its own.

The maths: over a white card, a pixel of colour I at alpha a lands at
255 - a*(255 - I). Taking a = max_channel(deficit)/255 and
I_c = bg_c - deficit_c/a reproduces the reference's colour exactly, hue and
all, at the lowest alpha that can express it.
"""

from PIL import Image, ImageFilter, ImageDraw
import numpy as np
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'card-reference.jpg')
PUB = os.path.join(HERE, '..', 'public')
# Two assets, not one. The wave is a flowing edge ornament and can be stretched
# to whatever height the card ends up; the dot field is a grid, and stretching a
# grid shows. So the dots are cut out separately and placed at a fixed aspect.
WAVE = os.path.join(PUB, 'card-wave.png')
DOTS = os.path.join(PUB, 'card-dots.png')
WAVE_BOX = (0, 0, 264, 366)          # the left ornament, in card coords
DOTS_BOX = (468, 0, 664, 84)         # the corner grid

CL, CT, CR, CB = 36, 618, 700, 984      # the card, in the reference screenshot
GRAIN = 1.0                              # jpeg grain in the flat areas
# The browser resamples this asset to the card's real width, which softens the
# hairlines and costs them contrast. LIFT pulls faint pixels up without
# touching strong ones: a -> a**LIFT, so the wave gains and the dots barely do.
LIFT = float(os.environ.get('LIFT', 1.0))

W, H = CR - CL, CB - CT
card = Image.open(REF).convert('RGB').crop((CL, CT, CR, CB))
rgb = np.asarray(card).astype(float)

# The card's own background: a max filter first, so dark ornament cannot drag
# the estimate down, then a wide blur to leave only the slow vignette.
bg = np.stack([
    np.asarray(Image.fromarray(rgb[..., c].astype(np.uint8))
               .filter(ImageFilter.MaxFilter(9))
               .filter(ImageFilter.GaussianBlur(14))).astype(float)
    for c in range(3)
], axis=2)

deficit = np.clip(bg - rgb, 0, 255)
deficit = np.clip(deficit - GRAIN, 0, 255)

# Everything that is a real element rather than ornament.
for x0, y0, x1, y1 in [(62, 676, 208, 822),     # avatar and its halo
                       (156, 758, 214, 832),    # the badge
                       (208, 686, 700, 836),    # hairline, label, name, number
                       (68, 856, 670, 956)]:    # the button and its glow
    deficit[max(0, y0 - CT):max(0, y1 - CT), max(0, x0 - CL):max(0, x1 - CL)] = 0

# The card's edge and rounded corners are not ornament either.
keep = Image.new('L', (W, H), 0)
ImageDraw.Draw(keep).rounded_rectangle([5, 5, W - 6, H - 6], radius=30, fill=255)
keep = np.asarray(keep.filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255.0
deficit *= keep[..., None]

peak = deficit.max(axis=2)
alpha = np.clip(peak / 255.0, 0, 1)
if LIFT != 1.0:
    alpha = alpha ** LIFT

# Below this, a pixel is grain rather than ornament. Zeroing it matters for
# more than tidiness: ink is bg - deficit/alpha, so as alpha approaches zero the
# ink goes wild, and that noise is what makes the png large.
faint = peak < 3.0
alpha[faint] = 0

safe = np.maximum(alpha, 1e-6)[..., None]
ink = np.clip(bg - deficit / safe, 0, 255)
ink[faint] = 255                       # flat, so it costs nothing to compress

out = np.zeros((H, W, 4), np.uint8)
out[..., :3] = np.round(ink / 4.0) * 4      # quantise; alpha carries the detail
out[..., 3] = np.round(alpha * 255).astype(np.uint8)

full = Image.fromarray(out, 'RGBA')
for path, box in ((WAVE, WAVE_BOX), (DOTS, DOTS_BOX)):
    full.crop(box).save(path, optimize=True)
    print('%-28s %dx%d  %d bytes' % (os.path.basename(path),
          box[2]-box[0], box[3]-box[1], os.path.getsize(path)))
print('lift %.2f' % LIFT)
