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

describe('a set\'s art fingerprint', () => {
  it('lists illustrations and finished cards, in every finish, in a fixed order', () => {
    const root = setFolder({
      'art/cards/foil/X1-D01.webp': 'f', 'art/cards/X1-D01.webp': 'c', 'art/illustrations/X1-D01.webp': 'i',
      'art/prompts.json': 'not art', 'set.json': '{}',
    });
    expect(artFiles(root)).toEqual(['art/cards/X1-D01.webp', 'art/cards/foil/X1-D01.webp', 'art/illustrations/X1-D01.webp']);
  });

  it('is the same for the same art, and changes with any file, byte or name', () => {
    const files = { 'art/illustrations/X1-D01.webp': 'abc', 'art/cards/X1-D01.webp': 'card' };
    const a = artHash(setFolder(files));
    expect(a).toBe(artHash(setFolder(files)));
    expect(artHash(setFolder({ ...files, 'art/cards/X1-D01.webp': 'carD' }))).not.toBe(a);
    expect(artHash(setFolder({ ...files, 'art/cards/gold/X1-D01.webp': 'g' }))).not.toBe(a);
    expect(artHash(setFolder({ 'art/illustrations/X1-D02.webp': 'abc', 'art/cards/X1-D01.webp': 'card' }))).not.toBe(a);
  });

  it('is null for a set with no art, so there is nothing to publish or check', () => {
    expect(artHash(setFolder({ 'set.json': '{}' }))).toBeNull();
  });
});
