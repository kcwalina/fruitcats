// How each starter's board and purse grow in bot games: board Power + Health, units, Offerings and Level as a few
// rounds end, and what it buys. npx tsx packages/engine/scripts/deck-growth.ts [games per pairing]
// Other rules, to try them: RULES='{"income":[4,5,6]}'.

import { CARDS, apply, chooseAction, createGame, nextSeat, registerSet, unitHealth, unitPower, type GameState, type PlayerId } from '../src/index';
import { loadContent } from '../../../content';

loadContent(registerSet);
const RULES = JSON.parse(process.env.RULES ?? '{}');

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keys = ['domowiki', 'pari', 'aluxes', 'jiaoren', 'hui-hai'];
const games = Number(process.argv[2] ?? 10);
const at = [2, 4, 6, 8];
type Row = { n: number; board: number; units: number; offerings: number; level: number };
const rows: Record<string, Record<number, Row>> = {};
const bought: Record<string, Record<string, number>> = {};
const wins: Record<string, number> = {}, played: Record<string, number> = {};
const board = (s: GameState, p: PlayerId) => s.players[p].yard.reduce((n, u) => n + unitPower(u, s) + unitHealth(u, s), 0);

let seed = 1;
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) for (let g = 0; g < games; g++, seed++) {
  const decks: [string, string] = g % 2 ? [keys[j], keys[i]] : [keys[i], keys[j]];
  const s = createGame({ decks, seed, rules: RULES });
  const rnd = mulberry(seed);
  for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
    const a = chooseAction(s, { random: rnd, seat: p });
    const counts = (bought[decks[p]] ??= {});
    if (a.t === 'play' || a.t === 'ambush') {
      const id = s.players[p].shop.find((c) => c.uid === a.uid)!.id;
      const kind = CARDS[id].type === 'Trick' ? 'Charm' : CARDS[id].type === 'Toy' ? 'Talisman' : 'unit';
      counts[kind] = (counts[kind] ?? 0) + 1;
    } else counts[a.t] = (counts[a.t] ?? 0) + 1;
    const round = s.round;
    apply(s, a, p);
    // The round just ended (its Clash played, the board stood up again): how each side stands.
    if (s.round !== round && at.includes(round)) {
      for (const q of [0, 1] as PlayerId[]) {
        const row = ((rows[decks[q]] ??= {})[round] ??= { n: 0, board: 0, units: 0, offerings: 0, level: 0 });
        row.n++; row.board += board(s, q); row.units += s.players[q].yard.length; row.offerings += s.players[q].offerings; row.level += s.players[q].hero.level;
      }
    }
  }
  for (const q of [0, 1] as PlayerId[]) { played[decks[q]] = (played[decks[q]] ?? 0) + 1; if (s.winner === q) wins[decks[q]] = (wins[decks[q]] ?? 0) + 1; }
}

for (const k of keys) {
  const b = bought[k] ?? {};
  const per = (x: string) => ((b[x] ?? 0) / played[k]).toFixed(1);
  console.log(`${k.padEnd(9)} wins ${(100 * (wins[k] ?? 0) / played[k]).toFixed(0)}% · per game: units ${per('unit')}, Charms ${per('Charm')}, Talismans ${per('Talisman')}, rolls ${per('roll')}, sells ${per('sell')}, levels ${per('levelUp')}, abilities ${per('ability')}`);
  console.log('          ' + at.map((r) => { const x = rows[k]?.[r]; return x ? `R${r}: P+H ${(x.board / x.n).toFixed(0)}, units ${(x.units / x.n).toFixed(1)}, ${(x.offerings / x.n).toFixed(0)} Off, L${(x.level / x.n).toFixed(1)}` : `R${r}: -`; }).join(' | '));
}
