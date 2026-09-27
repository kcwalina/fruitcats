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
    expect(suggestText(CARDS['SB1-C09'])).toBe('Ambush. Lucky. Deal 2 damage to a unit.');
    expect(suggestText(CARDS['SB1-C01'])).toBe('Swift. Zest: gets +1 Power this round.');
    expect(suggestText(CARDS['SB1-O09'])).toBe('Ambush. Cancel an attack. (The attacker stays exhausted.)');
    expect(suggestText(CARDS['BP1-B04'])).toBe('Guardian. Goodbye: Summon an Ant.');
    expect(heroTexts(CARDS['SB1-H03']).kitten).toBe('Exhaust: Ready one of your Offerings.\nAwaken: You have 8 or more Offerings.');
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
