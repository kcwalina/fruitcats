// The Studio reads a project from its Alex files: Mochi's brief and cards, as games/folkborn/sets/mochi/ has them.
// The Studio's saved work (uploads, comments, a step opened early) is kept under each picture's file name and each
// step's number, so those must read as they always have.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AlexFolder, parseAlex } from '../../../cardengine/alex/alex';
import { briefFromAlex } from '../src/studio/brief';
import { cardsOf } from '../src/studio/cards';

const MOCHI = fileURLToPath(new URL('../../../games/folkborn/sets/mochi/', import.meta.url));
const folder = new AlexFolder(new Map(readdirSync(MOCHI).filter((f) => f.endsWith('.alex'))
  .map((f) => [f.replace(/\.alex$/, ''), parseAlex(readFileSync(MOCHI + f, 'utf8'), f)])));

describe('a Studio project in Alex', () => {
  const brief = briefFromAlex(folder, 'mochi-brief');

  it('keeps the set, the steps and the pictures the Studio keeps work under', () => {
    expect([brief.set, brief.name]).toEqual(['MC1', 'Mochi']);
    expect(brief.milestones.map((m) => [m.id, m.title])).toEqual([[1, 'Mochi’s card'], [2, 'Mochi’s Portrait']]);
    expect(brief.pictures.map((p) => [p.file, p.card, p.kind, p.size, p.tier, p.milestone])).toEqual([
      ['MC1-X01.webp', 'MC1-X01', 'card', [1536, 1024], 'signature', 1],
      ['legend-mochi.webp', null, 'pawtrait', [512, 512], 'legend', 2],
    ]);
  });

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
    expect(cardsOf(folder, 'mochi').get('MC1-X01')).toMatchObject({
      name: 'Mochi, the Sweet Spirit', type: 'Fabled', cost: 4, power: 3, health: 4, family: 'Paragon', rarity: 'legendary',
      text: 'Guardian. Lucky. Hello: Draw a card.\nGoodbye: Ready two of your Offerings.',
    });
  });

  it('says which reference names nothing', () => {
    const broken = new AlexFolder(new Map([...folder.documents].filter(([name]) => name !== 'mochi')));
    expect(() => briefFromAlex(broken, 'mochi-brief')).toThrow(/line \d+: nothing is named @mochi/);
  });
});
