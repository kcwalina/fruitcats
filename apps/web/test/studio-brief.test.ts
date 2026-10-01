// The Studio reads a project through the core: Mochi's brief and cards, as games/folkborn/sets/mochi/ has them. The
// Studio's saved work (uploads, comments, a step opened early) is kept under each picture's file name and each step's
// number, so those must read as they always have.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Json } from '../../../cardengine/engine/host/core';
import { core } from '../../../content/core';
import { briefFrom } from '../src/studio/brief';
import { cardsFrom } from '../src/studio/cards';

const MOCHI = fileURLToPath(new URL('../../../games/folkborn/sets/mochi/', import.meta.url));

function documents(skip = ''): Record<string, Json> {
  const files = readdirSync(MOCHI).filter((f) => f.endsWith('.alex') && f !== skip).map((path) => ({ path, bytes: readFileSync(MOCHI + path) }));
  const project = core().loadProject(files);
  const values = Object.fromEntries(files.map((f) => [f.path.replace(/\.alex$/, ''), project.value(f.path.replace(/\.alex$/, ''))]));
  project.free();
  return values;
}

describe('a Studio project, read through the core', () => {
  const read = documents();
  const brief = briefFrom(read, 'mochi-brief');

  it('keeps the set, the steps and the pictures the Studio keeps work under', () => {
    expect([brief.set, brief.name]).toEqual(['MC1', 'Mochi']);
    expect(brief.milestones.map((m) => [m.id, m.title])).toEqual([[1, 'Mochi’s card'], [2, 'Mochi’s Portrait']]);
    expect(brief.pictures.map((p) => [p.file, p.card, p.kind, p.size, p.tier, p.milestone])).toEqual([
      ['MC1-X01.webp', 'MC1-X01', 'card', [1536, 1024], 'signature', 1],
      ['legend-mochi.webp', null, 'pawtrait', [512, 512], 'legend', 2],
    ]);
  }, 120_000);

  it('keeps what the artist reads', () => {
    expect(brief.pictures[0]).toMatchObject({
      open: ['name', 'flavor', 'look', 'scene'], showcase: true, signature: 'requested', family: 'Paragon',
      pawtrait: 'legend-mochi.webp', frameChoice: true,
    });
    expect(brief.pictures[0].mustKeep).toHaveLength(2);
    expect(brief.pictures[0].draw).toMatch(/^Mochi, the Sweet Spirit: .*Guardian/);
    expect(brief.families?.Paragon.world).toMatch(/most important cards/);
  });

  it('reads the cards the pictures are for', () => {
    expect(cardsFrom(read.mochi).get('MC1-X01')).toMatchObject({
      name: 'Mochi, the Sweet Spirit', type: 'Fabled', cost: 4, power: 3, health: 4, family: 'Paragon', rarity: 'legendary',
      text: 'Guardian. Lucky. Hello: Draw a card.\nGoodbye: Gain two Offerings.',
    });
  });

  it('says which reference names nothing', () => {
    expect(() => briefFrom(documents('mochi.alex'), 'mochi-brief')).toThrow(/nothing is named @mochi/);
  });
});
