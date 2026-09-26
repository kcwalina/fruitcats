// decks list | show KEY | code KEY
// decks add (--code FC1.… | --file deck.json) [--name …] [--about …] [--key KEY]
// decks remove KEY
// decks import [--pc2024 http://192.168.1.74:5280] [--min 0.55] [--dry-run]
// decks nightly [--pc2024 URL] [--publish] [--commit]   (nightly.ts: one K3 deck, results, retention)
// decks prune [--dry-run] | decks pin KEY | decks unpin KEY
//
// The deck library (library.ts): the custom decks playtests can name by key. `add` takes a deck code (the
// game's deck builder copies one; so do the reports) or a DeckList file. `import` collects the decks that
// earned a place from deck hunts (at least --min against the starters) and deck builds (the LLM's pick),
// from this checkout's reports and, with --pc2024, the runs on PC2024. Commit library.json and deploy to
// send the library to PC2024; until then a deck travels as its code.

import { arg, flag, numArg, textArg } from '../lib/args';
import { CARDS, cardName, deckCode, parseDeckCode, type DeckList } from '../lib/engine';
import { readFileSync } from 'node:fs';
import { pct } from '../lib/runs';
import { localSummaries, pc2024Summaries } from '../lib/pc2024';
import { brokenLibraryDecks, deckFamilies, findInLibrary, libraryDecks, readLibrary, removeFromLibrary, saveToLibrary, writeLibrary } from './library';
import { decksNightly, decksPrune } from './nightly';
import { averageRate } from './retention';
import { worthKeeping, type Found } from './found';

const cardsText = (d: DeckList) => Object.entries(d.cards).sort(([a], [b]) => a.localeCompare(b)).map(([id, q]) => `${q}× ${cardName(id)}`).join(', ');

const line = (f: Found) => `${f.name} (${f.source}${f.vsStarters !== undefined ? `, ${pct(f.vsStarters)} vs starters` : ''}) from ${f.from}`;

export async function decksCommand(): Promise<number> {
  const sub = process.argv[3] ?? 'list';
  const key = process.argv[4];
  if (sub === 'list') {
    const decks = Object.entries(libraryDecks());
    if (!decks.length) console.log('The deck library is empty. Add decks with: decks add --code FC1.…, or decks import');
    for (const [k, d] of decks) {
      const rate = averageRate(d);
      console.log(`${k.padEnd(28)} ${d.name} · ${cardName(d.hero)} (${deckFamilies(d).join(' + ')}) · ${d.source}${rate !== undefined ? ` · ${pct(rate)} vs starters` : ''}${d.stats?.llm ? ` · LLM won ${d.stats.llm.won}/${d.stats.llm.games}` : ''}${d.pinned ? ' · pinned' : ''}`);
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
  if (sub === 'nightly') return decksNightly();
  if (sub === 'prune') return decksPrune();
  if (sub === 'pin' || sub === 'unpin') {
    const file = readLibrary();
    if (!file.decks[key]) { console.error(`No library deck ${key}.`); return 1; }
    if (sub === 'pin') file.decks[key].pinned = true; else delete file.decks[key].pinned;
    writeLibrary(file);
    console.log(`${key} ${sub === 'pin' ? 'is pinned: retention never removes it' : 'is no longer pinned'}.`);
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
