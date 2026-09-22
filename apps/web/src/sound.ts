// Sound effects, synthesized with the Web Audio API: no audio files, nothing to license or download.
//
// Sounds follow the game log, so every event makes a sound whoever caused it (you or the AI):
// `playLogSounds(game)` is called after each render and plays the entries it hasn't heard yet.
// Browsers (iOS in particular) only allow audio after a user gesture, so the audio context is
// created/resumed on the first tap or click.

import type { GameState, PlayerId } from '@fruitcats/engine';

type SoundName =
  | 'unit' | 'trick' | 'toy' | 'pounce' | 'ability' | 'swipe' | 'hitGood' | 'hitBad' | 'bonk' | 'poof'
  | 'fail' | 'zest' | 'ripen' | 'lucky' | 'growUp' | 'plant' | 'yarn' | 'round' | 'win' | 'lose' | 'tick';

const STORAGE_KEY = 'fruitcats-sound';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readSetting();

function readSetting(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
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
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
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

const notes = (freqs: number[], step: number, opts: Partial<ToneOptions> = {}, at = 0) =>
  freqs.forEach((freq, i) => tone({ freq, dur: step * 1.6, type: 'triangle', gain: 0.22, ...opts, at: at + i * step }));

// ── The sounds ───────────────────────────────────────────────────────────────────────────────────

const SOUNDS: Record<SoundName, (at: number) => void> = {
  unit: (at) => { tone({ freq: 520, to: 880, dur: 0.12, type: 'triangle', gain: 0.28, at }); tone({ freq: 1320, dur: 0.08, gain: 0.08, at: at + 0.05 }); },
  trick: (at) => { noise({ dur: 0.28, filter: 600, sweepTo: 3200, q: 2, gain: 0.22, at }); tone({ freq: 700, to: 1400, dur: 0.2, gain: 0.08, at }); },
  toy: (at) => { tone({ freq: 1560, dur: 0.12, type: 'square', gain: 0.06, at }); tone({ freq: 2340, dur: 0.18, gain: 0.08, at: at + 0.04 }); },
  pounce: (at) => { noise({ dur: 0.16, filter: 2500, sweepTo: 800, q: 3, gain: 0.3, at }); tone({ freq: 900, to: 420, dur: 0.14, type: 'sawtooth', gain: 0.07, at }); },
  ability: (at) => notes([880, 1175, 1568, 2093], 0.055, { type: 'sine', gain: 0.14 }, at),
  swipe: (at) => noise({ dur: 0.18, filter: 900, sweepTo: 2600, q: 1.5, gain: 0.2, at }),
  hitGood: (at) => { noise({ dur: 0.12, filter: 300, q: 0.7, gain: 0.45, at }); tone({ freq: 140, to: 60, dur: 0.18, gain: 0.35, at }); notes([784, 1047, 1319], 0.07, { gain: 0.18 }, at + 0.08); },
  hitBad: (at) => { noise({ dur: 0.14, filter: 250, q: 0.7, gain: 0.45, at }); tone({ freq: 180, to: 70, dur: 0.3, type: 'triangle', gain: 0.35, at }); tone({ freq: 330, to: 220, dur: 0.25, type: 'sine', gain: 0.12, at: at + 0.1 }); },
  bonk: (at) => { tone({ freq: 260, to: 120, dur: 0.12, type: 'square', gain: 0.1, at }); noise({ dur: 0.07, filter: 500, gain: 0.25, at }); },
  poof: (at) => { noise({ dur: 0.35, filter: 1800, sweepTo: 300, q: 0.8, gain: 0.25, at }); tone({ freq: 600, to: 180, dur: 0.3, gain: 0.08, at }); },
  fail: (at) => { tone({ freq: 440, to: 330, dur: 0.16, type: 'triangle', gain: 0.2, at }); tone({ freq: 330, to: 150, dur: 0.32, type: 'triangle', gain: 0.2, at: at + 0.16 }); },
  zest: (at) => { tone({ freq: 1200, to: 2400, dur: 0.12, type: 'square', gain: 0.06, at }); notes([1568, 2093], 0.05, { gain: 0.12 }, at + 0.06); },
  ripen: (at) => notes([392, 523, 659], 0.07, { type: 'sine', gain: 0.16 }, at),
  lucky: (at) => notes([1319, 1568, 1976, 2637, 3136], 0.045, { type: 'sine', gain: 0.12 }, at),
  growUp: (at) => { notes([523, 659, 784, 1047], 0.1, { gain: 0.22 }, at); tone({ freq: 1047, dur: 0.5, type: 'triangle', gain: 0.18, at: at + 0.4 }); tone({ freq: 1319, dur: 0.5, gain: 0.1, at: at + 0.4 }); },
  plant: (at) => { tone({ freq: 220, to: 140, dur: 0.1, type: 'sine', gain: 0.3, at }); noise({ dur: 0.05, filter: 1200, gain: 0.08, at }); },
  yarn: (at) => { tone({ freq: 400, to: 700, dur: 0.1, gain: 0.18, at }); tone({ freq: 500, to: 850, dur: 0.1, gain: 0.14, at: at + 0.12 }); },
  round: (at) => { tone({ freq: 988, dur: 0.6, gain: 0.12, at }); tone({ freq: 1976, dur: 0.4, gain: 0.04, at }); },
  win: (at) => notes([523, 659, 784, 1047, 1319, 1568], 0.09, { gain: 0.22 }, at),
  lose: (at) => notes([523, 466, 415, 349], 0.16, { type: 'triangle', gain: 0.2 }, at),
  tick: (at) => tone({ freq: 1400, dur: 0.04, type: 'square', gain: 0.04, at }),
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
