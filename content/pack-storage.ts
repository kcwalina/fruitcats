// Where a set's files live on the pack storage, and the rules that let many sessions publish to it at once.
//
// Art and data are content-addressed: a set's art goes under a folder named by its fingerprint
// (<set>/art/<fingerprint>/illustrations/, cards/ and art.json), its data under <set>/data/<fingerprint>.json.
// Nothing there is ever overwritten with different bytes, so publishing from a branch can't replace the art
// another branch (or the live site) uses: every version stays, and each build points at its own
// (apps/web/vite.config.ts). On 2026-09-27 the art had one address per set; sessions publishing from their own
// branches kept replacing each other's, and every deploy's build refused until it republished, 3–4 rounds running.
//
// The one file that changes is index.json, the list running games take packs from. It is written only from a set
// that matches origin/main (the live site is always exactly origin/main), and only if nobody wrote it since it was
// read (its ETag), so two sessions publishing different sets at once can't drop each other's entry.
//
// Before 2026-09-27 art lived at <set>/art/illustrations/, <set>/art/cards/ and <set>/art.json. Those files stay as
// they are, for games built before then; nothing writes them any more.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** The pack storage's public address. */
export const PACKS_URL = 'https://fruitcatspacks.blob.core.windows.net/packs/';

/** A fingerprint as it appears in an address: short, and still far from ever meeting another. */
export const addressOf = (fingerprint: string) => fingerprint.slice(0, 16);

/**
 * Where a set's art with this fingerprint lives, relative to the storage. `project`: a Studio project's folder (the
 * set's Alex files and paintings, as in games/folkborn/). `marker` is written last, when all of it is up.
 */
export function artPaths(code: string, hash: string): { dir: string; art: string; cards: string; project: string; marker: string } {
  const dir = `${code}/art/${addressOf(hash)}/`;
  return { dir, art: `${dir}illustrations/`, cards: `${dir}cards/`, project: `${dir}project/`, marker: `${dir}art.json` };
}

/** Where this exact set data lives, relative to the storage. */
export function dataPath(code: string, json: string): string {
  return `${code}/data/${addressOf(createHash('sha256').update(json).digest('hex'))}.json`;
}

/**
 * Whether the storage has all of this art: its marker, written after every file, names this fingerprint.
 * A failed read counts as not there; the build says so and names the command that publishes it.
 */
export async function artPublished(packs: string, code: string, hash: string, get: typeof fetch = fetch): Promise<boolean> {
  const marker = await get(`${packs}${artPaths(code, hash).marker}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<{ hash?: string }>) : null)).catch(() => null);
  return marker?.hash === hash;
}

export interface PackEntry { set: string; name: string; version?: string; status?: string; data: string; art: string; cards: string; published: string }
export interface PackIndex { packs: PackEntry[] }

/** The index with this set's entry in place of its old one; every other set's entry kept as it was. */
export const withEntry = (index: PackIndex, entry: PackEntry): PackIndex =>
  ({ packs: [...index.packs.filter((p) => p.set !== entry.set), entry] });

/** The index file, read with its version and written only over that version. */
export interface IndexStore {
  /** The index and its ETag; null when there's no index yet. */
  read(): Promise<{ index: PackIndex; etag: string } | null>;
  /** Write the index if it is still at `etag` (null: if there is none yet). False when someone wrote it meanwhile. */
  write(index: PackIndex, etag: string | null): Promise<boolean>;
}

/**
 * Change the index without losing a write made meanwhile: read it, change it, write it only over what was read,
 * and start again from a fresh read when someone else got there first.
 */
export async function updateIndex(store: IndexStore, change: (index: PackIndex) => PackIndex, attempts = 5): Promise<PackIndex> {
  for (let i = 0; i < attempts; i++) {
    const current = await store.read();
    const next = change(current?.index ?? { packs: [] });
    if (await store.write(next, current?.etag ?? null)) return next;
  }
  throw new Error(`index.json kept changing under this write (${attempts} tries). Run the command again.`);
}

/**
 * Why a set's folder isn't exactly what `ref` (origin/main) has, or null when it is: a changed, staged or new file
 * under it. Only such a set may go into the index, where running games take it: what players get is always main.
 */
export function differsFrom(repo: string, folder: string, ref = 'origin/main'): string | null {
  const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status !== 0) return `there is no ${ref} here`;
  const changed = git(['diff', '--name-only', ref, '--', folder]);
  if (changed.status !== 0) return `git diff failed: ${changed.stderr.trim()}`;
  const extra = git(['ls-files', '--others', '--exclude-standard', '--', folder]);
  const files = [...changed.stdout.split('\n'), ...extra.stdout.split('\n')].filter(Boolean);
  return files.length ? `${files.length} file(s) differ from ${ref}, e.g. ${files[0]}` : null;
}
