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
  /** Keywords this face has (an Awakened Hero's Fierce). */
  keywords?: string[];
  /** The face's abilities: an "exhaust" ability, and any static ones. */
  abilities?: Ability[];
  /** The first face's Awaken: it flips to its Awakened side as soon as this holds. */
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
  /** Keywords: the core ones ("Guardian", "Tough 1") and set mechanics ("Rain-Fed", "Heat"). */
  keywords?: string[];
  abilities?: Ability[];
  /** A unit that cards summon (never in a deck). */
  token?: boolean;
  /**
   * A Signature card: designed to exist only as its Signature print, never as a standard copy.
   * 'rainbow' is the Signature stone with rainbow cracks (Mochi). No effect on the rules.
   */
  signature?: boolean | 'rainbow';
  /**
   * Never sold in the Store, and how it's gotten instead: 'promo' (given out at an event, say). Players get such cards
   * by grants, and later perhaps from each other (docs/store-plan.md, Cards the Store doesn't sell). No effect on play.
   */
  exclusive?: string;
  /** The set this card came from (filled in when the set is registered). */
  set?: string;
  /** How the rules text calls the card once named ("her"); its name otherwise. */
  pronoun?: string;
  /** A token rules text calls by name only ("Summon an Ant"), not by its stats and keywords. */
  brief?: boolean;
}

// ── Card abilities, as data ────────────────────────────────────────────────────────────────────────
// A card's rules are a list of abilities. Each combines a trigger (`when`), an optional condition
// (`if`), a target and what it does (`do`). docs/card-data-architecture.md describes the vocabulary.

/** When an ability happens. `exhaust` is a Hero's activated ability; `play` a Charm's effect. */
export type Trigger =
  | 'play' | 'hello' | 'goodbye' | 'roundStart' | 'exhaust'
  | 'damagedAndSurvives' | 'defeatsInCombat' | 'youHeal'
  /** In the Clash: once before the first bout, at the start of every bout, at the start of bouts 2, 4, 6, 8. */
  | 'clashStart' | 'boutStart' | 'everyOtherBout';

/** Which units a filter keeps. */
export interface UnitFilter {
  exhausted?: boolean;
  damaged?: boolean;
  noToy?: boolean;
  keyword?: string;
  counter?: { name: string; atLeast: number };
  /** Units of this family (a trait's). */
  family?: string;
  /** Units of this card (a token's, say). */
  card?: string;
  /** Tokens only (true), or no tokens (false). */
  token?: boolean;
}

/**
 * What an ability acts on: `self` (the unit with the ability), `attack` (an Ambush's: the enemy unit across from
 * its lane), one chosen unit, or each unit that matches (no choice).
 */
export type TargetSel =
  | 'self' | 'attack'
  | { unit: 'own' | 'enemy' | 'any'; other?: boolean; filter?: UnitFilter }
  /** `range`: only units within this many lanes of the ability's own unit (0: the one across from it, or itself). */
  | { each: 'own' | 'enemy' | 'all' | 'allOther'; other?: boolean; filter?: UnitFilter; range?: number };

/** A condition: a set mechanic's name ("Company", "Well-Fed"), a plugin's, a built-in name, or a test. */
export type Condition =
  | string
  | { not: Condition }
  | { playedThisRound: { atLeast: number } }
  /** Offerings this player has saved. */
  | { treats: { atLeast: number } }
  | { lives: { atMost: number } }
  | { opponentLives: { atMost: number } }
  | { yardHas: { keyword: string } }
  | { unitsInComposts: { atLeast: number } }
  /** Units that have gone down in Clashes this game, both players' together. */
  | { unitsDown: { atLeast: number } }
  | { compost: { atLeast: number } }
  | { controlUnits: { atLeast: number } }
  | { unitHasCounter: { whose: 'own' | 'enemy' | 'any'; name: string; atLeast: number } };

/** One thing an ability does. Plugins can add their own (`{ myAction: … }`). */
export type Act = Record<string, unknown>;

/** A lasting effect: bonuses granted to units while a condition holds, or a unit that can't attack. */
export interface StaticEffect {
  grant?: { power?: number; health?: number; keywords?: string[] };
  /** Who gets the grant: the card itself, the unit a Talisman is attached to, or each matching unit. */
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
  /** A better version when a condition holds (Súči of the Hunt: deal 2 instead with Company). */
  instead?: { if: Condition; do: Act[] };
  /** "You may": a Hello whose target can be left out. */
  optional?: boolean;
  /** The effect still happens with no legal target (Warm Cider still draws). */
  optionalTarget?: boolean;
  oncePerRound?: boolean;
  /** An Ambush card that can only be set face-down, never played in the Muster (A Whistle in the Dark). */
  pounceOnly?: 'attack';
  /** A mechanic's start-of-round ability that happens as the unit readies, not as a queued step (Rain-Fed). */
  inline?: boolean;
  static?: StaticEffect;
  /** A line for the game log when it happens. */
  log?: string;
  /** A reminder printed after the ability's text, in brackets. */
  note?: string;
  /** A trait's ability: which of the player's units carry it (none: the player does, once). */
  on?: { filter?: UnitFilter };
}

/** Where an ability lives, so a queued step (plain JSON) can find it again. */
export type AbilityRef =
  | { card: string; side?: 'kitten' | 'bigCat'; index: number }
  | { mechanic: string; index: number }
  | { trait: string; tier: number; index: number };

/** A physical card: `uid` is unique within a game, `id` names its definition. */
export interface CardInst {
  uid: number;
  id: string;
}

export interface Unit {
  uid: number;
  id: string;
  /** Its lane, 0 to 5: a unit fights the enemy across from it first, the nearest next. */
  slot: number;
  damage: number;
  /** An exhausted unit deals no damage in the Clash (an enemy's "exhaust" effect). Readied at the Start. */
  exhausted: boolean;
  toy?: CardInst;
  /** Stars (2 or 3), from the copies merged into it: each star adds the card's printed Power and Health again. */
  stars?: number;
  /** Copies of the card in this unit, itself included (Rules.starCopies says how many make each star). */
  copies?: number;
  /** "This round" Power, cleared in the End Phase. */
  buffPower: number;
  /** "This round" Health, cleared in the End Phase. */
  buffHealth?: number;
  /** Keywords granted this round ("Sneaky", "Guardian"). */
  buffKeywords?: string[];
  /** A "once per round" ability has been used since the last Start Phase. */
  usedOnce: boolean;
  /** Mechanics' counters on the unit: { rain: 2 } (Rain-Fed). They stay while the unit stays on the board. */
  counters?: Record<string, number>;
  /** Offerings paid for it, its merged copies included: what selling it gives back (less sellLoss for each star). */
  paid?: number;
}

export interface Hero {
  id: string;
  grown: boolean;
  exhausted: boolean;
  /** How many units the player may field (2 to 6). */
  level: number;
}

/** A target chosen during the Muster: a unit of your own, or a lane of the opponent's (whoever stands there at the Clash). */
export type Target =
  | { kind: 'unit'; uid: number }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'lane'; player: PlayerId; lane: number };

/** An effect aimed at the enemy, waiting for the Clash: it hits whoever stands in its lane then. */
export interface Pending {
  ref: AbilityRef;
  sourceId: string;
  /** A Charm, which goes to the Mist when it resolves. */
  card?: CardInst;
  target?: Target;
  target2?: Target;
  selfUid?: number;
}

/** A face-down Ambush in one of your lanes. */
export interface AmbushCard {
  card: CardInst;
  lane: number;
  /** For a card that may aim at either side: the lane, yours or theirs, it watches. */
  target?: Target;
}

export interface PlayerState {
  name: string;
  deckName: string;
  hero: Hero;
  deck: CardInst[];
  /** The shop: cards dealt face up from the deck at the Start, to buy or let go. What isn't bought goes back into the deck. */
  shop: CardInst[];
  /** Candles left: the last one blown out loses the game. */
  lives: number;
  /** Offerings saved: what units, Charms, Levels and rolls are paid with. What isn't spent is kept, and earns interest. */
  offerings: number;
  /** Clashes lost in a row: a losing streak earns Offerings at the Start. */
  streak?: number;
  /** Rolls this player may make without paying (a card's "Get a free roll"). */
  freeRolls?: number;
  yard: Unit[];
  compost: CardInst[];
  /** Units that went down in this Clash: they stand up again when it ends. */
  fallen?: Unit[];
  /** Effects aimed at the enemy, made this Muster, waiting for the Clash. */
  pending?: Pending[];
  /** Face-down Ambushes, each in one of this player's lanes. */
  ambushes?: AmbushCard[];
  /** Units of this player that have gone down in Clashes this game. */
  downed?: number;
  /** Cards this player has played this round: Orange-Peri's count. */
  playedThisRound?: number;
  /** Candles this player gave up at the start, as a handicap (GameOptions.lives). */
  handicap?: number;
  /** What the opponent sees of this player during the Muster: the player as they stood when it began. */
  shown?: PlayerState;
}

export type Action =
  /** Buy a card from the shop: a unit goes to a lane (or merges into its twin), a Charm happens, a Talisman is attached. */
  | { t: 'play'; uid: number; slot?: number; target?: Target; target2?: Target }
  /** Buy a card with Ambush from the shop and set it face-down in one of your lanes. */
  | { t: 'ambush'; uid: number; lane: number; target?: Target }
  | { t: 'move'; uid: number; slot: number }
  /** Sell a unit you control: it goes back into the deck, and you get back what you paid less sellLoss for each star. */
  | { t: 'sell'; uid: number }
  /** The shop goes back into the deck and a new one is dealt. */
  | { t: 'roll' }
  | { t: 'ability'; target?: Target }
  | { t: 'levelUp' }
  | { t: 'ready' };

/** The decision the game is waiting on. `null` only when the game is over. */
/**
 * The Muster: both players decide at once, each until they are Ready (`GameState.muster.open`). `player` is one of
 * the players still deciding, for callers that drive one seat at a time.
 */
export type Prompt = { kind: 'muster'; player: PlayerId };

/** Pending engine work. Steps are data so the whole game is a pure fold over actions. */
export type Step =
  | { t: 'beginMuster' }
  | { t: 'startRound' }
  | { t: 'endRound' }
  | { t: 'income'; p: PlayerId }
  /** The shop goes back into the deck, which is shuffled, and a new one is dealt. */
  | { t: 'restock'; p: PlayerId }
  | { t: 'loseLife'; p: PlayerId; n: number }
  | { t: 'resolvePlay'; p: PlayerId; card: CardInst; paid: number; slot?: number; target?: Target; target2?: Target }
  /** Run an ability: a Hero's exhaust, a trigger, or an effect that waited for the Clash. */
  | {
    t: 'ability'; p: PlayerId; ref: AbilityRef; target?: Target; target2?: Target; sourceId: string; selfUid?: number;
    trigger?: boolean; card?: CardInst;
  }
  | { t: 'clashStart' }
  | { t: 'pending'; p: PlayerId }
  | { t: 'ambushes'; p: PlayerId }
  | { t: 'heroStrike'; p: PlayerId }
  | { t: 'bout'; n: number }
  | { t: 'strike'; n: number; swift: boolean }
  | { t: 'clashEnd' }
  | { t: 'reset' }
  /** The Clash's own triggers: every standing unit's (and each player's traits') abilities with this trigger. */
  | { t: 'triggers'; when: 'clashStart' | 'boutStart' | 'everyOtherBout' }
  /** After a strike: `uid` hit `foeUid`; if the foe went down, `uid`'s "defeats in combat" abilities happen. */
  | { t: 'combatWin'; uid: number; foeUid: number };

export interface LogEntry {
  round: number;
  player?: PlayerId;
  text: string;
  /** Written during the Muster: only this player may read it until the Clash. */
  secret?: PlayerId;
}

/**
 * What just happened, as data, for a screen to show: one record per visible change, in the order the rules made
 * them. Public information only (a lost Candle's card is secret, so it isn't named); a record made during the Muster
 * is `secret` to the player who made it.
 */
export type GameEvent = (
  | { t: 'play'; p: PlayerId; uid: number; cardId: string; target?: Target }
  | { t: 'ability'; p: PlayerId; heroId: string; target?: Target }
  | { t: 'ambushSet'; p: PlayerId; lane: number }
  | { t: 'ambush'; p: PlayerId; lane: number; cardId: string }
  | { t: 'sell'; p: PlayerId; cardId: string; offerings: number }
  | { t: 'roll'; p: PlayerId; free: boolean }
  | { t: 'move'; p: PlayerId; uid: number; slot: number }
  | { t: 'levelUp'; p: PlayerId; level: number }
  | { t: 'readyUp'; p: PlayerId }
  | { t: 'merge'; p: PlayerId; uid: number; stars: number; copies: number }
  | { t: 'clash'; n: number }
  | { t: 'bout'; n: number }
  /** The board as it stands at the start of the Clash, of each bout, and at its end: for a replay of the fight. */
  | { t: 'board'; units: BoardUnit[] }
  /** One unit's (or Hero's) hit in a bout; `swift` in the bout's first strike, the Swift units'. */
  | { t: 'hit'; from: Target; uid: number; dealt: number; swift?: true }
  | { t: 'clashEnd'; standing: [number, number]; lost: [number, number] }
  | { t: 'fizzled'; cardId?: string }
  | { t: 'damage'; uid: number; amount: number; p: PlayerId }
  | { t: 'heal'; uid: number; amount: number }
  | { t: 'buff'; uid: number; power?: number; health?: number; sneaky?: boolean; guardian?: boolean }
  | { t: 'exhaust'; uid: number }
  | { t: 'ready'; uid: number }
  | { t: 'toy'; uid: number; cardId: string }
  | { t: 'down'; uid: number; cardId: string; owner: PlayerId }
  | { t: 'lifeLost'; p: PlayerId; left: number }
  | { t: 'income'; p: PlayerId; gained: number; offerings: number }
  | { t: 'growUp'; p: PlayerId }
  | { t: 'counter'; uid: number; name: string; value: number }
  | { t: 'summon'; p: PlayerId; uid: number; cardId: string; slot: number }
  | { t: 'freeRoll'; p: PlayerId; n: number }
  | { t: 'round'; n: number }
  | { t: 'win'; p: PlayerId | 'draw' }
) & { secret?: PlayerId; src?: EffectSource };

/** A unit as a replay of the Clash draws it: where it stands, and its numbers at that moment (its auras included). */
export interface BoardUnit {
  uid: number;
  id: string;
  p: PlayerId;
  slot: number;
  power: number;
  health: number;
  damage: number;
  stars?: number;
  copies?: number;
  /** Its Talisman's card id. */
  toy?: string;
  exhausted?: true;
  /** It has gone down in this Clash (it stands up again when the Clash ends). */
  down?: true;
}

/** What made an effect happen, for the screen: whose it is, the card or trait (by id, or a trait's name), and the unit. */
export interface EffectSource {
  p: PlayerId;
  id: string;
  uid?: number;
}

/** The numbers of the rules that playtests tune: docs/rulebook.md, Tunable parameters. */
export interface Rules {
  /** Offerings each player has for round 1. */
  startOfferings: number;
  /** Income at the Start of round 2, 3, …; the last number repeats. */
  income: number[];
  /** Offerings for a losing streak at the Start, by Clashes lost in a row (streak[2]: two in a row); the last repeats. */
  streak: number[];
  /** Cards dealt to the shop. */
  shopSize: number;
  /** The shop's odds of each tier (1 to 5), in percent, by the Hero's Level (shopOdds[3]: at Level 3). */
  shopOdds: number[][];
  /** What a roll costs. */
  rollCost: number;
  /** Selling a unit gives back what was paid for it, less this for each star it has. */
  sellLoss: number;
  /** Interest: +1 Offering for every `interestPer` saved, at most `interestMax`. */
  interestPer: number;
  interestMax: number;
  levelStart: number;
  levelMax: number;
  /** What the next Level costs, by the Level you are at (levelCost[2]: from 2 to 3). */
  levelCost: number[];
  /** Bouts in a Clash before it stops with both sides standing. */
  boutCap: number;
  /** The most Candles a player loses in one Clash. */
  clashCandleCap: number;
  /** At the bout cap, each side loses Candles for the other's standing units (otherwise nobody does). */
  overtimeBothLose: boolean;
  maxRounds: number;
  /** Copies in one unit that make it 2★ and 3★. */
  starCopies: number[];
}

export interface GameState {
  seed: number;
  round: number;
  /** The Lantern: its holder's effects and triggers go first. It passes every round. */
  yarn: PlayerId;
  players: [PlayerState, PlayerState];
  prompt: Prompt | null;
  queue: Step[];
  winner: PlayerId | 'draw' | null;
  nextUid: number;
  log: LogEntry[];
  /** Everything that happened, for the screen. */
  events: GameEvent[];
  /** Number of actions applied; a cheap clock for replays and stats. */
  actions: number;
  startingYarn: PlayerId;
  /** Triggered abilities run since the last action or bout: a cap stops two cards triggering each other forever. */
  chain?: number;
  /** Where the round is. */
  phase: 'setup' | 'muster' | 'clash';
  /** During the Muster: who is still deciding (Ready closes it). */
  muster?: { open: [boolean, boolean] };
  /** Each player's count of decisions, plus one at every public turn of the game: what a move online must quote. */
  clock: [number, number];
  /** Counters as they stood when the Muster began: a player's view can't move with the opponent's Muster. */
  musterStart?: { nextUid: number; actions: number; clock: [number, number] };
  /** The Clash in progress: its bout, and the damage dealt in that bout (a bout with none ends the Clash). */
  clash?: { bout: number; dealt: number; struck: [boolean, boolean] };
  /** Who is acting during the Muster: what they log and emit is secret to them. */
  acting?: PlayerId;
  /** While an ability runs: its source, which every event it emits carries (`src`). */
  effect?: EffectSource;
  rules: Rules;
}
