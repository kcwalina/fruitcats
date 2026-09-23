# The tutorial video

A narrated "how to play" video, recorded from the real game: no screen-recording software, no video
editor, and nothing installed system-wide. It plays one slow game and shows every click. A drawn
cursor glides to each button or card, a label says what to click ("👆 Click “Pass”"), a ripple marks
the click, and a spotlight dims everything except what the narration is talking about.

```bash
npm run dev                            # the recorder needs the dev build's window.fruitcats hook
npx tsx tools/demo/find-seed.mjs       # 0. only after editing the script's moves: find a game that fits
python tools/demo/narrate.py           # 1. speak each beat with Azure OpenAI text to speech
npm run demo:record                    # 2. play the game in headless Edge, capture frames
python tools/demo/build.py             # 3. frames + narration -> out/fruitcats-how-to-play.mp4
```

Everything lands in `tools/demo/out/` (git-ignored): `frames/`, `audio/`, `durations.json`,
`manifest.json`, the `.mp4` and a matching `.srt` subtitle file.

## How it works

- **`script.json`** is the whole video: scenes made of **beats**. Each beat has an on-screen
  `caption`, the narrator's `say` line, and `do`, the steps performed while it is spoken:
  - `spot` (spotlight + label), `move`, `click`, `pressDown` / `release` (hold a card to enlarge it),
    `title`, `at` (wait until that fraction of the narration), `wait`;
  - `act`: one of the human player's moves (`mulligan`, `setupPlant`, `plant`, `play`, `attack`,
    `pass`, ...), with filters such as `"unit": true`, `"cost": 1`, `"zoomies": true` or
    `"defeats": true`;
  - `foe`: wait for the opponent to finish;
  - `expect`: checks like `foeLives8` (see `CHECKS` in `director.mjs`), so the narration never
    describes something that didn't happen.

  `deck`, `foe` and `seed` fix the game: the dev page reads `?seed=N&foe=<deck>` and then deals the
  same cards, and its AI makes the same moves, every time.
- **`director.mjs`** walks the beats and decides each human move, and which clicks make it. The same
  code runs in two modes: in Node alone (`find-seed.mjs`) and against the browser (`record.mjs`).
- **`find-seed.mjs`** plays the script in Node against the seeded AI for thousands of seeds and lists
  the ones where every move is possible and every `expect` holds. `find-seed.mjs <seed>` replays one
  and prints every move. Run it again whenever you change an `act` or an `expect`.
- **`narrate.py`** speaks each beat's `say` with the `gpt-4o-mini-tts` deployment, and writes
  `durations.json`. Beats whose words haven't changed are not spoken again. The key is read from the
  Azure account at run time with the signed-in CLI and is never printed or stored.
- **`record.mjs`** starts Edge headless (set `EDGE_PATH` if it isn't in the usual place) and drives it
  over the DevTools protocol. Every human move is a real mouse click (`Input.dispatchMouseEvent`),
  and after each one it checks the game made exactly the planned move. Each beat stays on screen for
  as long as its narration. Frames stream from `Page.startScreencast` with the compositor's
  timestamps.
- **`build.py`** plays the frames back on their timestamps and drops each beat's narration in where
  that beat started. It encodes H.264 + AAC through PyAV, which bundles its own FFmpeg.

## Notes

- The demo plays the **Kitten** opponent: a stronger opponent thinks on the page's main thread,
  which stalls the screencast.
- Changing only the words: rerun `narrate.py`, then record and build. The narration comes first,
  because the recording is paced by it.
- Changing the moves or checks: rerun `find-seed.mjs`, put a fitting seed in `script.json`, and
  rewrite any narration that names specific cards (Passionfruit Parrot, the hamster, the mouse).
