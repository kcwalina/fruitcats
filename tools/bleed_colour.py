"""Make a picture's colour bleed past its ink lines, like a hand-coloured folk print.

    python tools/bleed_colour.py content/2027/01/hui-hai/art/illustrations/HH1-D01.webp [more files]

Hàng Trống pictures were printed as ink outlines and coloured in by hand, fast, so the washes spill over the lines and
sit a little off register. The image model draws the lines and the colour in perfect register, so the Hui Hai (HH1)
pictures get this pass after tools/generate_art.py: the colour (chroma) is blurred and shifted a few pixels while the
lines (luma) stay put, only a little softened. Rewrites the files in place; run it once per new drawing.
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps


def shift(channel: Image.Image, dx: int, dy: int) -> Image.Image:
    """Move a channel by (dx, dy), repeating the edge pixels instead of wrapping around."""
    pad = max(abs(dx), abs(dy))
    padded = ImageOps.expand(channel, border=pad)
    padded.paste(channel.resize((channel.width + 2 * pad, channel.height + 2 * pad)), (0, 0))
    padded.paste(channel, (pad, pad))
    return padded.crop((pad - dx, pad - dy, pad - dx + channel.width, pad - dy + channel.height))


def bleed(image: Image.Image, chroma: float = 8, soft: float = 1.4, offset: tuple[int, int] = (7, 5)) -> Image.Image:
    y, cb, cr = image.convert("YCbCr").split()
    cb = shift(cb.filter(ImageFilter.GaussianBlur(chroma)), *offset)
    cr = shift(cr.filter(ImageFilter.GaussianBlur(chroma)), *offset)
    y = y.filter(ImageFilter.GaussianBlur(soft))
    return Image.merge("YCbCr", (y, cb, cr)).convert("RGB")


if __name__ == "__main__":
    for name in sys.argv[1:]:
        path = Path(name)
        bleed(Image.open(path).convert("RGB")).save(path, quality=92)
        print(f"  {path}: colour bled")
