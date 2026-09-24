// play new [--deck zest-rush|five-alarm|file.json] [--vs orchard-guard|file.json] [--seed N] [--file game.json]
// play show | play do <your answer> | play log | play rules   [--file game.json]
//
// A game against the bot, one decision per command, for a player that reads: a Claude Code session doing a
// deep playtest, or you. The game lives in a file between commands (playtest/.state/game.json by default),
// the bot plays its side as soon as it is its turn, and every command prints what you may see and your
// numbered choices.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from '../lib/args';
import {
  DECKS, apply, prototypeDecks, rulesPrimer, choicesText, chooseAction, createGame, deckProblems, describe, parseChoice, resolveDeck,
  type DeckList, type GameState, type PlayerId,
} from '../lib/engine';
import { mulberry } from '../lib/rng';

interface SavedGame { state: GameState; seat: PlayerId; botSeed: number }

const defaultFile = () => fileURLToPath(new URL('../.state/game.json', import.meta.url));
const gameFile = () => resolve(arg('file') ?? defaultFile());

export function loadDeck(spec: string): DeckList {
  if (DECKS[spec]) return resolveDeck(spec);
  // A prototype set's deck (Heat Wave's five-alarm): playable, though not a starter.
  const prototype = prototypeDecks()[spec];
  if (prototype) return prototype;
  const deck = JSON.parse(readFileSync(spec, 'utf8')) as DeckList;
  const problems = deckProblems(deck);
  if (problems.length) throw new Error(`${spec}: ${problems.join(' ')}`);
  return deck;
}

/** Lets the bot take every decision that is its own, until it is the reader's turn or the game ends. */
export function botUntilTurn(g: SavedGame): void {
  const s = g.state;
  while (s.winner === null && s.prompt!.player !== g.seat) {
    apply(s, chooseAction(s, { random: mulberry(g.botSeed ^ s.actions) }));
  }
}

function show(g: SavedGame): string {
  const s = g.state;
  const table = describe(s, g.seat);
  if (s.winner !== null) {
    const result = s.winner === 'draw' ? 'The game is a draw.' : s.winner === g.seat ? 'YOU WIN.' : 'YOU LOSE.';
    return `${table}\n\nGAME OVER after ${s.round} rounds: ${result}`;
  }
  return `${table}\n\n${choicesText(s)}`;
}

export async function playCommand(): Promise<number> {
  const sub = process.argv[3];
  const file = gameFile();
  if (sub === 'rules') { console.log(rulesPrimer()); return 0; }
  if (sub === 'new') {
    const seed = Number(arg('seed') ?? Math.floor(Math.random() * 1e9));
    const mine = loadDeck(arg('deck') ?? 'zest-rush');
    const theirs = loadDeck(arg('vs') ?? 'orchard-guard');
    const g: SavedGame = { state: createGame({ decks: [mine, theirs], seed, names: ['You', 'Bot'] }), seat: 0, botSeed: seed };
    botUntilTurn(g);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(g));
    console.log(`New game (seed ${seed}): ${mine.name} (you) against ${theirs.name} (the bot).\n`);
    console.log(RULES_HINT);
    console.log(show(g));
    return 0;
  }
  if (!existsSync(file)) { console.error(`No game at ${file}. Start one with: play new`); return 1; }
  const g = JSON.parse(readFileSync(file, 'utf8')) as SavedGame;
  if (sub === 'show' || !sub) { console.log(show(g)); return 0; }
  if (sub === 'log') { console.log(g.state.log.map((e) => `R${e.round} ${e.text}`).join('\n')); return 0; }
  if (sub === 'do') {
    if (g.state.winner !== null) { console.log(show(g)); return 0; }
    const reply = process.argv.slice(4).filter((a, i, all) => a !== '--file' && all[i - 1] !== '--file').join(' ');
    const parsed = parseChoice(g.state, reply);
    if ('error' in parsed) { console.log(`${parsed.error}\n\n${choicesText(g.state)}`); return 1; }
    apply(g.state, parsed.action);
    botUntilTurn(g);
    writeFileSync(file, JSON.stringify(g));
    console.log(show(g));
    return 0;
  }
  console.error('Usage: play new|show|do <answer>|log');
  return 1;
}

const RULES_HINT = 'Rules in brief: `npm run play -- rules`. Units are Y1… (yours) and T1… (theirs); hand cards are H1….\n';
