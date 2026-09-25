// check-set: everything a card set must pass before it can be played, for a contributor (or the future
// Studio) who changes data, not code.
//
//   npm run check-set                      # every set
//   npm run check-set -- heat-wave         # one set, by folder name or code (hw1)
//   npm run check-set -- hw1 --games 40    # also play its decks against the released decks (bots)
//
// Errors (the set can't be played as it is) fail the check; warnings (worth a look) don't.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IN_ACTIONS, CARDS, CONDITION_TESTS, DECKS, MECHANICS, PLUGINS, TRIGGERS, apply, chooseAction, createGame, deckProblems, registerSet,
  type Ability, type CardDef, type Condition, type DeckList, type SetData, type TargetSel,
} from '../packages/engine/src/index';
import { CONTENT, loadContent, type ContentSet } from './index';
import { missingNumbers, suggestText } from './rules-text';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The vocabulary the engine understands (packages/engine/src/types.ts) ─────────────────────────────

const ACTIONS = BUILT_IN_ACTIONS;
const TESTS = CONDITION_TESTS;
const CORE_KEYWORDS = ['Zoomies', 'Guardian', 'Sneaky', 'Fierce', 'Lucky', 'Pounce'];
const ABILITY_KEYS = ['when', 'if', 'target', 'target2', 'do', 'instead', 'optional', 'optionalTarget', 'oncePerRound', 'pounceOnly', 'inline', 'static', 'log'];
const TYPES = ['Hero Cat', 'Cat', 'Critter', 'Trick', 'Toy'];
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary'];

// Stat budget (docs/starter-box-cards.md): a plain Critter of cost N has Power + Health = 2N + 1, and
// keywords and effects are paid for out of it. A report, not a rule: Cats get +2 to +3 on purpose.
const KEYWORD_PRICE: Record<string, number> = { Guardian: 1, Zoomies: 1, Sneaky: 2, Fierce: 2, Lucky: 0, Pounce: 0 };

interface Report { errors: string[]; warnings: string[]; notes: string[] }

function checkSet(set: ContentSet, games: number): Report {
  const r: Report = { errors: [], warnings: [], notes: [] };
  const data = set.data;
  const where = (c: { id: string }) => `${c.id} (${CARDS[c.id]?.name ?? c.id})`;
  const code = data.set;
  const cards: CardDef[] = [...data.cards, ...(data.tokens ?? []).map((t) => ({ ...t, token: true }))];

  // 1. Structure
  if (!code || !data.name) r.errors.push('set.json needs "set" (a code like HW1) and "name".');
  if (!['released', 'prototype'].includes(String(data.status))) r.errors.push(`"status" must be "released" or "prototype", not ${JSON.stringify(data.status)}.`);
  for (const req of data.requires ?? []) if (!CONTENT.some((c) => c.data.set === req)) r.errors.push(`It requires set ${req}, which isn't in content/.`);

  const ids = new Set<string>();
  for (const c of cards) {
    if (ids.has(c.id)) r.errors.push(`${c.id} appears twice.`);
    ids.add(c.id);
    if (!c.id.startsWith(`${code}-`)) r.errors.push(`${c.id}: card ids start with the set code (${code}-…).`);
    const other = CONTENT.find((s) => s !== set && [...s.data.cards, ...(s.data.tokens ?? [])].some((x) => x.id === c.id));
    if (other) r.errors.push(`${c.id} is also a card in ${other.data.name}.`);
    if (!TYPES.includes(c.type)) r.errors.push(`${where(c)}: type must be one of ${TYPES.join(', ')}.`);
    if (!c.token && !RARITIES.includes(String(c.rarity))) r.errors.push(`${where(c)}: rarity must be one of ${RARITIES.join(', ')}.`);
    if (c.type === 'Hero Cat' && c.rarity !== 'Legendary') r.errors.push(`${where(c)}: Hero Cats are Legendary.`);
    if (!c.family) r.errors.push(`${where(c)}: needs a family.`);
    else if (!knownFamily(c.family, data)) r.errors.push(`${where(c)}: family ${c.family} isn't defined by this set or one it requires.`);
    if (c.type !== 'Hero Cat' && !c.token && typeof c.cost !== 'number') r.errors.push(`${where(c)}: needs a cost.`);
    if ((c.type === 'Cat' || c.type === 'Critter') && (typeof c.power !== 'number' || typeof c.health !== 'number'))
      r.errors.push(`${where(c)}: a unit needs power and health.`);
    if (c.type === 'Hero Cat' && c.preview) {
      r.notes.push(`${where(c)} is a preview: shown, not playable, so its rules aren't checked.`);
    } else if (c.type === 'Hero Cat') {
      if (!c.kitten || !c.bigCat) r.errors.push(`${where(c)}: a Hero Cat needs a kitten and a bigCat face.`);
      else {
        if (!c.kitten.growUp) r.errors.push(`${where(c)}: its Kitten needs a growUp condition.`);
        else checkCondition(c.kitten.growUp.if, `${where(c)} Grow Up`, r, data);
        if (!c.kitten.abilities?.some((a) => a.when === 'exhaust')) r.warnings.push(`${where(c)}: its Kitten has no "exhaust" ability.`);
        if (!c.bigCat.abilities?.some((a) => a.when === 'exhaust')) r.warnings.push(`${where(c)}: its Big Cat has no "exhaust" ability.`);
        for (const [side, face] of [['Kitten', c.kitten], ['Big Cat', c.bigCat]] as const)
          (face.abilities ?? []).forEach((a, i) => checkAbility(a, `${where(c)} ${side} ability ${i + 1}`, r, data, ids));
      }
    }
    (c.abilities ?? []).forEach((a, i) => checkAbility(a, `${where(c)} ability ${i + 1}`, r, data, ids));
    for (const k of c.keywords ?? []) if (!knownKeyword(k)) r.errors.push(`${where(c)}: unknown keyword "${k}".`);

    // 3. Rules text: every keyword is written on the card
    const text = [c.text, c.kitten?.text, c.bigCat?.text].filter(Boolean).join(' ');
    if (!c.token && !text && (c.keywords?.length || c.abilities?.length))
      r.errors.push(`${where(c)}: has rules but no "text". Suggested: "${suggestText(c)}"`);
    // The numbers the abilities use must be the ones the text says (data and text can't drift apart).
    const faces: [string, typeof c.abilities, string | undefined][] = c.type === 'Hero Cat'
      ? [['Kitten', c.kitten?.abilities, c.kitten?.text], ['Big Cat', c.bigCat?.abilities, c.bigCat?.text]]
      : [['', c.abilities, c.text]];
    for (const [side, abilities, faceText] of faces) {
      const off = faceText ? missingNumbers(abilities, faceText) : [];
      if (off.length && !c.preview) r.errors.push(`${where(c)}${side ? ` ${side}` : ''}: its abilities use ${off.join(', ')}, which its text doesn't say.`);
    }
    for (const k of c.keywords ?? []) if (text && !new RegExp(`\\b${k.split(' ')[0]}\\b`).test(text)) r.warnings.push(`${where(c)}: keyword ${k} isn't in its rules text.`);
    if (c.type === 'Trick' && !c.abilities?.some((a) => a.when === 'play')) r.errors.push(`${where(c)}: a Trick needs a "play" ability.`);
    if (c.type === 'Toy' && !c.abilities?.some((a) => a.static?.to === 'attached')) r.errors.push(`${where(c)}: a Toy needs a static grant "to": "attached".`);

    // 5. Budget
    if ((c.type === 'Critter' || c.type === 'Cat') && !c.token && typeof c.cost === 'number') {
      const priced = (c.power ?? 0) + (c.health ?? 0) + (c.keywords ?? []).reduce((n, k) => n + keywordPrice(k), 0);
      const budget = 2 * c.cost + 1 + (c.type === 'Cat' ? 2 : 0);
      const effects = (c.abilities ?? []).length;
      const over = priced - budget;
      if (over > (c.type === 'Cat' ? 2 : 1) + effects) r.warnings.push(`${where(c)}: stats and keywords are ${over} over its cost's budget (${priced} vs ${budget}${effects ? `, plus ${effects} effect(s)` : ''}).`);
    }
  }

  // 2 & 4. Decks
  for (const [key, deck] of Object.entries(data.decks ?? {})) {
    for (const id of [deck.hero, ...Object.keys(deck.cards)]) if (!CARDS[id]) r.errors.push(`Deck ${deck.name}: ${id} isn't a card in any loaded set.`);
    const problems = deckProblems(deck as DeckList);
    for (const p of problems) r.errors.push(`Deck ${deck.name} (${key}): ${p}`);
  }

  // 6. Art
  const art = join(HERE, set.folder, 'art');
  const faces = cards.flatMap((c) => (c.type === 'Hero Cat' ? [`${c.id}-kitten`, `${c.id}-bigcat`] : [c.id]));
  const missingArt = faces.filter((f) => !existsSync(join(art, 'illustrations', `${f}.webp`)));
  const missingCards = faces.filter((f) => !existsSync(join(art, 'cards', `${f}.webp`)));
  if (missingArt.length) r.warnings.push(`No illustration yet for ${missingArt.length} card face(s): ${missingArt.join(', ')} (art/illustrations/<id>.webp).`);
  if (missingCards.length) r.warnings.push(`Not composed yet: ${missingCards.join(', ')} (python tools/compose_cards.py --set ${code.toLowerCase()}).`);
  const promptsFile = join(art, 'prompts.json');
  if (existsSync(promptsFile)) {
    const subjects = JSON.parse(readFileSync(promptsFile, 'utf8')).subjects ?? {};
    const noPrompt = faces.filter((f) => !subjects[f]);
    if (noPrompt.length) r.notes.push(`No art prompt for ${noPrompt.join(', ')} (fine if an artist draws them).`);
  }
  // The art brief, for the Artist Studio (docs/artist-studio-plan.md): a picture for every card face, each on a
  // real card and in a real step, and the Studio's frames drawn.
  const briefFile = join(art, 'brief.json');
  if (existsSync(briefFile)) {
    const brief = JSON.parse(readFileSync(briefFile, 'utf8')) as { milestones?: { id: unknown }[]; pictures?: { file: string; card: string | null; milestone: unknown; size?: number[] }[] };
    const pictures = brief.pictures ?? [];
    const steps = new Set((brief.milestones ?? []).map((m) => String(m.id)));
    const briefed = new Set(pictures.map((p) => p.file.replace(/\.[a-z]+$/i, '')));
    const unbriefed = faces.filter((f) => !briefed.has(f));
    if (unbriefed.length) r.warnings.push(`The art brief has no picture for ${unbriefed.join(', ')}.`);
    for (const p of pictures) {
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*\.webp$/.test(p.file)) r.errors.push(`Art brief: "${p.file}" isn't a file name the Studio can use (letters, digits and dashes, .webp).`);
      if (p.card && !ids.has(p.card)) r.errors.push(`Art brief: ${p.file} is for card ${p.card}, which isn't in the set.`);
      if (!steps.has(String(p.milestone))) r.errors.push(`Art brief: ${p.file} is in step ${String(p.milestone)}, which isn't one of its milestones.`);
      if (!Array.isArray(p.size) || p.size.length !== 2) r.errors.push(`Art brief: ${p.file} needs a size, [width, height].`);
    }
    const noFrame = faces.filter((f) => briefed.has(f) && !existsSync(join(art, 'cards', 'frames', `${f}.webp`)));
    if (noFrame.length) r.warnings.push(`No Studio frame for ${noFrame.join(', ')} (python tools/compose_cards.py --set ${code.toLowerCase()} --frames).`);
  }

  // 7. Bots
  if (games > 0) for (const key of Object.keys(data.decks ?? {})) r.notes.push(botRun(key, games));
  return r;
}

function knownFamily(family: string, data: SetData): boolean {
  if (data.families?.[family]) return true;
  return (data.requires ?? []).some((req) => CONTENT.find((c) => c.data.set === req)?.data.families?.[family]);
}

function knownKeyword(k: string): boolean {
  return CORE_KEYWORDS.includes(k) || /^Tough \d+$/.test(k) || MECHANICS[k]?.kind === 'keyword';
}

function keywordPrice(k: string): number {
  if (/^Tough \d+$/.test(k)) return 2 * Number(k.slice(6));
  return KEYWORD_PRICE[k] ?? 1;
}

function knownCondition(name: string): boolean {
  return name === 'targetIsYours' || MECHANICS[name]?.kind === 'condition' || PLUGINS.some((p) => p.conditions?.[name]);
}

function checkCondition(c: Condition, where: string, r: Report, data: SetData): void {
  void data;
  if (typeof c === 'string') {
    if (!knownCondition(c)) r.errors.push(`${where}: unknown condition "${c}" (not a mechanic or plugin condition).`);
    return;
  }
  const key = Object.keys(c)[0];
  if (!TESTS.includes(key)) r.errors.push(`${where}: unknown condition test "${key}".`);
  if (key === 'not') checkCondition((c as { not: Condition }).not, where, r, data);
}

function checkTarget(t: TargetSel | undefined, where: string, r: Report): void {
  if (t === undefined || t === 'self' || t === 'attack') return;
  if (typeof t !== 'object' || !('unit' in t || 'each' in t)) r.errors.push(`${where}: target must be "self", "attack", { unit: … } or { each: … }.`);
}

function checkAbility(a: Ability, where: string, r: Report, data: SetData, ids: Set<string>): void {
  for (const k of Object.keys(a)) if (!ABILITY_KEYS.includes(k)) r.errors.push(`${where}: unknown ability field "${k}".`);
  if (a.static) {
    if (a.static.while !== undefined) checkCondition(a.static.while, where, r, data);
    for (const k of a.static.grant?.keywords ?? []) if (!knownKeyword(k)) r.errors.push(`${where}: grants unknown keyword "${k}".`);
    return;
  }
  if (!a.when) r.errors.push(`${where}: needs "when" (or "static").`);
  else if (!TRIGGERS.includes(a.when)) r.errors.push(`${where}: unknown trigger "${a.when}".`);
  if (a.if !== undefined) checkCondition(a.if, where, r, data);
  if (a.instead) checkCondition(a.instead.if, where, r, data);
  checkTarget(a.target, where, r);
  checkTarget(a.target2, where, r);
  for (const act of [...(a.do ?? []), ...(a.instead?.do ?? [])]) {
    const name = Object.keys(act)[0];
    if (!ACTIONS.includes(name) && !PLUGINS.some((p) => p.actions?.[name])) r.errors.push(`${where}: unknown action "${name}" (not built in, and no plugin provides it).`);
    if (name === 'summon' && !ids.has(String(act[name])) && !CARDS[String(act[name])]) r.errors.push(`${where}: summons ${String(act[name])}, which isn't a token or card.`);
  }
}

/** Bots play the deck against each released deck: a first look, not the balance gate. */
function botRun(key: string, games: number): string {
  const released = CONTENT.filter((c) => c.data.status === 'released').flatMap((c) => Object.keys(c.data.decks ?? {})).filter((k) => k !== key);
  let wins = 0, total = 0;
  const per: string[] = [];
  for (const foe of released) {
    let w = 0;
    for (let g = 0; g < games; g++) {
      const seat = g % 2 ? [foe, key] : [key, foe];
      const s = createGame({ decks: seat as [string, string], seed: 1000 + g });
      let seed = 77 + g;
      const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      while (s.winner === null) apply(s, chooseAction(s, { random }));
      if (s.winner === seat.indexOf(key)) w++;
    }
    wins += w; total += games;
    per.push(`${DECKS[foe].name} ${Math.round((100 * w) / games)}%`);
  }
  return `Bots: ${DECKS[key].name} wins ${Math.round((100 * wins) / Math.max(total, 1))}% (${per.join(', ')}; ${games} games each).`;
}

// ── Command line ─────────────────────────────────────────────────────────────────────────────────

export function runChecks(which?: string, games = 0): { set: ContentSet; report: Report }[] {
  loadContent(registerSet, { prototypes: true });
  const chosen = CONTENT.filter((c) => !which || c.folder.endsWith(which) || c.data.set.toLowerCase() === which.toLowerCase());
  if (!chosen.length) throw new Error(`No set "${which}" in content/.`);
  return chosen.map((set) => ({ set, report: checkSet(set, games) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const gi = args.indexOf('--games');
  const games = gi >= 0 ? Number(args[gi + 1]) : 0;
  const which = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--games');
  let failed = false;
  for (const { set, report } of runChecks(which, games)) {
    console.log(`\n${set.data.name} (${set.data.set}, ${set.data.status}) — content/${set.folder}`);
    for (const e of report.errors) console.log(`  ✗ ${e}`);
    for (const w of report.warnings) console.log(`  ! ${w}`);
    for (const n of report.notes) console.log(`  · ${n}`);
    if (!report.errors.length) console.log(`  ✓ ready to play${report.warnings.length ? ` (${report.warnings.length} warning(s))` : ''}`);
    failed ||= report.errors.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
