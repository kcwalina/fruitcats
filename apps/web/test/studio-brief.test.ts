// Mochi's brief in Alex reads as the same brief the Studio had from brief.json, apart from the words the game has
// since changed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AlexFolder, parseAlex } from '../../../cardengine/alex/alex';
import { briefFromAlex } from '../src/studio/brief';

const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('the Studio reads a brief from Alex', () => {
  const folder = new AlexFolder(new Map([
    ['mochi', parseAlex("#type Set\nname = 'Mochi'\ncode = 'MC1'\ncards = [\n  mochi = Creature { number = 'MC1-X01' }\n]\n")],
    ['mochi-brief', parseAlex(repo('games/folkborn/sets/mochi/mochi-brief.alex'), 'mochi-brief.alex')],
  ]));
  const brief = briefFromAlex(folder, 'mochi-brief');
  const json = JSON.parse(repo('content/2026/12/mochi/art/brief.json'));

  it('keeps the set, the steps and the pictures the Studio stores work under', () => {
    expect(brief.set).toBe(json.set);
    expect(brief.name).toBe(json.name);
    expect(brief.milestones.map((m) => m.id)).toEqual(json.milestones.map((m: { id: number }) => m.id));
    expect(brief.pictures.map((p) => [p.file, p.card, p.kind, p.size, p.tier, p.milestone]))
      .toEqual(json.pictures.map((p: Record<string, unknown>) => [p.file, p.card, p.kind, p.size, p.tier, p.milestone]));
  });

  it('keeps what the artist reads', () => {
    const picture = brief.pictures[0], old = json.pictures[0];
    expect(picture).toMatchObject({
      mustKeep: old.mustKeep, open: old.open, showcase: true, signature: 'requested', family: 'Paragon',
      pawtrait: 'legend-mochi.webp', frameChoice: true,
    });
    expect(picture.draw).toContain('Guardian');
    expect(brief.families).toEqual(json.families);
    expect(brief.pictures[1].mustKeep).toEqual(json.pictures[1].mustKeep);
  });
});
