"""Draw the banner painting over each deck's tale in the Collection: a place from the set's lore, in the deck's own style.

    python tools/draw_banners.py                 # every set whose art/prompts.json has a "banner", if not drawn yet
    python tools/draw_banners.py --only dw1 --force

The prompt is the set's `banner` subject (art/prompts.json) with its `bannerStyle` (or `style`) and `referenceLead`; one of the set's
own paintings (`bannerReference`, an illustration's name) is the style reference. Saved as <SET>-banner.webp in the
set's art/illustrations, published with the rest of its art (npm run publish-pack -- <set>). Same auth as
generate_art.py (az login). Every run costs money, so an existing banner is kept unless --force is given.
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

LEAD = ("Draw a NEW painting in exactly the same art style as this reference image (same technique, brushwork, "
        "colour treatment and mood), but of a completely different subject and scene.")
FRAMING = ("A wide banner picture: keep everything important in the middle band of the picture, top to bottom about "
           "20% to 75%, because the top and bottom will be cropped. Leave the lowest quarter calm and fairly dark, "
           "like a floor, ground or water in shadow, because a title is written over it. No people, no creatures "
           "of the tale, no text, no letters, no frame, no border.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", help="set codes")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    endpoint, deployment = MODELS["gpt-image-2"]
    todo = []
    for set_path in sorted((ROOT / "content").glob("*/*/*/set.json")):
        code = json.loads(set_path.read_text(encoding="utf-8"))["set"]
        prompts_path = set_path.parent / "art" / "prompts.json"
        prompts = json.loads(prompts_path.read_text(encoding="utf-8")) if prompts_path.exists() else {}
        if not prompts.get("banner") or (args.only and code.lower() not in [c.lower() for c in args.only]):
            continue
        out = set_path.parent / "art" / "illustrations" / f"{code}-banner.webp"
        if out.exists() and not args.force:
            continue
        todo.append((code, prompts, set_path.parent / "art" / "illustrations" / f"{prompts['bannerReference']}.webp", out))
    if not todo:
        print("Nothing to draw.")
        return 0
    token = access_token()

    def draw(job) -> bool:
        code, prompts, reference, out = job
        prompt = "\n\n".join(p for p in [prompts.get("referenceLead") or LEAD, prompts.get("bannerStyle") or prompts.get("style", ""),
                                         f"Subject: {prompts['banner']}", FRAMING] if p)
        body, content_type = multipart({"prompt": prompt, "n": "1", "size": "1536x1024", "quality": "high"}, "image", reference)
        url = f"{endpoint}/openai/deployments/{deployment}/images/edits?api-version={API_VERSION}"
        try:
            data = post(url, token, body, content_type)["data"][0]["b64_json"]
        except (RuntimeError, KeyError, IndexError, OSError) as error:
            print(f"  {code}: FAILED {error}", flush=True)
            return False
        Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB").save(out, quality=90, method=6)
        print(f"  {code}: {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)", flush=True)
        return True

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(draw, todo))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
