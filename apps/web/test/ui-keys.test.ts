import { describe, expect, it } from 'vitest';
import { altKey, altOf } from '../src/ui';

describe('a selection’s other choices', () => {
  // The game screen reads a click key's second part as a number for hand and unit clicks; an Offer it button once
  // did the same, read `alt` as NaN and did nothing, which left a player over the hand limit unable to be Ready.
  it('read back the index their button was drawn with', () => {
    for (const i of [0, 1, 2]) expect(altOf(altKey(i))).toBe(i);
  });
});
