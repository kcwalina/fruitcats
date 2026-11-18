// One bot game, its story printed from a round on: to see how a pairing actually plays.
// npx tsx packages/engine/scripts/one-game.ts <deck> <deck> [seed] [from round]
import { apply, chooseAction, createGame, nextSeat, registerSet } from '../src/index';
import { loadContent } from '../../../content';

loadContent(registerSet);
const [a = 'hui-hai', b = 'domowiki', seedArg = '1', fromArg = '4'] = process.argv.slice(2);
const seed = Number(seedArg), from = Number(fromArg);
let r = seed;
const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
const s = createGame({ decks: [a, b], seed, names: [a, b] });
for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, chooseAction(s, { random: rnd, seat: p }), p);
for (const e of s.log) if (e.round >= from && e.round <= from + 1) console.log(`R${e.round} ${e.text}`);
console.log(`winner: ${s.winner === 'draw' ? 'draw' : s.players[s.winner as 0 | 1].name}, round ${s.round}, Candles ${s.players.map((p) => p.lives).join(' / ')}`);
