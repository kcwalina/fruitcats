// The printed cards: each released set's cards as Alex (content/<y>/<m>/<set>/<set>.alex), which tcg renders
// into art/cards/ (cardengine/tcg: tcg cards --project content --out art/cards). Until the engine reads Alex, the
// game still reads set.json, so the two must say the same thing; check-set compares them on every deploy.
//
// This reads only what those files hold: cards with name, epithet, cost, power, health, rarity, number, text and
// flavor, a Hero's back, and text tables. It is not an Alex parser; the TypeScript Alex will replace it.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CardDef, SetData } from '../packages/engine/src/index';

export interface PrintedFace { name: string; text: string; flavor: string; cost?: number; power?: number; health?: number; rarity?: string }
export interface PrintedCard extends PrintedFace { number: string; back?: PrintedFace }

const PAIR = /([a-z][a-z-]*) = ('(?:[^']|'')*'|@[\w-]+|-?\d+|[\w-]+)/g;

function value(raw: string, texts: Map<string, string>): string | number {
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  if (raw.startsWith('@')) return texts.get(raw.slice(1)) ?? raw;
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

/** The cards in a set's .alex file, by number; undefined when the set has none. */
export function printedCards(folder: string): Map<string, PrintedCard> | undefined {
  const file = join(folder, `${basename(folder)}.alex`);
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n');
  const texts = new Map<string, string>();
  const table = lines.indexOf(lines.find((l) => l.startsWith('@@@ ')) ?? '\u0000');
  if (table >= 0) {
    let name: string | undefined;
    let body: string[] = [];
    for (const line of lines.slice(table)) {
      if (line.startsWith('@@@')) {
        if (name) texts.set(name, body.join('\n'));
        name = line.slice(3).trim() || undefined;
        body = [];
      } else body.push(line);
    }
  }

  const cards = new Map<string, PrintedCard>();
  let card: Record<string, unknown> | undefined;
  let face: Record<string, unknown> | undefined;
  let inCards = false;
  for (const line of lines.slice(0, table >= 0 ? table : undefined)) {
    if (line === 'cards = [') { inCards = true; continue; }
    if (line === ']') { inCards = false; continue; }
    if (!inCards) continue;
    if (/^ {2}[\w-]+ = \w+ \{$/.test(line)) { card = {}; face = card; continue; }
    if (/^ {4}back = \w+ \{$/.test(line) && card) { face = {}; card.back = face; continue; }
    if (/^ {4}\}$/.test(line) && card) { face = card; continue; }
    if (/^ {2}\}$/.test(line) && card) {
      cards.set(String(card.number), card as unknown as PrintedCard);
      card = face = undefined;
      continue;
    }

    if (!face) continue;
    for (const m of line.matchAll(PAIR)) face[m[1]] = value(m[2], texts);
  }

  for (const c of cards.values()) {
    for (const f of [c, c.back].filter(Boolean) as PrintedFace[]) {
      const epithet = (f as unknown as { epithet?: string }).epithet;
      if (epithet) f.name = `${f.name}, ${epithet}`;
      f.text ??= '';
      f.flavor ??= '';
    }
  }

  return cards;
}

/** Where a set's printed cards (its .alex) and its set.json disagree, one line each. */
export function printedDifferences(folder: string, data: SetData, cards: CardDef[]): string[] {
  const printed = printedCards(folder);
  if (!printed) return [];
  const out: string[] = [];
  const file = `${basename(folder)}.alex`;
  const all = [...cards, ...((data.tokens ?? []) as CardDef[])];
  for (const c of all) {
    const p = printed.get(c.id);
    if (!p) { out.push(`${c.id} isn't in ${file}, so it has no printed card.`); continue; }
    const hero = c.type === 'Hero Cat';
    const front = hero ? (c as unknown as { kitten: PrintedFace }).kitten : (c as unknown as PrintedFace);
    const want: [string, unknown, unknown][] = [
      ['name', front.name, p.name],
      ['text', front.text ?? '', p.text],
      ['flavor', c.flavor ?? '', p.flavor],
      ['rarity', c.rarity?.toLowerCase(), p.rarity],
    ];
    if (!hero) want.push(['cost', c.cost ?? 0, p.cost], ['power', c.power, p.power], ['health', c.health, p.health]);
    if (hero) {
      const back = (c as unknown as { bigCat: PrintedFace }).bigCat;
      want.push(['Awakened name', back.name, p.back?.name], ['Awakened text', back.text ?? '', p.back?.text],
        ['Awakened power', back.power, p.back?.power]);
    }

    for (const [what, json, alex] of want) {
      if (json !== alex) out.push(`${c.id}: its ${what} is ${JSON.stringify(json)} in set.json but ${JSON.stringify(alex)} in ${file}. Change both, then tcg cards.`);
    }
  }

  for (const number of printed.keys()) {
    if (!all.some((c) => c.id === number)) out.push(`${file} prints ${number}, which isn't a card in set.json.`);
  }

  return out;
}
