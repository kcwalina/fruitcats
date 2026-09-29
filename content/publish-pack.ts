// publish-pack: put a card set on the pack storage, where running games take it at their next start,
// without deploying the game (docs/card-data-architecture.md, Card packs).
//
//   npm run publish-pack -- berry-picnic         # by folder name or code (bp1)
//   npm run publish-pack -- bp1 --dry-run        # check and list what would be uploaded
//   npm run publish-pack -- hw1 --unpublish      # take a set out of the index (by code): games stop loading it
//
// It runs check-set first and stops on any error. Released sets are taken by every game; prototypes only
// with ?prototypes in the address (playtesters). A set whose cards need plugin code the deployed game
// doesn't have is skipped by games until a game build brings the plugin.
//
// Safe from any branch, at any time: art and data go to addresses named by their fingerprint, so no publish replaces
// what another checkout or the live site uses (content/pack-storage.ts). A build finds its own art there. Only the
// index, what running games take, waits for the set to be on origin/main: from a branch, the art goes up and the
// index is left alone.
//
// Storage: the fruitcatspacks account (ViaMochi Production, rg-fruitcats), container `packs`, public read.
// Uploads sign in as the Via Mochi deploy identity (~/.azure-viamochi-deploy), never your own Azure login.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artHash } from './art-hash';
import { pictureFolders, renderCards, renderedByTcg } from './tcg';
import { runChecks } from './check-set';
import { PACKS_URL, artPaths, artPublished, dataPath, differsFrom, updateIndex, withEntry, type IndexStore, type PackEntry, type PackIndex } from './pack-storage';

const ACCOUNT = 'fruitcatspacks';
const CONTAINER = 'packs';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CONFIG_DIR = process.env.FRUITCATS_PACKS_AZURE_CONFIG_DIR ?? join(homedir(), '.azure-viamochi-deploy');
/** What sits at a fingerprinted address never changes, so it may be kept for good. */
const FOREVER = 'public, max-age=31536000, immutable';

function az(args: string[]): string {
  const env = { ...process.env, AZURE_CONFIG_DIR: CONFIG_DIR, MSYS_NO_PATHCONV: '1' };
  const cmd = process.platform === 'win32' ? 'az.cmd' : 'az';
  return execFileSync(cmd, args, { env, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Upload a folder under a path in the container. */
function uploadDir(source: string, destinationPath: string, cache: string): void {
  az(['storage', 'blob', 'upload-batch', '--account-name', ACCOUNT, '--destination', CONTAINER, '--destination-path', destinationPath,
    '--source', source, '--auth-mode', 'login', '--overwrite', '--content-cache-control', `"${cache}"`, '--only-show-errors', '--output', 'none']);
}

function uploadFile(file: string, name: string, contentType: string, cache: string, condition: string[] = []): void {
  az(['storage', 'blob', 'upload', '--account-name', ACCOUNT, '--container-name', CONTAINER, '--name', name, '--file', file,
    '--auth-mode', 'login', '--overwrite', '--content-type', contentType, '--content-cache-control', `"${cache}"`, ...condition,
    '--only-show-errors', '--output', 'none']);
}

/** index.json on the storage: read over the public address with its ETag, written only over that ETag. */
function storageIndex(temp: string): IndexStore {
  return {
    async read() {
      const r = await fetch(`${PACKS_URL}index.json`, { cache: 'no-store' });
      if (r.status === 404) return null;
      const etag = r.headers.get('etag');
      if (!r.ok || !etag) throw new Error(`Couldn't read ${PACKS_URL}index.json (HTTP ${r.status}).`);
      return { index: await r.json() as PackIndex, etag };
    },
    async write(index, etag) {
      writeFileSync(join(temp, 'index.json'), JSON.stringify(index, null, 1));
      try {
        uploadFile(join(temp, 'index.json'), 'index.json', 'application/json', 'no-cache', etag ? ['--if-match', `"${etag.replace(/"/g, '\\"')}"`] : ['--if-none-match', '"*"']);
        return true;
      } catch (e) {
        // Someone wrote the index since it was read: read it again.
        const text = `${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message}`;
        if (/ConditionNotMet|BlobAlreadyExists|\b412\b|\b409\b/.test(text)) return false;
        throw e;
      }
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const which = args.find((a) => !a.startsWith('--'));
  if (!which) throw new Error('Name the set to publish: npm run publish-pack -- berry-picnic');
  if (args.includes('--unpublish')) return unpublish(which.toUpperCase(), dry);

  const [{ set, report }] = runChecks(which);
  const code = set.data.set.toLowerCase();
  console.log(`${set.data.name} (${set.data.set} ${set.data.version ?? ''}, ${set.data.status}) from content/${set.folder}`);
  for (const w of report.warnings) console.log(`  ! ${w}`);
  if (report.errors.length) {
    for (const e of report.errors) console.log(`  ✗ ${e}`);
    throw new Error('check-set failed: fix the set before publishing it.');
  }
  if (set.plugin) console.log(`  · It has a plugin (${set.plugin.id}): games take the pack only if they were built with it.`);

  const root = join(HERE, set.folder);
  const hash = artHash(root);
  const paths = hash ? artPaths(code, hash) : null;
  const artUp = hash ? await artPublished(PACKS_URL, code, hash) : true;
  const json = JSON.stringify(set.data);
  const data = dataPath(code, json);

  // The index only from origin/main: running games take what it lists, and what players get is always main.
  spawnSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: REPO, stdio: 'ignore' });
  const offMain = differsFrom(REPO, `content/${set.folder}`);

  if (paths) console.log(artUp ? `  · The art is already on the storage: ${PACKS_URL}${paths.dir}` : `  → art to ${PACKS_URL}${paths.dir}`);
  console.log(`  → data to ${PACKS_URL}${data}`);
  console.log(offMain
    ? `  · index.json left alone: this set isn't what origin/main has (${offMain}). A build of this checkout finds its art; `
      + 'running games get the set once it is on main (npm run deploy) and published from there.'
    : '  → index.json');
  if (dry) return;
  if (!existsSync(CONFIG_DIR)) throw new Error(`No Azure sign-in at ${CONFIG_DIR} (the Via Mochi deploy identity).`);

  const temp = mkdtempSync(join(tmpdir(), 'fruitcats-pack-'));
  const published = new Date().toISOString();
  if (paths && !artUp) {
    // A set tcg renders has no finished cards in the repository: they're made here, from its sources, into a
    // fresh folder, and uploaded from there (content/tcg.ts).
    let cards = join(root, 'art', 'cards');
    if (renderedByTcg(root)) {
      cards = join(temp, 'cards');
      console.log('  · rendering the cards with tcg');
      renderCards(root, cards);
    }
    for (const dir of pictureFolders(root)) if (existsSync(dir)) uploadDir(dir, paths.art.slice(0, -1), FOREVER);
    if (existsSync(cards)) uploadDir(cards, paths.cards.slice(0, -1), FOREVER);
    // The marker after the art: a build ships only when the storage has all the art it was built for (vite.config.ts).
    writeFileSync(join(temp, 'art.json'), JSON.stringify({ hash, published }));
    uploadFile(join(temp, 'art.json'), paths.marker, 'application/json', 'no-cache');
  }
  writeFileSync(join(temp, 'set.json'), json);
  uploadFile(join(temp, 'set.json'), data, 'application/json', FOREVER);
  if (offMain) { console.log('  ✓ art and data published (not in the index).'); return; }

  const entry: PackEntry = {
    set: set.data.set, name: set.data.name, version: set.data.version, status: set.data.status,
    data, art: paths?.art ?? `${code}/art/illustrations/`, cards: paths?.cards ?? `${code}/art/cards/`, published,
  };
  // The index last: a game never sees a pack whose data and art aren't up yet.
  const index = await updateIndex(storageIndex(temp), (current) => {
    // Games that have a set built in take its pack only if the pack's version is higher: a changed set needs a new version.
    const before = current.packs.find((p) => p.set === entry.set);
    if (before && before.version === entry.version && before.data !== entry.data)
      console.log(`  ! The data changed but the version is still ${entry.version}. Games that have ${set.data.name} built in won't take it: bump "version" in set.json.`);
    return withEntry(current, entry);
  });
  console.log(`  ✓ published, index.json has ${index.packs.length} pack(s). Games take it at their next start${entry.status === 'released' ? '' : ' (with ?prototypes: it is a prototype)'}.`);
}

/**
 * Take a set out of the index, for a set that was deleted from content/: games stop loading it at their next start.
 * Its files stay on the storage (nothing lists them any more), so this can be undone by publishing the set again.
 */
async function unpublish(code: string, dry: boolean): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'fruitcats-pack-'));
  const store = storageIndex(temp);
  const current = await store.read();
  if (!current?.index.packs.some((p) => p.set === code)) { console.log(`${code} isn't in the index: nothing to do.`); return; }
  console.log(`  → index.json without ${code}`);
  if (dry) return;
  if (!existsSync(CONFIG_DIR)) throw new Error(`No Azure sign-in at ${CONFIG_DIR} (the Via Mochi deploy identity).`);
  const index = await updateIndex(store, (i) => ({ packs: i.packs.filter((p) => p.set !== code) }));
  console.log(`  ✓ ${code} unpublished (${index.packs.length} pack(s) left). Games stop loading it at their next start.`);
}

main().catch((e) => {
  console.error(`publish-pack: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
