import { describe, expect, it } from 'vitest';
import { runChecks } from '../../../content/check-set';
import { missingNumbers, suggestText } from '../../../content/rules-text';
import { CARDS } from '../src/index';

// Every set in content/ passes check-set (npm run check-set): the same checks a contributor runs.
describe('content sets pass check-set', () => {
  for (const { set, report } of runChecks()) {
    it(`${set.data.name} (${set.folder})`, () => expect(report.errors).toEqual([]));
  }
});

describe('rules text and data agree', () => {
  it('catches a card whose abilities use a number its text does not say', () => {
    expect(missingNumbers([{ when: 'play', target: { unit: 'any' }, do: [{ damage: 3 }] }], 'Deal 2 damage to a unit.')).toEqual([3]);
    expect(missingNumbers([{ when: 'hello', do: [{ readyTreats: 2 }] }], 'Hello: Ready two of your Treats.')).toEqual([]);
  });
  it('suggests text in the house style for a card that has none', () => {
    expect(suggestText(CARDS['SB1-C09'])).toBe('Pounce. Lucky. Deal 2 damage to a unit.');
    expect(suggestText(CARDS['HW1-P04'])).toBe('Heat. Hello: Deal 2 damage to an enemy unit.');
    expect(suggestText(CARDS['SB1-C06'])).toBe('Hello: Deal 1 damage to a unit. Zest: deal 2 instead.');
  });
});
