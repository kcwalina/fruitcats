// decks list | show KEY | code KEY
// decks add (--code FC1.… | --file deck.json) [--name …] [--about …] [--key KEY]
// decks remove KEY
// decks import [--pc2024 http://192.168.1.74:5280] [--min 0.55] [--dry-run]
//
// The deck library (library.ts): the custom decks playtests can name by key. `add` takes a deck code (the
// game's deck builder copies one; so do the reports) or a DeckList file. `import` collects the decks that
// earned a place from deck hunts (at least --min against the starters) and deck builds (the LLM's pick),
// from this checkout's reports and, with --pc2024, the runs on PC2024. Commit library.json and deploy to
// send the library to PC2024; until then a deck travels as its code.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag, numArg, textArg } from '../lib/args';
import { CARDS, cardName, deckCode, parseDeckCode, type DeckList } from '../lib/engine';
import { pct, reportsRoot, type RunSummary } from '../lib/runs';
import { pc2024Summaries } from '../dashboard/sync';
import { brokenLibraryDecks, deckFamilies, findInLibrary, libraryDecks, removeFromLibrary, saveToLibrary, type LibraryDeck } from './library';

const cardsText = (d: DeckList) => Object.entries(d.cards).sort(([a], [b]) => a.localeCompare(b)).map(([id, q]) => `${q}× ${cardName(id)}`).join(', ');

function localSummaries(kinds: string[]): RunSummary[] {
  const root = reportsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((id) => kinds.some((k) => id.startsWith(`${k}-`))).flatMap((id) => {
    const f = join(root, id, 'summary.json');
    return existsSync(f) ? [JSON.parse(readFileSync(f, 'utf8')) as RunSummary] : [];
  });
}

type Found = Omit<LibraryDeck, 'addedAt'>;

/** The decks worth keeping from deck hunts (those that beat the starters often enough) and deck builds (the pick). */
export function worthKeeping(runs: RunSummary[], min: number): Found[] {
  const found: Found[] = [];
  // A run with the fake provider (random answers, for trying the pipeline) never made a deck worth keeping.
  for (const r of runs.filter((x) => x.details.provider !== 'fake')) {
    if (r.kind === 'deck-hunt') {
      for (const d of (r.details.decks ?? []) as { name: string; idea: string; hero: string; cards: Record<string, number>; vsStarters: number }[]) {
        if (d.vsStarters < min) continue;
        found.push({ name: d.name.replace(/^hunt: /, ''), hero: d.hero, cards: d.cards, source: 'hunt', about: d.idea, vsStarters: d.vsStarters, from: r.id });
      }
    }
    if (r.kind === 'deck-build') {
      const p = r.details.pick as { name: string; idea: string; code: string; vsStarters?: number } | null;
      const deck = p ? parseDeckCode(p.code) : null;
      if (p && deck) {
        found.push({
          name: p.name, hero: deck.hero, cards: deck.cards, source: 'built', about: p.idea, goal: String(r.details.goal ?? ''),
          ...(p.vsStarters !== undefined ? { vsStarters: p.vsStarters } : {}), from: `${r.id} (${r.details.model})`,
        });
      }
    }
  }
  return found;
}

const line = (f: Found) => `${f.name} (${f.source}${f.vsStarters !== undefined ? `, ${pct(f.vsStarters)} vs starters` : ''}) from ${f.from}`;

export async function decksCommand(): Promise<number> {
  const sub = process.argv[3] ?? 'list';
  const key = process.argv[4];
  if (sub === 'list') {
    const decks = Object.entries(libraryDecks());
    if (!decks.length) console.log('The deck library is empty. Add decks with: decks add --code FC1.…, or decks import');
    for (const [k, d] of decks) {
      console.log(`${k.padEnd(28)} ${d.name} · ${cardName(d.hero)} (${deckFamilies(d).join(' + ')}) · ${d.source}${d.vsStarters !== undefined ? ` · ${pct(d.vsStarters)} vs starters` : ''}`);
    }
    for (const b of brokenLibraryDecks()) console.log(`${b.key.padEnd(28)} LEFT OUT: ${b.problem}`);
    return 0;
  }
  if (sub === 'show' || sub === 'code') {
    const d = libraryDecks()[key];
    if (!d) { console.error(`No library deck ${key}.`); return 1; }
    if (sub === 'code') { console.log(deckCode(d)); return 0; }
    console.log(`${d.name} (${key})\n${d.about}${d.goal ? `\nBuilt for: ${d.goal}` : ''}\nFrom: ${d.source}${d.from ? `, ${d.from}` : ''}, added ${d.addedAt.slice(0, 10)}`);
    console.log(`${cardName(d.hero)} (${CARDS[d.hero].family}): ${cardsText(d)}\n${deckCode(d)}`);
    return 0;
  }
  if (sub === 'add') {
    const code = arg('code'), file = arg('file');
    const deck = code ? parseDeckCode(code) : file ? JSON.parse(readFileSync(file, 'utf8')) as DeckList : null;
    if (!deck) { console.error('decks add --code FC1.… | --file deck.json [--name …] [--about …] [--key KEY]'); return 1; }
    const saved = saveToLibrary({ ...deck, name: textArg('name') ?? deck.name, source: 'imported', about: textArg('about') ?? 'A deck brought in by hand.' }, arg('key'));
    console.log(`Saved as ${saved}. Commit playtest/decks/library.json and deploy to send it to PC2024.`);
    return 0;
  }
  if (sub === 'remove') {
    if (!removeFromLibrary(key)) { console.error(`No library deck ${key}.`); return 1; }
    console.log(`Removed ${key}.`);
    return 0;
  }
  if (sub === 'import') {
    const kinds = ['deck-hunt', 'deck-build'];
    const runs = localSummaries(kinds);
    const pc = arg('pc2024');
    if (pc) {
      try { runs.push(...await pc2024Summaries(pc, kinds)); } catch (e) { console.error(`PC2024 not reachable (${(e as Error).message}); this checkout's reports only.`); }
    }
    const dry = flag('dry-run');
    let added = 0;
    for (const f of worthKeeping(runs, numArg('min') ?? 0.55)) {
      if (findInLibrary(f)) continue;
      if (dry) { console.log(`would add ${line(f)}`); added++; continue; }
      try {
        console.log(`added ${saveToLibrary(f)}: ${line(f)}`);
        added++;
      } catch (e) { console.log(`skipped ${f.name}: ${(e as Error).message}`); }
    }
    console.log(`${added} deck(s) ${dry ? 'to add' : 'added'} from ${runs.length} run(s).${added && !dry ? ' Commit playtest/decks/library.json and deploy to send them to PC2024.' : ''}`);
    return 0;
  }
  console.error('Usage: decks list | show KEY | code KEY | add --code … | remove KEY | import [--pc2024 URL]');
  return 1;
}
