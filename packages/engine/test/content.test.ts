import { describe, expect, it } from 'vitest';
import { retiredIn, runChecks } from '../../../content/check-set';
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
    expect(suggestText(CARDS['PR1-D12'])).toBe('Ambush. Deal 2 damage to an enemy unit.');
    expect(suggestText(CARDS['PR1-D04'])).toBe('Marksman. Swift.');
    expect(suggestText(CARDS['PR1-D06'])).toBe('Marksman. Clash start: Deal 2 damage to the enemy across.');
    expect(suggestText(CARDS['AL1-D09'])).toBe('Ambush. The enemy unit across from this Ambush deals no damage this Clash.');
    expect(suggestText(CARDS['JR1-D18'])).toBe('Marksman. Goodbye: Your units get +2 Power this round.');
    expect(suggestText(CARDS['DW1-D02'])).toBe('Bruiser. Goodbye: Gain an Offering.');
    expect(suggestText(CARDS['DW1-D06'])).toBe('Support. Clash start: The units next to Bread-and-Salt Greeter gain Tough 1 this round.');
    expect(suggestText(CARDS['DW1-D07'])).toBe('Mage. Every second bout: The enemy across and the ones next to it get -2 Power this round.');
    expect(suggestText(CARDS['HH1-D18'])).toBe('Mage. Every second bout: Deal 1 damage to the enemy across and the ones next to it.');
    expect(suggestText(CARDS['AL1-D04'])).toBe('Bruiser. At the start of each round, Clay Alux gets +1 Rain-Fed.');
    expect(suggestText(CARDS['DW1-D04'])).toBe('Tank. Taunt.');
    expect(suggestText(CARDS['DW1-D20'])).toBe('An enemy unit deals no damage in the first two bouts.');
    expect(heroTexts(CARDS['DW1-H01']).kitten).toBe('Exhaust: Gain an Offering.\nAwaken: You have 15 or more Offerings.');
    expect(heroTexts(CARDS['JR1-H01']).kitten).toContain('Awaken: 15 or more units have gone down in Clashes this game.');
  });
  it('never writes a retired word (Treats, Pounce, Zoomies…) on any card', () => {
    for (const c of Object.values(CARDS)) {
      const texts = c.type === 'Hero Cat' ? Object.values(heroTexts(c)) : [suggestText(c)];
      for (const text of texts) expect(retiredIn(text, true), `${c.id}: ${text}`).toEqual([]);
    }
  });
  it('refuses the old game words on cards, so they cannot come back', () => {
    expect(retiredIn('Exhaust: Ready one of your Treats.', true)).toEqual(['Treats']);
    expect(retiredIn('Zoomies. Pounce: deal 2 damage.', true)).toEqual(['Zoomies', 'Pounce']);
    expect(retiredIn('It takes the Yarn Ball.', true)).toEqual(['Yarn', 'Yarn Ball']);
    // A cat deck's names and flavor may keep ordinary words; the game's own terms are still refused there.
    expect(retiredIn('Hiss!', false)).toEqual([]);
    expect(retiredIn('A Kitten with 9 Treats', false)).toEqual(['Treats']);
  });
  it('catches a card whose abilities use a number its text does not say', () => {
    expect(missingNumbers([{ when: 'play', target: { unit: 'any' }, do: [{ damage: 3 }] }], 'Deal 2 damage to a unit.')).toEqual([3]);
  });
});
