"""Cut the captured frames and the narration into the finished video.

    python tools/demo/build.py            # -> tools/demo/out/fruitcats-how-to-play.mp4 (+ .srt)

Each scene plays its own footage at the speed it was captured, then holds its last frame until that
scene's narration finishes, so picture and voice stay together without anything being cut short.
"""

import json
import sys
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
VIDEO = OUT / "fruitcats-how-to-play.mp4"
FPS = 20
SAMPLE_RATE = 48000
TAIL = 0.45          # a breath between scenes


def audio_of(path: Path) -> np.ndarray:
    """One scene's narration as mono float32 at SAMPLE_RATE."""
    with av.open(str(path)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        chunks = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):
            chunks.append(resampled.to_ndarray().reshape(-1))
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)


def timeline(scene: dict, frames_dir: Path, length: float) -> list:
    """The frames this scene shows, one per output frame, held on the last frame to fill `length`."""
    names = scene["frames"]
    if not names:
        return []
    span = max((scene["to"] - scene["from"]) / 1000, 0.1)
    out = []
    for i in range(round(length * FPS)):
        t = i / FPS
        # Play the footage at its captured pace, then freeze on the last frame.
        index = min(int(t / span * len(names)), len(names) - 1) if t < span else len(names) - 1
        out.append(frames_dir / names[index])
    return out


def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def main() -> int:
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    frames_dir = OUT / "frames"
    scenes = {s["id"]: s for s in manifest["scenes"]}
    width, height = manifest["size"]["width"], manifest["size"]["height"]

    container = av.open(str(VIDEO), "w")
    video = container.add_stream("libx264", rate=FPS)
    video.width, video.height, video.pix_fmt = width, height, "yuv420p"
    video.options = {"crf": "20", "preset": "medium"}
    sound = container.add_stream("aac", rate=SAMPLE_RATE)
    sound.layout = "mono"

    pieces, subtitles, clock, shown = [], [], 0.0, 0
    for index, entry in enumerate(script["scenes"], start=1):
        scene = scenes.get(entry["id"])
        if not scene:
            print(f"  {entry['id']}: no footage, skipped")
            continue
        speech = audio_of(OUT / "audio" / f"{entry['id']}.mp3")
        length = max(len(speech) / SAMPLE_RATE + TAIL, (scene["to"] - scene["from"]) / 1000)

        subtitles.append(f"{index}\n{srt_time(clock)} --> {srt_time(clock + len(speech) / SAMPLE_RATE)}\n{entry['say']}\n")
        padded = np.zeros(round(length * SAMPLE_RATE), dtype=np.int16)
        padded[: len(speech)] = speech
        pieces.append(padded)

        for path in timeline(scene, frames_dir, length):
            image = Image.open(path).convert("RGB")
            if image.size != (width, height):
                image = image.resize((width, height), Image.LANCZOS)
            frame = av.VideoFrame.from_ndarray(np.asarray(image), format="rgb24")
            frame.pts = shown
            frame.time_base = Fraction(1, FPS)
            for packet in video.encode(frame):
                container.mux(packet)
            shown += 1
        print(f"  {entry['id']:<9} {length:5.1f}s")
        clock += length

    track = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.int16)
    for start in range(0, len(track), 1024):
        block = track[start: start + 1024].reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(block), format="s16", layout="mono")
        frame.sample_rate = SAMPLE_RATE
        frame.pts = start
        frame.time_base = Fraction(1, SAMPLE_RATE)
        for packet in sound.encode(frame):
            container.mux(packet)

    for packet in video.encode():
        container.mux(packet)
    for packet in sound.encode():
        container.mux(packet)
    container.close()

    (OUT / "fruitcats-how-to-play.srt").write_text("\n".join(subtitles), encoding="utf-8")
    print(f"\n{VIDEO}  {VIDEO.stat().st_size / 1e6:.1f} MB, {clock:.0f}s, {shown} frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
