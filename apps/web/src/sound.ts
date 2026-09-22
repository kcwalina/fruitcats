// Sound effects, synthesized with the Web Audio API: no audio files, nothing to license or download.
// The palette is soft and animal-like (kitten mews, a cat hiss, bubble pops, music-box plucks).
//
// Sounds follow the game log, so every event makes a sound whoever caused it (you or the AI):
// `playLogSounds(game)` is called after each render and plays the entries it hasn't heard yet.
// Browsers (iOS in particular) only allow audio after a user gesture, so the audio context is
// created/resumed on the first tap or click.

import type { GameState, PlayerId } from '@fruitcats/engine';

type SoundName =
  | 'unit' | 'trick' | 'toy' | 'pounce' | 'ability' | 'swipe' | 'hitGood' | 'hitBad' | 'bonk' | 'poof'
  | 'fail' | 'zest' | 'ripen' | 'lucky' | 'growUp' | 'plant' | 'yarn' | 'round' | 'win' | 'lose' | 'tick';

const STORAGE_KEY = 'fruitcats-sound-v2'; // v2: new default (off); earlier choices don't carry over
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readSetting();

function readSetting(): boolean {
  // Off unless the player turned it on: the current synthesized palette is a placeholder until
  // recorded sounds replace it.
  try { return localStorage.getItem(STORAGE_KEY) === 'on'; } catch { return false; }
}

export const soundEnabled = () => enabled;

export function toggleSound(): boolean {
  enabled = !enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* private mode: not remembered */ }
  if (enabled) play('tick');
  return enabled;
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    // A gentle low-pass on everything keeps the palette soft and round rather than bright and 8-bit.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 5200;
    soften.Q.value = 0.5;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(soften).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Unlock audio on the first gesture (required by iOS Safari and Chrome's autoplay policy).
for (const type of ['pointerdown', 'keydown'] as const)
  window.addEventListener(type, () => { if (enabled) audio(); }, { capture: true, passive: true });

// ── Synth building blocks ────────────────────────────────────────────────────────────────────────

interface ToneOptions {
  freq: number;
  to?: number;          // glide to this frequency
  dur: number;          // seconds
  type?: OscillatorType;
  gain?: number;
  at?: number;          // start offset in seconds
  attack?: number;
}

function tone({ freq, to, dur, type = 'sine', gain = 0.3, at = 0, attack = 0.005 }: ToneOptions) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur, gain = 0.25, at = 0, filter = 1200, q = 1, sweepTo }: { dur: number; gain?: number; at?: number; filter?: number; q?: number; sweepTo?: number }) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + at;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(filter, t);
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(env).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ── Cute sound palette ───────────────────────────────────────────────────────────────────────────
//
// Built from soft, "organic" pieces rather than 8-bit waves: a kalimba/music-box pluck, a kitten
// "mew" (a voice shaped by two moving formant filters), a cat hiss, bubble pops, a squeaky toy, paw
// thumps and a springy yarn-ball boing.

/** A soft kalimba / music-box pluck: a sine with a quickly fading bell-like overtone. */
function pluck(freq: number, at = 0, gain = 0.2, dur = 0.5) {
  tone({ freq, dur, type: 'sine', gain, at, attack: 0.004 });
  tone({ freq: freq * 4, dur: dur * 0.25, type: 'sine', gain: gain * 0.25, at, attack: 0.002 });
  tone({ freq: freq * 2, dur: dur * 0.5, type: 'sine', gain: gain * 0.2, at, attack: 0.003 });
}

const plucks = (freqs: number[], step: number, at = 0, gain = 0.18) =>
  freqs.forEach((f, i) => pluck(f, at + i * step, gain));

/**
 * A kitten "mew": a buzzy voice source through two band-pass "formants" that slide from an "ee"
 * shape to an "ow" shape while the pitch rises and falls, with a little vibrato.
 */
function mew({ at = 0, from = 780, peak = 1100, to = 640, dur = 0.34, gain = 0.28 } = {}) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + at;
  const voice = a.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(from, t);
  voice.frequency.linearRampToValueAtTime(peak, t + dur * 0.35);
  voice.frequency.linearRampToValueAtTime(to, t + dur);
  const vibrato = a.createOscillator();
  const depth = a.createGain();
  vibrato.frequency.value = 8;
  depth.gain.value = 22;
  vibrato.connect(depth).connect(voice.frequency);

  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.04);
  env.gain.setValueAtTime(gain, t + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [f1, f2, q, g] of [[1900, 1150, 6, 1], [520, 820, 4, 0.8]] as const) {
    const formant = a.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = q;
    formant.frequency.setValueAtTime(f1, t);
    formant.frequency.linearRampToValueAtTime(f2, t + dur);
    const level = a.createGain();
    level.gain.value = g;
    voice.connect(formant).connect(level).connect(env);
  }
  env.connect(master);
  voice.start(t); vibrato.start(t);
  voice.stop(t + dur + 0.05); vibrato.stop(t + dur + 0.05);
}

/** A little bubble pop: a sine that jumps up in pitch very quickly. */
const bubble = (at = 0, from = 380, to = 1150, gain = 0.26) => tone({ freq: from, to, dur: 0.09, type: 'sine', gain, at, attack: 0.002 });

/** A soft paw thump. */
const thump = (at = 0, gain = 0.3) => { tone({ freq: 170, to: 90, dur: 0.12, type: 'sine', gain, at }); noise({ dur: 0.04, filter: 700, gain: gain * 0.25, at }); };

const SOUNDS: Record<SoundName, (at: number) => void> = {
  unit: (at) => { bubble(at); pluck(1047, at + 0.06, 0.12, 0.3); },                                  // a new friend pops in
  trick: (at) => { noise({ dur: 0.3, filter: 900, sweepTo: 4000, q: 1.2, gain: 0.08, at }); plucks([1319, 1760, 2349], 0.05, at + 0.04, 0.1); }, // sparkle
  toy: (at) => { tone({ freq: 900, to: 1500, dur: 0.08, gain: 0.18, at }); tone({ freq: 1500, to: 1000, dur: 0.1, gain: 0.16, at: at + 0.08 }); }, // squeaky toy
  pounce: (at) => noise({ dur: 0.32, filter: 4200, q: 0.9, gain: 0.22, at }),                          // cat hiss!
  ability: (at) => plucks([784, 988, 1175, 1568], 0.07, at, 0.15),                                    // music-box
  swipe: (at) => noise({ dur: 0.14, filter: 1400, sweepTo: 2600, q: 1.2, gain: 0.1, at }),            // soft paw swish
  hitGood: (at) => { thump(at, 0.32); mew({ at: at + 0.08, from: 820, peak: 1250, to: 900 }); },       // happy mew
  hitBad: (at) => { thump(at, 0.34); mew({ at: at + 0.08, from: 700, peak: 760, to: 430, dur: 0.45 }); }, // sad mew
  bonk: (at) => { thump(at, 0.24); bubble(at + 0.02, 600, 300, 0.1); },                               // soft bonk
  poof: (at) => { noise({ dur: 0.35, filter: 1600, sweepTo: 350, q: 0.7, gain: 0.12, at }); bubble(at + 0.05, 700, 1400, 0.14); }, // poof + pop
  fail: (at) => {                                                                                       // springy "boing" that droops
    const a = audio(); if (!a || !master) return;
    tone({ freq: 520, to: 260, dur: 0.45, type: 'sine', gain: 0.24, at });
    tone({ freq: 530, to: 250, dur: 0.45, type: 'sine', gain: 0.12, at: at + 0.01 });
  },
  zest: (at) => { noise({ dur: 0.12, filter: 5000, q: 0.8, gain: 0.06, at }); plucks([1568, 2093], 0.06, at, 0.14); }, // fizz + ting
  ripen: (at) => plucks([523, 659, 784], 0.09, at, 0.14),                                             // growing
  lucky: (at) => plucks([1568, 1976, 2349, 3136], 0.06, at, 0.1),                                      // twinkle
  growUp: (at) => { plucks([523, 659, 784, 1047], 0.1, at, 0.16); mew({ at: at + 0.42, from: 700, peak: 1150, to: 820, dur: 0.5 }); }, // fanfare + big meow
  plant: (at) => thump(at, 0.26),                                                                      // pat it into the soil
  yarn: (at) => { bubble(at, 300, 700, 0.18); bubble(at + 0.16, 300, 650, 0.13); bubble(at + 0.27, 300, 600, 0.09); }, // bouncing ball
  round: (at) => plucks([1319, 988], 0.12, at, 0.1),                                                  // gentle chime
  win: (at) => { plucks([523, 659, 784, 1047, 1319], 0.09, at, 0.16); mew({ at: at + 0.5, from: 800, peak: 1300, to: 1000, dur: 0.45 }); },
  lose: (at) => { plucks([659, 587, 523, 440], 0.16, at, 0.14); mew({ at: at + 0.66, from: 650, peak: 700, to: 420, dur: 0.55, gain: 0.22 }); },
  tick: (at) => tone({ freq: 1760, dur: 0.035, type: 'sine', gain: 0.07, at }),                       // tiny tap
};

export function play(name: SoundName, at = 0) {
  // Dev-only: record what played, for automated checks in the browser.
  if (import.meta.env.DEV) ((window as unknown as { __sounds?: string[] }).__sounds ??= []).push(name);
  if (!enabled) return;
  try { SOUNDS[name](at); } catch { /* audio is best-effort */ }
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
function soundFor(text: string, player: PlayerId | undefined, human: PlayerId, game: GameState): SoundName | null {
  if (/wins!$/.test(text)) return game.winner === human ? 'win' : 'lose';
  if (/POUNCES/.test(text)) return 'pounce';
  if (/^Lucky!/.test(text)) return 'lucky';
  if (/Grows Up/.test(text)) return 'growUp';
  if (/^Zest!/.test(text)) return 'zest';
  if (/ripens/.test(text)) return 'ripen';
  if (/cancelled|fizzles|attacker is gone|target is gone|no legal target|no room in the Yard/.test(text)) return 'fail';
  if (/^Hit!/.test(text)) return player === human ? 'hitGood' : 'hitBad';
  if (/ attacks /.test(text)) return 'swipe';
  if (/ takes \d+/.test(text)) return 'bonk';
  if (/is defeated/.test(text)) return 'poof';
  if (/uses their ability/.test(text)) return 'ability';
  if (/is attached to/.test(text)) return 'toy';
  if (/ plays? /.test(text) && !/Lucky/.test(text)) return null; // handled with the card type below
  if (/plants? /.test(text) || /now has \d+ Treats/.test(text)) return 'plant';
  if (/takes the Yarn Ball/.test(text)) return 'yarn';
  if (/^— Round/.test(text)) return 'round';
  return null;
}

export function playLogSounds(game: GameState | null, human: PlayerId, cardType: (logText: string) => string | null) {
  if (!game) return;
  if (game !== heardGame) { resetLogSounds(game); return; }
  const fresh = game.log.slice(heard);
  heard = game.log.length;
  if (!enabled || !fresh.length) return;
  let at = 0;
  let count = 0;
  for (const entry of fresh) {
    let name = soundFor(entry.text, entry.player, human, game);
    if (!name && / plays? /.test(entry.text) && !/^Lucky!/.test(entry.text)) {
      const type = cardType(entry.text);
      name = type === 'Trick' ? 'trick' : type === 'Toy' ? null : 'unit'; // Toys sound when they attach
    }
    if (!name) continue;
    play(name, at);
    at += name === 'growUp' || name === 'win' || name === 'lose' ? 0.45 : 0.11;
    if (++count >= 6) break; // a burst of events shouldn't become a cacophony
  }
}
