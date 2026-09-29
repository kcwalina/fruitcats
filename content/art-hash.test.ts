import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artFiles, artHash } from './art-hash';

// The build refuses to ship when a set's art here differs from what the pack storage has (vite.config.ts), and
// this hash is how it knows. It must see every file, every byte, and nothing else.

const made: string[] = [];
function setFolder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fruitcats-art-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
afterEach(() => { for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true }); });

// A set as tcg renders it (content/tcg.ts): the game folder defines its cards (sets/x/x.alex) and holds their
// paintings (sets/x/art/); its folder in content/ may hold other pictures; its finished cards are build output.
function tcgSet(game: Record<string, string>, content: Record<string, string> = {}): [string, string] {
  const root = setFolder({ 'game/folkborn.alex': '#type Game\n', ...Object.fromEntries(Object.entries(game).map(([p, t]) => [`game/sets/x/${p}`, t])),
    ...Object.fromEntries(Object.entries(content).map(([p, t]) => [`content/x/${p}`, t])), 'content/x/set.json': '{}' });
  return [join(root, 'content', 'x'), join(root, 'game')];
}

describe('a set\'s art fingerprint', () => {
  const sources = { 'x.alex': "#type Set\n\nname = 'X'\n", 'art/X1-D01.webp': 'painting' };

  it('publishes its card paintings and its other pictures together, and never finished cards', () => {
    const [root, game] = tcgSet(sources, { 'art/illustrations/X1-banner.webp': 'banner', 'art/cards/X1-D01.webp': 'old card' });
    expect(artFiles(root, game)).toEqual(['art/illustrations/X1-D01.webp', 'art/illustrations/X1-banner.webp']);
  });

  it('is the same for the same art, and changes with any picture: its bytes, its name, one more', () => {
    const a = artHash(...tcgSet(sources));
    expect(a).toBe(artHash(...tcgSet(sources)));
    expect(artHash(...tcgSet({ ...sources, 'art/X1-D01.webp': 'paintinG' }))).not.toBe(a);
    expect(artHash(...tcgSet({ 'x.alex': sources['x.alex'], 'art/X1-D02.webp': 'painting' }))).not.toBe(a);
    expect(artHash(...tcgSet(sources, { 'art/illustrations/X1-banner.webp': 'banner' }))).not.toBe(a);
  });

  it('is null for a set with no art, so there is nothing to publish or check', () => {
    expect(artHash(...tcgSet({ 'x.alex': sources['x.alex'] }))).toBeNull();
  });

  it('is made from the sources, so finished cards change nothing', () => {
    const a = artHash(...tcgSet(sources));
    expect(artHash(...tcgSet(sources, { 'art/cards/X1-D01.webp': 'anything', 'art/cards/foil/X1-D01.webp': 'at all' }))).toBe(a);
  });

  it('changes with the cards in Alex and with a painting', () => {
    const a = artHash(...tcgSet(sources));
    expect(artHash(...tcgSet({ ...sources, 'x.alex': "#type Set\n\nname = 'Y'\n" }))).not.toBe(a);
    expect(artHash(...tcgSet({ ...sources, 'art/X1-D01.webp': 'repainted' }))).not.toBe(a);
  });

  it('is the same whichever line endings a checkout gives the Alex files', () => {
    expect(artHash(...tcgSet({ ...sources, 'x.alex': "#type Set\r\n\r\nname = 'X'\r\n" }))).toBe(artHash(...tcgSet(sources)));
  });
});
