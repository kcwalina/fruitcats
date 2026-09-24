// Sound effects: a few short recorded sounds (CC0, see art/sounds/CREDITS.md), kept deliberately
// sparse — only the moments that matter make a sound:
//
//   card played · Hero Cat ability · attack hits a Hero Cat (you hit / you're hit) · attack fails
//
// Sounds follow the game log, so every event makes a sound whoever caused it (you or the AI):
// `playLogSounds(game)` is called after each render and plays the entries it hasn't heard yet.
// With animations on, fx.ts plays each sound at the moment its animation lands instead.
// Browsers (iOS in particular) only allow audio after a user gesture, so the audio context is
// created/resumed on the first tap or click.

import type { GameState, PlayerId } from '@fruitcats/engine';

type SoundName = 'card' | 'ability' | 'hitGood' | 'hitBad' | 'fail';

/** Sound files in art/sounds (served from the site root). */
const FILES: Record<SoundName, string> = {
  card: 'sounds/card-played.mp3',
  ability: 'sounds/ability.mp3',
  fail: 'sounds/attack-fail.mp3',
  hitGood: 'sounds/hit-good.mp3', // you hit their Hero Cat: paw punch + little meow
  hitBad: 'sounds/hit-bad.mp3',   // they hit yours: big soft thump + meow
};

const STORAGE_KEY = 'fruitcats-sound-v3'; // v3: recorded sounds, on by default
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let enabled = readSetting();

function readSetting(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

export const soundEnabled = () => enabled;

export function toggleSound(): boolean {
  enabled = !enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* private mode: not remembered */ }
  if (enabled) play('card');
  return enabled;
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    void loadAll(ctx);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

async function loadAll(a: AudioContext) {
  await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
    try {
      const res = await fetch(new URL(file, document.baseURI));
      const data = await res.arrayBuffer();
      // The callback form of decodeAudioData works on older Safari too.
      const buffer = await new Promise<AudioBuffer>((ok, fail) => a.decodeAudioData(data, ok, fail));
      buffers.set(name as SoundName, buffer);
    } catch { /* sound is best-effort */ }
  }));
}

// Unlock audio on the first gesture (required by iOS Safari and Chrome's autoplay policy).
for (const type of ['pointerdown', 'keydown'] as const)
  window.addEventListener(type, () => { if (enabled) audio(); }, { capture: true, passive: true });

export function play(name: SoundName, at = 0) {
  // Dev-only: record what played, for automated checks in the browser.
  if (import.meta.env.DEV) ((window as unknown as { __sounds?: string[] }).__sounds ??= []).push(name);
  if (!enabled) return;
  const a = audio();
  const buffer = buffers.get(name);
  if (!a || !master || !buffer) return;
  try {
    const src = a.createBufferSource();
    src.buffer = buffer;
    src.connect(master);
    src.start(a.currentTime + at);
  } catch { /* audio is best-effort */ }
}

// ── Game log → sounds ────────────────────────────────────────────────────────────────────────────

let heard = 0;
let heardGame: GameState | null = null;

/** Skip everything already in the log (e.g. setup lines when a game starts). */
export function resetLogSounds(game: GameState | null) {
  heardGame = game;
  heard = game?.log.length ?? 0;
}

/** Which sound a log line makes, if any. `human` is the player you control. */
function soundFor(text: string, player: PlayerId | undefined, human: PlayerId): SoundName | null {
  if (/attack is cancelled|attack fizzles/.test(text)) return 'fail';
  if (/^Hit!/.test(text)) return player === human ? 'hitGood' : 'hitBad';
  if (/uses their ability/.test(text)) return 'ability';
  if (/ plays? | POUNCES with /.test(text)) return 'card';
  return null;
}

export function playLogSounds(game: GameState | null, human: PlayerId) {
  if (!game) return;
  if (game !== heardGame) { resetLogSounds(game); return; }
  const fresh = game.log.slice(heard);
  heard = game.log.length;
  if (!enabled || !fresh.length) return;
  // Each kind of sound plays at most once per update, a beat apart, so a burst stays calm.
  const names = new Set<SoundName>();
  for (const entry of fresh) {
    const name = soundFor(entry.text, entry.player, human);
    if (name) names.add(name);
  }
  let at = 0;
  for (const name of names) { play(name, at); at += 0.18; }
}
