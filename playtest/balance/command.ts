// balance [--quick] [--scale N] [--threads N] [--deck file.json ...] [--quiet]
//
// Exit codes: 0 pass or warnings, 2 a blocking balance problem (the deploy gate stops on it).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag } from '../lib/args';
import { deckProblems, type DeckList } from '../lib/engine';
import { reportsRoot } from '../lib/runs';
import { runBalance } from './gauntlet';

export async function balanceCommand(): Promise<number> {
  const decks: DeckList[] = [];
  process.argv.forEach((a, i) => {
    if (a !== '--deck') return;
    const deck = JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as DeckList;
    const problems = deckProblems(deck);
    if (problems.length) throw new Error(`${process.argv[i + 1]}: ${problems.join(' ')}`);
    decks.push(deck);
  });
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
