// What one player may see of a game: the state an online server sends to that player's screen.
//
// Hidden information is exactly rule 100.5: a player's hand, all face-down Lives, deck order, and the
// opponent's face-down Treats. The view keeps the GameState shape (so the screen can draw it and ask
// `legalActions` about its own decisions) with every hidden card's id replaced by HIDDEN. Deck and Lives
// cards lose their uids too, so not even their owner can follow a card's position in the deck.
//
// Also withheld: the seed (it would predict every draw), the engine's pending work, and what the
// opponent is deciding. Their prompt alone would leak a card: a Pounce prompt means they hold a Pounce,
// and a Lucky prompt means the Life they just lost is Lucky (rule 700.3 lets them keep that secret).

import type { CardInst, GameState, PlayerId } from './types';

export const HIDDEN = '?';

export interface PlayerView extends GameState {
  /** The player this view is for. */
  seat: PlayerId;
  /** Whose decision the game is waiting on; `prompt` is only filled in when it is this seat's. */
  waitingOn: PlayerId | null;
}

const hidden = (cards: CardInst[], keepUid: boolean): CardInst[] =>
  cards.map((c) => ({ uid: keepUid ? c.uid : 0, id: HIDDEN }));

export function viewFor(s: GameState, seat: PlayerId): PlayerView {
  const v = structuredClone(s) as PlayerView;
  v.seat = seat;
  v.waitingOn = s.winner === null ? s.prompt?.player ?? null : null;
  if (s.prompt?.player !== seat) v.prompt = null;
  v.seed = 0;
  v.queue = [];
  v.players.forEach((pl, p) => {
    pl.deck = hidden(pl.deck, false);
    pl.lives = hidden(pl.lives, false);
    if (p !== seat) {
      pl.hand = hidden(pl.hand, true);
      pl.pantry = pl.pantry.map((t) => ({ ...t, card: { uid: t.card.uid, id: HIDDEN } }));
    }
  });
  return v;
}
