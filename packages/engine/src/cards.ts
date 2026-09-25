// The catalog: every card, deck, family and mechanic the engine knows about. It starts empty. Card sets
// are data (content/<year>/<month>/<set>/set.json) and are handed to the engine from outside with
// `registerSet`, together with an optional plugin: code a set brings for what data can't express. The
// engine itself names no card, deck or family.

import type { Ability, AbilityRef, CardDef, Condition, GameState, PlayerId, Unit } from './types';

export interface DeckList {
  name: string;
  hero: string;
  cards: Record<string, number>;
}

export interface FamilyDef {
  colors?: string[];
  /** Neutral families (Garden) go in any deck. */
  neutral?: boolean;
  mechanic?: string;
  personality?: string;
  playsLike?: string;
}

/**
 * A set mechanic. `keyword` mechanics (Ripen, Heat) give the units that have them abilities and a
 * counter; `condition` mechanics (Zest, Lush) name a condition cards can ask for; `action` ones (Sprout)
 * only name a built-in action for the rules text.
 */
export interface MechanicDef {
  family?: string;
  kind: 'keyword' | 'condition' | 'action';
  reminder: string;
  if?: Condition;
  /** A counter the keyword keeps on a unit, and what each point of it is worth. */
  counter?: { name: string; power?: number; health?: number; log?: string };
  abilities?: Ability[];
  /** A small symbol the game shows with the keyword on a unit (🍎 for Ripen). */
  icon?: string;
  /** A condition written as a label in rules text ("Zest: …") rather than as a clause ("If you're Lush, …"). */
  label?: boolean;
}

/** A card set, as its set.json holds it. */
export interface SetData {
  set: string;
  name: string;
  version?: string;
  /** `released` sets are for everyone; `prototype` ones only for playtests and tools. */
  status?: 'released' | 'prototype' | string;
  released?: string;
  requires?: string[];
  families?: Record<string, FamilyDef>;
  mechanics?: Record<string, MechanicDef>;
  cards: CardDef[];
  tokens?: CardDef[];
  decks?: Record<string, DeckList>;
}

// ── Plugins ──────────────────────────────────────────────────────────────────────────────────────
// What data can't say, a set says in code. A plugin adds named conditions and actions that its cards'
// data then uses like the built-in ones, and hooks for the bot. It gets everything it needs through its
// arguments, so it imports nothing from the engine but types, and the engine runs without it.

/** What a plugin's action or condition can see and do. */
export interface PluginContext {
  s: GameState;
  /** The player whose ability this is. */
  p: PlayerId;
  /** The unit the action is applied to (for a unit target), or the ability's own unit. */
  unit?: Unit;
  self?: Unit;
  log(text: string): void;
  damage(u: Unit, amount: number): void;
  heal(u: Unit, amount: number): void;
  draw(n: number): void;
}

/** What a bot hook can use: the decision in front of it and the bot's own one-step judge. */
export interface AiContext {
  s: GameState;
  p: PlayerId;
  /** The bot's favourite, and the score of passing instead. */
  chosen: import('./types').Action;
  candidates: import('./types').Action[];
  passScore: number;
  /** The bot's best choice among some actions, with its score (one-step lookahead). */
  best(actions: import('./types').Action[]): { action: import('./types').Action; score: number };
  /** Whether a card's abilities ask for a named condition (a mechanic such as Zest). */
  usesCondition(cardId: string, name: string): boolean;
  cardCost(cardId: string): number;
}

export interface Plugin {
  id: string;
  conditions?: Record<string, (ctx: PluginContext, value: unknown) => boolean>;
  actions?: Record<string, (ctx: PluginContext, value: unknown) => void>;
  ai?: {
    /** Offer a better move than the bot's favourite, or null to keep it. The first plugin that answers wins. */
    refineAction?(ctx: AiContext): import('./types').Action | null;
  };
}

// ── The registries ─────────────────────────────────────────────────────────────────────────────────

export const CARDS: Record<string, CardDef> = {};
export const DECKS: Record<string, DeckList> = {};
export const FAMILIES: Record<string, FamilyDef> = {};
export const MECHANICS: Record<string, MechanicDef> = {};
export const SETS: Record<string, SetData> = {};
export const PLUGINS: Plugin[] = [];

/**
 * Cards (and Hero Cat faces, as `<id>:kitten` / `<id>:bigCat`) with a lasting grant to units other than a
 * Toy's own: auras and "while…" grants. The engine only looks for auras when one of these is in play.
 */
export const AURA_SOURCES = new Set<string>();
/** Hero Cats whose Kitten or Big Cat face grants auras, by id (the same facts as AURA_SOURCES, for a fast check). */
export const AURA_HEROES = new Map<string, { kitten: boolean; bigCat: boolean }>();
const grantsAura = (abilities: Ability[] | undefined) => !!abilities?.some((a) => a.static?.grant && a.static.to !== 'attached');

/**
 * A vanilla card the bot puts in place of cards it can't see (the opponent's hand) when it searches.
 * Part of the engine, not of any set.
 */
export const BLANK_CARD = 'CORE-BLANK';
const CORE_CARDS: CardDef[] = [
  { id: BLANK_CARD, type: 'Critter', family: 'Core', name: 'Unknown card', cost: 2, power: 3, health: 2, text: '' },
];

function registerCore(): void {
  for (const c of CORE_CARDS) CARDS[c.id] = c;
}
registerCore();

/** Add a set (and the plugin its data needs). Registering a set again replaces it. */
export function registerSet(data: SetData, plugin?: Plugin): void {
  SETS[data.set] = data;
  for (const [name, f] of Object.entries(data.families ?? {})) FAMILIES[name] = { ...FAMILIES[name], ...f };
  for (const [name, m] of Object.entries(data.mechanics ?? {})) MECHANICS[name] = m;
  for (const c of [...data.cards, ...(data.tokens ?? []).map((t) => ({ ...t, token: true }))]) {
    CARDS[c.id] = { ...c, set: data.set };
    keywordCache.delete(c.id);
    for (const [key, abilities] of [[c.id, c.abilities], [`${c.id}:kitten`, c.kitten?.abilities], [`${c.id}:bigCat`, c.bigCat?.abilities]] as const) {
      if (grantsAura(abilities)) AURA_SOURCES.add(key);
      else AURA_SOURCES.delete(key);
    }
    if (grantsAura(c.kitten?.abilities) || grantsAura(c.bigCat?.abilities))
      AURA_HEROES.set(c.id, { kitten: grantsAura(c.kitten?.abilities), bigCat: grantsAura(c.bigCat?.abilities) });
    else AURA_HEROES.delete(c.id);
  }
  for (const [key, deck] of Object.entries(data.decks ?? {})) DECKS[key] = deck;
  if (plugin && !PLUGINS.some((x) => x.id === plugin.id)) PLUGINS.push(plugin);
}

/** Forget every set (tests). */
export function clearCatalog(): void {
  for (const r of [CARDS, DECKS, FAMILIES, MECHANICS, SETS] as Record<string, unknown>[]) for (const k of Object.keys(r)) delete r[k];
  PLUGINS.length = 0;
  AURA_SOURCES.clear();
  AURA_HEROES.clear();
  keywordCache.clear();
  registerCore();
}

// ── Keywords ─────────────────────────────────────────────────────────────────────────────────────

export interface Keywords {
  zoomies: boolean;
  guardian: boolean;
  sneaky: boolean;
  fierce: boolean;
  lucky: boolean;
  pounce: boolean;
  ripen: boolean;
  tough: number;
  /** Every keyword by name, core and set mechanics alike ("Guardian", "Tough 1", "Heat"). */
  all: string[];
}

const keywordCache = new Map<string, Keywords>();

export function keywordsFrom(list: string[]): Keywords {
  const k: Keywords = { zoomies: false, guardian: false, sneaky: false, fierce: false, lucky: false, pounce: false, ripen: false, tough: 0, all: list };
  for (const s of list) {
    if (s === 'Zoomies') k.zoomies = true;
    else if (s === 'Guardian') k.guardian = true;
    else if (s === 'Sneaky') k.sneaky = true;
    else if (s === 'Fierce') k.fierce = true;
    else if (s === 'Lucky') k.lucky = true;
    else if (s === 'Pounce') k.pounce = true;
    else if (s === 'Ripen') k.ripen = true;
    else if (/^Tough \d+$/.test(s)) k.tough += Number(s.slice(6));
  }
  return k;
}

/** Keywords written in rules text: the sentences that are a keyword alone ("Guardian.", "Tough 1."). */
export function parseKeywords(text = ''): Keywords {
  const list: string[] = [];
  for (const raw of text.split(/[.\n]/)) {
    const s = raw.trim();
    if (['Zoomies', 'Guardian', 'Sneaky', 'Fierce', 'Lucky', 'Pounce', 'Ripen'].includes(s) || /^Tough \d+$/.test(s)) list.push(s);
  }
  return keywordsFrom(list);
}

/** A card's printed keywords (not what Toys, auras or buffs add in play: see the engine's unitKeywords). */
export function keywords(id: string): Keywords {
  let k = keywordCache.get(id);
  if (!k) {
    k = keywordsFrom(CARDS[id]?.keywords ?? []);
    keywordCache.set(id, k);
  }
  return k;
}

// ── Looking up abilities ─────────────────────────────────────────────────────────────────────────

/** The abilities of a card, or of a Hero Cat's face. */
export function abilitiesOf(id: string, side?: 'kitten' | 'bigCat'): Ability[] {
  const c = CARDS[id];
  if (!c) return [];
  return (side ? c[side]?.abilities : c.abilities) ?? [];
}

export function abilityAt(ref: AbilityRef): Ability | undefined {
  if ('mechanic' in ref) return MECHANICS[ref.mechanic]?.abilities?.[ref.index];
  return abilitiesOf(ref.card, ref.side)[ref.index];
}

/** A card's first ability with this trigger, with its reference. */
export function findAbility(id: string, when: string, side?: 'kitten' | 'bigCat'): { ability: Ability; ref: AbilityRef } | null {
  const list = abilitiesOf(id, side);
  const index = list.findIndex((a) => a.when === when);
  return index < 0 ? null : { ability: list[index], ref: side ? { card: id, side, index } : { card: id, index } };
}

/** Whether a card's abilities ask for a condition by name (Zest, Lush, a plugin's). */
export function usesCondition(id: string, name: string): boolean {
  const mentions = (c: Condition | undefined): boolean =>
    c === name || (typeof c === 'object' && c !== null && 'not' in c && mentions(c.not));
  return abilitiesOf(id).some((a) => mentions(a.if) || mentions(a.instead?.if) || mentions(a.static?.while));
}

export function isNeutralFamily(family: string | undefined): boolean {
  return !!family && !!FAMILIES[family]?.neutral;
}

export function isUnitCard(id: string): boolean {
  const type = CARDS[id]?.type;
  return type === 'Cat' || type === 'Critter';
}

/** A registered deck by key, or a deck list as it is (a player's own deck). */
export function resolveDeck(deck: string | DeckList): DeckList {
  if (typeof deck !== 'string') return deck;
  const list = DECKS[deck];
  if (!list) throw new Error(`Unknown deck '${deck}' (is its set registered?)`);
  return list;
}

/** Expand a decklist into card ids (hero excluded). */
export function deckCardIds(deckOrKey: string | DeckList): string[] {
  const deck = resolveDeck(deckOrKey);
  const ids: string[] = [];
  for (const [id, qty] of Object.entries(deck.cards)) for (let i = 0; i < qty; i++) ids.push(id);
  return ids;
}

// ── The built-in vocabulary ──────────────────────────────────────────────────────────────────────
// What the engine itself understands (src/engine.ts runs each one). Anything else a set's data names
// must come from a registered plugin.

export const TRIGGERS = ['play', 'hello', 'goodbye', 'roundStart', 'exhaust', 'damagedAndSurvives', 'defeatsInCombat', 'youHeal'];
export const BUILT_IN_ACTIONS = ['damage', 'heal', 'buff', 'counter', 'draw', 'exhaust', 'ready', 'readyTreats', 'sprout', 'summon', 'cancelAttack', 'fight'];
export const CONDITION_TESTS = ['not', 'playedThisRound', 'treats', 'lives', 'opponentLives', 'yardHas', 'unitsInComposts', 'compost', 'controlUnits', 'unitHasCounter'];

/**
 * The actions and conditions a set's cards use that neither the engine nor a registered plugin provides
 * (its own mechanics count). Empty means the engine can play the set as it is: what a site checks before it
 * takes a card pack that arrived without a new build.
 */
export function missingPieces(data: SetData): string[] {
  const mechanics = { ...MECHANICS, ...(data.mechanics ?? {}) };
  const missing = new Set<string>();
  const condition = (c: Condition | undefined): void => {
    if (c === undefined) return;
    if (typeof c === 'string') {
      if (c !== 'targetIsYours' && mechanics[c]?.kind !== 'condition' && !PLUGINS.some((p) => p.conditions?.[c])) missing.add(`condition ${c}`);
    } else if ('not' in c) condition(c.not);
    else if (!CONDITION_TESTS.includes(Object.keys(c)[0])) missing.add(`condition ${Object.keys(c)[0]}`);
  };
  const ability = (a: Ability): void => {
    condition(a.if); condition(a.instead?.if); condition(a.static?.while);
    for (const act of [...(a.do ?? []), ...(a.instead?.do ?? [])]) {
      const name = Object.keys(act)[0];
      if (!BUILT_IN_ACTIONS.includes(name) && !PLUGINS.some((p) => p.actions?.[name])) missing.add(`action ${name}`);
    }
  };
  const all = [...Object.values(data.mechanics ?? {}).flatMap((m) => m.abilities ?? [])];
  for (const c of [...data.cards, ...(data.tokens ?? [])]) {
    all.push(...(c.abilities ?? []), ...(c.kitten?.abilities ?? []), ...(c.bigCat?.abilities ?? []));
    if (c.kitten?.growUp) condition(c.kitten.growUp.if);
  }
  all.forEach(ability);
  return [...missing];
}

// ── Compatibility ────────────────────────────────────────────────────────────────────────────────
// Older callers ask for a card's "behaviour": today only a Hero Cat's Grow Up is still asked for this
// way (the bot's planting rule, the playtest harness's list of playable heroes).

export interface Behaviour {
  growUp?: (s: GameState, p: PlayerId) => boolean;
  kitten?: { effect: string };
  bigCat?: { effect: string };
}

/** Set by the engine: evaluates a condition for a player. */
let conditionEvaluator: ((s: GameState, p: PlayerId, c: Condition) => boolean) | null = null;
export function setConditionEvaluator(f: (s: GameState, p: PlayerId, c: Condition) => boolean): void {
  conditionEvaluator = f;
}

export function behaviour(id: string): Behaviour {
  const c = CARDS[id];
  if (!c || c.type !== 'Hero Cat') return {};
  const grow = c.kitten?.growUp?.if;
  const name = (side: 'kitten' | 'bigCat') => {
    const a = c[side]?.abilities?.find((x) => x.when === 'exhaust');
    return a ? { effect: Object.keys(a.do?.[0] ?? {})[0] ?? 'ability' } : undefined;
  };
  return {
    growUp: grow !== undefined ? (s, p) => !!conditionEvaluator?.(s, p, grow) : undefined,
    kitten: name('kitten'),
    bigCat: name('bigCat'),
  };
}

/** Every Hero Cat's behaviour, by id (a live view of the catalog). */
export const BEHAVIOURS: Record<string, Behaviour> = new Proxy({} as Record<string, Behaviour>, {
  get: (_t, id) => (typeof id === 'string' && CARDS[id]?.type === 'Hero Cat' ? behaviour(id) : undefined),
  has: (_t, id) => typeof id === 'string' && CARDS[id]?.type === 'Hero Cat',
  ownKeys: () => Object.keys(CARDS).filter((id) => CARDS[id].type === 'Hero Cat'),
  getOwnPropertyDescriptor: (_t, id) =>
    typeof id === 'string' && CARDS[id]?.type === 'Hero Cat' ? { enumerable: true, configurable: true, value: behaviour(id) } : undefined,
});
