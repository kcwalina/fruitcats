import { describe, expect, it } from 'vitest';
import { DECKS, apply, chooseAction, createGame, legalActions, type Action, type GameState } from '@fruitcats/engine';
import { orList, otherMoves, yarnConfirmText, yarnNeedsConfirm } from '../src/yourmoves';

/** Every action prompt seen in some computer-vs-computer games, with its legal actions. */
function actionPrompts(): Action[][] {
  const seen: Action[][] = [];
  const decks = Object.keys(DECKS);
  for (let seed = 1; seed <= 40; seed++) {
    const s: GameState = createGame({ decks: [decks[seed % decks.length], decks[(seed * 7 + 3) % decks.length]], seed });
    for (let steps = 0; s.winner === null && steps < 2000; steps++) {
      if (s.prompt?.kind === 'action') seen.push(legalActions(s));
      apply(s, chooseAction(s));
    }
  }
  return seen;
}

describe('Take the Yarn confirmation', () => {
  const prompts = actionPrompts().filter((l) => l.some((a) => a.t === 'takeYarn'));

  it('takes the Yarn right away when Pass is the only other choice', () => {
    const onlyPass = prompts.filter((l) => l.every((a) => a.t === 'takeYarn' || a.t === 'pass'));
    expect(onlyPass.length).toBeGreaterThan(0);
    for (const legal of onlyPass) {
      expect(yarnNeedsConfirm(legal)).toBe(false);
      expect(otherMoves(legal)).toEqual([]);
    }
  });

  it('asks only when the action bar names something else to do, and the question names it too', () => {
    for (const legal of prompts) {
      const moves = otherMoves(legal);
      // The action bar says "Nothing left to do" exactly when otherMoves is empty.
      expect(yarnNeedsConfirm(legal)).toBe(moves.length > 0);
      if (moves.length) expect(yarnConfirmText(legal)).not.toMatch(/only <b>pass<\/b>/);
    }
  });

  it('counts the Hero Cat ability, and says so, when it is the only other thing left', () => {
    const abilityOnly: Action[] = [{ t: 'ability' }, { t: 'takeYarn' }, { t: 'pass' }];
    expect(otherMoves(abilityOnly)).toEqual(['use your Hero Cat’s ability']);
    expect(yarnConfirmText(abilityOnly)).toContain('can’t use your Hero Cat’s ability');
  });

  it('lists moves in plain words', () => {
    expect(orList(['a'])).toBe('a');
    expect(orList(['a', 'b'])).toBe('a or b');
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c');
  });
});
