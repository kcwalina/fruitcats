// Every playtest command, behind one entry. Run with tsx in a checkout (npm run balance, npm run play, …),
// or as the single-file bundle PC2024 downloads: `node runner.mjs <command> [options]`.

import { balanceCommand } from './balance/command';
import { reportsCommand } from './dashboard/sync';
import { runMain } from './lib/pool';
import { llmPlaytestCommand } from './llm/command';
import { deckHuntCommand } from './llm/hunt';
import { playCommand } from './play/command';
import { weeklyCommand } from './weekly/command';

const COMMANDS: Record<string, () => Promise<number>> = {
  balance: balanceCommand,
  play: playCommand,
  'llm-playtest': llmPlaytestCommand,
  'deck-hunt': deckHuntCommand,
  weekly: weeklyCommand,
  reports: reportsCommand,
};

runMain(async () => {
  const name = process.argv[2];
  const command = COMMANDS[name];
  if (!command) {
    console.error(`Usage: runner <${Object.keys(COMMANDS).join('|')}> [options]`);
    return 1;
  }
  return command();
});
