"""Speak the demo script with Azure OpenAI text to speech.

    python tools/demo/narrate.py

One MP3 per beat in tools/demo/out/audio/, and out/durations.json with how long each one runs: the
recorder holds every beat on screen for as long as its narration. Beats whose words haven't changed
are not spoken again. Auth is the signed-in Azure CLI (`az login`): the key is read from the Azure
account at run time and never printed or written anywhere.
"""

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import av

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "audio"
DURATIONS = HERE / "out" / "durations.json"
ACCOUNT, GROUP = "mochi-openai-eastus2", "mochi-ai"
ENDPOINT = "https://eastus2.api.cognitive.microsoft.com"
DEPLOYMENT = "gpt-4o-mini-tts"
API_VERSION = "2025-03-01-preview"
# How the narrator should sound; gpt-4o-mini-tts takes free-text direction.
STYLE = ("Warm, friendly and patient, like someone teaching a board game to a friend who has never played one. "
         "Speak slowly and clearly, with a short pause after each sentence. Calm and upbeat, never salesy or rushed.")


def azure_key() -> str:
    az = shutil.which("az") or shutil.which("az.cmd")
    if not az:
        sys.exit("Azure CLI not found. Install it and run 'az login'.")
    result = subprocess.run([az, "cognitiveservices", "account", "keys", "list", "-n", ACCOUNT, "-g", GROUP,
                             "--query", "key1", "-o", "tsv"], capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        sys.exit(f"az returned {result.returncode}: {result.stderr.strip()[:200]}  Run 'az login'.")
    return result.stdout.strip()


def speak(key: str, text: str, voice: str, path: Path) -> None:
    body = json.dumps({"model": DEPLOYMENT, "input": text, "voice": voice,
                       "instructions": STYLE, "response_format": "mp3"}).encode()
    url = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT}/audio/speech?api-version={API_VERSION}"
    request = urllib.request.Request(url, data=body, headers={"api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            path.write_bytes(response.read())
    except urllib.error.HTTPError as error:
        sys.exit(f"text to speech failed: {error.code} {error.read()[:300].decode(errors='replace')}")


def seconds(path: Path) -> float:
    with av.open(str(path)) as container:
        return float(container.duration) / 1_000_000


def main() -> int:
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    voice = script.get("voice", "alloy")
    known = json.loads(DURATIONS.read_text(encoding="utf-8")) if DURATIONS.exists() else {}
    beats = [beat for scene in script["scenes"] for beat in scene["beats"] if beat.get("say")]
    key = None
    durations, total = {}, 0.0
    for beat in beats:
        path = OUT / f"{beat['id']}.mp3"
        old = known.get(beat["id"], {})
        fresh = path.exists() and old.get("text") == beat["say"] and old.get("voice") == voice and old.get("style") == STYLE
        if not fresh:
            key = key or azure_key()
            speak(key, beat["say"], voice, path)
        length = seconds(path)
        durations[beat["id"]] = {"seconds": length, "text": beat["say"], "voice": voice, "style": STYLE}
        total += length
        print(f"  {beat['id']:<16} {length:5.1f}s  {'(kept)' if fresh else ''}")
    DURATIONS.write_text(json.dumps(durations, indent=2), encoding="utf-8")
    print(f"\nnarration: {total:.0f}s ({total / 60:.1f} min) over {len(beats)} beats")
    return 0


if __name__ == "__main__":
    sys.exit(main())
