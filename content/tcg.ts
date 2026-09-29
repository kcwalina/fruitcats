// Sets whose finished cards tcg renders (cardengine/tcg). Their cards are defined in the game folder,
// games/folkborn/: the game and its card layout (folkborn.alex, card-layout.alex), its icons and finish textures (art/), and
// for each set its cards (sets/<set>/<set>.alex) and the paintings they name (sets/<set>/art/). That folder holds
// sources only. The finished cards are build output, never committed: tcg makes them from the sources, so what's
// published can only be what the sources say.
//
// A set here in content/ keeps what the game engine and the web app still read from it: set.json, the art
// generator's prompts, and pictures that aren't card art (the tale banner).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(CONTENT);
const TCG = join(REPO, 'cardengine', 'tcg');

/** Folkborn's game folder: its cards, card layout and the assets they're made from. */
export const GAME = join(REPO, 'games', 'folkborn');

/** Where the cards of the set in `root` (a folder in content/) are defined, in the game folder. */
export const gameSet = (root: string, game = GAME) => join(game, 'sets', basename(root));

/** Whether tcg renders the cards of the set in `root`: the game folder defines them. */
export function renderedByTcg(root: string, game = GAME): boolean {
  return existsSync(join(gameSet(root, game), `${basename(root)}.alex`));
}

/** Folders that hold a set's pictures: content/<set>/art/illustrations, and its card paintings in the game folder. */
export function pictureFolders(root: string, game = GAME): string[] {
  const own = join(root, 'art', 'illustrations');
  return renderedByTcg(root, game) ? [own, join(gameSet(root, game), 'art')] : [own];
}

function walk(dir: string, keep: (file: string) => boolean = () => true): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'bin' && name !== 'obj') out.push(...walk(path, keep));
    } else if (keep(path)) out.push(path);
  }
  return out;
}

/**
 * Everything a tcg set's finished cards are made from besides its paintings: as [a stable name, the file's
 * path]. The set's cards by their file name; the game's shared sources and tcg relative to their folders.
 */
export function cardSources(root: string, game = GAME): [string, string][] {
  const own = `${basename(root)}.alex`;
  const shared: [string, string][] = [
    ...readdirSync(game).filter((f) => f.endsWith('.alex')).map((f): [string, string] => [`game/${f}`, join(game, f)]),
    ...walk(join(game, 'art')).map((f): [string, string] => [`game/${relative(game, f).replace(/\\/g, '/')}`, f]),
    ...walk(TCG, (f) => /\.(cs|csproj|nupkg|config)$/.test(f)).map((f): [string, string] => [`tcg/${relative(TCG, f).replace(/\\/g, '/')}`, f]),
    ['core.alex', join(REPO, 'cardengine', 'framework', 'core.alex')],
  ];
  return [[own, join(gameSet(root, game), own)], ...shared.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))];
}

/** Text a checkout may store with either line ending; its fingerprint mustn't depend on which. */
export const isText = (file: string) => /\.(alex|cs|csproj|config|json|md)$/.test(file);

/**
 * Renders the finished cards of the set in `root` into `out` (card faces there; finishes in subfolders), with a
 * fresh build of tcg. Throws with tcg's own message when it fails.
 */
export function renderCards(root: string, out: string): void {
  const r = spawnSync('dotnet', ['run', '--project', TCG, '-c', 'Release', '--', 'cards', '--project', GAME, '--set', basename(root),
    '--out', out], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`tcg couldn't render ${basename(root)}'s cards: ${(r.stderr || r.stdout).trim()}\n`
      + '(tcg needs the .NET SDK; see cardengine/tcg/Tcg.csproj.)');
  }
}
