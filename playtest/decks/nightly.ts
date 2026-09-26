// decks nightly [--here] [--pc2024 http://192.168.1.74:5280] [--commit] [--force] [--no-build]
// decks prune [--dry-run]
//
// The deck library's night. PC2024's playtester runs it every evening at 22:00, before the midnight run, as
// `decks nightly --here` (docs/playtests.md), with the Fireworks key the API hands it for this run:
//   0. --here: the published library becomes tonight's working copy, and the decks deck builds and deck hunts
//      found since (this machine's reports) join it, as `decks import` does.
//   1. Kimi K3 builds one new deck, for a goal that rotates (the strongest deck for a Hero Cat, an aggressive
//      deck, a two-family combo, a deck that beats a starter, a deck for a new player), around the Hero Cat the
//      library has fewest decks for; it stops at library.nightlyBuildMaxUsd.
//   2. The LLM playtest results played with library decks since the last night are added to their stats: this
//      machine's reports, or with --pc2024 (from the laptop) PC2024's.
//   3. Every library deck plays the starters in bot games with tonight's cards.
//   4. The retention policy (retention.ts) removes what the library doesn't need.
//   5. With --here, PC2024's playtester sends the working copy to the API, which keeps it as the published library
//      every runner takes when it starts. From a checkout instead, --commit commits library.json and pushes it (on
//      main, and only if it had no other changes); it reaches runners with the next deploy.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from '../playtest.config.json';
import { arg, flag } from '../lib/args';
import { CARDS, DECKS, resolveDeck } from '../lib/engine';
import { pct, type RunSummary } from '../lib/runs';
import { playableHeroes } from '../balance/decks';
import { runDeckBuild } from '../llm/builder';
import { getProvider } from '../llm/providers';
import { localSummaries, pc2024Summaries } from '../lib/pc2024';
import { adoptPublishedLibrary, findInLibrary, readLibrary, saveToLibrary, writeLibrary } from './library';
import { worthKeeping } from './found';
import { measureLibrary, recordLlmGames, retention, retentionConfig } from './retention';

const today = () => new Date().toISOString().slice(0, 10);
const dayNumber = () => Math.floor(Date.now() / 86400e3);
const cfg = () => (config as unknown as { library: { nightlyBuildProvider: string; nightlyBuildMaxUsd: number } }).library;

/** Tonight's goal: around the Hero Cat the library has fewest decks for, with a theme that rotates by day. */
export function nightlyGoal(): { goal: string; hero: string; vs: string } {
  const file = readLibrary();
  const heroes = playableHeroes();
  const count = (h: string) => Object.values(file.decks).filter((d) => d.hero === h).length;
  const fewest = Math.min(...heroes.map(count));
  const candidates = heroes.filter((h) => count(h) === fewest);
  const hero = candidates[dayNumber() % candidates.length];
  const name = CARDS[hero].name.split(',')[0];
  const family = CARDS[hero].family;
  const starters = Object.entries(DECKS).filter(([, d]) => CARDS[d.hero].family !== family);
  const [starterKey, starter] = starters[dayNumber() % starters.length] ?? Object.entries(DECKS)[0];
  const themes = [
    { goal: `the strongest deck you can build around ${name}`, vs: 'starters' },
    { goal: `an aggressive ${family} deck led by ${name} that wins fast`, vs: 'starters' },
    { goal: `a ${family} deck led by ${name} with a partner family that makes a real combo`, vs: 'starters' },
    { goal: `a ${name} deck that beats ${starter.name}`, vs: starterKey },
    { goal: `a fun, simple ${family} deck led by ${name} for a new player`, vs: 'starters' },
  ];
  return { ...themes[dayNumber() % themes.length], hero };
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const LIBRARY_PATH = 'playtest/decks/library.json';

export async function decksNightly(): Promise<number> {
  const out: string[] = [];
  const log = (s: string) => { out.push(s); console.log(s); };
  if (flag('here')) {
    log(`Tonight's library: ${adoptPublishedLibrary()}`);
    // 0. What deck builds and deck hunts found since, as `decks import` does on the laptop.
    for (const f of worthKeeping(localSummaries(['deck-hunt', 'deck-build']), 0.55)) {
      if (findInLibrary(f)) continue;
      try { log(`  added ${saveToLibrary(f)}: ${f.name} (${f.source}) from ${f.from}`); } catch (e) { log(`  skipped ${f.name}: ${(e as Error).message}`); }
    }
  }
  const start = readLibrary();
  if (start.lastNightly === today() && !flag('force')) { console.log(`The library's night already ran today (${today()}).`); return 0; }

  const commit = flag('commit');
  if (commit) {
    if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') throw new Error('--commit works on main only.');
    if (git(['status', '--porcelain', '--', LIBRARY_PATH])) throw new Error(`${LIBRARY_PATH} has uncommitted changes; not touching it.`);
    git(['pull', '--ff-only', '--quiet']);
  }

  // 1. One new deck.
  if (!flag('no-build')) {
    const g = nightlyGoal();
    log(`Building: ${g.goal} (Kimi K3, at most $${cfg().nightlyBuildMaxUsd.toFixed(2)})`);
    try {
      const run = await runDeckBuild({
        provider: getProvider(cfg().nightlyBuildProvider), goal: g.goal, hero: g.hero,
        opponents: g.vs === 'starters' ? Object.keys(DECKS).map((k) => resolveDeck(k)) : [resolveDeck(g.vs)],
        candidates: 3, rounds: 2, games: 40, maxUsd: cfg().nightlyBuildMaxUsd, save: true,
      });
      const pick = run.details.pick as { name: string; winRate: number } | null;
      log(pick ? `  added ${run.details.saved}: ${pick.name}, ${pct(pick.winRate)} in bot games, $${((run.details.costUsd as number) ?? 0).toFixed(2)} (${run.id})` : `  no deck (${run.id})`);
    } catch (e) { log(`  the build failed: ${(e as Error).message}`); }
  }

  const file = readLibrary();
  // 2. LLM games played with library decks, from the runs not counted before (by id: a long run can finish after a
  // later one): this machine's (PC2024's own, with --here), or PC2024's through catsitter.
  const pc = arg('pc2024');
  if (pc || flag('here')) {
    try {
      const counted = new Set(file.llmRunsCounted ?? []);
      const all = pc ? await pc2024Summaries(pc, ['llm-playtest']) : localSummaries(['llm-playtest']);
      const runs = all.filter((r: RunSummary) => !counted.has(r.id));
      const games = runs.reduce((n, r) => n + recordLlmGames(file, (r.details.byDeck ?? []) as { deck: string; games: number; won: number }[]), 0);
      file.llmRunsCounted = [...counted, ...runs.map((r) => r.id)].slice(-300);
      log(`LLM games with library decks, from ${runs.length} run(s) not counted before: ${games}`);
    } catch (e) { log(`PC2024 not reachable, no LLM results tonight: ${(e as Error).message}`); }
  }

  // 3. Tonight's bot games.
  const measured = await measureLibrary(file, today());
  log(`Bot games: ${measured.length} deck(s) against the starters, ${retentionConfig().gamesPerStarter} games each.`);

  // 4. Retention.
  const verdicts = retention(file);
  for (const v of verdicts.filter((x) => !x.keep)) { delete file.decks[v.key]; log(`  removed ${v.key}: ${v.why}`); }
  log(`Library: ${Object.keys(file.decks).length} deck(s) (cap ${retentionConfig().cap}).`);
  file.lastNightly = today();
  writeLibrary(file);

  // 5. Commit (the published copy is PC2024's to send: see --here).
  if (commit) {
    git(['add', '--', LIBRARY_PATH]);
    if (git(['status', '--porcelain', '--', LIBRARY_PATH])) {
      git(['commit', '--quiet', '-m', `Deck library, ${today()}: nightly deck build and retention\n\n${out.join('\n')}`, '--', LIBRARY_PATH]);
      try { git(['push', '--quiet']); log('Committed and pushed library.json.'); } catch (e) { log(`Committed; the push failed: ${(e as Error).message.split('\n')[0]}`); }
    }
  }
  return 0;
}

/** Shows (with --dry-run) or applies the retention policy now, without building or measuring. */
export function decksPrune(): number {
  const file = readLibrary();
  const verdicts = retention(file);
  for (const v of verdicts) console.log(`${v.keep ? 'keep  ' : 'REMOVE'} ${v.key.padEnd(28)} ${v.why}`);
  if (flag('dry-run')) return 0;
  const gone = verdicts.filter((v) => !v.keep);
  for (const v of gone) delete file.decks[v.key];
  if (gone.length) writeLibrary(file);
  console.log(`${gone.length} removed; ${Object.keys(file.decks).length} left.`);
  return 0;
}
