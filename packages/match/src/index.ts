// Online games (docs/pvp-plan.md): what the game and the Fruitcats API say to each other, and the rules a match is
// played under. Both sides import this file, so each message and each rule is written once.
//
// Friend games and Ranked are the same match with different rules (MatchRules). Nothing in a match asks which mode
// it is in: it reads the rules.

import type { Action, DeckList, PlayerId, PlayerView } from '@fruitcats/engine';

/**
 * Where the game connects while it's playing online (Play a friend, waiting, a game): one WebSocket for presence,
 * friend codes, challenges and matches. The rest of the time the game holds no connection: it says it's here with a
 * small request now and then (HERE_PATH), which is also how a challenge reaches it.
 */
export const LIVE_PATH = '/v1/live';
/** "I'm here" (POST, every HERE_EVERY_MS while the game is open): answers with challenges waiting and a game going. */
export const HERE_PATH = '/v1/live/here';
/** "Let me in" (POST): in, or a place in the waiting line when online play is full, or closed. */
export const ENTER_PATH = '/v1/live/enter';
export const HERE_EVERY_MS = 20_000;
/** A player who hasn't said they're here for this long is offline. */
export const HERE_MS = 50_000;
/** While waiting in line, ask again this often. A place is kept only while it's asked for. */
export const ENTER_EVERY_MS = 10_000;
/** Bumped when a message changes shape: an older game is asked to reload before it can play online. */
export const PROTOCOL = 3;

/**
 * How long a request to play waits for an answer. It's kept on the server from the moment it's sent: it ends when the
 * friend joins or says no, when the one who asked cancels, or after this long. Never because a connection dropped or
 * the game was closed: whoever opens the game again finds it where it was.
 */
export const CHALLENGE_MS = 5 * 60_000;

/** A challenge waiting for you, as "I'm here" or the connection brings it. */
export interface ChallengeNote { id: string; from: Person; options: ChallengeOptions; lives: number }

/** Your own request to play, still waiting for an answer: who it's to, and how long it has left (ms). */
export interface SentNote { id: string; to: string; left: number }

export interface HereAnswer {
  /** Online play is on (the kill switch: LIVE=off on the API turns it off). */
  open: boolean;
  challenges: ChallengeNote[];
  /** Your own request still waiting (older APIs: missing). */
  sent?: SentNote[];
  /** A game you're in that's still going. */
  match: string | null;
}

/**
 * The answer to "let me in". Online play has room for a fixed number of players at once (no autoscaling, so the bill
 * can't grow by itself). When it's full, players wait in line; players who have bought cards go first.
 */
export type EnterAnswer =
  | { status: 'in' }
  | { status: 'waiting'; position: number; paid: boolean }
  | { status: 'closed' };

// ── The clock ────────────────────────────────────────────────────────────────────────────────────

export interface ClockRules {
  /** Time for each decision, in ms; null for no timer. */
  moveMs: number | null;
  /** Each player's reserve for the whole game, used once a decision's own time runs out. */
  reserveMs: number;
  /**
   * What happens when a player's time runs out. 'auto': the game makes the plainest move for them (Ranked).
   * 'ask': nothing happens by itself; the other player chooses to give more time or to nudge (Friend games).
   */
  onTimeout: 'auto' | 'ask';
  /** "Hold on" taps each player gets per game; each adds holdOnMs to the decision in front of them. */
  holdOns: number;
  holdOnMs: number;
  /** 'auto' only: timeouts in a row that lose the game, so a player can't stall by never moving. */
  strikes: number;
}

/** How long a Pounce or Lucky question stays open before it's let go, the same whether there's anything to play. */
export const ASK_MS = 2500;
/** A teaching game's Pounce and Lucky questions: long enough for someone new to read them. */
export const TEACHING_ASK_MS = 8000;
/** In a Friend game, how long a player can be out of time before the other may take the win or call the game off. */
export const OVERTIME_CLAIM_MS = 3 * 60_000;
/** Nudges: at most one per this long. */
export const NUDGE_EVERY_MS = 20_000;

/** The paces a friend can pick when challenging: gentle by default. */
export type Pace = 'relaxed' | 'quick' | 'untimed';

export const PACES: Record<Pace, { label: string; blurb: string; clock: ClockRules }> = {
  relaxed: {
    label: 'Relaxed', blurb: '2 minutes a move',
    clock: { moveMs: 120_000, reserveMs: 0, onTimeout: 'ask', holdOns: 2, holdOnMs: 120_000, strikes: 0 },
  },
  quick: {
    label: 'Quick', blurb: '45 seconds a move',
    clock: { moveMs: 45_000, reserveMs: 0, onTimeout: 'ask', holdOns: 2, holdOnMs: 60_000, strikes: 0 },
  },
  untimed: {
    label: 'No timer', blurb: 'Take all the time you like',
    clock: { moveMs: null, reserveMs: 0, onTimeout: 'ask', holdOns: 0, holdOnMs: 0, strikes: 0 },
  },
};

export const RANKED_CLOCK: ClockRules = { moveMs: 30_000, reserveMs: 120_000, onTimeout: 'auto', holdOns: 0, holdOnMs: 0, strikes: 3 };

// ── Match rules ──────────────────────────────────────────────────────────────────────────────────

/** What the friend who challenges picks. */
export interface ChallengeOptions {
  pace: Pace;
  /**
   * A teaching game, for a friend who is new: no timer, hints, take-backs, either player may show their hand, a
   * gentler end, and it doesn't count in your record against each other.
   */
  teaching: boolean;
  /** Both players play a starter deck, so an experienced player can't bring a tuned one. */
  startersOnly: boolean;
}

export interface MatchRules {
  kind: 'friend' | 'ranked';
  clock: ClockRules;
  /** Hints, take-backs, open hands, slower replays of the other player's moves, a gentler end. */
  teaching: boolean;
  /** How long a Pounce or Lucky question stays open (see ASK_MS). */
  askMs: number;
  /** How long a player whose connection dropped has to come back, before the other player may end the game. */
  dropGraceMs: number;
  /** Whether the result counts: in the record between two friends, or (later) the rating. */
  counts: boolean;
  /** Friend games offer a rematch; Ranked sends you back to the queue instead. */
  rematch: boolean;
  /** Only starter decks (checked when each player picks a deck). */
  startersOnly: boolean;
}

export function friendRules(o: ChallengeOptions): MatchRules {
  return {
    kind: 'friend',
    clock: PACES[o.teaching ? 'untimed' : o.pace].clock,
    teaching: o.teaching,
    askMs: o.teaching ? TEACHING_ASK_MS : ASK_MS,
    dropGraceMs: 3 * 60_000,
    counts: !o.teaching,
    rematch: true,
    startersOnly: o.startersOnly,
  };
}

export function rankedRules(): MatchRules {
  return {
    kind: 'ranked', clock: RANKED_CLOCK, teaching: false, askMs: ASK_MS, dropGraceMs: 60_000,
    counts: true, rematch: false, startersOnly: false,
  };
}

/** A clean challenge from whatever a client sent, or null. */
export function cleanOptions(o: unknown): ChallengeOptions | null {
  const x = o as Partial<ChallengeOptions> | null;
  if (!x || typeof x !== 'object' || !(typeof x.pace === 'string' && x.pace in PACES)) return null;
  // "Starter decks only" is gone: each player picks any deck of theirs (a starter deck is one of them). An older game
  // may still ask for it, and is ignored.
  return { pace: x.pace as Pace, teaching: x.teaching === true, startersOnly: false };
}

/** Lives a player may choose to start with: all 9, or fewer as a handicap. */
export const MIN_LIVES = 3;
export const cleanLives = (n: unknown): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= MIN_LIVES && n <= 9 ? n : null;

// ── People ───────────────────────────────────────────────────────────────────────────────────────

/** A player as others see them: their account id, display name and Pawtrait. Never an email. */
export interface Person { id: string; name: string; avatar: string }

export type Presence = 'online' | 'playing' | 'offline';

/** Games between two friends that counted (teaching games and games called off don't). */
export interface Tally { wins: number; losses: number; draws: number }

export interface FriendStatus {
  id: string;
  status: Presence;
  /** When they were last online (ISO), for "Last seen 3 days ago". */
  lastSeen?: string;
  /** Their name and Pawtrait while they're online (the game also has them from viamochi-id's friends list). */
  person?: Person;
  record?: Tally;
}

export const EMOTES = {
  meow: 'Meow!',
  purr: 'Purr…',
  hiss: 'Hiss!',
  nice: 'Nice play!',
  goodtry: 'Good try!',
  hint: 'Want a hint?',
  gg: 'Good game!',
} as const;
export type Emote = keyof typeof EMOTES;

// ── A match, as a player sees it ─────────────────────────────────────────────────────────────────

export interface MatchInfo {
  id: string;
  /** Your seat. */
  seat: PlayerId;
  players: [Person, Person];
  rules: MatchRules;
  options: ChallengeOptions | null;
}

/** Where the clock stands, as of when the message was sent. */
export interface ClockView {
  /** Whose decision the clock is running for; null when nothing is timed. */
  seat: PlayerId | null;
  /**
   * 'ask': a Pounce or Lucky question, let go when it runs out. 'move': the decision's own time. 'reserve': the
   * reserve is running. 'overtime': out of time in a Friend game; the other player decides. 'paused': a player's
   * connection dropped. 'none': no timer.
   */
  phase: 'ask' | 'move' | 'reserve' | 'overtime' | 'paused' | 'none';
  /** Ms left in this phase when the message was sent; null when it doesn't run out. */
  left: number | null;
  reserve: [number, number];
  holdOns: [number, number];
  /** Overtime: ms until the other player may take the win or call the game off (0: they may now). */
  claimIn: number | null;
}

export type EndHow = 'played' | 'conceded' | 'timeout' | 'left' | 'claimed' | 'called-off';

export interface MatchEnd {
  winner: PlayerId | 'draw' | null;
  how: EndHow;
  /** Friend games that count: your record against them afterwards. */
  record?: Tally;
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────

export type ClientMessage =
  /** First message on a new connection. `name` is only used by a local API with fake sign-in. */
  | { t: 'hello'; token: string; protocol: number; rules: number; avatar: string; name?: string }
  /** My friends' presence again; `again`: also ask viamochi-id who they are (after adding or removing one). */
  | { t: 'friends'; again?: boolean }
  /** The friend code I'm showing (a QR code or typed), so a friend who scans it sees who I am first; null: stopped. */
  | { t: 'code'; code: string | null }
  /** Whose code is this? Asked before adding, so the player can confirm. */
  | { t: 'lookup'; code: string }
  /** I just added this friend with their code: tell them, so their screen can say so. */
  | { t: 'added'; friend: string }
  | { t: 'challenge'; to: string; deck: DeckList; options: ChallengeOptions; lives: number }
  | { t: 'accept'; id: string; deck: DeckList; lives: number }
  | { t: 'decline'; id: string }
  | { t: 'cancel'; id: string }
  | { t: 'act'; match: string; seq: number; action: Action }
  /** Keep a Pounce or Lucky question open, or use a "Hold on" for more time. */
  | { t: 'hold'; match: string }
  /** The other player is out of time: give them more, or nudge them. */
  | { t: 'time'; match: string; what: 'give' | 'nudge' }
  /** Concede, take the win when the other player is gone or out of time, or call the game off. */
  | { t: 'end'; match: string; how: 'concede' | 'claim' | 'call-off' }
  | { t: 'emote'; match: string; emote: Emote }
  | { t: 'hint'; match: string }
  | { t: 'undo'; match: string }
  | { t: 'show'; match: string; on: boolean }
  | { t: 'rematch'; match: string }
  /** Send me the match again (after reconnecting, or to open it from Home). */
  | { t: 'rejoin'; match: string }
  /** I've left the result screen: no rematch. */
  | { t: 'leave'; match: string };

export type ServerMessage =
  | { t: 'welcome'; you: Person; friends: FriendStatus[]; match: string | null; /** Your own requests still waiting. */ sent: SentNote[]; /** Friends' requests waiting for you. */ incoming: ChallengeNote[] }
  /** This game is older than the server: reload to play online. */
  | { t: 'update' }
  /** Online play is full (ask to be let in first), or switched off. The connection is closed after this. */
  | { t: 'full' }
  | { t: 'closed' }
  /** Nothing happened on this connection for a while and it isn't in a game: it's closed to make room. */
  | { t: 'idle' }
  | { t: 'error'; message: string }
  | { t: 'presence'; friend: FriendStatus }
  | { t: 'friends'; friends: FriendStatus[] }
  | { t: 'looked'; code: string; person: Person | null; yours: boolean }
  /** Someone added you as a friend: look at your friends again. */
  | { t: 'added'; by: Person }
  | { t: 'sent'; id: string; to: string; left: number }
  | { t: 'challenge'; id: string; from: Person; options: ChallengeOptions; lives: number }
  | { t: 'challenge-ended'; id: string; why: 'declined' | 'cancelled' | 'expired' | 'offline' | 'busy' | 'started' }
  /** A match you're in: its players and rules, and where it stands. Sent at the start and when you rejoin. */
  | { t: 'match'; info: MatchInfo; view: PlayerView; clock: ClockView; showing: [boolean, boolean]; rematch: [boolean, boolean]; end: MatchEnd | null }
  /**
   * The game moved on. `view.events` holds only what happened since the last view you were sent, and `view.log` only
   * the story from line `logFrom` on (the lines before it are the ones you already have).
   */
  | { t: 'view'; match: string; view: PlayerView; logFrom: number; clock: ClockView; showing: [boolean, boolean]; undone?: PlayerId }
  | { t: 'clock'; match: string; clock: ClockView; held?: PlayerId }
  | { t: 'emote'; match: string; seat: PlayerId; emote: Emote }
  | { t: 'away'; match: string; seat: PlayerId; left: number }
  | { t: 'back'; match: string; seat: PlayerId }
  | { t: 'nudge'; match: string }
  | { t: 'hint'; match: string; action: Action | null }
  | { t: 'end'; match: string; end: MatchEnd }
  | { t: 'rematch'; match: string; wants: [boolean, boolean] };

/** Friend codes as viamochi-id makes them: 6 letters and digits, shown as K7M-4Q2. */
export const normalizeCode = (code: string): string => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const validCode = (code: string): boolean => /^[A-Z0-9]{6}$/.test(normalizeCode(code));
