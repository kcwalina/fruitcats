// How bot games go in the shop game: rounds, and how often each player buys, rolls, sells and levels.
// npx tsx packages/engine/scripts/shop-shape.ts [games]

import { DECKS, apply, chooseAction, createGame, nextSeat, registerSet, type GameState } from '../src/index';
import { loadContent } from '../../../content';

loadContent(registerSet);

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const games = Number(process.argv[2] ?? 40);
const keys = Object.keys(DECKS).filter((k) => ['domowiki', 'pari', 'aluxes', 'jiaoren', 'hui-hai'].includes(k));
const count: Record<string, number> = {};
let rounds = 0, ms = 0, draws = 0;
const levels: number[] = [];
const stars: number[] = [];
for (let g = 0; g < games; g++) {
  const a = keys[g % keys.length], b = keys[(g * 3 + 1) % keys.length];
  const s: GameState = createGame({ decks: [a, b], seed: g + 1 });
  const rnd = mulberry(g + 1);
  const t0 = Date.now();
  for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
    const action = chooseAction(s, { random: rnd, seat: p });
    count[action.t] = (count[action.t] ?? 0) + 1;
    apply(s, action, p);
  }
  ms += Date.now() - t0;
  rounds += s.round;
  if (s.winner === 'draw') draws++;
  for (const pl of s.players) {
    levels.push(pl.hero.level);
    stars.push(pl.yard.reduce((n, u) => n + ((u.stars ?? 1) > 1 ? 1 : 0), 0));
  }
}
const per = (k: string) => ((count[k] ?? 0) / games / 2).toFixed(1);
console.log(`${games} games: ${(rounds / games).toFixed(1)} rounds on average, ${draws} draws, ${(ms / games).toFixed(0)} ms a game`);
console.log(`per player per game: buys ${per('play')}, ambushes ${per('ambush')}, rolls ${per('roll')}, sells ${per('sell')}, levels ${per('levelUp')}, moves ${per('move')}, abilities ${per('ability')}`);
console.log(`Level at the end: ${(levels.reduce((x, y) => x + y, 0) / levels.length).toFixed(1)}; merged units on the board at the end: ${(stars.reduce((x, y) => x + y, 0) / stars.length).toFixed(1)}`);
