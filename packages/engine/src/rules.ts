// The numbers of the rules: docs/rulebook.md, Tunable parameters. A game keeps the numbers it was created with
// (GameState.rules), so a saved game or a match record plays on with them after the defaults change.

import type { Rules } from './types';

export const RULES: Readonly<Rules> = {
  startOfferings: 3,
  income: [4, 5, 6],
  // A losing streak, as in TFT: two or three Clashes lost in a row +1, four +2, five or more +3.
  streak: [0, 0, 1, 1, 2, 3],
  shopSize: 6,
  // Each slot's tier by the Hero's Level, as in TFT: levelling up deals better cards (docs/folkborn-0.6-design.md).
  shopOdds: [
    [100, 0, 0, 0, 0],
    [100, 0, 0, 0, 0],
    [75, 25, 0, 0, 0],
    [55, 30, 15, 0, 0],
    [35, 35, 25, 5, 0],
    [20, 30, 33, 15, 2],
    [15, 20, 30, 25, 10],
  ],
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
  starCopies: [3, 5],
};

/** The rules for a new game: the defaults with any overrides (a playtest trying other numbers). */
export function rulesWith(overrides: Partial<Rules> = {}): Rules {
  return structuredClone({ ...RULES, ...overrides });
}
