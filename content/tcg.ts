// Sets whose finished cards tcg renders (cardengine/tcg). Such a set has its cards in Alex beside its set.json
// (content/<y>/<m>/<set>/<set>.alex), and its finished cards are build output, never committed: tcg makes them
// from the sources, so what's published can only be what the sources say.
//
// The sources of a set's cards: its .alex file and paintings (art/illustrations/), the game's own Alex files
// (content/*.alex: the game and its card layout), its frames and icons (content/art/), and tcg itself.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(CONTENT);
const TCG = join(REPO, 'cardengine', 'tcg');

/** Whether tcg renders the cards of the set in `root` (it has its cards in `<set>.alex`). */
export function renderedByTcg(root: string): boolean {
  return existsSync(join(root, `${basename(root)}.alex`));
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
 * Everything a tcg set's finished cards are made from, outside the set's own art/illustrations/: as
 * [a stable name, the file's path]: the set's own .alex by its file name, the rest relative to the repository.
 */
export function cardSources(root: string): [string, string][] {
  const shared = [
    ...readdirSync(CONTENT).filter((f) => f.endsWith('.alex')).map((f) => join(CONTENT, f)),
    ...walk(join(CONTENT, 'art')),
    ...walk(TCG, (f) => /\.(cs|csproj)$/.test(f)),
    join(REPO, 'cardengine', 'framework', 'core.alex'),
  ];
  const own = `${basename(root)}.alex`;
  return [[own, join(root, own)], ...shared.sort().map((f): [string, string] => [relative(REPO, f).replace(/\\/g, '/'), f])];
}

/** Text a checkout may store with either line ending; its fingerprint mustn't depend on which. */
export const isText = (file: string) => /\.(alex|cs|csproj|json|md)$/.test(file);

/**
 * Renders the finished cards of the set in `root` into `out` (card faces there; finishes in subfolders), with a
 * fresh build of tcg. Throws with tcg's own message when it fails.
 */
export function renderCards(root: string, out: string): void {
  const r = spawnSync('dotnet', ['run', '--project', TCG, '-c', 'Release', '--', 'cards', '--project', CONTENT, '--set', basename(root),
    '--out', out], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`tcg couldn't render ${basename(root)}'s cards: ${(r.stderr || r.stdout).trim()}\n`
      + '(tcg needs the .NET SDK and the C# Alex; see cardengine/tcg/Tcg.csproj.)');
  }
}
