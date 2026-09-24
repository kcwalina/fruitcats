"""Draw card illustrations with an Azure OpenAI image model.

    python tools/generate_art.py                      # draw every card that has no art yet
    python tools/generate_art.py --only SB1-C04       # one card (hero ids draw both sides)
    python tools/generate_art.py --force              # redraw even if the file exists
    python tools/generate_art.py --reference art/sb1/SB1-C04.webp   # anchor the style to an existing image

Art is text-free; card text is added by tools/compose_cards.py so it is always exact.
Auth is the signed-in Azure CLI (`az login`), the same as mochi's image tools -- no keys.
Every run costs money, so existing files are skipped unless --force is given.
"""

import argparse
import base64
import io
import json
import mimetypes
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODELS = {
    # Reliably cartoon; what mochi's illustrated avatars use.
    "gpt-image-1-mini": ("https://imageskc.cognitiveservices.azure.com", "gpt-image-1-mini"),
    # Finer linework but drifts towards realism.
    "gpt-image-2": ("https://mochi-openai.openai.azure.com", "gpt-image-2"),
}
API_VERSION = "2025-04-01-preview"


def set_file(code: str) -> Path:
    """A set's data by its code ('sb1', 'hw1'): content/<year>/<month>/<set>/set.json."""
    for path in sorted((ROOT / "content").glob("*/*/*/set.json")):
        if json.loads(path.read_text(encoding="utf-8")).get("set", "").lower() == code.lower():
            return path
    sys.exit(f"No set '{code}' in content/*/*/*/set.json")


def access_token() -> str:
    az = shutil.which("az") or shutil.which("az.cmd")
    if not az:
        sys.exit("Azure CLI not found. Install it and run 'az login'.")
    result = subprocess.run(
        [az, "account", "get-access-token", "--resource", "https://cognitiveservices.azure.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        sys.exit(f"az returned {result.returncode}: {result.stderr.strip()}  Run 'az login'.")
    return result.stdout.strip()


def jobs(cards: list, only: set | None):
    """(output key, card) for every illustration: one per card, two per Hero Cat."""
    for card in cards:
        if only and card["id"] not in only:
            continue
        if card["type"] == "Hero Cat":
            yield f'{card["id"]}-kitten', card
            yield f'{card["id"]}-bigcat', card
        else:
            yield card["id"], card


def post(url: str, token: str, body: bytes, content_type: str) -> dict:
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": content_type})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{error.code}: {error.read().decode(errors='replace')[:400]}") from None


def multipart(fields: dict, file_field: str, file_path: Path) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                  f'filename="{file_path.name}"\r\n'
                  f'Content-Type: {mimetypes.guess_type(file_path.name)[0] or "image/png"}\r\n\r\n').encode())
    parts.append(file_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default="sb1")
    parser.add_argument("--only", nargs="*", help="card ids to draw")
    parser.add_argument("--force", action="store_true", help="redraw existing art")
    parser.add_argument("--model", default="gpt-image-1-mini", choices=MODELS)
    parser.add_argument("--quality", default="medium", choices=["low", "medium", "high"])
    parser.add_argument("--reference", type=Path, help="style reference image (uses /images/edits)")
    parser.add_argument("--jobs", type=int, default=4, help="parallel requests")
    parser.add_argument("--ui", action="store_true", help="draw the interface art (backgrounds, card back) into art/ui/")
    args = parser.parse_args()

    data = json.loads(set_file(args.set).read_text(encoding="utf-8"))
    cards = data["cards"] + data.get("tokens", [])    # tokens (units that cards summon) need art too
    # A set may bring its own art direction (art/prompts.<set>.json); the Starter Box uses art/prompts.json.
    set_prompts = ROOT / "art" / f"prompts.{args.set}.json"
    prompts = json.loads((set_prompts if set_prompts.exists() else ROOT / "art" / "prompts.json").read_text(encoding="utf-8"))
    if args.ui:
        return draw_ui(prompts["ui"], args)
    out_dir = ROOT / "art" / args.set
    out_dir.mkdir(parents=True, exist_ok=True)

    endpoint, deployment = MODELS[args.model]
    todo = [(key, card) for key, card in jobs(cards, set(args.only) if args.only else None)
            if args.force or not (out_dir / f"{key}.webp").exists()]
    if not todo:
        print("Nothing to draw (all art exists; use --force to redraw).")
        return 0

    print(f"{deployment} @ {endpoint}, quality={args.quality}, {len(todo)} image(s), {args.jobs} at a time")
    token = access_token()

    def draw(key: str, card: dict) -> bool:
        subject = prompts["subjects"].get(key)
        if not subject:
            print(f"  {key}: no prompt in art/prompts.json, skipped", flush=True)
            return False
        # Hero Cats are drawn as plush mascots (their own style); the rest of the set is painted.
        hero = card["type"] == "Hero Cat"
        style = prompts["heroStyle"] if hero else prompts["style"]
        background = prompts.get("backgrounds", {}).get(key) or (prompts["heroFamilies"] if hero else prompts["families"])[card["family"]]
        prompt = f'{style}\n\nSubject: {subject}\n\n{background}'

        try:
            if args.reference:
                prompt = ("Draw a NEW illustration in exactly the same art style as this reference image "
                          "(same linework, shading, colour treatment and level of cuteness), "
                          "but with a completely different subject and scene.\n\n" + prompt)
                body, content_type = multipart(
                    {"prompt": prompt, "n": "1", "size": "1536x1024", "quality": args.quality},
                    "image", args.reference)
                url = f"{endpoint}/openai/deployments/{deployment}/images/edits?api-version={API_VERSION}"
            else:
                body = json.dumps({"prompt": prompt, "n": 1, "size": "1536x1024",
                                   "quality": args.quality}).encode()
                content_type = "application/json"
                url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version={API_VERSION}"
            result = post(url, token, body, content_type)
            data = result["data"][0]["b64_json"]
        except (RuntimeError, KeyError, IndexError, OSError) as error:
            print(f"  {key}: FAILED {error}", flush=True)
            return False

        # WebP at q90 is ~12x smaller than the PNG the model returns, with no visible loss.
        path = out_dir / f"{key}.webp"
        Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB").save(path, quality=90, method=6)
        print(f"  {key}: {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)", flush=True)
        return True

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda job: draw(*job), todo))
    failed = results.count(False)

    print(f"\ndrew {len(todo) - failed} of {len(todo)}")
    return 1 if failed else 0


def draw_ui(items: dict, args) -> int:
    """Interface art: each entry has its own full prompt and size, and is saved to art/ui/<key>.webp."""
    out_dir = ROOT / "art" / "ui"
    out_dir.mkdir(parents=True, exist_ok=True)
    endpoint, deployment = MODELS[args.model]
    todo = [(k, v) for k, v in items.items() if (not args.only or k in args.only)
            and (args.force or not (out_dir / f"{k}.webp").exists())]
    if not todo:
        print("Nothing to draw (all UI art exists; use --force to redraw).")
        return 0
    token = access_token()

    def draw(key: str, item: dict) -> bool:
        request = {"prompt": item["prompt"], "n": 1, "size": item["size"], "quality": "high"}
        if item.get("transparent"):  # icons: keep the alpha channel
            request.update(background="transparent", output_format="png")
        body = json.dumps(request).encode()
        url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version={API_VERSION}"
        try:
            data = post(url, token, body, "application/json")["data"][0]["b64_json"]
        except (RuntimeError, KeyError, IndexError, OSError) as error:
            print(f"  {key}: FAILED {error}", flush=True)
            return False
        path = out_dir / f"{key}.webp"
        image = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA" if item.get("transparent") else "RGB")
        if item.get("resize"):
            image = image.resize((item["resize"], item["resize"] * image.height // image.width), Image.LANCZOS)
        image.save(path, quality=88, method=6)
        print(f"  {key}: {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)", flush=True)
        return True

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda job: draw(*job), todo))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
