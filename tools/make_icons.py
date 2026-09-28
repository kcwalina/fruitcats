"""Cut the app icons (home screen, PWA, favicon) from art/ui/app-icon.webp.

    python tools/make_icons.py

A drawn icon with a cream margin and a rounded frame is cropped to just inside that frame (iOS and Android round the
corners themselves); a full-bleed painting is used as it is.
Maskable icon: the same picture inset to 80%, because Android crops icons to a circle.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art" / "ui" / "app-icon.webp"
ICONS = ROOT / "art" / "icons"
# Home screen (iOS), PWA, and the browser tab.
SIZES = {"apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512, "favicon-32.png": 32}
MASKABLE_SAFE = 0.8


def full_bleed(image: Image.Image) -> bool:
    """A painting that fills the square to its edges (no cream margin or drawn frame): used as it is."""
    corners = [image.getpixel(c) for c in [(2, 2), (image.width - 3, 2), (2, image.height - 3), (image.width - 3, image.height - 3)]]
    return not all(min(c) > 200 for c in corners)


def square(image: Image.Image) -> Image.Image:
    """The drawn frame cropped away: the biggest centred square inside the coloured panel."""
    background = image.getpixel((2, 2))                     # the cream margin
    mask = Image.new("L", image.size, 0)
    pixels = image.convert("RGB")
    for x in range(image.width):
        for y in range(0, image.height, 4):                 # every 4th row is enough to find the edges
            if sum(abs(a - b) for a, b in zip(pixels.getpixel((x, y)), background)) > 60:
                mask.putpixel((x, y), 255)
    box = mask.getbbox()
    if not box:
        return image
    inset = round(image.width * 0.045)                       # drop the dark frame stroke itself
    left, top, right, bottom = box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset
    side = min(right - left, bottom - top)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    cut = image.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
    # The frame's rounded corners leave cream wedges in a square crop: flood them with the panel colour.
    ring = [cut.getpixel((x, y)) for x in range(0, cut.width, 7)
            for y in (round(cut.height * 0.04), round(cut.height * 0.5), cut.height - 1 - round(cut.height * 0.04))]
    fill = max(set(ring), key=ring.count)                   # the panel colour, not a corner or the cat
    for corner in [(1, 1), (cut.width - 2, 1), (1, cut.height - 2), (cut.width - 2, cut.height - 2)]:
        if sum(abs(a - b) for a, b in zip(cut.getpixel(corner), fill)) > 60:
            ImageDraw.floodfill(cut, corner, fill, thresh=70)
    return cut


def main() -> int:
    if not SOURCE.exists():
        sys.exit(f"{SOURCE} not found — draw it with: python tools/generate_art.py --ui --only app-icon")
    source = Image.open(SOURCE).convert("RGB")
    icon = source if full_bleed(source) else square(source)
    ICONS.mkdir(parents=True, exist_ok=True)

    for name, size in SIZES.items():
        icon.resize((size, size), Image.LANCZOS).save(ICONS / name)
        print(f"  {name}: {size}x{size}")

    # Android crops maskable icons to a circle, so keep the cat inside the safe 80%.
    side = 512
    inner = round(side * MASKABLE_SAFE)
    # Behind it, the same picture enlarged and blurred, so the margin continues the painting instead of a flat band;
    # the inset picture's edge is feathered into it.
    maskable = icon.resize((side, side), Image.LANCZOS).filter(ImageFilter.GaussianBlur(18))
    feather = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(feather).rectangle((0, 0, inner - 1, inner - 1), fill=255)
    feather = ImageOps.expand(feather.crop((12, 12, inner - 12, inner - 12)), 12, 0).filter(ImageFilter.GaussianBlur(8))
    maskable.paste(icon.resize((inner, inner), Image.LANCZOS), ((side - inner) // 2, (side - inner) // 2), feather)
    maskable.save(ICONS / "icon-maskable-512.png")
    print("  icon-maskable-512.png: 512x512 (80% safe zone)")

    # index.html also links /apple-touch-icon.png at the site root.
    (ROOT / "art" / "apple-touch-icon.png").write_bytes((ICONS / "apple-touch-icon.png").read_bytes())
    print("  apple-touch-icon.png copied to art/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
