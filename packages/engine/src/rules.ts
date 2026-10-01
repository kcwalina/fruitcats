// The numbers of the rules: docs/rulebook.md, Tunable parameters. A game keeps the numbers it was created with
// (GameState.rules), so a saved game or a match record plays on with them after the defaults change.

import type { Rules } from './types';

export const RULES: Readonly<Rules> = {
  startOfferings: 3,
  income: [4, 5, 6],
  // A losing streak, as in TFT: two or three Clashes lost in a row +1, four +2, five or more +3.
  streak: [0, 0, 1, 1, 2, 3],
  shopSize: 6,
  rollCost: 1,
  sellLoss: 1,
  interestPer: 5,
  interestMax: 3,
  levelStart: 2,
  levelMax: 6,
  levelCost: [0, 0, 3, 4, 5, 6],
  boutCap: 8,
  clashCandleCap: 2,
  overtimeBothLose: true,
  maxRounds: 30,
  maxStars: 3,
};

/** The rules for a new game: the defaults with any overrides (a playtest trying other numbers). */
export function rulesWith(overrides: Partial<Rules> = {}): Rules {
  return structuredClone({ ...RULES, ...overrides });
}
