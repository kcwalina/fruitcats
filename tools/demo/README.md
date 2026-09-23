# The tutorial video

A narrated "how to play" video, recorded from the real game — no screen-recording software, no video
editor, and nothing installed system-wide.

```bash
npm run dev                       # the recorder needs the dev build's window.fruitcats hook
node tools/demo/record.mjs        # 1. play the game in headless Edge, capture frames
python tools/demo/narrate.py      # 2. speak the script with Azure OpenAI text to speech
python tools/demo/build.py        # 3. cut frames + narration into out/fruitcats-how-to-play.mp4
```

Everything lands in `tools/demo/out/` (git-ignored): `frames/`, `audio/`, the `.mp4` and a matching
`.srt` subtitle file.

## How it works

- **`script.json`** is the whole video: one entry per scene with the on-screen `caption` and the
  narrator's `say` line. Edit this first — the other three steps read it.
- **`record.mjs`** starts Edge headless and drives it over the DevTools protocol, so the frames are
  the page alone: no browser chrome, no toolbar, no cursor. It plays a real game through the app's
  own UI and dev hook, draws the caption bar into the page (so captions are part of the picture),
  and captures with `Page.startScreencast`, which streams frames from the compositor.
- **`narrate.py`** sends each `say` line to the `gpt-4o-mini-tts` deployment. The key is read from
  the Azure account at run time with the signed-in CLI and is never printed or stored.
- **`build.py`** gives each scene the longer of its footage and its narration: the footage plays at
  the speed it was captured, then holds its last frame until the narration finishes. It encodes
  H.264 + AAC through PyAV, which bundles its own FFmpeg.

## Notes

- The demo picks the **Kitten** opponent: a stronger opponent thinks on the page's main thread,
  which stalls the screencast.
- Timings in `script.json` are not fixed — each scene stretches to fit its narration, so rewriting a
  line does not require re-recording.
- To re-record just the footage (after a UI change) rerun step 1 and step 3; the narration only needs
  redoing when the script's words change.
