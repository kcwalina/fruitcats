// A set's art, fingerprinted. kardix renders the finished cards (content/kardix.ts), so they are build output, and the
// hash is over what they're made from: the set's pictures (here and its card paintings in the game folder), its
// cards in Alex, the game's card layout, frames and icons, and kardix. publish-pack uploads the art to a folder named
// by it (<set>/art/<fingerprint>/, content/pack-storage.ts), and the game's build points at the folder of its own
// art and refuses while the storage doesn't have it yet (apps/web/vite.config.ts).
//
// Why the storage holds the art at all: the site is deployed as one upload inside Azure's two-minute window,
// and card art (over 100 MB by the third deck) doesn't fit through a home uplink in that time. The art changes
// rarely, so it is published on its own and the site stays small (docs/card-data-architecture.md, Card packs).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAME, briefFile, cardSources, isText, pictureFolders } from './kardix';

function walk(dir: string, rel: string, into: [string, string][]): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, `${rel}${name}/`, into);
    else into.push([`${rel}${name}`, path]);
  }
}

/**
 * Every art file of the set at `root`: [its path as published (relative to the set, forward slashes), the file].
 * Its pictures are in two folders but published as one, art/illustrations/; finished cards aren't art files.
 */
export function artEntries(root: string, game = GAME): [string, string][] {
  const files: [string, string][] = [];
  for (const dir of pictureFolders(root, game)) if (existsSync(dir)) walk(dir, 'art/illustrations/', files);
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every art file of the set at `root`, as sorted paths relative to it (forward slashes). */
export function artFiles(root: string, game = GAME): string[] {
  return artEntries(root, game).map(([name]) => name);
}

/**
 * The fingerprint of the set's art, or null when the set has no art at all. A Studio project (a set with an art brief)
 * always has one, pictures or not: its Studio frames and its project files are published under it.
 */
export function artHash(root: string, game = GAME): string | null {
  // Art files byte for byte, as always; the sources with their line endings made the same everywhere.
  const files: [string, string, boolean][] = artEntries(root, game).map(([name, path]) => [name, path, false]);
  if (!files.length && !briefFile(root, game)) return null;
  files.push(...cardSources(root, game).map(([name, path]): [string, string, boolean] => [`source:${name}`, path, isText(path)]));
  const hash = createHash('sha256');
  for (const [name, path, text] of files) {
    hash.update(name);
    hash.update('\0');
    const bytes = readFileSync(path);
    hash.update(text ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}
