// kardix (cardengine/kardix) draws every set's finished cards, with the core (cardengine/engine), as PNGs; the build
// keeps them as WebP. The cards are defined in the game folder,
// games/folkborn/: the game and its card layout (folkborn.alex, card-layout.alex), its icons and finish textures (art/), and
// for each set its cards (sets/<set>/<set>.alex) and the paintings they name (sets/<set>/art/); a set that isn't part
// of the game yet is in prototypes/<set>/ instead. A set's folder may hold its art brief for the Artist Studio
// (<set>-brief.alex), which makes it a Studio project. The game folder holds
// sources only. The finished cards are build output, never committed: kardix makes them from the sources, so what's
// published can only be what the sources say.
//
// A set here in content/ keeps what the game engine and the web app still read from it: set.json, the art
// generator's prompts, and pictures that aren't card art (the tale banner).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { briefFrom, type Brief } from '../apps/web/src/studio/brief';
import { core } from './core';

const CONTENT = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(CONTENT);
const KARDIX = join(REPO, 'cardengine', 'kardix');
const ENGINE = join(REPO, 'cardengine', 'engine');

/** Folkborn's game folder: its cards, card layout and the assets they're made from. */
export const GAME = join(REPO, 'games', 'folkborn');

/**
 * Where the cards of the set in `root` (a folder in content/) are defined, in the game folder: sets/<set>, or
 * prototypes/<set> for a prototype, which kardix renders only when asked for it by name.
 */
export function gameSet(root: string, game = GAME): string {
  const prototype = join(game, 'prototypes', basename(root));
  return existsSync(prototype) ? prototype : join(game, 'sets', basename(root));
}

/** The set's art brief for the Artist Studio (<set>-brief.alex in its folder), or null when it has none. */
export function briefFile(root: string, game = GAME): string | null {
  const file = join(gameSet(root, game), `${basename(root)}-brief.alex`);
  return existsSync(file) ? file : null;
}

/** The set's art brief, as the Studio reads it (the core loads the set's folder), or null when it has none. */
export function readBrief(root: string, game = GAME): Brief | null {
  const file = briefFile(root, game);
  if (!file) return null;
  const dir = gameSet(root, game);
  const files = readdirSync(dir).filter((f) => f.endsWith('.alex')).sort().map((f) => ({ path: f, bytes: readFileSync(join(dir, f)) }));
  const project = core().loadProject(files);
  try {
    const documents = Object.fromEntries(files.map((f) => [f.path.slice(0, -'.alex'.length), project.value(f.path.slice(0, -'.alex'.length))]));
    return briefFrom(documents, basename(file, '.alex'));
  } finally {
    project.free();
  }
}

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
 * Everything a set's finished cards (and a Studio project's frames) are made from besides its paintings: as [a stable
 * name, the file's path]. The set's Alex files (its cards, its brief) by their file name; the game's shared sources
 * and kardix relative to their folders.
 */
export function cardSources(root: string, game = GAME): [string, string][] {
  const dir = gameSet(root, game);
  const own = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.alex')).sort() : [];
  const shared: [string, string][] = [
    ...readdirSync(game).filter((f) => f.endsWith('.alex')).map((f): [string, string] => [`game/${f}`, join(game, f)]),
    ...walk(join(game, 'art')).map((f): [string, string] => [`game/${relative(game, f).replace(/\\/g, '/')}`, f]),
    ...walk(KARDIX, (f) => /\.(cs|csproj)$/.test(f)).map((f): [string, string] => [`kardix/${relative(KARDIX, f).replace(/\\/g, '/')}`, f]),
    // The core draws the cards: its source, the crates it builds with, and the framework it binds games against.
    ...[...walk(join(ENGINE, 'src'), (f) => f.endsWith('.rs')), ...['Cargo.toml', 'Cargo.lock', '.cargo/config.toml', 'build.rs'].map((f) => join(ENGINE, f))]
      .map((f): [string, string] => [`engine/${relative(ENGINE, f).replace(/\\/g, '/')}`, f]),
    ...walk(join(REPO, 'cardengine', 'framework')).map((f): [string, string] => [`framework/${relative(join(REPO, 'cardengine', 'framework'), f).replace(/\\/g, '/')}`, f]),
  ];
  return [...own.map((f): [string, string] => [f, join(dir, f)]), ...shared.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))];
}

/** Text a checkout may store with either line ending; its fingerprint mustn't depend on which. */
export const isText = (file: string) => /\.(alex|cs|csproj|json|md|rs|toml|lock)$/.test(file);

/**
 * Renders the finished cards of the set in `root` into `out` (card faces there; finishes in subfolders), with a
 * fresh build of kardix. Throws with kardix's own message when it fails.
 */
export async function renderCards(root: string, out: string): Promise<void> {
  kardix(root, out);
  if (briefFile(root)) renderStudioFrames(root, join(out, 'frames'));
  await asWebp(out);
}

/** Every PNG kardix drew under `out` as WebP (quality 90), the PNG removed. */
async function asWebp(out: string): Promise<void> {
  for (const png of walk(out, (f) => f.endsWith('.png'))) {
    await sharp(png).webp({ quality: 90 }).toFile(`${png.slice(0, -'.png'.length)}.webp`);
    unlinkSync(png);
  }
}

/**
 * The Artist Studio's frames for a set with an art brief: each card without its picture (the window see-through),
 * in frames/. A card whose artist picks the frame (frameChoice, on its picture in the brief or on its family) also
 * gets every frame colour the layout names, in frames/p-<colour>/, and its frame for the artist's own image, with
 * that image's parts see-through, in frames/p-image/ (apps/web/src/studio/previews.ts).
 */
function renderStudioFrames(root: string, out: string): void {
  kardix(root, out, '--no-art');
  const brief = readBrief(root)!;
  const data = JSON.parse(readFileSync(join(root, 'set.json'), 'utf8')) as {
    families?: Record<string, { frameChoice?: boolean }>; cards: { id: string; family: string }[];
  };
  const choosing = new Set([
    ...brief.pictures.filter((p) => p.frameChoice && p.card).map((p) => p.card!),
    ...data.cards.filter((c) => data.families?.[c.family]?.frameChoice).map((c) => c.id),
  ]);
  if (choosing.size === 0) return;
  const layout = readFileSync(join(GAME, 'card-layout.alex'), 'utf8');
  const colours = [...layout.matchAll(/^ {2}([\w-]+) = Frame \{/gm)].map((m) => m[1]).filter((f) => f !== 'Card');
  for (const colour of colours) kardix(root, join(out, `p-${colour}`), '--no-art', '--frame', colour, '--only', ...choosing);
}

function kardix(root: string, out: string, ...options: string[]): void {
  const r = spawnSync('dotnet', ['run', '--project', KARDIX, '-c', 'Release', '--', 'cards', '--project', GAME, '--set', basename(root),
    '--out', out, ...options], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`kardix couldn't render ${basename(root)}'s cards: ${(r.stderr || r.stdout).trim()}\n`
      + '(kardix needs the .NET SDK; see cardengine/kardix/Kardix.csproj.)');
  }
}
