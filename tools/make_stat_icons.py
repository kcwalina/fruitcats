"""Turn the drawn paw and heart into the two stat badges: flat colour, one pen, same framing.

    python tools/make_stat_icons.py

The image model draws the shapes (art/ui/icon-paw-a.webp, icon-heart-a.webp); this flattens their
shading and stray highlights to one flat fill, gives both the same outline colour so the pair looks
like one set, and re-frames them identically so a Power badge and a Health badge look the same size.
It also prints where the number should sit inside each icon — the centre of the largest circle that
fits in the flat area — which is what tools/compose_cards.py and skin.css use.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "art" / "ui"
SIZE = 256
CONTENT = 0.94                      # how much of the canvas the shape fills, for both icons alike
INK = (80, 35, 28)                  # one pen for both badges
CONTRAST = 3.0                      # a white number has to stay legible at 21px, so darken until it does
SOURCES = {"icon-paw": ("icon-paw-a", (235, 133, 52)), "icon-heart": ("icon-heart-a", (247, 90, 118))}


def contrast_on_white(rgb: tuple) -> float:
    """WCAG contrast of white text on this colour."""
    def channel(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    lum = sum(channel(c) * w for c, w in zip(rgb, (0.2126, 0.7152, 0.0722)))
    return 1.05 / (lum + 0.05)


def legible(rgb: tuple) -> tuple:
    """Darken a colour, keeping its hue, until white text on it reaches CONTRAST."""
    scale = 1.0
    while contrast_on_white(tuple(round(c * scale) for c in rgb)) < CONTRAST and scale > 0.3:
        scale -= 0.02
    return tuple(round(c * scale) for c in rgb)


def flatten(img: Image.Image, fill: tuple, ink: tuple) -> Image.Image:
    """One flat fill and one outline colour: the model's soft shading and shine streaks go away."""
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb, alpha = rgba[..., :3], rgba[..., 3:4]
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    # 0 = outline, 1 = fill, with a soft band between so the edges stay smooth.
    t = np.clip((lum - 90) / 60, 0, 1)[..., None]
    out = np.array(ink, dtype=np.float32) * (1 - t) + np.array(fill, dtype=np.float32) * t
    return Image.fromarray(np.concatenate([out, alpha], axis=-1).astype(np.uint8), "RGBA")


def reframe(img: Image.Image) -> Image.Image:
    """Same framing for every badge: trim to the drawing, then centre it in a square canvas."""
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    shape = img.crop(box)
    scale = SIZE * CONTENT / max(shape.width, shape.height)
    shape = shape.resize((max(1, round(shape.width * scale)), max(1, round(shape.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(shape, ((SIZE - shape.width) // 2, (SIZE - shape.height) // 2), shape)
    return canvas


def text_spot(img: Image.Image, ink: tuple) -> tuple:
    """Where a number fits best: centre and radius of the largest circle inside the flat fill."""
    rgba = np.asarray(img).astype(np.int16)
    solid = rgba[..., 3] > 200
    far_from_ink = np.abs(rgba[..., :3] - np.array(ink)).sum(axis=-1) > 150
    distance = distance_transform_edt(solid & far_from_ink)
    y, x = np.unravel_index(int(distance.argmax()), distance.shape)
    return x / img.width, y / img.height, float(distance[y, x]) / img.width


def main() -> int:
    for name, (source, fill) in SOURCES.items():
        src = UI / f"{source}.webp"
        if not src.exists():
            sys.exit(f"{src} not found — draw it with: python tools/generate_art.py --ui --only {source}")
        fill = legible(fill)
        icon = reframe(flatten(Image.open(src), fill, INK))
        icon.save(UI / f"{name}.webp", quality=95, method=6)
        x, y, r = text_spot(icon, INK)
        print(f"  {name}.webp  number at ({x:.3f}, {y:.3f}), room for a circle {r * 2:.2f} of the width, "
              f"fill {fill}, white-on-fill contrast {contrast_on_white(fill):.2f}:1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
