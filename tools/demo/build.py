"""Cut the captured frames and the narration into the finished video.

    python tools/demo/build.py            # -> tools/demo/out/fruitcats-how-to-play.mp4 (+ .srt)

The recording already runs at the pace of the narration (record.mjs holds every beat for as long as
its voice-over), so this just plays the frames back on their own timestamps and lays each beat's
narration in where that beat started. When nothing moves on screen the compositor sends no frames,
so the last one stays up until the next arrives: that is a still picture, not a freeze.
"""

import bisect
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
FPS = 30
SAMPLE_RATE = 48000


def audio_of(path: Path) -> np.ndarray:
    """One beat's narration as mono int16 at SAMPLE_RATE."""
    with av.open(str(path)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        chunks = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):
            chunks.append(resampled.to_ndarray().reshape(-1))
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)


def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    frames, beats = manifest["frames"], manifest["beats"]
    width, height = manifest["size"]["width"], manifest["size"]["height"]
    if not frames or not beats:
        sys.exit("manifest.json has no frames or beats: record first")
    start = beats[0]["start"]
    length = (beats[-1]["end"] - start) / 1000
    times = [f["t"] for f in frames]

    # Narration: each beat's clip starts where the beat did.
    track = np.zeros(round((length + 1) * SAMPLE_RATE), dtype=np.int32)
    subtitles = []
    for index, beat in enumerate(beats, start=1):
        at = (beat["start"] - start) / 1000
        path = OUT / "audio" / f"{beat['id']}.mp3"
        if not beat.get("say"):
            continue
        if not path.exists():
            print(f"  {beat['id']}: no narration (run narrate.py)")
            continue
        speech = audio_of(path)
        offset = round(at * SAMPLE_RATE)
        end = min(len(track), offset + len(speech))
        track[offset:end] += speech[: end - offset]
        spoken = len(speech) / SAMPLE_RATE
        subtitles.append(f"{index}\n{srt_time(at)} --> {srt_time(at + spoken)}\n{beat['say']}\n")
        if spoken > (beat["end"] - beat["start"]) / 1000 + 0.05:
            print(f"  warning: {beat['id']} narration ({spoken:.1f}s) runs into the next beat")
    track = np.clip(track, -32768, 32767).astype(np.int16)

    container = av.open(str(VIDEO), "w")
    video = container.add_stream("libx264", rate=FPS)
    video.width, video.height, video.pix_fmt = width, height, "yuv420p"
    video.options = {"crf": "20", "preset": "medium"}
    sound = container.add_stream("aac", rate=SAMPLE_RATE)
    sound.layout = "mono"

    shown, cached_name, cached = 0, None, None
    total = round(length * FPS)
    for i in range(total):
        t = start + i * 1000 / FPS
        index = max(0, bisect.bisect_right(times, t) - 1)
        name = frames[index]["name"]
        if name != cached_name:
            image = Image.open(OUT / "frames" / name).convert("RGB")
            if image.size != (width, height):
                image = image.resize((width, height), Image.LANCZOS)
            cached_name, cached = name, np.asarray(image)
        frame = av.VideoFrame.from_ndarray(cached, format="rgb24")
        frame.pts = shown
        frame.time_base = Fraction(1, FPS)
        for packet in video.encode(frame):
            container.mux(packet)
        shown += 1
        if i % (FPS * 30) == 0:
            print(f"  {i / FPS / 60:4.1f} min")

    for begin in range(0, len(track), 1024):
        block = track[begin: begin + 1024].reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(block), format="s16", layout="mono")
        frame.sample_rate = SAMPLE_RATE
        frame.pts = begin
        frame.time_base = Fraction(1, SAMPLE_RATE)
        for packet in sound.encode(frame):
            container.mux(packet)

    for packet in video.encode():
        container.mux(packet)
    for packet in sound.encode():
        container.mux(packet)
    container.close()

    (OUT / "fruitcats-how-to-play.srt").write_text("\n".join(subtitles), encoding="utf-8")
    print(f"\n{VIDEO}  {VIDEO.stat().st_size / 1e6:.1f} MB, {length / 60:.1f} min, {shown} frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
