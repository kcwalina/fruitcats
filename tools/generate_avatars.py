"""Draw the Via Mochi account avatars ("Pawtraits") with the same image model and plush style as the Hero Cats.

    python tools/generate_avatars.py                 # draw every avatar that has no image yet
    python tools/generate_avatars.py --only lemon    # one avatar
    python tools/generate_avatars.py --force         # redraw

Everyday Pawtraits are plain fruit-hooded cats anyone can pick. Legend Pawtraits come with a Legendary card: owning
the card unlocks its avatar (docs/accounts-plan.md, Avatars). Images are square, head-and-shoulders portraits made to
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
    "An avatar portrait of a cute collectible mascot cat drawn as a soft plush toy, in a simple flat kawaii sticker "
    "style: bold clean black outlines, completely flat colours, no gradients and almost no shading. Head and "
    "shoulders only, the face large and centred, filling most of the frame, facing the viewer, made to be cropped "
    "into a circle for a profile picture. The face is minimal and sewn-on looking: two tiny black dot eyes set wide "
    "apart, a small soft smile, two round pink blush ovals on the cheeks, three short black stripes on the forehead, "
    "and three long straight black whiskers on each side of the face. The cat wears a soft fruit-shaped hood over its "
    "head, with its two little cat ears poking out through the hood. Toy-like and huggable, never realistic, no fur "
    "texture, no 3D render. Absolutely no text, letters, numbers, symbols, logos, borders, frames or watermarks."
)
# Legend Pawtraits come with the most expensive cards. They stay in the clean, cute Hero Cat look (simple and readable
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
EVERYDAY_BACKGROUND = "Background: one plain flat pastel colour ({colour}) filling the whole square, nothing else."
LEGEND_BACKGROUND = ("Background: a radiant sunburst of warm gold and soft cream rays spreading from behind the head, "
                     "with three or four big simple four-pointed white-gold sparkles. Bright, warm and celebratory.")
# Every Legend is drawn from real Hero Cat art, so it matches the game's own look.
# Each Legend Pawtrait comes with a card, so it lives in that card's set folder (the site publishes each set's
# avatars/ at /avatars/, apps/web/vite.config.ts). Everyday Pawtraits belong to no set and stay in art/avatars/.
LEGEND_SETS = {
    "legend-mochi": "content/2026/09/starter-box/avatars",
    "legend-nova": "content/2026/09/heat-wave/avatars",
    "legend-reaper": "content/2026/09/heat-wave/avatars",
}
LEGEND_REFERENCE = "content/2026/09/starter-box/art/illustrations/SB1-H03-bigcat.webp"

# id: (subject, background colour or None for a Legend Pawtrait, reference image for a known character)
AVATARS = {
    # Everyday Pawtraits: two per fruit family.
    "lemon": ("a pale cream cat wearing a bright yellow lemon hood with a little green leaf", "pale butter yellow", None),
    "orange": ("a ginger cat wearing a round orange-fruit hood with a green stem", "pale apricot", None),
    "apple": ("a white cat wearing a shiny red apple hood with a stalk and a leaf", "pale apple green", None),
    "pear": ("a soft grey cat wearing a green pear hood with a brown stalk", "pale cream", None),
    "strawberry": ("a calico cat wearing a red strawberry hood with tiny seeds and a green leafy top", "pale pink", None),
    "blueberry": ("a black cat wearing a round blueberry hood with a little crown-shaped top", "pale lavender", None),
    "pineapple": ("a tabby cat wearing a golden pineapple hood with spiky green leaves", "pale peach", None),
    "coconut": ("a chocolate-brown cat wearing a brown coconut-shell hood", "pale sky blue", None),
    "watermelon": ("a white cat with a black patch wearing a green striped watermelon hood", "pale mint", None),
    "cantaloupe": ("an orange tabby wearing a netted cantaloupe-melon hood", "pale sea green", None),
    "peapod": ("a black-and-white tuxedo cat wearing a green pea-pod hood", "pale spring green", None),
    "pumpkin": ("a grey tabby wearing an orange pumpkin hood with a curly vine", "pale beige", None),
    # Legend Pawtraits: each comes with its Legendary card.
    "legend-mochi": ("Mochi, the Mango Bengal: a cream-coloured cat with a few simple grey spots and grey-tipped "
                     "ears, wearing a bright golden-orange mango hood with a little crown of green palm leaves and a "
                     "small orange bow at the neck, a proud happy smile", None, "content/2026/09/starter-box/art/illustrations/SB1-H03-bigcat.webp"),
    # Nova and Reaper are drawn by the Heat Wave card work to match their cards (content/2026/09/heat-wave/avatars/); don't redraw them from these older descriptions.
    "legend-nova": ("Nova, the Starfruit Voyager: a sunny golden-tabby cat wearing a bright lemon-yellow hood shaped "
                    "like a five-pointed starfruit star, one small glowing star tucked by its ear, wide-eyed and "
                    "delighted, a wonder-filled smile", None, None),
    "legend-reaper": ("Reaper, the Carolina Sphynx: a round, chubby, smooth peachy-pink cartoon kitten with big "
                      "pointy ears (drawn simply, like the other mascots, no wrinkles), wearing a glossy bright "
                      "cherry-red chili-pepper hood with a little curly green stem on top, two tiny cute flames beside "
                      "it, a cheeky playful grin", None, None),
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
