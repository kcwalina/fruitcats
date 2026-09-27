"""Draw the Via Mochi account avatars ("Portraits"): everyday ones are folk creatures; Legend ones come with a card.

    python tools/generate_avatars.py                 # draw every avatar that has no image yet
    python tools/generate_avatars.py --only lemon    # one avatar
    python tools/generate_avatars.py --force         # redraw

Everyday Portraits are folk creatures anyone can pick. Legend Portraits come with a Legendary card: owning
the card unlocks its avatar (docs/accounts.md, Avatars). Images are square, head-and-shoulders portraits made to
be shown in a circle, saved at 512px: everyday ones to art/avatars/<id>.webp, Legend ones to their card set's
folder (content/<yyyy>/<mm>/<set>/avatars/<id>.webp, see LEGEND_SETS). Every run costs money, so existing files are skipped.
"""

import argparse
import base64
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_art import API_VERSION, MODELS, ROOT, access_token, multipart, post  # noqa: E402

STYLE = (
    "An avatar portrait of one cute, gentle creature from world folklore, in a soft storybook style: gently painterly "
    "soft 3D with smooth rounded shapes, warm lantern light from one side, a friendly face with kind eyes, lovable and "
    "never scary, never a caricature of a real people. Head and shoulders only, the face large and centred, filling "
    "most of the frame, facing the viewer, made to be cropped into a circle for a profile picture. Simple and readable "
    "at a small size. No text, letters, numbers, logos, borders, frames or watermarks."
)
# Legend Portraits come with the most expensive cards. They stay in the clean, cute Hero Cat look (simple and readable
# at icon size); what makes them special is bright, joyful colour, a radiant golden backdrop and a happy hero pose. The
# game adds the rest around them: a turning foil ring, a glow and a shine (apps/web/src/account.ts, pawtrait()).
LEGEND_STYLE = (
    "An avatar portrait of a cute collectible mascot cat in exactly the art style of the reference image: a soft "
    "plush-toy mascot in a clean kawaii sticker style with bold clean black outlines, simple shapes and flat, bright, "
    "cheerful colours with just a touch of glossy highlight. The face is simple and adorable: big round shiny eyes "
    "with a sparkle, a small happy open smile, round pink blush cheeks. Head and shoulders only, the face large and "
    "centred, facing the viewer, filling most of the frame, made to be cropped into a circle. Keep it simple and easy "
    "to read at a small size: no fur texture, no strands of hair, no wrinkles, no fine detail, no busy patterns. "
    "Joyful, sweet and huggable, never scary, never realistic, no 3D render. Absolutely no text, letters, numbers, "
    "logos, borders, frames or watermarks."
)
EVERYDAY_BACKGROUND = "Background: one soft plain warm colour ({colour}) with a faint darker vignette, nothing else."
LEGEND_BACKGROUND = ("Background: a radiant sunburst of warm gold and soft cream rays spreading from behind the head, "
                     "with three or four big simple four-pointed white-gold sparkles. Bright, warm and celebratory.")
# Every Legend is drawn from real Hero Cat art, so it matches the game's own look.
# Each Legend Portrait comes with a card, so it lives in that card's set folder (the site publishes each set's
# avatars/ at /avatars/, apps/web/vite.config.ts). Everyday Portraits belong to no set and stay in art/avatars/.
LEGEND_SETS = {
    "legend-tango": "content/2026/09/starter-box/avatars",
}
LEGEND_REFERENCE = "content/2026/09/starter-box/art/illustrations/SB1-H03-bigcat.webp"

# id: (subject, background colour or None for a Legend Portrait, reference image for a known character)
AVATARS = {
    # Everyday Portraits: folk creatures from around the world (Folkborn, 2026-09-26). The ids are the old fruit names,
    # because accounts store the id; the names players see are in viamochi-id's Avatars.cs.
    "lemon": ("a Polish domowik house spirit: a small round furry old fellow with a long soft grey beard, bushy eyebrows, droopy sleepy eyes, a big soft pink nose, an embroidered white linen shirt", "warm honey", None),
    "orange": ("a Chinese feifei: a small fluffy raccoon-dog-like creature with soft grey-brown fur, a big bushy white-tipped tail curled beside its face and a gentle comforting smile", "soft moss green", None),
    "apple": ("a Chinese household hedgehog spirit with soft spines, a tiny white topknot and a small red lucky knot charm, gentle smile", "dusty rose", None),
    "pear": ("a Persian pari: a small graceful winged being with soft feathered wings, a delicate jewelled headband, flowing robe with Persian patterns", "pale turquoise", None),
    "strawberry": ("a Filipino nuno sa punso: a tiny old spirit with a long white beard and a wide conical woven salakot hat, twinkling eyes", "warm sand", None),
    "blueberry": ("a Kashmiri yech: a small dark soft civet-like sprite wearing a white cap, a few snowflakes around it, sly friendly smile", "soft slate blue", None),
    "pineapple": ("a Ghanaian mmoatia: a tiny leafy forest spirit with a face of soft bark and a crown of banana leaves, wise gentle eyes", "leaf green", None),
    "coconut": ("a Fijian veli: a small furry forest spirit wearing a band of patterned brown-and-black tapa cloth and a hibiscus flower behind one ear", "terracotta", None),
    "watermelon": ("a Venezuelan momoy: a tiny bearded little mountain-lake spirit in a palm-fibre hat trimmed with feathers, leaves and flowers", "misty lilac", None),
    "cantaloupe": ("a Scottish selkie pup: a round soft grey seal with big gentle dark eyes and a little shawl of seaweed", "sea blue-grey", None),
    "peapod": ("a Slavic klobuk house bird spirit: a round fluffy little bird with warm brown feathers and golden-tipped wings, a tiny embroidered collar", "warm straw", None),
    "pumpkin": ("a Chinese dangkang lucky beast: a round cheerful little pig-like creature with two small soft tusks and a golden harvest grain stalk behind its ear", "warm apricot", None),
    # Legend Portraits: each comes with its Legendary card.
    "legend-tango": ("Tango, the Mango Bengal: a cream-coloured cat with a few simple grey spots and grey-tipped "
                     "ears, wearing a bright golden-orange mango hood with a little crown of green palm leaves and a "
                     "small orange bow at the neck, a proud happy smile", None, "content/2026/09/starter-box/art/illustrations/SB1-H03-bigcat.webp"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", help="avatar ids to draw")
    parser.add_argument("--force", action="store_true", help="redraw existing images")
    parser.add_argument("--model", default="gpt-image-1-mini", choices=MODELS, help="gpt-image-1-mini stays cartoon; gpt-image-2 drifts towards realism")
    parser.add_argument("--quality", default="medium", choices=["low", "medium", "high"])
    parser.add_argument("--jobs", type=int, default=4, help="parallel requests")
    parser.add_argument("--out", help="one output folder for all, to try variants without replacing")
    args = parser.parse_args()

    def target(key: str) -> Path:
        folder = ROOT / (args.out or LEGEND_SETS.get(key, "art/avatars"))
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{key}.webp"
    todo = [k for k in AVATARS if (not args.only or k in args.only) and (args.force or not target(k).exists())]
    if not todo:
        print("Nothing to draw (all avatars exist; use --force to redraw).")
        return 0
    endpoint, deployment = MODELS[args.model]
    print(f"{deployment} @ {endpoint}, quality={args.quality}, {len(todo)} avatar(s)")
    token = access_token()

    def draw(key: str) -> bool:
        subject, colour, reference = AVATARS[key]
        legend = colour is None
        background = LEGEND_BACKGROUND if legend else EVERYDAY_BACKGROUND.format(colour=colour)
        prompt = f"{LEGEND_STYLE if legend else STYLE}\n\nSubject: {subject}\n\n{background}"
        try:
            if reference or legend:
                prompt = (("Draw this same character again as a new avatar portrait, keeping its colours, markings "
                           "and hood" if reference else
                           "Draw a NEW character in exactly the same art style as this reference image (same "
                           "outlines, flat colours and cuteness)") + ", following these instructions:\n\n" + prompt)
                body, content_type = multipart({"prompt": prompt, "n": "1", "size": "1024x1024", "quality": args.quality},
                                               "image", ROOT / (reference or LEGEND_REFERENCE))
                url = f"{endpoint}/openai/deployments/{deployment}/images/edits?api-version={API_VERSION}"
            else:
                body = json.dumps({"prompt": prompt, "n": 1, "size": "1024x1024", "quality": args.quality}).encode()
                content_type = "application/json"
                url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version={API_VERSION}"
            data = post(url, token, body, content_type)["data"][0]["b64_json"]
        except (RuntimeError, KeyError, IndexError, OSError) as error:
            print(f"  {key}: FAILED {error}", flush=True)
            return False
        path = target(key)
        image = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB").resize((512, 512), Image.LANCZOS)
        image.save(path, quality=88, method=6)
        print(f"  {key}: {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)", flush=True)
        return True

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(draw, todo))
    print(f"\ndrew {results.count(True)} of {len(todo)}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
