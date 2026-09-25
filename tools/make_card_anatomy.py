"""The card-anatomy diagram for the documentation (docs/card-anatomy.md): a finished card with numbered
pins in the margins, each on a line to the edge of the part it names, and below it the collector line
enlarged, with pins for its rarity mark, number and finish code.

    python tools/make_card_anatomy.py

Reads the composed card (tools/compose_cards.py) and writes art/guide/card-anatomy.webp. The numbers match
the table in docs/card-anatomy.md, so change both together.
"""

from pathlib import Path

from PIL import Image, ImageDraw

from compose_cards import W, font

ROOT = Path(__file__).resolve().parent.parent
CARD = ("prismatic", "SB1-C15")          # Sanguine: a Rare Cat with cost, stats and flavour, printed Prismatic
KEY = "SB1-C15"
MARGIN, TOP = 150, 24
ZOOM, STRIP = 2.6, (470, 598, 708, 646)   # the collector line: this part of the card, this much bigger
PIN_R = 22
GOLD, INK, CREAM = "#f2b940", "#3b2513", "#fff6dc"

# The collector line's parts on the card (compose_cards.py: the tag is 26 wide, its right edge at W - 62).
key_font = font("segoeui.ttf", 20)
tag_left = W - 62 - 26
number_right = tag_left - 8
number_mid = number_right - key_font.getlength(KEY) / 2
mark_x = number_right - key_font.getlength(KEY) - 20

# On the card: (number, the point it names, which margin its pin is in, the pin's height).
ON_CARD = [
    (1, (30, 77), "left", 77),            # cost: the circle's left edge
    (2, (560, 64), "right", 64),          # name: the banner, right of the name
    (3, (60, 300), "left", 300),          # art
    (4, (44, 622), "left", 622),          # type line: its left end
    (8, (48, 760), "left", 760),          # rules text: its box's left edge
    (9, (598, 858), "right", 858),        # flavour text: just past its end
    (10, (44, 961), "left", 961),         # power: the paw chip's left end
    (11, (706, 961), "right", 961),       # health: the heart chip's right end
    (12, (10, 450), "left", 450),         # the chrome: the frame
]
# In the enlarged collector line: (number, x on the card).
ON_STRIP = [(5, mark_x), (6, number_mid), (7, tag_left + 13)]


def pin(d: ImageDraw.ImageDraw, n: int, at: tuple, target: tuple, k: int) -> None:
    # The line: dark underneath, cream on top, so it shows on light and dark parts of the card alike.
    d.line((at, target), fill=INK, width=6 * k)
    d.line((at, target), fill=CREAM, width=3 * k)
    tx, ty = target
    d.ellipse((tx - 7 * k, ty - 7 * k, tx + 7 * k, ty + 7 * k), fill=CREAM, outline=INK, width=3 * k)
    x, y = at
    r = PIN_R * k
    d.ellipse((x - r, y - r, x + r, y + r), fill=GOLD, outline=INK, width=4 * k)
    d.text((x, y + k), str(n), font=font("seguibl.ttf", 24 * k), fill=INK, anchor="mm")


def main() -> None:
    card = Image.open(ROOT / "content" / "2026" / "09" / "starter-box" / "art" / "cards" / CARD[0] / f"{KEY}.webp").convert("RGBA")
    k = 2                                 # drawn at 2x, then scaled down, for smooth lines
    sx0, sy0, sx1, sy1 = STRIP
    strip_w, strip_h = round((sx1 - sx0) * ZOOM), round((sy1 - sy0) * ZOOM)
    strip_top = TOP + card.height + 40
    height = strip_top + strip_h + 110
    out = Image.new("RGBA", ((W + 2 * MARGIN) * k, height * k), (0, 0, 0, 0))
    out.alpha_composite(card.resize((card.width * k, card.height * k), Image.LANCZOS), (MARGIN * k, TOP * k))
    d = ImageDraw.Draw(out)
    for n, (px, py), side, pin_y in ON_CARD:
        at = ((MARGIN // 2 if side == "left" else MARGIN + W + MARGIN // 2) * k, (TOP + pin_y) * k)
        pin(d, n, at, ((MARGIN + px) * k, (TOP + py) * k), k)

    # The collector line, enlarged, in a rounded frame, centred under the card.
    strip = card.crop(STRIP).resize((strip_w * k, strip_h * k), Image.LANCZOS)
    left = (MARGIN + W / 2) - strip_w / 2
    frame = (round(left * k) - 6 * k, strip_top * k - 6 * k, round((left + strip_w) * k) + 6 * k, (strip_top + strip_h) * k + 6 * k)
    d.rounded_rectangle(frame, radius=18 * k, fill=INK)
    mask = Image.new("L", strip.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *strip.size), radius=14 * k, fill=255)
    out.paste(strip, (round(left * k), strip_top * k), mask)
    for i, (n, cx) in enumerate(ON_STRIP):
        tx = left + (cx - sx0) * ZOOM
        ty = strip_top + strip_h / 2 + 14 * ZOOM / 2
        at = (left + strip_w * (i + 0.5) / len(ON_STRIP), strip_top + strip_h + 62)
        pin(d, n, (at[0] * k, at[1] * k), (tx * k, ty * k), k)

    out = out.resize((out.width // k, out.height // k), Image.LANCZOS)
    path = ROOT / "art" / "guide" / "card-anatomy.webp"
    path.parent.mkdir(exist_ok=True)
    out.save(path, quality=90, method=6)
    print(f"wrote {path.relative_to(ROOT)} ({out.width} x {out.height})")


if __name__ == "__main__":
    main()
