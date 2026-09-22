// Bot-vs-bot playtesting: npm run sim -- [games=200] [skillA=1] [skillB=1]
// Prints deck win rates, starting-player advantage and game length.

import { apply, chooseAction, createGame, type GameState, type PlayerId } from '../src/index';

const games = Number(process.argv[2] ?? 200);
const skills = [Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 1)];
const decks: [string, string] = ['zest-rush', 'orchard-guard'];

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wins = [0, 0];
let draws = 0, starterWins = 0, rounds = 0, actions = 0, grown = [0, 0], livesLeft = 0;
const started = Date.now();

for (let g = 0; g < games; g++) {
  // Alternate seats so each deck plays both sides of the Yarn Ball equally.
  const seatDecks: [string, string] = g % 2 ? [decks[1], decks[0]] : decks;
  const s: GameState = createGame({ decks: seatDecks, seed: g + 1, names: ['A', 'B'] });
  const rnd = mulberry(1000 + g);
  while (s.winner === null) {
    const p = s.prompt!.player;
    const deckIndex = seatDecks[p] === decks[0] ? 0 : 1;
    apply(s, chooseAction(s, { skill: skills[deckIndex], random: rnd }));
  }
  rounds += s.round;
  actions += s.actions;
  if (s.winner === 'draw') { draws++; continue; }
  const winnerDeck = seatDecks[s.winner] === decks[0] ? 0 : 1;
  wins[winnerDeck]++;
  if (s.winner === s.startingYarn) starterWins++;
  livesLeft += s.players[s.winner].lives.length;
  for (const p of [0, 1] as PlayerId[]) if (s.players[p].hero.grown) grown[seatDecks[p] === decks[0] ? 0 : 1]++;
}

const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`;
console.log(`${games} games in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  ${decks[0]}: ${pct(wins[0])}   ${decks[1]}: ${pct(wins[1])}   draws: ${draws}`);
console.log(`  starting Yarn holder wins: ${pct(starterWins)}`);
console.log(`  avg rounds: ${(rounds / games).toFixed(1)}   avg actions: ${(actions / games).toFixed(0)}   winner's Lives left: ${(livesLeft / Math.max(1, games - draws)).toFixed(1)}`);
console.log(`  Grew Up: ${decks[0]} ${pct(grown[0])}, ${decks[1]} ${pct(grown[1])}`);
