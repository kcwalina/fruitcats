// publish-pack: put a card set on the pack storage, where running games take it at their next start,
// without deploying the game (docs/card-data-architecture.md, Card packs).
//
//   npm run publish-pack -- heat-wave            # by folder name or code (hw1)
//   npm run publish-pack -- hw1 --dry-run        # check and list what would be uploaded
//
// It runs check-set first and stops on any error. Released sets are taken by every game; prototypes only
// with ?prototypes in the address (playtesters). A set whose cards need plugin code the deployed game
// doesn't have is skipped by games until a game build brings the plugin.
//
// Storage: the fruitcatspacks account (ViaMochi Production, rg-fruitcats), container `packs`, public read.
// Uploads sign in as the Via Mochi deploy identity (~/.azure-viamochi-deploy), never your own Azure login.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks } from './check-set';

const ACCOUNT = 'fruitcatspacks';
const CONTAINER = 'packs';
const PUBLIC = `https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}`;
const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = process.env.FRUITCATS_PACKS_AZURE_CONFIG_DIR ?? join(homedir(), '.azure-viamochi-deploy');

interface PackEntry { set: string; name: string; version?: string; status?: string; data: string; art: string; cards: string; published: string }

function az(args: string[]): string {
  const env = { ...process.env, AZURE_CONFIG_DIR: CONFIG_DIR, MSYS_NO_PATHCONV: '1' };
  const cmd = process.platform === 'win32' ? 'az.cmd' : 'az';
  return execFileSync(cmd, args, { env, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Upload a folder under a path in the container. Art rarely changes once published, so it may be cached for a day. */
function uploadDir(source: string, destinationPath: string, cache: string): void {
  az(['storage', 'blob', 'upload-batch', '--account-name', ACCOUNT, '--destination', CONTAINER, '--destination-path', destinationPath,
    '--source', source, '--auth-mode', 'login', '--overwrite', '--content-cache-control', `"${cache}"`, '--only-show-errors', '--output', 'none']);
}

function uploadFile(file: string, name: string, contentType: string): void {
  az(['storage', 'blob', 'upload', '--account-name', ACCOUNT, '--container-name', CONTAINER, '--name', name, '--file', file,
    '--auth-mode', 'login', '--overwrite', '--content-type', contentType, '--content-cache-control', '"no-cache"', '--only-show-errors', '--output', 'none']);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const which = args.find((a) => !a.startsWith('--'));
  if (!which) throw new Error('Name the set to publish: npm run publish-pack -- heat-wave');

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
  const entry: PackEntry = {
    set: set.data.set, name: set.data.name, version: set.data.version, status: set.data.status,
    data: `${code}/set.json`, art: `${code}/art/illustrations/`, cards: `${code}/art/cards/`,
    published: new Date().toISOString(),
  };
  const current = await fetch(`${PUBLIC}/index.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { packs: [] })).catch(() => ({ packs: [] })) as { packs: PackEntry[] };
  const index = { packs: [...current.packs.filter((p) => p.set !== entry.set), entry] };

  // Games that have a set built in take its pack only if the pack's version is higher: a changed set needs a new version.
  const before = current.packs.find((p) => p.set === entry.set);
  if (before && before.version === entry.version) {
    const published = await fetch(`${PUBLIC}/${entry.data}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    if (published && published !== JSON.stringify(set.data))
      console.log(`  ! The data changed but the version is still ${entry.version}. Games that have ${set.data.name} built in won't take it: bump "version" in set.json.`);
  }

  console.log(`  → ${PUBLIC}/${entry.data}, ${entry.art}, ${entry.cards}, index.json (${index.packs.length} pack(s))`);
  if (dry) return;
  if (!existsSync(CONFIG_DIR)) throw new Error(`No Azure sign-in at ${CONFIG_DIR} (the Via Mochi deploy identity).`);

  const temp = mkdtempSync(join(tmpdir(), 'fruitcats-pack-'));
  writeFileSync(join(temp, 'set.json'), JSON.stringify(set.data));
  writeFileSync(join(temp, 'index.json'), JSON.stringify(index, null, 1));
  uploadDir(join(root, 'art', 'illustrations'), `${code}/art/illustrations`, 'public, max-age=86400');
  uploadDir(join(root, 'art', 'cards'), `${code}/art/cards`, 'public, max-age=86400');
  uploadFile(join(temp, 'set.json'), entry.data, 'application/json');
  // The index last: a game never sees a pack whose data and art aren't up yet.
  uploadFile(join(temp, 'index.json'), 'index.json', 'application/json');
  console.log(`  ✓ published. Games take it at their next start${entry.status === 'released' ? '' : ' (with ?prototypes: it is a prototype)'}.`);
}

main().catch((e) => {
  console.error(`publish-pack: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
