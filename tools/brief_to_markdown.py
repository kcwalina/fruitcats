"""Turn a set's art brief (art/brief.json) into the Markdown brief sent to the artist.

    python tools/brief_to_markdown.py content/2026/12/berry-picnic docs/art-brief-berry-picnic.md

The JSON is the source (the Artist Studio reads it too); re-run this after changing it.
"""

import json
import sys
from pathlib import Path

TIER = {"deck": "Deck card", "token": "Token", "foil": "Foil single ($1.49)", "gold": "Gold single ($4.99)",
        "signature": "Signature ($19.99)", "legend": "Legend Pawtrait", "announcement": "Announcement"}
STYLE = {"painted": "Painted", "sticker": "Sticker"}
OPEN = {"name": "the name", "flavor": "the flavour text", "animal": "which animal it is", "berry": "which berry",
        "breed": "the cat breed", "scene": "the scene", "object": "the object", "look": "the look", "characters": "the characters"}


def main() -> int:
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    brief = json.loads((folder / "art" / "brief.json").read_text(encoding="utf-8"))
    cards = {c["id"]: c for c in json.loads((folder / "set.json").read_text(encoding="utf-8"))["cards"]}
    tokens = {t["id"]: t for t in json.loads((folder / "set.json").read_text(encoding="utf-8")).get("tokens", [])}
    cards.update(tokens)

    def name(p):
        c = cards.get(p.get("card") or "")
        if not c:
            return "Announcement key art" if p["kind"] == "announcement" else p["file"]
        n = c["name"]
        if p.get("side"):
            n = c[{"kitten": "kitten", "bigcat": "bigCat"}[p["side"]]]["name"] + f" ({'Kitten' if p['side'] == 'kitten' else 'Big Cat'})"
        if p["kind"] == "pawtrait":
            n = f"Pawtrait: {c['name'].split(',')[0]}"
        return n

    def rules(p):
        c = cards.get(p.get("card") or "")
        if not c or p["kind"] == "pawtrait":
            return None
        face = c[{"kitten": "kitten", "bigcat": "bigCat"}[p["side"]]] if p.get("side") else c
        return face.get("text") or None

    L = [f"# Art brief: {brief['name']} ({brief['set']})", "",
         f"**For:** {brief['artist']} · **From:** Krzysztof Cwalina · **Sent:** <date>", "",
         "Please read the [artist guide](artist-guide.md) first: it covers sizes, styles, milestones and suggesting",
         "changes. This brief lists what this set needs.", "",
         "## The set in a few lines", "", brief["about"], "", f"**Who it's for:** {brief['audience']}", "",
         f"**Style:** {brief['style']}", "", "## Families", "", "| Family | World |", "|---|---|"]
    for fam, f in brief["families"].items():
        L.append(f"| {fam} | {f['world']} |")
    counts = {}
    for p in brief["pictures"]:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1
    L += ["", "## Summary", "", "| | Count |", "|---|---|",
          f"| Card pictures (including Hero Cat forms) | {counts.get('card', 0)} |",
          f"| Tokens | {counts.get('token', 0)} |", f"| Pawtraits (512 × 512) | {counts.get('pawtrait', 0)} |",
          f"| Announcement key art (2400 × 1260) | {counts.get('announcement', 0)} |",
          f"| **Total pictures** | **{len(brief['pictures'])}** |", "",
          "Card pictures and tokens are **1536 × 1024**, landscape. Save every picture as WebP with the file name below.",
          "The deck also uses 14 Garden cards that are already drawn: nothing to draw for them.", ""]
    for m in brief["milestones"]:
        pics = [p for p in brief["pictures"] if p["milestone"] == m["id"]]
        L += [f"## Milestone {m['id']}: {m['title']}", "", m["note"], ""]
        for p in pics:
            L += [f"### `{p['file']}`: {name(p)}", ""]
            tags = [TIER.get(p["tier"], p["tier"]), STYLE.get(p["style"], p["style"])]
            if p.get("showcase"):
                tags.append("showcase art")
            if p.get("main"):
                tags.append("a main picture")
            L.append(f"- **Kind:** {' · '.join(tags)}")
            r = rules(p)
            if r:
                L.append(f"- **What the card does:** {r.replace(chr(10), ' ')}")
            L.append(f"- **What to draw:** {p['draw']}")
            L.append(f"- **Must keep:** {'; '.join(p['mustKeep'])}" if p["mustKeep"] else "- **Must keep:** nothing specific")
            if p["open"]:
                L.append(f"- **Open to change:** {', '.join(OPEN.get(o, o) for o in p['open'])}")
            if p.get("signature") == "requested":
                L.append("- **Signature:** please sign this picture in a corner.")
            elif p.get("signature") == "welcome":
                L.append("- **Signature:** especially welcome on this card.")
            if p.get("pawtrait"):
                L.append(f"- **Pawtrait:** yes, `{p['pawtrait']}` (milestone 6)")
            L.append("")
    L += ["## Open questions for the artist", "", "- None yet. Send questions and suggestions with your first sketch.", ""]
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"wrote {out} ({len(brief['pictures'])} pictures)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
