"""Compose finished card images: generated art + frame + exact card text and stats.

    python tools/compose_cards.py            # every card in cards/sb1.json
    python tools/compose_cards.py --only SB1-C04
    python tools/compose_cards.py --finish gold     # only one finish (standard, foil, gold, prismatic)

Reads art from art/<set>/<key>.webp (see tools/generate_art.py) and writes 750x1050 WebP images
(2.5" x 3.5" at 300 dpi) to art/cards/<set>/, plus a README.md gallery grouped by deck. Every card is
also printed in each finish, to art/cards/<set>/<finish>/: the same card with its chrome (the frame, the
art's border, the edges of the name banner and type line, the cost ring) in holographic silver (foil),
polished gold (gold) or a rainbow (prismatic).
Card text comes from the card data, never from the image model, so a balance patch only
needs a re-compose, not a redraw.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 750, 1050
ART_BOX = (42, 138, 708, 582)          # 666 x 444 = the 3:2 art the model draws
TEXT_BOX = (42, 660, 708, 912)
FOOTER = "Fruitcats · Starter Box · © 2026 Krzysztof Cwalina"

FAMILIES = {                            # main, dark, tint
    "Citrus":   ("#F29F05", "#A86400", "#FFF1CC"),
    "Orchard":  ("#D64545", "#8E2A2A", "#FBE0DA"),
    "Garden":   ("#5FA84D", "#3B7430", "#E3F2DC"),
    "Berry":    ("#D6336C", "#8F1D46", "#FBDDE7"),
    "Tropical": ("#F2780C", "#A24E05", "#FFE6CC"),
    "Melon":    ("#3FA66B", "#25714A", "#DDF3E6"),
}
CREAM, INK, MUTED = "#FFF8EC", "#2B211B", "#7A6A5C"
POWER_COLOR, HEALTH_COLOR = "#E4572E", "#E0457B"

KEYWORDS = r"\b(Zoomies|Guardian|Sneaky|Fierce|Tough \d+|Lucky|Pounce)\b"
LABEL = r"(?:(?<=^)|(?<=\n)|(?<=\. ))([A-Z][A-Za-z ,0-9]*?:)"   # "Hello:", "Exhaust, pay 1:", "Grow Up:"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (Path("C:/Windows/Fonts") / name, Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size)


def fonts(size: int) -> dict:
    return {"regular": font("segoeui.ttf", size), "bold": font("segoeuib.ttf", size),
            "italic": font("segoeuii.ttf", size), "bolditalic": font("segoeuiz.ttf", size)}


def runs(text: str) -> list[tuple[str, str]]:
    """Split rules text into (text, style) runs: labels and keywords bold, reminders italic."""
    marks = [0] * len(text)                       # 0 regular, 1 bold, 2 italic
    for pattern in (KEYWORDS, LABEL):
        for match in re.finditer(pattern, text):
            for i in range(match.start(1), match.end(1)):
                marks[i] = 1
    for match in re.finditer(r"\([^)]*\)", text):
        for i in range(match.start(), match.end()):
            marks[i] = 2
    styles = ("regular", "bold", "italic")
    result, start = [], 0
    for i in range(1, len(text) + 1):
        if i == len(text) or marks[i] != marks[start]:
            result.append((text[start:i], styles[marks[start]]))
            start = i
    return result


def layout(text: str, width: int, f: dict) -> list[list[tuple[str, str]]]:
    """Word-wrap styled runs into lines of (word-with-space, style)."""
    lines, line, used = [], [], 0.0
    tokens = []
    for chunk, style in runs(text):
        for piece in re.split(r"(\s+)", chunk):
            if piece:
                tokens.append((piece, style))
    for piece, style in tokens:
        if "\n" in piece:
            lines.append(line)
            line, used = [], 0.0
            continue
        if piece.isspace():
            if line:
                line.append((" ", style))
                used += f[style].getlength(" ")
            continue
        size = f[style].getlength(piece)
        if used + size > width and line:
            while line and line[-1][0] == " ":
                line.pop()
            lines.append(line)
            line, used = [], 0.0
        line.append((piece, style))
        used += size
    if line:
        lines.append(line)
    return lines


ICONS = ROOT / "art" / "ui"
HEART_COLOR = "#D9486C"
CHIP_H, CHIP_ICON, CHIP_FONT, CHIP_PAD, CHIP_GAP = 62, 34, 40, 14, 8
CHIP_TOP = 930                     # the chips sit in the card's bottom strip, clear of the text box and frame


def stat_chip(img: Image.Image, kind: str, value: int, colors: tuple, right: bool) -> None:
    """A stat as a small chip in the family's tint: an icon (paw = Power, heart = Health) and the number.

    Quiet on purpose, so it never competes with the art: the chip matches the type line above the rules
    text. Power sits at the text box's left edge, Health at its right edge. The icons are Phosphor's
    (art/ui/stat-paw.svg, stat-heart.svg), kept as white masks and tinted here.
    """
    main, dark, tint = colors
    f = font("seguibl.ttf", CHIP_FONT)
    num = str(value)
    width = round(CHIP_PAD + CHIP_ICON + CHIP_GAP + ImageDraw.Draw(img).textlength(num, font=f) + CHIP_PAD + 2)
    x0 = TEXT_BOX[2] - width if right else TEXT_BOX[0]
    k = 4                                                   # drawn 4x and scaled down, for smooth edges
    chip = Image.new("RGBA", (width * k, CHIP_H * k), (0, 0, 0, 0))
    ImageDraw.Draw(chip).rounded_rectangle((0, 0, width * k - 1, CHIP_H * k - 1), radius=CHIP_H * k // 2,
                                           fill=tint, outline=main, width=2 * k)
    img.alpha_composite(chip.resize((width, CHIP_H), Image.LANCZOS), (x0, CHIP_TOP))
    mask = Image.open(ICONS / f"stat-{kind}.png").getchannel("A").resize((CHIP_ICON, CHIP_ICON), Image.LANCZOS)
    icon = Image.new("RGBA", (CHIP_ICON, CHIP_ICON), HEART_COLOR if kind == "heart" else dark)
    icon.putalpha(mask)
    img.alpha_composite(icon, (x0 + CHIP_PAD, CHIP_TOP + (CHIP_H - CHIP_ICON) // 2))
    ImageDraw.Draw(img).text((x0 + CHIP_PAD + CHIP_ICON + CHIP_GAP, CHIP_TOP + CHIP_H / 2 + 1), num,
                             font=f, fill=dark, anchor="lm")


def star(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill: str) -> None:
    import math
    points = []
    for i in range(10):
        radius = r if i % 2 == 0 else r * 0.45
        angle = math.pi / 2 + i * math.pi / 5
        points.append((cx + radius * math.cos(angle), cy - radius * math.sin(angle)))
    draw.polygon(points, fill=fill)


def clover(draw: ImageDraw.ImageDraw, cx: int, cy: int) -> None:
    draw.ellipse((cx - 32, cy - 32, cx + 32, cy + 32), fill="white", outline="#3B8A3A", width=4)
    for dx, dy in ((-9, -9), (9, -9), (-9, 9), (9, 9)):
        draw.ellipse((cx + dx - 10, cy + dy - 10, cx + dx + 10, cy + dy + 10), fill="#43A047")
    draw.line((cx + 2, cy + 4, cx + 12, cy + 24), fill="#2E7D32", width=4)


# Rarity marks, as in trading card games: a shape and a metal for each rarity. top, bottom, outline.
RARITY_MARKS = {
    "Common":    ("#F2B880", "#8A4A1C", "#4A2408"),     # bronze circle
    "Uncommon":  ("#F4F6FA", "#7F8B9C", "#2F3842"),     # silver diamond
    "Rare":      ("#FFE680", "#E0A019", "#6B4500"),     # gold star
    "Legendary": ("#FF8AD8", "#8B4DFF", "#3F1466"),     # pink-violet crown
}


def rarity_shape(rarity: str, cx: float, cy: float, r: float) -> list[tuple[float, float]] | None:
    """The mark's outline as a polygon, or None for the Common circle."""
    import math
    if rarity == "Uncommon":
        return [(cx, cy - r), (cx + r * 0.78, cy), (cx, cy + r), (cx - r * 0.78, cy)]
    if rarity == "Rare":
        return [(cx + (r if i % 2 == 0 else r * 0.46) * math.cos(math.pi / 2 + i * math.pi / 5),
                 cy - (r if i % 2 == 0 else r * 0.46) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]
    if rarity == "Legendary":   # a crown: three points over a band
        w, top, base = r * 1.05, cy - r * 0.85, cy + r * 0.7
        return [(cx - w, base), (cx - w, top + r * 0.25), (cx - w * 0.5, cy), (cx, top - r * 0.1),
                (cx + w * 0.5, cy), (cx + w, top + r * 0.25), (cx + w, base)]
    return None


def rarity_mark(img: Image.Image, cx: int, cy: int, r: int, rarity: str) -> None:
    """The rarity mark centred on (cx, cy), drawn at 4x and scaled down so its edges stay smooth."""
    top, bottom, outline = RARITY_MARKS[rarity]
    k, size = 4, 2 * r + 8
    c, R = size * k / 2, r * k
    shape = rarity_shape(rarity, c, c, R)
    mask = Image.new("L", (size * k, size * k), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((c - R, c - R, c + R, c + R), fill=255) if shape is None else md.polygon(shape, fill=255)
    # The metal: a vertical gradient from light to dark, inside an outline in the metal's own dark ink.
    grad = Image.new("RGBA", mask.size)
    gd = ImageDraw.Draw(grad)
    t, b = Image.new("RGB", (1, 1), top).getpixel((0, 0)), Image.new("RGB", (1, 1), bottom).getpixel((0, 0))
    for y in range(mask.size[1]):
        f = min(max((y - (c - R)) / (2 * R), 0), 1)
        gd.line((0, y, mask.size[0], y), fill=tuple(round(t[i] + (b[i] - t[i]) * f) for i in range(3)) + (255,))
    tile = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    ring = mask.filter(ImageFilter.MaxFilter(2 * k + 1))
    tile.paste(outline, (0, 0), ring)
    inner = mask.filter(ImageFilter.MinFilter(k + 1))
    tile.paste(grad, (0, 0), inner)
    tile = tile.resize((size, size), Image.LANCZOS)
    img.alpha_composite(tile, (round(cx - size / 2), round(cy - size / 2)))


# Finishes: the chrome's colours along the gradient, and the ink that edges it. Foil and prismatic are
# printed on silver, as real foils are: bands of metal, with the rainbow laid over them.
FINISHES = ("foil", "gold", "prismatic")
SILVER = ["#8e97a3", "#eef1f5", "#a7b0bb", "#f7f9fb", "#7f8894", "#dfe4ea", "#8e97a3"]
RAINBOW = ["#ff3d8b", "#ff9f1a", "#ffe23d", "#2ee88a", "#2bb8ff", "#7a5cff", "#e84dff", "#ff3d8b"]
CHROME = {
    "foil":      (SILVER, "#4a5362"),
    "gold":      (["#fff4c2", "#e8b73a", "#8a5a0c", "#f7d774", "#b07d17", "#fff0b0", "#c89224", "#fff4c2"], "#5a3a04"),
    "prismatic": (RAINBOW, "#3a2a5a"),
    "signature": (["#2a1a15", "#120b09"], "#120b09"),
}
# Signature: a set's top card is printed only this way (docs/heat-wave-set.md). Charred black stone with
# glowing lava cracks running through it. Cards opt in with "signature": true; it's never a default print.
SIGNATURE = "signature"
_textures: dict = {}


def signature_texture(xs, ys):
    """Charred black stone split by glowing lava cracks: the edges of a Voronoi pattern, hottest (yellow)
    in the middle of each crack and cooling through orange to deep red at its edges. Fixed seed, so every
    Signature card is cracked the same way."""
    import numpy as np
    rng = np.random.default_rng(7)
    pts = rng.uniform(0, 1, (170, 2)) * (W, H)
    d = np.sqrt((xs[..., None] - pts[:, 0]) ** 2 + (ys[..., None] - pts[:, 1]) ** 2)
    d.sort(axis=-1)
    edge = d[..., 1] - d[..., 0]                        # 0 on a crack, growing into each stone
    core = np.exp(-(edge / 3.2) ** 2)[..., None]
    glow = np.exp(-(edge / 16) ** 2)[..., None]
    stone = np.array([30, 20, 17], float) + 14 * np.sin(xs / 37 + np.sin(ys / 53) * 2)[..., None] / 2
    rgb = stone * (1 - glow) + np.array([190, 42, 10], float) * glow
    rgb = rgb * (1 - core) + np.array([255, 196, 92], float) * core
    return rgb


def chrome_texture(finish: str) -> Image.Image:
    """The chrome's material, card-sized. Foil is brushed silver with rainbow flashes running across it at
    another angle; gold is polished bands of gold; prismatic is the rainbow turning around the card's
    centre, over silver, with a band of light across it."""
    if finish not in _textures:
        import numpy as np
        ys, xs = np.mgrid[0:H, 0:W].astype(float)

        def ramp(stops: list[str], t):
            rgb = np.array([Image.new("RGB", (1, 1), c).getpixel((0, 0)) for c in stops], float)
            pos = np.linspace(0, 1, len(stops))
            return np.stack([np.interp(t % 1.0, pos, rgb[:, c]) for c in range(3)], -1)

        diagonal = (xs * 0.8 + ys * 0.6) / (W * 0.8 + H * 0.6)
        brushed = (1 + 0.04 * np.sin(ys * 1.9 + np.sin(xs / 23) * 3))[..., None]
        if finish == SIGNATURE:
            rgb = signature_texture(xs, ys)
        elif finish == "gold":
            rgb = ramp(CHROME["gold"][0], diagonal * 2) * brushed
        else:
            silver = ramp(SILVER, diagonal * 2.5) * brushed
            if finish == "foil":   # rainbow flashes, strongest where the silver is brightest
                flash = ramp(RAINBOW, (xs * 0.3 - ys * 0.9) / H * 1.5)
                light = silver.mean(-1, keepdims=True) / 255
                rgb = silver + (flash - 128) * 0.42 * light
            else:
                conic = ramp(RAINBOW, np.arctan2(ys - H / 2, xs - W / 2) / (2 * np.pi) + 0.1)
                rgb = conic * 0.78 + silver * 0.22
                band = np.exp(-(((xs * 0.55 + ys * 0.85) / (W * 0.55 + H * 0.85) - 0.42) / 0.05) ** 2)
                rgb = rgb + (255 - rgb) * 0.45 * band[..., None]
        _textures[finish] = Image.fromarray(np.clip(rgb, 0, 255).astype("uint8"), "RGB").convert("RGBA")
    return _textures[finish]


# A finish's code in the collector line, like the codes on real cards: F(oil), G(old), P(rismatic).
FINISH_CODES = {"foil": ("F", "#2e3552"), "gold": ("G", "#4a2c02"), "prismatic": ("P", "white"), SIGNATURE: ("S", "white")}


def finish_tag(img: Image.Image, right: int, cy: int, finish: str) -> int:
    """The finish code on a little tag of the finish's own material, its right edge at `right`.
    Drawn at 4x and scaled down so its edges stay smooth. Returns the tag's left edge."""
    letter, ink = FINISH_CODES[finish]
    k, w, h = 4, 26, 24
    mask = Image.new("L", (w * k, h * k), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * k - 1, h * k - 1), radius=7 * k, fill=255)
    x0, y0 = right - w, cy - h // 2
    # The whole card's chrome in miniature, so a Prismatic tag shows every colour, not just one patch.
    metal = chrome_texture(finish).resize((w * k, h * k), Image.LANCZOS)
    tile = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    tile.paste(metal, (0, 0), mask)
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle((0, 0, w * k - 1, h * k - 1), radius=7 * k, outline=CHROME[finish][1], width=2 * k)
    stroke = {"stroke_width": 2 * k, "stroke_fill": CHROME[finish][1]} if ink == "white" else {}
    td.text((w * k / 2, h * k / 2 + k), letter, font=font("seguibl.ttf", 16 * k), fill=ink, anchor="mm", **stroke)
    img.alpha_composite(tile.resize((w, h), Image.LANCZOS), (x0, y0))
    return x0


def centered(draw: ImageDraw.ImageDraw, xy: tuple, text: str, f, fill: str, **kw) -> None:
    draw.text(xy, text, font=f, fill=fill, anchor="mm", **kw)


def centered_ink(draw: ImageDraw.ImageDraw, xy: tuple, text: str, f, fill: str, **kw) -> None:
    """Centre the digits themselves. PIL's "mm" centres the font's line box, which sits a few pixels
    low on a badge because of the descender space below the digits."""
    box = draw.textbbox((0, 0), text, font=f, anchor="lt", stroke_width=kw.get("stroke_width", 0))
    draw.text((xy[0] - box[0] - (box[2] - box[0]) / 2, xy[1] - box[1] - (box[3] - box[1]) / 2),
              text, font=f, fill=fill, anchor="lt", **kw)


def compose(card: dict, side: str | None, art_path: Path, finish: str = "standard") -> Image.Image:
    main, dark, tint = FAMILIES[card["family"]]
    face = card[{"kitten": "kitten", "bigcat": "bigCat"}[side]] if side else card
    name = face["name"]
    text = face.get("text", "")
    power = face.get("power")
    health = None if side else card.get("health")
    # Where the chrome goes. A standard card keeps its family's colours there; a finish paints them over.
    chrome = Image.new("L", (W, H), 0)
    cd = ImageDraw.Draw(chrome)

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=42, fill=dark)
    d.rounded_rectangle((21, 21, W - 22, H - 22), radius=30, fill=CREAM)
    cd.rounded_rectangle((0, 0, W - 1, H - 1), radius=42, fill=255)
    cd.rounded_rectangle((21, 21, W - 22, H - 22), radius=30, fill=0)

    # Art
    x0, y0, x1, y1 = ART_BOX
    if art_path.exists():
        art = Image.open(art_path).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS)
    else:
        art = Image.new("RGB", (x1 - x0, y1 - y0), tint)
        ImageDraw.Draw(art).text(((x1 - x0) / 2, (y1 - y0) / 2), "art pending", font=fonts(34)["italic"],
                                 fill=MUTED, anchor="mm")
    mask = Image.new("L", art.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *art.size), radius=18, fill=255)
    img.paste(art, (x0, y0), mask)
    d.rounded_rectangle(ART_BOX, radius=18, outline=main, width=6)
    cd.rounded_rectangle(ART_BOX, radius=18, outline=255, width=7)

    # Name banner
    d.rounded_rectangle((36, 30, W - 36, 126), radius=26, fill=main, outline=dark, width=4)
    cd.rounded_rectangle((36, 30, W - 36, 126), radius=26, outline=255, width=5)
    title, _, epithet = name.partition(", ")
    title_font = font("segoeuib.ttf", 42)
    while title_font.getlength(title) > 520 and title_font.size > 26:
        title_font = font("segoeuib.ttf", title_font.size - 2)
    if epithet:
        d.text((150, 68), title, font=title_font, fill="white", anchor="ls", stroke_width=2, stroke_fill=dark)
        d.text((152, 104), epithet, font=font("segoeuiz.ttf", 25), fill="white", anchor="ls")
    else:
        d.text((150, 78), title, font=title_font, fill="white", anchor="lm", stroke_width=2, stroke_fill=dark)

    # Cost (or hero star)
    d.ellipse((30, 26, 132, 128), fill="white", outline=dark, width=8)
    cd.ellipse((30, 26, 132, 128), fill=0)
    cd.ellipse((30, 26, 132, 128), outline=255, width=9)
    if card["type"] == "Hero Cat":
        star(d, 81, 79, 38, main)
    else:
        centered(d, (81, 76), str(card.get("cost", 0)), font("seguibl.ttf", 60), dark)

    # Lucky badge
    if re.search(r"\bLucky\b", text):
        clover(d, x1 - 44, y0 + 44)

    # Type line
    kind = card["type"].upper()
    if card.get("token"):
        kind = f"TOKEN {kind}"
    if side:
        kind = f'HERO CAT · {"KITTEN" if side == "kitten" else "BIG CAT"}'
    d.rounded_rectangle((42, 596, W - 42, 648), radius=14, fill=tint, outline=main, width=3)
    d.text((62, 622), f'{kind} · {card["family"].upper()}',font=font("segoeuib.ttf", 25), fill=dark, anchor="lm")
    # The collector line: rarity mark, card number, and on a finished copy its finish code (F, G or P).
    key = card["id"] + (f"-{side}" if side else "")
    key_font = font("segoeui.ttf", 20)
    right = W - 62
    if finish != "standard":
        right = finish_tag(img, right, 622, finish) - 8
    d.text((right, 622), key, font=key_font, fill=MUTED, anchor="rm")
    if card.get("rarity"):                 # tokens aren't collected, so they have no rarity
        rarity_mark(img, round(right - key_font.getlength(key) - 20), 622, 12, card["rarity"])
    cd.rounded_rectangle((42, 596, W - 42, 648), radius=14, outline=255, width=4)

    # The finish's chrome, edged in its ink where it meets the card.
    if finish != "standard":
        img.paste(chrome_texture(finish), (0, 0), chrome)
        ink = CHROME[finish][1]
        d.rounded_rectangle((21, 21, W - 22, H - 22), radius=30, outline=ink, width=2)
        d.rounded_rectangle((1, 1, W - 2, H - 2), radius=41, outline=ink, width=2)
        d.ellipse((30, 26, 132, 128), outline=ink, width=2)
        d.ellipse((38, 34, 124, 120), outline=ink, width=2)
        d.rounded_rectangle(ART_BOX, radius=18, outline=ink, width=1)
        d.rounded_rectangle((ART_BOX[0] + 7, ART_BOX[1] + 7, ART_BOX[2] - 7, ART_BOX[3] - 7), radius=12, outline=ink, width=1)

    # Rules text + flavor, shrinking to fit
    d.rounded_rectangle(TEXT_BOX, radius=18, fill="white", outline="#E2D3BA", width=3)
    bx0, by0, bx1, by1 = TEXT_BOX
    flavor = card.get("flavor") if side != "bigcat" else None
    inner = bx1 - bx0 - 48
    for size in range(31, 17, -1):
        f = fonts(size)
        lines = layout(text, inner, f) if text else []
        flavor_font = font("segoeuii.ttf", max(size - 5, 16))
        flavor_lines = layout(flavor, inner, {"regular": flavor_font, "bold": flavor_font, "italic": flavor_font}) if flavor else []
        line_h, flavor_h = int(size * 1.3), int(flavor_font.size * 1.3)
        total = len(lines) * line_h + (18 if lines and flavor_lines else 0) + len(flavor_lines) * flavor_h
        if total <= by1 - by0 - 36:
            break
    # Lines are placed by baseline: Segoe UI's ascent/descent are larger than its em size.
    y = by0 + (by1 - by0 - total) / 2
    for line in lines:
        x = bx0 + 24
        for piece, style in line:
            d.text((x, y + size), piece, font=f[style], fill=INK, anchor="ls")
            x += f[style].getlength(piece)
        y += line_h
    if lines and flavor_lines:
        d.line((bx0 + 150, y + 6, bx1 - 150, y + 6), fill="#E2D3BA", width=2)
        y += 18
    for line in flavor_lines:
        words = "".join(piece for piece, _ in line)
        d.text(((bx0 + bx1) / 2, y + flavor_font.size), words, font=flavor_font, fill=MUTED, anchor="ms")
        y += flavor_h

    # Stats
    if power is not None:
        stat_chip(img, "paw", power, (main, dark, tint), right=False)
    if health is not None:
        stat_chip(img, "heart", health, (main, dark, tint), right=True)
    centered(d, (W / 2, 1000), FOOTER, font("segoeui.ttf", 17), MUTED)
    return img


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default="sb1")
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--finish", choices=("standard", *FINISHES, SIGNATURE), help="only this finish (default: all)")
    args = parser.parse_args()

    data = json.loads((ROOT / "cards" / f"{args.set}.json").read_text(encoding="utf-8"))
    cards = {c["id"]: c for c in data["cards"]}
    # A set can add families (with their colours) and family mechanics, and names itself in the footer.
    global FOOTER, KEYWORDS
    for family, info in data.get("families", {}).items():
        FAMILIES[family] = tuple(info["colors"])
    if data.get("mechanics"):
        KEYWORDS = KEYWORDS[:-3] + "|" + "|".join(data["mechanics"]) + r")\b"
    FOOTER = f'Fruitcats · {data["name"]} · © 2026 Krzysztof Cwalina'
    art_dir = ROOT / "art" / args.set
    out_dir = ROOT / "art" / "cards" / args.set
    out_dir.mkdir(parents=True, exist_ok=True)
    finishes = [args.finish] if args.finish else ["standard", *FINISHES]
    for f in finishes:
        if f != "standard":
            (out_dir / f).mkdir(exist_ok=True)

    written, pending = [], []
    for card in data["cards"] + [dict(t, token=True) for t in data.get("tokens", [])]:
        if args.only and card["id"] not in args.only:
            continue
        for side in (("kitten", "bigcat") if card["type"] == "Hero Cat" else (None,)):
            key = card["id"] + (f"-{side}" if side else "")
            art = art_dir / f"{key}.webp"
            if not art.exists():
                pending.append(key)
            # Tokens are printed plain; a Signature card also gets its Signature print.
            prints = ["standard"] if card.get("token") else list(finishes)
            if card.get("signature") and not args.finish:
                prints.append(SIGNATURE)
            for f in prints:
                if f != "standard":
                    (out_dir / f).mkdir(exist_ok=True)
                compose(card, side, art, f).save(out_dir / (f"{key}.webp" if f == "standard" else f"{f}/{key}.webp"),
                                                 quality=90, method=6)
            written.append(key)
    print(f"composed {len(written)} card image(s) in {len(finishes)} finish(es) into {out_dir.relative_to(ROOT)}")
    if pending:
        print(f"art pending for: {', '.join(pending)}")

    # Gallery grouped by deck
    def label(key: str) -> str:
        card_id, _, side = key.partition("-kitten") if key.endswith("-kitten") else key.partition("-bigcat")
        card = cards[card_id]
        if card["type"] == "Hero Cat":
            face = card["kitten"] if key.endswith("-kitten") else card["bigCat"]
            return f'{face["name"]} ({"Kitten" if key.endswith("-kitten") else "Big Cat"})'
        return card["name"]

    def cell(key: str, qty: str = "", width: int = 180) -> str:
        name = label(key).replace('"', "&quot;")
        return f'<img src="{key}.webp" width="{width}" alt="{name}"><br><b>{name}</b><br><sub>{key}{qty}</sub>'

    def grid(entries: list[str]) -> str:
        rows = [entries[i:i + 4] for i in range(0, len(entries), 4)]
        return "\n".join("<tr>" + "".join(f"<td align=\"center\">{e}</td>" for e in row) + "</tr>" for row in rows)

    sections = [f'# {data["name"]} ({data["set"]}) — card images\n',
                "Generated by `tools/generate_art.py` (art) and `tools/compose_cards.py` (frames and text).\n"]

    # Hero Cats first, the mightiest one (the only Big Cat with the most Power and Fierce) on top.
    heroes = [c for c in data["cards"] if c["type"] == "Hero Cat"]
    mightiest = max(heroes, key=lambda c: (c["bigCat"].get("power", 0), "Fierce" in c["bigCat"]["text"]))
    others = [h for h in heroes if h is not mightiest]
    note = " *(preview — not in the Starter Box yet)*" if mightiest.get("preview") else ""
    sections.append(
        f'## {mightiest["name"]} — the mightiest Hero Cat{note}\n\n'
        f'The only Big Cat with {mightiest["bigCat"]["power"]} Power and Fierce.\n\n'
        f'<table>\n<tr><td align="center">{cell(mightiest["id"] + "-kitten", width=300)}</td>'
        f'<td align="center">{cell(mightiest["id"] + "-bigcat", width=300)}</td></tr>\n</table>\n')
    hero_entries = [cell(f'{h["id"]}-{side}') for h in others for side in ("kitten", "bigcat")]
    sections.append("## All Hero Cats\n\nEach Hero Cat starts as a Kitten and Grows Up into a Big Cat. "
                    + ", ".join(h["name"] + (" (preview)" if h.get("preview") else "") for h in others)
                    + f".\n\n<table>\n{grid(hero_entries)}\n</table>\n")

    garden = set()
    for deck in data["decks"].values():
        entries = []
        for cid, qty in deck["cards"].items():
            if cid not in cards:                   # a card from another set (the Starter Box's Garden)
                continue
            if cards[cid]["family"] == "Garden":
                garden.add(cid)
            else:
                entries.append(cell(cid, f" ×{qty}"))
        hero = cards[deck["hero"]]["name"]
        sections.append(f'## {deck["name"]} deck (led by {hero})\n\n<table>\n{grid(entries)}\n</table>\n')
    sections.append(f"## Garden (in both decks)\n\n<table>\n{grid([cell(c) for c in sorted(garden)])}\n</table>\n")
    (out_dir / "README.md").write_text("\n".join(sections), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
