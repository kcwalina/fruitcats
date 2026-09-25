// Every playtest command, behind one entry. Run with tsx in a checkout (npm run balance, npm run play, …),
// or as the single-file bundle PC2024 downloads: `node runner.mjs <command> [options]`.

import { balanceCommand } from './balance/command';
import { reportsCommand } from './dashboard/sync';
import { runMain } from './lib/pool';
import { llmCompareCommand, llmPlaytestCommand } from './llm/command';
import { deckBuildCommand } from './llm/builder';
import { decksCommand } from './decks/command';
import { deckHuntCommand } from './llm/hunt';
import { playCommand } from './play/command';
import { refreshLibrary } from './decks/library';
import { nightlyCommand } from './nightly/command';

const COMMANDS: Record<string, () => Promise<number>> = {
  balance: balanceCommand,
  play: playCommand,
  'llm-playtest': llmPlaytestCommand,
  'llm-compare': llmCompareCommand,
  'deck-hunt': deckHuntCommand,
  'deck-build': deckBuildCommand,
  decks: decksCommand,
  nightly: nightlyCommand,
  // The name of the first paw build (2026-09-24), kept until every PC2024 paw asks for 'nightly'.
  weekly: nightlyCommand,
  reports: reportsCommand,
};

runMain(async () => {
  const name = process.argv[2];
  const command = COMMANDS[name];
  if (!command) {
    console.error(`Usage: runner <${Object.keys(COMMANDS).join('|')}> [options]`);
    return 1;
  }
  // Away from a checkout (PC2024), the deck library's latest published copy: decks built since the last deploy.
  await refreshLibrary();
  return command();
});
