// A Friend game played directly between the two players' devices (index.ts, "Friend games played directly"): this runs
// it on the device of the friend who asked (seat 0, the host). It's the API's own Match, with a MatchHost that hands
// seat 0's messages to this device's screen and seat 1's to the direct connection, so both players see and do exactly
// what they would in a game the API runs.
//
// Nothing here knows how the two devices are connected (WebRTC on the web; Steam or a phone's own networking could be
// another): the connection gives this runner text from the other device, and a function that sends text to it.
//
// What the other device may send: the same ClientMessages it would send the API about a match, and nothing else. The
// match checks each one exactly as the API does (whose turn, the rules). What it's sent: only its own view (viewFor).

import type { ClientMessage, ServerMessage, Tally } from './index';
import { Match, type MatchHost, type MatchRecord } from './match';

/** Messages about the connection itself, never passed to the match: "are you still there?" and its answer. */
export const peerWire = { ping: '{"t":"ping"}', pong: '{"t":"pong"}' } as const;

/** The ClientMessages about a match that the other device may send. */
const FROM_GUEST = new Set<ClientMessage['t']>(['act', 'hold', 'time', 'end', 'emote', 'hint', 'undo', 'show', 'rematch', 'rejoin', 'leave']);

export interface PeerHostDeps {
  /** A message for this device's own player (seat 0). */
  local(msg: ServerMessage): void;
  /** The record changed: keep it on this device, and send the API its copy. */
  save(record: MatchRecord): void;
  /** The game is over: the API records the result. Each seat's record against the other, when it can say in time. */
  finished(record: MatchRecord): Promise<[Tally | undefined, Tally | undefined]>;
  /** Both players asked for a rematch. */
  rematch(record: MatchRecord): void;
  /** Both players have left the result: the match can be let go. */
  forget(record: MatchRecord): void;
}

export class PeerHost {
  readonly match: Match;
  private guest: ((text: string) => void) | null = null;
  private readonly deps: PeerHostDeps;

  /**
   * The match as the record has it: a new one, or one this device (or the API's copy) had. Nobody is here until they
   * say so: `open()` for this device's player, `linked()` for the other device.
   */
  constructor(record: MatchRecord, deps: PeerHostDeps) {
    this.deps = deps;
    const host = record.seats[0].person.id;
    const matchHost: MatchHost = {
      send: (account, msg) => {
        if (account === host) deps.local(msg);
        else this.guest?.(JSON.stringify(msg));
      },
      save: (m) => deps.save(m.record),
      finished: (m) => deps.finished(m.record),
      rematch: (m) => deps.rematch(m.record),
      forget: (m) => deps.forget(m.record),
    };
    this.match = new Match(record, matchHost);
    this.match.start(true);
  }

  get id() { return this.match.id; }
  get isLinked() { return this.guest !== null; }

  /** This device's player is here (the game opened, or came back to the front): the whole match, as they see it. */
  open() {
    this.match.connected(0);
    this.deps.local(this.match.matchMessage(0));
    const left = this.match.awayLeft(1);
    if (left !== null && !this.match.end) this.deps.local({ t: 'away', match: this.id, seat: 1, left });
  }

  /** This device's player went away (the game in the background): the clock stops for both, as when a connection drops. */
  away() { this.match.dropped(0); }

  /** A move or anything else from this device's own player. */
  fromHere(msg: ClientMessage) {
    if (!('match' in msg) || msg.match !== this.id || !FROM_GUEST.has(msg.t)) return;
    this.match.handle(0, msg);
  }

  /** The other device connected (or reconnected): it's sent the whole match. */
  linked(send: (text: string) => void) {
    this.guest = send;
    this.match.connected(1);
    send(JSON.stringify(this.match.matchMessage(1)));
  }

  /** The direct connection dropped: the other player is away, exactly as when their connection to the API drops. */
  unlinked() {
    if (!this.guest) return;
    this.guest = null;
    this.match.dropped(1);
  }

  /** Text from the other device. Anything but a match message about this game is ignored. */
  fromGuest(text: string) {
    if (text === peerWire.ping) { this.guest?.(peerWire.pong); return; }
    if (text === peerWire.pong || text.length > 64 * 1024) return;
    let msg: ClientMessage;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object' || !FROM_GUEST.has(msg.t) || !('match' in msg) || msg.match !== this.id) return;
    this.match.handle(1, msg);
  }

  /** The API has taken the game over, or it ended elsewhere: stop the timers, and stop talking to the other device. */
  stop() {
    this.guest = null;
    this.match.stop();
  }
}
