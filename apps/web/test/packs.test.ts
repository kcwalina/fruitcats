// Card packs a running game takes at start-up (src/content.ts): never one of a set taken out of the game, even while
// the pack storage still lists it.
import { describe, expect, it, vi } from 'vitest';
import { SETS } from '@fruitcats/engine';

const pack = (set: string, name: string) => ({ set, name, version: '9.0.0', status: 'released', data: `${set.toLowerCase()}/set.json` });
const data = (set: string) => ({
  set, name: set, version: '9.0.0', status: 'released', families: { Old: {} },
  cards: [{ id: `${set}-C01`, type: 'Critter', rarity: 'Common', family: 'Old', name: 'Old Card', cost: 1, power: 1, health: 1, text: '' }],
});

describe('card packs', () => {
  it('never loads a retired set (the Starter Box), and still loads a new one', async () => {
    vi.stubGlobal('location', { search: '', href: 'https://fruitcats.example/' });
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url).pathname;
      const json = path.endsWith('index.json') ? { packs: [pack('SB1', 'Starter Box'), pack('NW1', 'New Set')] }
        : path.endsWith('sb1/set.json') ? data('SB1') : path.endsWith('nw1/set.json') ? data('NW1') : null;
      return new Response(JSON.stringify(json), { status: json ? 200 : 404 });
    });
    const { loadPacks } = await import('../src/content');
    const loaded = await loadPacks();
    expect(SETS.SB1).toBeUndefined();
    expect(loaded).not.toContain('SB1');
    expect(loaded).toContain('NW1');
    vi.unstubAllGlobals();
  });
});
