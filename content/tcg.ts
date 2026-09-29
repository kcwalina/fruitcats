// tcg (cardengine/tcg) renders every set's finished cards. The cards are defined in the game folder,
// games/folkborn/: the game and its card layout (folkborn.alex, card-layout.alex), its icons and finish textures (art/), and
// for each set its cards (sets/<set>/<set>.alex) and the paintings they name (sets/<set>/art/). That folder holds
// sources only. The finished cards are build output, never committed: tcg makes them from the sources, so what's
// published can only be what the sources say.
//
// A set here in content/ keeps what the game engine and the web app still read from it: set.json, the art
// generator's prompts, and pictures that aren't card art (the tale banner).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(CONTENT);
const TCG = join(REPO, 'cardengine', 'tcg');

/** Folkborn's game folder: its cards, card layout and the assets they're made from. */
export const GAME = join(REPO, 'games', 'folkborn');

/** Where the cards of the set in `root` (a folder in content/) are defined, in the game folder. */
export const gameSet = (root: string, game = GAME) => join(game, 'sets', basename(root));

/** Folders that hold a set's pictures: content/<set>/art/illustrations, and its card paintings in the game folder. */
export function pictureFolders(root: string, game = GAME): string[] {
  return [join(root, 'art', 'illustrations'), join(gameSet(root, game), 'art')];
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
 * Everything a set's finished cards are made from besides its paintings: as [a stable name, the file's
 * path]. The set's cards by their file name; the game's shared sources and tcg relative to their folders.
 */
export function cardSources(root: string, game = GAME): [string, string][] {
  const own = `${basename(root)}.alex`;
  const shared: [string, string][] = [
    ...readdirSync(game).filter((f) => f.endsWith('.alex')).map((f): [string, string] => [`game/${f}`, join(game, f)]),
    ...walk(join(game, 'art')).map((f): [string, string] => [`game/${relative(game, f).replace(/\\/g, '/')}`, f]),
    ...walk(TCG, (f) => /\.(cs|csproj)$/.test(f)).map((f): [string, string] => [`tcg/${relative(TCG, f).replace(/\\/g, '/')}`, f]),
    ['core.alex', join(REPO, 'cardengine', 'framework', 'core.alex')],
    // The C# Alex tcg builds against, by its projects (their version): source in the mochi repository beside this one.
    ...['Alex/ViaMochi.Alex.csproj', 'Alex.Model/ViaMochi.Alex.Model.csproj'].map((f): [string, string] => [`alex/${f}`, join(alexSource(), f)]),
  ];
  return [[own, join(gameSet(root, game), own)], ...shared.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))];
}

/** The C# Alex's source folder, in the mochi repository checked out beside this one (as cardengine/tcg/Tcg.csproj finds it). */
export function alexSource(): string {
  for (let dir = REPO; dirname(dir) !== dir; dir = dirname(dir)) {
    const src = join(dir, 'mochi', 'mochi.agents', 'alex', 'src');
    if (existsSync(join(src, 'Alex', 'ViaMochi.Alex.csproj'))) return src;
  }
  throw new Error('tcg needs the mochi repository checked out beside this one (for example C:/git/mochi next to C:/git/fruitcats).');
}

/** Text a checkout may store with either line ending; its fingerprint mustn't depend on which. */
export const isText = (file: string) => /\.(alex|cs|csproj|json|md)$/.test(file);

/**
 * Renders the finished cards of the set in `root` into `out` (card faces there; finishes in subfolders), with a
 * fresh build of tcg. Throws with tcg's own message when it fails.
 */
export function renderCards(root: string, out: string): void {
  tcg(root, out);
  if (existsSync(join(root, 'art', 'brief.json'))) renderStudioFrames(root, join(out, 'frames'));
}

/**
 * The Artist Studio's frames for a set with an art brief: each card without its picture (the window see-through),
 * in frames/. A card whose artist picks the frame (frameChoice, on its picture in the brief or on its family) also
 * gets every frame colour the layout names, in frames/p-<colour>/, and its frame for the artist's own image, with
 * that image's parts see-through, in frames/p-image/ (apps/web/src/studio/previews.ts).
 */
function renderStudioFrames(root: string, out: string): void {
  tcg(root, out, '--no-art');
  const brief = JSON.parse(readFileSync(join(root, 'art', 'brief.json'), 'utf8')) as { pictures?: { card?: string; frameChoice?: boolean }[] };
  const data = JSON.parse(readFileSync(join(root, 'set.json'), 'utf8')) as {
    families?: Record<string, { frameChoice?: boolean }>; cards: { id: string; family: string }[];
  };
  const choosing = new Set([
    ...(brief.pictures ?? []).filter((p) => p.frameChoice && p.card).map((p) => p.card!),
    ...data.cards.filter((c) => data.families?.[c.family]?.frameChoice).map((c) => c.id),
  ]);
  if (choosing.size === 0) return;
  const layout = readFileSync(join(GAME, 'card-layout.alex'), 'utf8');
  const colours = [...layout.matchAll(/^ {2}([\w-]+) = Frame \{/gm)].map((m) => m[1]).filter((f) => f !== 'Card');
  for (const colour of colours) tcg(root, join(out, `p-${colour}`), '--no-art', '--frame', colour, '--only', ...choosing);
}

function tcg(root: string, out: string, ...options: string[]): void {
  const r = spawnSync('dotnet', ['run', '--project', TCG, '-c', 'Release', '--', 'cards', '--project', GAME, '--set', basename(root),
    '--out', out, ...options], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`tcg couldn't render ${basename(root)}'s cards: ${(r.stderr || r.stdout).trim()}\n`
      + '(tcg needs the .NET SDK; see cardengine/tcg/Tcg.csproj.)');
  }
}
