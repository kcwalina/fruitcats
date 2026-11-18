import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, UNIT_CLASSES, isUnitCard, unitClass } from '@fruitcats/engine';
import { CLASS_ICON, abilityLines } from '../src/glyphs';

// The owner's playtest (2026-10-02): what a unit does was hidden behind a long press. Each unit's tile now shows its
// class as an icon and each ability as a short line; these keep every starter's units readable at a glance.
describe('a unit at a glance', () => {
  const units = [...new Set(Object.values(DECKS).flatMap((d) => Object.keys(d.cards)))].filter(isUnitCard);

  it('every unit of every starter has a class with an icon', () => {
    for (const id of units) expect(CLASS_ICON[unitClass(id)], id).toBeTruthy();
    expect(UNIT_CLASSES.every((c) => CLASS_ICON[c])).toBe(true);
  });

  it('every ability a starter unit has shows as a line', () => {
    for (const id of units) {
      const n = (CARDS[id].abilities ?? []).filter((a) => !a.static || a.static.to !== 'attached').length;
      expect(abilityLines(id), id).toHaveLength(n);
    }
  });

  it('reads as the card does', () => {
    expect(abilityLines('DW1-D01')).toEqual(['⟳ heal 1 · sides']);                // Stove Keeper
    expect(abilityLines('PR1-D06')).toEqual(['⚡ 2 dmg · across']);               // Súči of the Hunt
    expect(abilityLines('DW1-D07')).toEqual(['⟳² −2⚔ · 3 across']);              // Kikimora
    expect(abilityLines('DW1-D15')).toEqual(['🏆 +2⚔']);                          // Bannik
    expect(abilityLines('DW1-D16')).toEqual([]);                                  // Hearth Cricket: plain
  });
});
