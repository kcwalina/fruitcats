// Bot-vs-bot playtesting: npm run sim -- [games per pairing=100] [skill=1]
// Plays every pair of decks against each other (both seats) and prints the matchup matrix,
// starting-player advantage, game length and Grow Up rates.

import { DECKS, apply, chooseAction, createGame, type PlayerId } from '../src/index';

const games = Number(process.argv[2] ?? 100);
const skill = Number(process.argv[3] ?? 1);
const decks = Object.keys(DECKS);

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wins: Record<string, Record<string, number>> = {};
const played: Record<string, number> = {};
const grown: Record<string, number> = {};
let total = 0, starterWins = 0, rounds = 0, actions = 0, draws = 0;
const started = Date.now();

for (let i = 0; i < decks.length; i++) {
  for (let j = i + 1; j < decks.length; j++) {
    for (let g = 0; g < games; g++) {
      // Alternate seats so each deck plays both sides of the Yarn Ball.
      const seat: [string, string] = g % 2 ? [decks[j], decks[i]] : [decks[i], decks[j]];
      const s = createGame({ decks: seat, seed: 7919 * (i * 31 + j) + g, names: ['A', 'B'] });
      const rnd = mulberry(1000 + g);
      while (s.winner === null) apply(s, chooseAction(s, { skill, random: rnd }));
      total++;
      rounds += s.round;
      actions += s.actions;
      for (const p of [0, 1] as PlayerId[]) {
        played[seat[p]] = (played[seat[p]] ?? 0) + 1;
        if (s.players[p].hero.grown) grown[seat[p]] = (grown[seat[p]] ?? 0) + 1;
      }
      if (s.winner === 'draw') { draws++; continue; }
      const winner = seat[s.winner], loser = seat[1 - s.winner];
      ((wins[winner] ??= {})[loser] ??= 0);
      wins[winner][loser]++;
      if (s.winner === s.startingYarn) starterWins++;
    }
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`.padStart(5);
const width = Math.max(...decks.map((d) => d.length)) + 2;
console.log(`${total} games in ${((Date.now() - started) / 1000).toFixed(1)}s (skill ${skill})\n`);
console.log('Win rate of row deck vs column deck:');
console.log(''.padEnd(width) + decks.map((d) => d.slice(0, 12).padStart(14)).join('') + '   overall');
for (const a of decks) {
  let w = 0, n = 0;
  const cells = decks.map((b) => {
    if (a === b) return '—'.padStart(14);
    const ab = wins[a]?.[b] ?? 0, ba = wins[b]?.[a] ?? 0;
    w += ab; n += ab + ba;
    return pct(ab, ab + ba).padStart(14);
  });
  console.log(a.padEnd(width) + cells.join('') + `   ${pct(w, n)}`);
}
console.log(`\nstarting Yarn holder wins: ${pct(starterWins, total - draws).trim()}   draws: ${draws}`);
console.log(`avg rounds: ${(rounds / total).toFixed(1)}   avg actions: ${(actions / total).toFixed(0)}`);
console.log('Grew Up: ' + decks.map((d) => `${d} ${pct(grown[d] ?? 0, played[d]).trim()}`).join(', '));
