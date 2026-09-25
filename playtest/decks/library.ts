// The deck library: custom decks a playtest can name by a short key (`--deck pepper-swarm`), kept in
// library.json next to this file. Decks come from deck hunts that beat the starters, from the LLM deck
// builder, and from players' deck codes pasted in. The file is bundled into runner.mjs, so PC2024 knows every
// deck that was in the library at the last deploy; a newer one travels as its deck code, which every command
// that takes a deck accepts too.
//
// Every deck is checked with the deck builder's own rules when it's read: a deck that a card change made
// illegal is left out (and `decks list` says why), rather than playing a deck no player could build.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARDS, DECKS, deckCode, deckProblems, parseDeckCode, prototypeDecks, resolveDeck, type DeckList } from '../lib/engine';
import library from './library.json';

export type DeckSource = 'hunt' | 'built' | 'imported' | 'generated';

export interface LibraryDeck extends DeckList {
  /** Where it came from: a deck hunt, the LLM deck builder, a pasted deck code or file, a generated deck. */
  source: DeckSource;
  /** One sentence: the idea behind it, or what it was built for. */
  about: string;
  /** For a built deck, what it was asked to be ("an aggressive Pepper deck"). */
  goal?: string;
  /** Its bot win rate against the starter decks when it was added. */
  vsStarters?: number;
  /** The run it came from, or the model that built it. */
  from?: string;
  addedAt: string;
}

const FILE = () => fileURLToPath(new URL('./library.json', import.meta.url));

/** Every deck in the library, legal or not, by key: the file on disk in a checkout, the bundled copy in runner.mjs. */
function allDecks(): Record<string, LibraryDeck> {
  try {
    if (existsSync(FILE())) return (JSON.parse(readFileSync(FILE(), 'utf8')) as { decks: Record<string, LibraryDeck> }).decks;
  } catch { /* the bundled copy below */ }
  return (library as unknown as { decks: Record<string, LibraryDeck> }).decks;
}

/** The library's decks that the rules allow today, by key. */
export function libraryDecks(): Record<string, LibraryDeck> {
  return Object.fromEntries(Object.entries(allDecks()).filter(([, d]) => deckProblems(d).length === 0));
}

/** Library decks the rules no longer allow, with the first reason. */
export function brokenLibraryDecks(): { key: string; name: string; problem: string }[] {
  return Object.entries(allDecks()).flatMap(([key, d]) => {
    const p = deckProblems(d);
    return p.length ? [{ key, name: d.name, problem: p[0] }] : [];
  });
}

/** A key from a deck's name: lowercase words joined by dashes, made unique in the library. */
export function libraryKey(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'deck';
  const taken = new Set([...Object.keys(allDecks()), ...Object.keys(DECKS), ...Object.keys(prototypeDecks())]);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  return key;
}

/** The library's key for a deck with exactly these cards and Hero Cat, if it has one. */
export function findInLibrary(deck: DeckList): string | undefined {
  const same = (a: DeckList) => deckCode({ ...a, name: '' }) === deckCode({ ...deck, name: '' });
  return Object.entries(allDecks()).find(([, d]) => same(d))?.[0];
}

/** Whether library.json is here to write to: a checkout, not the bundled runner on PC2024. */
export const canSaveLibrary = (): boolean => existsSync(FILE());

/** Adds a deck to library.json (in a checkout; commit it and deploy to send it to PC2024). Returns its key. */
export function saveToLibrary(entry: Omit<LibraryDeck, 'addedAt'> & { addedAt?: string }, key?: string): string {
  if (!canSaveLibrary()) throw new Error('The deck library can only be changed in a checkout (playtest/decks/library.json).');
  const problems = deckProblems(entry);
  if (problems.length) throw new Error(`${entry.name} breaks the deckbuilding rules: ${problems.join(' ')}`);
  const existing = findInLibrary(entry);
  if (existing && !key) return existing;
  const decks = allDecks();
  const k = key ?? libraryKey(entry.name);
  const cards = Object.fromEntries(Object.entries(entry.cards).filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b)));
  decks[k] = { ...entry, cards, addedAt: entry.addedAt ?? new Date().toISOString() };
  writeFileSync(FILE(), `${JSON.stringify({ decks }, null, 2)}\n`);
  return k;
}

export function removeFromLibrary(key: string): boolean {
  const decks = allDecks();
  if (!decks[key]) return false;
  delete decks[key];
  writeFileSync(FILE(), `${JSON.stringify({ decks }, null, 2)}\n`);
  return true;
}

/** A plain DeckList (no library fields), so reports and games carry only what a deck is. */
const plain = (d: DeckList): DeckList => ({ name: d.name, hero: d.hero, cards: { ...d.cards } });

/**
 * Any way of naming a deck, as a DeckList: a starter's key, a prototype set's deck key (five-alarm), a library
 * key, a deck code (FC1.…) or a JSON file with a DeckList. Throws, saying why, when it's none of them or the
 * deck breaks the rules.
 */
export function loadDeck(spec: string): DeckList {
  if (DECKS[spec]) return resolveDeck(spec);
  const prototype = prototypeDecks()[spec];
  if (prototype) return prototype;
  const all = allDecks();
  if (all[spec]) {
    const problems = deckProblems(all[spec]);
    if (problems.length) throw new Error(`Library deck ${spec} no longer follows the deckbuilding rules: ${problems.join(' ')}`);
    return plain(all[spec]);
  }
  const fromCode = parseDeckCode(spec);
  const deck = fromCode ?? (existsSync(spec) ? JSON.parse(readFileSync(spec, 'utf8')) as DeckList : null);
  if (!deck) throw new Error(`No deck "${spec}": not a starter (${Object.keys(DECKS).join(', ')}), a prototype deck, a library deck (npm run decks -- list), a deck code or a file.`);
  const problems = deckProblems(deck);
  if (problems.length) throw new Error(`${deck.name}: ${problems.join(' ')}`);
  // A code for a library deck plays under the library's name.
  const key = fromCode ? findInLibrary(deck) : undefined;
  return plain(key ? { ...deck, name: all[key].name } : deck);
}

/** Several decks: a comma-separated list of specs, `starters` for every starter deck, `library` for every library deck. */
export function loadDecks(specs: string): DeckList[] {
  return specs.split(',').filter(Boolean).flatMap((s) => {
    if (s === 'starters') return Object.keys(DECKS).map((k) => resolveDeck(k));
    if (s === 'library') return Object.values(libraryDecks()).map(plain);
    return [loadDeck(s)];
  });
}

/** The family a deck's Hero Cat leads, and the one other family it uses (if any). */
export function deckFamilies(deck: DeckList): string[] {
  const hero = CARDS[deck.hero]?.family;
  const others = new Set(Object.keys(deck.cards).map((id) => CARDS[id]?.family).filter((f) => f && f !== hero && f !== 'Garden'));
  return [hero, ...others].filter(Boolean) as string[];
}
