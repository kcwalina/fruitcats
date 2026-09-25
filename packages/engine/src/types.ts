// Game state, actions and prompts. Everything here is plain JSON so a state can be cloned,
// serialized, replayed, sent over a socket or shown to an LLM without conversion.

export type PlayerId = 0 | 1;
export type CardType = 'Hero Cat' | 'Cat' | 'Critter' | 'Trick' | 'Toy';
/** How rare a card is printed: a symbol on the card, with no effect on the rules. Rarest last. */
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Legendary';
export const RARITIES: readonly Rarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary'];

export interface HeroSide {
  name: string;
  text: string;
  power?: number;
  /** Keywords this face has (a Big Cat's Fierce). */
  keywords?: string[];
  /** The face's abilities: an "exhaust" ability, and any static ones. */
  abilities?: Ability[];
  /** A Kitten's Grow Up: it flips to its Big Cat side as soon as this holds. */
  growUp?: { if: Condition };
}

export interface CardDef {
  id: string;
  /** Tokens have no rarity: they're summoned, never collected. */
  rarity?: Rarity;
  type: CardType;
  family: string;
  name: string;
  cost?: number;
  power?: number;
  health?: number;
  text?: string;
  flavor?: string;
  kitten?: HeroSide;
  bigCat?: HeroSide;
  preview?: boolean;
  /** Keywords: the core ones ("Guardian", "Tough 1") and set mechanics ("Ripen", "Heat"). */
  keywords?: string[];
  abilities?: Ability[];
  /** A unit that cards summon (never in a deck). */
  token?: boolean;
  /** Printed as a Signature card (compose_cards.py). No effect on the rules. */
  signature?: boolean;
  /** The set this card came from (filled in when the set is registered). */
  set?: string;
  /** How the rules text calls the card once named ("her"); its name otherwise. */
  pronoun?: string;
}

// ── Card abilities, as data ────────────────────────────────────────────────────────────────────────
// A card's rules are a list of abilities. Each combines a trigger (`when`), an optional condition
// (`if`), a target and what it does (`do`). docs/card-data-architecture.md describes the vocabulary.

/** When an ability happens. `exhaust` is a Hero Cat's activated ability; `play` a Trick's effect. */
export type Trigger =
  | 'play' | 'hello' | 'goodbye' | 'roundStart' | 'exhaust'
  | 'damagedAndSurvives' | 'defeatsInCombat' | 'youHeal';

/** Which units a filter keeps. */
export interface UnitFilter {
  exhausted?: boolean;
  damaged?: boolean;
  noToy?: boolean;
  keyword?: string;
  counter?: { name: string; atLeast: number };
}

/**
 * What an ability acts on: `self` (the unit with the ability), `attack` (the attack in this Pounce
 * window), one chosen unit, or each unit that matches (no choice).
 */
export type TargetSel =
  | 'self' | 'attack'
  | { unit: 'own' | 'enemy' | 'any'; other?: boolean; filter?: UnitFilter }
  | { each: 'own' | 'enemy' | 'all' | 'allOther'; other?: boolean; filter?: UnitFilter };

/** A condition: a set mechanic's name ("Zest", "Lush"), a plugin's, a built-in name, or a test. */
export type Condition =
  | string
  | { not: Condition }
  | { playedThisRound: { atLeast: number } }
  | { treats: { atLeast: number } }
  | { lives: { atMost: number } }
  | { opponentLives: { atMost: number } }
  | { yardHas: { keyword: string } }
  | { unitsInComposts: { atLeast: number } }
  | { compost: { atLeast: number } }
  | { controlUnits: { atLeast: number } }
  | { unitHasCounter: { whose: 'own' | 'enemy' | 'any'; name: string; atLeast: number } };

/** One thing an ability does. Plugins can add their own (`{ myAction: … }`). */
export type Act = Record<string, unknown>;

/** A lasting effect: bonuses granted to units while a condition holds, or a unit that can't attack. */
export interface StaticEffect {
  grant?: { power?: number; health?: number; keywords?: string[] };
  /** Who gets the grant: the card itself, the unit a Toy is attached to, or each matching unit. */
  to?: 'self' | 'attached' | { each: 'own' | 'enemy' | 'all'; other?: boolean; filter?: UnitFilter };
  cantAttack?: boolean;
  while?: Condition;
}

export interface Ability {
  when?: Trigger;
  if?: Condition;
  target?: TargetSel;
  /** A second chosen target (Showdown: one of yours, then one of theirs). */
  target2?: TargetSel;
  do?: Act[];
  /** A better version when a condition holds (Citron Fox: deal 2 instead with Zest). */
  instead?: { if: Condition; do: Act[] };
  /** "You may": a Hello whose target can be left out. */
  optional?: boolean;
  /** The effect still happens with no legal target (Warm Cider still draws). */
  optionalTarget?: boolean;
  oncePerRound?: boolean;
  /** A Pounce card that can only answer this kind of window (Hiss!: an attack). */
  pounceOnly?: 'attack';
  /** A mechanic's start-of-round ability that happens as the unit readies, not as a queued step (Ripen). */
  inline?: boolean;
  static?: StaticEffect;
  /** A line for the game log when it happens. */
  log?: string;
  /** A reminder printed after the ability's text, in brackets: "(The attacker stays exhausted.)" */
  note?: string;
}

/** Where an ability lives, so a queued step (plain JSON) can find it again. */
export type AbilityRef =
  | { card: string; side?: 'kitten' | 'bigCat'; index: number }
  | { mechanic: string; index: number };

/** A physical card: `uid` is unique within a game, `id` names its definition. */
export interface CardInst {
  uid: number;
  id: string;
}

export interface Unit {
  uid: number;
  id: string;
  damage: number;
  exhausted: boolean;
  toy?: CardInst;
  /** "This round" modifiers, cleared in the End Phase. */
  buffPower: number;
  /** Keywords granted this round ("Sneaky", "Guardian"). */
  buffKeywords?: string[];
  /** A "once per round" ability has been used since the last Start Phase. */
  usedOnce: boolean;
  /** Mechanics' counters on the unit: { ripe: 2 } (Ripen), { heat: 1 } (Heat). Lost when it leaves the Yard. */
  counters?: Record<string, number>;
}

export interface Treat {
  card: CardInst;
  exhausted: boolean;
}

export interface Hero {
  id: string;
  grown: boolean;
  exhausted: boolean;
}

export interface PlayerState {
  name: string;
  deckName: string;
  hero: Hero;
  deck: CardInst[];
  hand: CardInst[];
  lives: CardInst[];
  pantry: Treat[];
  yard: Unit[];
  compost: CardInst[];
  /** Cards this player has played this round (actions, Pounces and Lucky plays): Citrus's Zest. */
  playedThisRound?: number;
}

export type Target = { kind: 'unit'; uid: number } | { kind: 'hero'; player: PlayerId };

export type Action =
  | { t: 'mulligan'; uids: number[] }
  | { t: 'setupPlant'; uids: number[] }
  | { t: 'plant'; uid: number }
  | { t: 'skipPlant' }
  | { t: 'play'; uid: number; target?: Target; target2?: Target }
  | { t: 'attack'; attacker: Target; target: Target }
  | { t: 'ability'; target?: Target }
  | { t: 'takeYarn' }
  | { t: 'pass' }
  | { t: 'pounce'; uid: number; target?: Target; target2?: Target }
  | { t: 'decline' }
  | { t: 'lucky'; target?: Target; target2?: Target }
  | { t: 'keepLucky' }
  | { t: 'choose'; target: Target }
  | { t: 'discard'; uids: number[] };

/** An open Pounce window: what the defender is reacting to. */
export type Window =
  | { kind: 'play'; by: PlayerId; card: CardInst; target?: Target; target2?: Target }
  | { kind: 'attack'; by: PlayerId; attacker: Target; target: Target; cancelled: boolean };

/** The decision the game is waiting on. `null` only when the game is over. */
export type Prompt =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'setupPlant'; player: PlayerId; count: number }
  | { kind: 'plant'; player: PlayerId }
  | { kind: 'action'; player: PlayerId }
  | { kind: 'pounce'; player: PlayerId }
  | { kind: 'lucky'; player: PlayerId; uid: number }
  | { kind: 'choose'; player: PlayerId; ref: AbilityRef; spec: TargetSel; sourceId: string; selfUid?: number }
  | { kind: 'discard'; player: PlayerId; count: number };

/** Pending engine work. Steps are data so the whole game is a pure fold over actions. */
export type Step =
  | { t: 'mulliganPrompt'; p: PlayerId }
  | { t: 'setupPlantPrompt'; p: PlayerId }
  | { t: 'plantPrompt'; p: PlayerId }
  | { t: 'discardCheck'; p: PlayerId }
  | { t: 'beginActions' }
  | { t: 'afterAction' }
  | { t: 'startRound' }
  | { t: 'endRound' }
  | { t: 'rollYarn' }
  | { t: 'draw'; p: PlayerId; n: number }
  | { t: 'loseLife'; p: PlayerId; n: number }
  | { t: 'resolvePlay'; p: PlayerId; card: CardInst; target?: Target; target2?: Target; closesWindow: boolean }
  | { t: 'resolveAttack' }
  /** Run an ability: a Hero Cat's exhaust, a trigger, or a Goodbye once its target is chosen. */
  | { t: 'ability'; p: PlayerId; ref: AbilityRef; target?: Target; target2?: Target; sourceId: string; selfUid?: number; trigger?: boolean }
  | { t: 'choosePrompt'; p: PlayerId; ref: AbilityRef; spec: TargetSel; sourceId: string; selfUid?: number }
  /** After a clash: `uid` fought `foeUid`; if the foe is gone, `uid`'s "defeats in combat" abilities happen. */
  | { t: 'combatWin'; uid: number; foeUid: number };

export interface LogEntry {
  round: number;
  player?: PlayerId;
  text: string;
}

/**
 * What just happened, as data, for a screen to animate: one record per visible change, in the order
 * the rules made them. Public information only (a lost Life's card is secret, so it isn't named).
 */
export type GameEvent =
  | { t: 'play'; p: PlayerId; uid: number; cardId: string; target?: Target; how?: 'pounce' | 'lucky' }
  | { t: 'ability'; p: PlayerId; heroId: string; target?: Target }
  | { t: 'attack'; p: PlayerId; attacker: Target; target: Target }
  | { t: 'clash'; attacker: Target; target: number; dealt: number; taken: number }
  | { t: 'heroHit'; attacker: Target; p: PlayerId; lives: number }
  | { t: 'cancelled'; attacker: Target }
  | { t: 'fizzled'; cardId?: string; attacker?: Target }
  | { t: 'damage'; uid: number; amount: number; p: PlayerId }
  | { t: 'heal'; uid: number; amount: number }
  | { t: 'buff'; uid: number; power?: number; sneaky?: boolean; guardian?: boolean }
  | { t: 'exhaust'; uid: number }
  | { t: 'ready'; uid: number }
  | { t: 'toy'; uid: number; cardId: string }
  | { t: 'defeated'; uid: number; cardId: string; owner: PlayerId }
  | { t: 'lifeLost'; p: PlayerId; left: number }
  | { t: 'growUp'; p: PlayerId }
  | { t: 'counter'; uid: number; name: string; value: number }
  | { t: 'summon'; p: PlayerId; uid: number; cardId: string }
  | { t: 'draw'; p: PlayerId; n: number }
  | { t: 'round'; n: number }
  | { t: 'win'; p: PlayerId | 'draw' };

export interface GameState {
  seed: number;
  round: number;
  yarn: PlayerId;
  yarnTaken: PlayerId | null;
  active: PlayerId;
  passes: number;
  players: [PlayerState, PlayerState];
  prompt: Prompt | null;
  queue: Step[];
  window: Window | null;
  winner: PlayerId | 'draw' | null;
  nextUid: number;
  log: LogEntry[];
  /** Everything that happened, for animation. Games saved before events existed may lack it. */
  events: GameEvent[];
  /** Number of actions applied; a cheap clock for replays and stats. */
  actions: number;
  startingYarn: PlayerId;
  /** Triggered abilities run since the last action: a cap stops two cards triggering each other forever. */
  chain?: number;
}
