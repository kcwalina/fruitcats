import { describe, expect, it } from 'vitest';
import { runChecks } from '../../../content/check-set';
import { heroTexts, missingNumbers, suggestText } from '../../../content/rules-text';
import { CARDS } from '../src/index';

// Every set in content/ passes check-set (npm run check-set): the same checks a contributor runs.
describe('content sets pass check-set', () => {
  for (const { set, report } of runChecks()) {
    it(`${set.data.name} (${set.folder})`, () => expect(report.errors).toEqual([]));
  }
});

describe('rules text comes from the data', () => {
  it('writes every card of every set exactly as its set.json says (check-set fails otherwise)', () => {
    for (const { report } of runChecks()) expect(report.errors.filter((e) => e.includes("doesn't match its data"))).toEqual([]);
  });
  it('writes the house style', () => {
    expect(suggestText(CARDS['SB1-C09'])).toBe('Pounce. Lucky. Deal 2 damage to a unit.');
    expect(suggestText(CARDS['SB1-C01'])).toBe('Zoomies. Zest: gets +1 Power this round.');
    expect(suggestText(CARDS['SB1-O09'])).toBe('Pounce. Cancel an attack. (The attacker stays exhausted.)');
    expect(suggestText(CARDS['HW1-X01'])).toBe("Guardian. Goodbye: Summon a 2/2 Jack-o'-Lantern with Guardian.");
    expect(heroTexts(CARDS['SB1-H03']).kitten).toBe('Exhaust: Ready one of your Treats.\nGrow Up: You have 8 or more Treats.');
  });
  it('catches a card whose abilities use a number its text does not say', () => {
    expect(missingNumbers([{ when: 'play', target: { unit: 'any' }, do: [{ damage: 3 }] }], 'Deal 2 damage to a unit.')).toEqual([3]);
  });
});
