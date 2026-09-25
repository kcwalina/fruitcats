// balance [--quick] [--scale N] [--threads N] [--deck DECK[,DECK…] ...] [--library] [--prototypes] [--quiet]
//
// --deck adds decks against the starters: a library key, a deck code, a DeckList file (see decks/library.ts).
// --library adds every deck in the deck library. Neither changes the verdict on the starters: extra decks warn
// when they beat them, never block.
// --prototypes adds the decks of prototype sets (Heat Wave's Five Alarm, …) as extra decks against the starters.
//
// Exit codes: 0 pass or warnings, 2 a blocking balance problem (the deploy gate stops on it).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag } from '../lib/args';
import { prototypeDecks, type DeckList } from '../lib/engine';
import { loadDecks } from '../decks/library';
import { reportsRoot } from '../lib/runs';
import { runBalance } from './gauntlet';

export async function balanceCommand(): Promise<number> {
  const decks: DeckList[] = [];
  process.argv.forEach((a, i) => { if (a === '--deck') decks.push(...loadDecks(process.argv[i + 1])); });
  if (flag('library')) decks.push(...loadDecks('library'));
  if (flag('prototypes')) decks.push(...Object.values(prototypeDecks()));
  const summary = await runBalance({
    quick: flag('quick'),
    scale: arg('scale') ? Number(arg('scale')) : undefined,
    threads: arg('threads') ? Number(arg('threads')) : undefined,
    extraDecks: decks,
    quiet: flag('quiet'),
  });
  const report = readFileSync(join(reportsRoot(), summary.id, 'report.md'), 'utf8');
  if (!flag('quiet')) console.log(report);
  console.log(`${summary.result.toUpperCase()}: ${summary.games} games in ${summary.durationSec}s. Report: ${join(reportsRoot(), summary.id)}`);
  return summary.result === 'block' ? 2 : 0;
}
