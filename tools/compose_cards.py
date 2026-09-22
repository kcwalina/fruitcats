"""Compose finished card images: generated art + frame + exact card text and stats.

    python tools/compose_cards.py            # every card in cards/sb1.json
    python tools/compose_cards.py --only SB1-C04

Reads art from art/<set>/<key>.webp (see tools/generate_art.py) and writes 750x1050 WebP images
(2.5" x 3.5" at 300 dpi) to art/cards/<set>/, plus a README.md gallery grouped by deck.
Card text comes from the card data, never from the image model, so a balance patch only
needs a re-compose, not a redraw.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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


def heart(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill: str, outline: str) -> None:
    for pad, color in ((6, outline), (0, fill)):
        rr = r - pad
        draw.ellipse((cx - rr, cy - rr * 0.95, cx, cy + rr * 0.05), fill=color)
        draw.ellipse((cx, cy - rr * 0.95, cx + rr, cy + rr * 0.05), fill=color)
        draw.polygon([(cx - rr * 0.97, cy - rr * 0.35), (cx + rr * 0.97, cy - rr * 0.35), (cx, cy + rr * 1.05)], fill=color)


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


def centered(draw: ImageDraw.ImageDraw, xy: tuple, text: str, f, fill: str, **kw) -> None:
    draw.text(xy, text, font=f, fill=fill, anchor="mm", **kw)


def compose(card: dict, side: str | None, art_path: Path) -> Image.Image:
    main, dark, tint = FAMILIES[card["family"]]
    face = card[{"kitten": "kitten", "bigcat": "bigCat"}[side]] if side else card
    name = face["name"]
    text = face.get("text", "")
    power = face.get("power")
    health = None if side else card.get("health")

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=42, fill=dark)
    d.rounded_rectangle((21, 21, W - 22, H - 22), radius=30, fill=CREAM)

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

    # Name banner
    d.rounded_rectangle((36, 30, W - 36, 126), radius=26, fill=main, outline=dark, width=4)
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
    if card["type"] == "Hero Cat":
        star(d, 81, 79, 38, main)
    else:
        centered(d, (81, 76), str(card["cost"]), font("seguibl.ttf", 60), dark)

    # Lucky badge
    if re.search(r"\bLucky\b", text):
        clover(d, x1 - 44, y0 + 44)

    # Type line
    kind = card["type"].upper()
    if side:
        kind = f'HERO CAT · {"KITTEN" if side == "kitten" else "BIG CAT"}'
    d.rounded_rectangle((42, 596, W - 42, 648), radius=14, fill=tint, outline=main, width=3)
    d.text((62, 622), f'{kind} · {card["family"].upper()}',font=font("segoeuib.ttf", 25), fill=dark, anchor="lm")
    key = card["id"] + (f"-{side}" if side else "")
    d.text((W - 62, 622), key, font=font("segoeui.ttf", 20), fill=MUTED, anchor="rm")

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
        d.ellipse((42, 922, 150, 1030), fill=dark)
        d.ellipse((48, 928, 144, 1024), fill=POWER_COLOR)
        centered(d, (96, 973), str(power), font("seguibl.ttf", 58), "white", stroke_width=3, stroke_fill=dark)
    if health is not None:
        heart(d, 654, 970, 58, HEALTH_COLOR, dark)
        centered(d, (654, 962), str(health), font("seguibl.ttf", 54), "white", stroke_width=3, stroke_fill=dark)
    centered(d, (W / 2, 1000), FOOTER, font("segoeui.ttf", 17), MUTED)
    return img


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default="sb1")
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()

    data = json.loads((ROOT / "cards" / f"{args.set}.json").read_text(encoding="utf-8"))
    cards = {c["id"]: c for c in data["cards"]}
    art_dir = ROOT / "art" / args.set
    out_dir = ROOT / "art" / "cards" / args.set
    out_dir.mkdir(parents=True, exist_ok=True)

    written, pending = [], []
    for card in data["cards"]:
        if args.only and card["id"] not in args.only:
            continue
        for side in (("kitten", "bigcat") if card["type"] == "Hero Cat" else (None,)):
            key = card["id"] + (f"-{side}" if side else "")
            art = art_dir / f"{key}.webp"
            if not art.exists():
                pending.append(key)
            compose(card, side, art).save(out_dir / f"{key}.webp", quality=90, method=6)
            written.append(key)
    print(f"composed {len(written)} card image(s) into {out_dir.relative_to(ROOT)}")
    if pending:
        print(f"art pending for: {', '.join(pending)}")

    # Gallery grouped by deck
    def cell(key: str, qty: str = "") -> str:
        return f'<img src="{key}.webp" width="180" alt="{key}"><br><sub>{key}{qty}</sub>'

    def grid(entries: list[str]) -> str:
        rows = [entries[i:i + 4] for i in range(0, len(entries), 4)]
        return "\n".join("<tr>" + "".join(f"<td align=\"center\">{e}</td>" for e in row) + "</tr>" for row in rows)

    sections = [f'# {data["name"]} ({data["set"]}) — card images\n',
                "Generated by `tools/generate_art.py` (art) and `tools/compose_cards.py` (frames and text).\n"]
    garden = set()
    for deck in data["decks"].values():
        hero = deck["hero"]
        entries = [cell(f"{hero}-kitten"), cell(f"{hero}-bigcat")]
        for cid, qty in deck["cards"].items():
            if cards[cid]["family"] == "Garden":
                garden.add(cid)
            else:
                entries.append(cell(cid, f" ×{qty}"))
        sections.append(f'## {deck["name"]}\n\n<table>\n{grid(entries)}\n</table>\n')
    sections.append(f"## Garden (in both decks)\n\n<table>\n{grid([cell(c) for c in sorted(garden)])}\n</table>\n")
    previews = [c for c in data["cards"] if c.get("preview")]
    if previews:
        entries = [cell(f'{c["id"]}-{s}') for c in previews for s in ("kitten", "bigcat")]
        sections.append(f"## Preview Hero Cats\n\n<table>\n{grid(entries)}\n</table>\n")
    (out_dir / "README.md").write_text("\n".join(sections), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
