import data from '../../../cards/sb1.json';
import type { CardDef, EffectKey, GameState, PlayerId, TargetSpec } from './types';

export const CARDS: Record<string, CardDef> = {};
for (const card of data.cards as CardDef[]) CARDS[card.id] = card;

export interface DeckList {
  name: string;
  hero: string;
  cards: Record<string, number>;
}
export const DECKS = data.decks as Record<string, DeckList>;

export interface Keywords {
  zoomies: boolean;
  guardian: boolean;
  sneaky: boolean;
  fierce: boolean;
  lucky: boolean;
  pounce: boolean;
  tough: number;
}

const keywordCache = new Map<string, Keywords>();

/** Keywords are the sentences of card text that consist of a keyword alone ("Guardian.", "Tough 1."). */
export function parseKeywords(text = ''): Keywords {
  const k: Keywords = { zoomies: false, guardian: false, sneaky: false, fierce: false, lucky: false, pounce: false, tough: 0 };
  for (const raw of text.split(/[.\n]/)) {
    const s = raw.trim();
    if (s === 'Zoomies') k.zoomies = true;
    else if (s === 'Guardian') k.guardian = true;
    else if (s === 'Sneaky') k.sneaky = true;
    else if (s === 'Fierce') k.fierce = true;
    else if (s === 'Lucky') k.lucky = true;
    else if (s === 'Pounce') k.pounce = true;
    else if (/^Tough \d+$/.test(s)) k.tough = Number(s.slice(6));
  }
  return k;
}

export function keywords(id: string): Keywords {
  let k = keywordCache.get(id);
  if (!k) {
    k = parseKeywords(CARDS[id]?.text);
    keywordCache.set(id, k);
  }
  return k;
}

export interface TargetedEffect {
  effect: EffectKey;
  target?: TargetSpec;
  /** The effect still happens when no legal target exists (e.g. Warm Cider still draws). */
  optionalTarget?: boolean;
}

export interface Behaviour {
  /** Tricks: what happens on resolution. */
  play?: TargetedEffect;
  /** Units: Hello trigger (targets chosen when the card is played, rule 400.1a). */
  hello?: TargetedEffect;
  /** Units: Goodbye trigger (target chosen when it triggers). */
  goodbye?: TargetedEffect & { target: TargetSpec };
  /** Toys: static bonuses to the attached unit. */
  toy?: { power?: number; health?: number; guardian?: boolean };
  /** Tricks that can only be played in a Pounce window of this kind. */
  pounceOnly?: 'attack';
  /** Hero Cats: Exhaust ability per side, and the Grow Up condition. */
  kitten?: TargetedEffect;
  bigCat?: TargetedEffect;
  growUp?: (s: GameState, p: PlayerId) => boolean;
}

const livesOf = (s: GameState, p: PlayerId) => s.players[p].lives.length;

/**
 * How each card's text is implemented. Plain keywords come from the card text; this table covers
 * everything else. Sanguine (C15), Sakura (O13) and Granny Smith (O14) have bespoke hooks in the rules.
 */
export const BEHAVIOURS: Record<string, Behaviour> = {
  'SB1-H01': {
    kitten: { effect: 'buff1', target: 'ownUnit' },
    bigCat: { effect: 'buff2sneaky', target: 'ownUnit' },
    growUp: (s, p) => livesOf(s, (1 - p) as PlayerId) <= 5,
  },
  'SB1-H02': {
    kitten: { effect: 'heal2', target: 'ownUnit' },
    bigCat: { effect: 'heal3guard', target: 'ownUnit' },
    growUp: (s, p) => livesOf(s, p) <= 6,
  },
  'SB1-C02': { goodbye: { effect: 'damage1', target: 'anyUnit' } },
  'SB1-C06': { hello: { effect: 'damage1', target: 'anyUnit' } },
  'SB1-C09': { play: { effect: 'damage2', target: 'anyUnit' } },
  'SB1-C10': { play: { effect: 'damage4', target: 'anyUnit' } },
  'SB1-C11': { play: { effect: 'readyOwn', target: 'ownUnit' } },
  'SB1-C12': { toy: { power: 2 } },
  'SB1-C13': { hello: { effect: 'readyOther', target: 'ownOtherUnit' } },
  'SB1-C14': { hello: { effect: 'damageEachEnemy1' } },
  'SB1-O01': { hello: { effect: 'heal2', target: 'anyUnit' } },
  'SB1-O03': { hello: { effect: 'drawIfGuardian' } },
  'SB1-O05': { hello: { effect: 'exhaustEnemy', target: 'enemyUnit' } },
  'SB1-O09': { play: { effect: 'cancelAttack' }, pounceOnly: 'attack' },
  'SB1-O10': { play: { effect: 'heal3draw', target: 'ownUnit', optionalTarget: true } },
  'SB1-O11': { play: { effect: 'damage4', target: 'exhaustedUnit' } },
  'SB1-O12': { toy: { health: 3, guardian: true } },
  'SB1-G03': { hello: { effect: 'draw1' } },
  'SB1-G04': { play: { effect: 'buff2', target: 'ownUnit' } },
  'SB1-G05': { play: { effect: 'exhaustEnemy', target: 'enemyUnit' } },
};

export const SANGUINE = 'SB1-C15';
export const SAKURA = 'SB1-O13';
export const GRANNY_SMITH = 'SB1-O14';

export function behaviour(id: string): Behaviour {
  return BEHAVIOURS[id] ?? {};
}

export function isUnitCard(id: string): boolean {
  const type = CARDS[id]?.type;
  return type === 'Cat' || type === 'Critter';
}

/** Expand a decklist into card ids (hero excluded). */
export function deckCardIds(deckKey: string): string[] {
  const deck = DECKS[deckKey];
  if (!deck) throw new Error(`Unknown deck '${deckKey}'`);
  const ids: string[] = [];
  for (const [id, qty] of Object.entries(deck.cards)) for (let i = 0; i < qty; i++) ids.push(id);
  return ids;
}
