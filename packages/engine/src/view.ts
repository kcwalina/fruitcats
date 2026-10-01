// What one player may see of a game: the state an online server sends to that player's screen.
//
// Hidden information is rule 100.5: a player's hand, all face-down Candles, deck order, and the cards of the
// opponent's face-down Ambushes. During the Muster, everything the opponent does is hidden too: the view shows the
// opponent as they stood when the Muster began (`PlayerState.shown`), and leaves out their moves, their Ready, and
// every log line and event their moves made. The view keeps the GameState shape (so the screen can draw it and ask
// `legalActions` about its own decisions) with every hidden card's id replaced by HIDDEN. Deck and Candle cards lose
// their uids too, so not even their owner can follow a card's position in the deck.
//
// Also withheld: the seed (it would predict every draw), the engine's pending work, and what the opponent is
// deciding.

import { HIDDEN, clockFor, other } from './engine';
import type { CardInst, GameEvent, GameState, LogEntry, PlayerId } from './types';

export { HIDDEN };

export interface PlayerView extends GameState {
  /** The player this view is for. */
  seat: PlayerId;
  /** Whose decision the game is waiting on; `prompt` is only filled in when it is this seat's. */
  waitingOn: PlayerId | null;
  /** What a move from this seat must quote (clockFor): a move made on an older view is refused. */
  seq: number;
}

const hidden = (cards: CardInst[], keepUid: boolean): CardInst[] =>
  cards.map((c) => ({ uid: keepUid ? c.uid : 0, id: HIDDEN }));

/** The events a player may see: everything but what the other player did during a Muster not yet over. */
export const visibleEvents = (events: GameEvent[], seat: PlayerId): GameEvent[] =>
  events.filter((e) => e.secret === undefined || e.secret === seat);

/** The log lines a player may read, by the same rule. */
export const visibleLog = (log: LogEntry[], seat: PlayerId): LogEntry[] =>
  log.filter((e) => e.secret === undefined || e.secret === seat);

export function viewFor(s: GameState, seat: PlayerId): PlayerView {
  const v = structuredClone(s) as PlayerView;
  const foe = other(seat);
  v.seat = seat;
  v.seq = clockFor(s, seat);
  v.seed = 0;
  v.queue = [];
  v.events = visibleEvents(v.events ?? [], seat);
  v.log = visibleLog(v.log, seat);
  delete v.acting;
  if (s.prompt?.kind === 'muster' && s.winner === null) {
    // The opponent as they stood when the Muster began; nothing they do until the Clash shows.
    const mine = s.muster!.open[seat];
    v.players[foe] = { ...structuredClone(s.players[foe].shown!), name: s.players[foe].name, deckName: s.players[foe].deckName };
    v.muster = { open: seat === 0 ? [mine, true] : [true, mine] };
    v.prompt = mine ? { kind: 'muster', player: seat } : null;
    v.waitingOn = mine ? seat : foe;
    v.nextUid = s.musterStart!.nextUid;
    v.actions = s.musterStart!.actions;
    v.musterStart = { ...s.musterStart!, clock: seat === 0 ? [s.musterStart!.clock[0], 0] : [0, s.musterStart!.clock[1]] };
    v.clock = seat === 0 ? [s.clock[0], 0] : [0, s.clock[1]];
    v.chain = 0;
  } else {
    v.waitingOn = s.winner === null ? s.prompt?.player ?? null : null;
    if (s.prompt?.player !== seat) v.prompt = null;
  }
  v.players.forEach((pl, p) => {
    delete pl.shown;
    pl.deck = hidden(pl.deck, false);
    pl.lives = hidden(pl.lives, false);
    if (p !== seat) {
      pl.hand = hidden(pl.hand, true);
      pl.ambushes = (pl.ambushes ?? []).map((a) => ({ card: { uid: a.card.uid, id: HIDDEN }, lane: a.lane }));
      pl.pending = [];
      pl.free = [];
    }
  });
  return v;
}
