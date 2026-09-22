// Game state, actions and prompts. Everything here is plain JSON so a state can be cloned,
// serialized, replayed, sent over a socket or shown to an LLM without conversion.

export type PlayerId = 0 | 1;
export type CardType = 'Hero Cat' | 'Cat' | 'Critter' | 'Trick' | 'Toy';

export interface HeroSide {
  name: string;
  text: string;
  power?: number;
}

export interface CardDef {
  id: string;
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
}

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
  buffSneaky: boolean;
  buffGuardian: boolean;
  /** A "once per round" ability has been used since the last Start Phase. */
  usedOnce: boolean;
  /** Orchard's Ripen: +1/+1 per Start Phase survived, up to RIPEN_MAX. */
  ripe?: number;
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
  | { t: 'play'; uid: number; target?: Target }
  | { t: 'attack'; attacker: Target; target: Target }
  | { t: 'ability'; target?: Target }
  | { t: 'takeYarn' }
  | { t: 'pass' }
  | { t: 'pounce'; uid: number; target?: Target }
  | { t: 'decline' }
  | { t: 'lucky'; target?: Target }
  | { t: 'keepLucky' }
  | { t: 'choose'; target: Target }
  | { t: 'discard'; uids: number[] };

export type TargetSpec = 'anyUnit' | 'ownUnit' | 'enemyUnit' | 'ownOtherUnit' | 'exhaustedUnit' | 'ownUnitNoToy';

export type EffectKey =
  | 'damage1' | 'damage2' | 'damage4' | 'damageEachEnemy1'
  | 'heal2' | 'heal3' | 'heal3guard' | 'heal3draw' | 'grannyHeal'
  | 'exhaustEnemy' | 'readyOwn' | 'readyOther'
  | 'buff1' | 'buff2' | 'buff2sneaky'
  | 'draw1' | 'drawIfGuardian'
  | 'cancelAttack'
  // Tropical: ramp
  | 'damage5' | 'healEach2' | 'readyTreat1' | 'readyTreat2' | 'sprout1' | 'sprout2' | 'drawIfTreats7' | 'buff2readyTreat'
  // Citrus: Zest
  | 'damage1zest2' | 'damage3zest5' | 'zestBuffSelf1' | 'zestReadySelf';

/** An open Pounce window: what the defender is reacting to. */
export type Window =
  | { kind: 'play'; by: PlayerId; card: CardInst; target?: Target }
  | { kind: 'attack'; by: PlayerId; attacker: Target; target: Target; cancelled: boolean };

/** The decision the game is waiting on. `null` only when the game is over. */
export type Prompt =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'setupPlant'; player: PlayerId; count: number }
  | { kind: 'plant'; player: PlayerId }
  | { kind: 'action'; player: PlayerId }
  | { kind: 'pounce'; player: PlayerId }
  | { kind: 'lucky'; player: PlayerId; uid: number }
  | { kind: 'choose'; player: PlayerId; effect: EffectKey; spec: TargetSpec; sourceId: string }
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
  | { t: 'resolvePlay'; p: PlayerId; card: CardInst; target?: Target; closesWindow: boolean }
  | { t: 'resolveAttack' }
  | { t: 'effect'; p: PlayerId; effect: EffectKey; target?: Target; sourceId: string }
  | { t: 'choosePrompt'; p: PlayerId; effect: EffectKey; spec: TargetSpec; sourceId: string }
  | { t: 'sanguine'; uid: number; foeUid: number };

export interface LogEntry {
  round: number;
  player?: PlayerId;
  text: string;
}

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
  /** Number of actions applied; a cheap clock for replays and stats. */
  actions: number;
  startingYarn: PlayerId;
}
