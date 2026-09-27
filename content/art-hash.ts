// A set's art, fingerprinted: one hash over every illustration and finished card in its folder. publish-pack
// stores it beside the art in the pack storage (<set>/art.json), and the game's build compares it with the
// folder here, so a build never ships with art the storage doesn't have yet (apps/web/vite.config.ts).
//
// Why the storage holds the art at all: the site is deployed as one upload inside Azure's two-minute window,
// and card art (over 100 MB by the third deck) doesn't fit through a home uplink in that time. The art changes
// rarely, so it is published on its own and the site stays small (docs/card-data-architecture.md, Card packs).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The folders of a set that hold its art, relative to the set's folder. */
export const ART_DIRS = ['art/illustrations', 'art/cards'];

/** Every art file of the set at `root`, as sorted paths relative to it (forward slashes). */
export function artFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${rel}${name}/`);
      else files.push(`${rel}${name}`);
    }
  };
  for (const d of ART_DIRS) if (existsSync(join(root, d))) walk(join(root, d), `${d}/`);
  return files.sort();
}

/** The fingerprint of the set's art, or null when the set has no art at all. */
export function artHash(root: string): string | null {
  const files = artFiles(root);
  if (!files.length) return null;
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
