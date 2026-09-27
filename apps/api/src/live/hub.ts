// Online play's switchboard (docs/pvp-plan.md). A game that's playing online (Play a friend, waiting, a game) keeps one
// connection here, which carries
//   - presence: which of your friends are online, or in a game;
//   - friend codes: the code you're showing (as a QR code or typed), so a friend who scans it sees who you are before
//     adding you. Adding itself is viamochi-id's (the game redeems the code there, as before);
//   - challenges: Friend's way into a match. (Ranked's, the queue, comes later and ends the same way: startMatch);
//   - the matches themselves (match.ts).
//
// Who is friends with whom is viamochi-id's: the hub asks it with the player's own token when they connect, and again
// when they say their friends changed. A challenge is only sent between two people on each other's lists.
//
// What it costs is fixed (docs/pvp-plan.md, What online play costs). There's room for `maxPlayers` connections at once
// and no more, so the bill can't grow by itself:
//   - a game that isn't playing online holds no connection. It says "I'm here" now and then (here()), which is how its
//     friends see it online and how a challenge reaches it;
//   - to connect, a game asks to be let in first (enter()). When there's no room it gets a place in the waiting line and
//     asks again every few seconds; players who have bought cards go first. Waiting holds no connection either;
//   - a connection that isn't in a game and does nothing for 10 minutes is closed, to make room;
//   - LIVE=off on the API turns online play off (docs/emergency-stop.md).
//
// Friend games are played directly between the two devices when both can (@fruitcats/match, "Friend games played
// directly"): then the hub only introduces them, passes along what they need to connect (peer()), keeps a checked copy
// of the record, and records the result. Neither holds a connection here while they play. When they can't reach each
// other, the hub takes the game over from its copy (serve()).
//
// The hub knows nothing about sockets: socket.ts turns a WebSocket into connect/receive/closed, and the tests use
// plain functions.

import { CARDS, RULES_VERSION, other, type DeckList, type PlayerId } from '@fruitcats/engine';
import {
  CHALLENGE_MS, HERE_MS, PEER_LINK_MS, PEER_SIGNAL_MS, PROTOCOL, cleanLives, cleanOptions, friendRules, normalizeCode, rebuild, validCode,
  type ChallengeNote, type ChallengeOptions, type ClientMessage, type EndHow, type EnterAnswer, type FriendStatus, type HereAnswer,
  type MatchEnd, type PeerNote, type PeerPollAnswer, type PeerSaveAnswer, type PeerSignal, type Person, type Played, type SentNote,
  type ServerMessage, type Tally,
} from '@fruitcats/match';
import { Match, newMatchId, newSeed, type MatchHost, type MatchRecord } from './match';
import type { LiveStore } from './records';

export interface HubDeps {
  store: LiveStore;
  /** The account a token belongs to, and its display name. `name` is only used by a local API with fake sign-in. */
  verify(token: string, name?: string): Promise<{ id: string; name: string } | null>;
  /** The account ids of this account's friends, from viamochi-id. */
  friendsOf(account: string, token: string): Promise<string[]>;
  /** Why this deck can't be played by this account (not finished, cards not owned), or null if it can. */
  checkDeck(account: string, deck: DeckList, startersOnly: boolean): Promise<string | null>;
  /** Has this account bought anything? Buyers go first in the waiting line. */
  paid(account: string): Promise<boolean>;
  /** How many players may be connected at once. */
  maxPlayers: number;
  /** Online play is switched on (LIVE=off turns it off). */
  open(): boolean;
  /** Friend games may be played directly between the devices (LIVE_PEER=off: always on the API). */
  peers?(): boolean;
  log(event: string, fields?: Record<string, unknown>): void;
}

/** One app's connection. */
export interface Connection {
  receive(text: string): void;
  closed(): void;
}

interface Conn {
  account: string | null;
  person: Person;
  token: string;
  friends: Set<string>;
  /** viamochi-id couldn't be asked for the friends when this connected: asked again at the next presence check. */
  friendsStale?: boolean;
  send(msg: ServerMessage): void;
  close(): void;
  /** Code lookups in the last minute, so codes can't be guessed by trying them all. */
  lookups: number[];
  /** When this connection last did something (other than asking for presence), to close it when idle. */
  active: number;
}

interface Challenge {
  id: string;
  from: string;
  /** Who asked, as their friend sees them: kept here, since they may step away for a moment while it's open. */
  fromPerson: Person;
  to: string;
  deck: DeckList;
  options: ChallengeOptions;
  lives: number;
  expires: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A challenge nobody answers is withdrawn after this long (@fruitcats/match). Nothing else ends it but an answer or a
 * cancel: a connection dropping or the game closing doesn't. (A friend who isn't connected hears of it within
 * HERE_EVERY_MS.)
 */
export { CHALLENGE_MS };
/** Once let in, this long to connect before the place goes to someone else. */
export const LET_IN_MS = 60_000;
/** A place in the waiting line is kept this long after it was last asked for. */
const WAITING_KEPT_MS = 30_000;
/** A connection that isn't in a game and does nothing for this long is closed, to make room. */
export const IDLE_CONNECTION_MS = 10 * 60_000;
/** Whether someone has bought anything, remembered this long. */
const PAID_KEPT_MS = 10 * 60_000;
/** A friend code works for 15 minutes (viamochi-id's rule); after that the hub forgets it too. */
const CODE_MS = 15 * 60_000;
const LOOKUPS_PER_MINUTE = 12;
const MAX_MESSAGE = 64 * 1024;
/** A game played directly with neither device heard from this long is called off (as BOTH_GONE_MS for the API's). */
export const PEER_GONE_MS = 30 * 60_000;
/** A game played directly with no move for this long is called off (as IDLE_MS for the API's). */
export const PEER_IDLE_MS = 24 * 60 * 60_000;
/** A device heard from within this long is still trying to connect (it asks every PEER_POLL_MS). */
const PEER_TRYING_MS = 5000;
/** A finished game played directly is remembered this long, so a device that saves it again hears the same answer. */
const PEER_ENDED_MS = 60 * 60_000;
/** Moves in one record, at most (a real game has a few hundred). */
const MAX_PLAYED = 5000;
/** What one device may leave for the other at once. */
const MAX_MAIL = 8;

/** A Friend game played directly between the two devices, as the hub keeps it. */
interface PeerGame {
  record: MatchRecord;
  /** When each seat's device was last heard from about this game (asking for news, saving, "I'm here"). */
  seen: [number, number];
  /** Since when each seat's device has been trying to reach the other (null: connected, or not trying). */
  trying: [number | null, number | null];
  /** How many moves seat 0's device says it has: the hub takes the game over only once its copy has them all. */
  hostPlayed: number;
  /** The device that runs the game: the one that last asked for the record. Another device of that account stops. */
  device: string | null;
  /** What each seat's device hasn't been passed yet. */
  mail: [(PeerSignal & { at: number })[], (PeerSignal & { at: number })[]];
  /** When the last move was saved. */
  moved: number;
}

export function createHub(deps: HubDeps) {
  const conns = new Map<string, Conn>();                 // account → its connection (the newest one)
  const matches = new Map<string, Match>();              // match id → match
  const matchOf = new Map<string, string>();             // account → the match it's in
  const challenges = new Map<string, Challenge>();
  const codes = new Map<string, { account: string; person: Person; expires: number }>();
  const saving = new Map<string, ReturnType<typeof setTimeout>>();
  /** Games that said "I'm here" lately, without a connection: account → when, and who (for their friends' lists). */
  const here = new Map<string, { at: number; person?: Person }>();
  /** Let in and not connected yet: account → until when the place is kept. */
  const letIn = new Map<string, number>();
  /** The waiting line: account → when they joined, whether they've bought anything, and when they last asked. */
  const waiting = new Map<string, { since: number; paid: boolean; asked: number }>();
  const paidCache = new Map<string, { paid: boolean; at: number }>();
  /** Each account's friends as viamochi-id last told us: used while it can't be asked (restarting, down). */
  const knownFriends = new Map<string, Set<string>>();
  /** Friend games played directly between the two devices: match id → game. */
  const peers = new Map<string, PeerGame>();
  /** Games played directly that are over: how each ended and each seat's record (a device may save it again). */
  const peersEnded = new Map<string, { end: MatchEnd; records: [Tally | null, Tally | null]; seats: [string, string]; at: number; record: MatchRecord; /** The rematch, once asked for. */ next: MatchRecord | null }>();
  /** Accounts whose game (the newest to say hello or "I'm here") can play a Friend game directly. */
  const peerCapable = new Map<string, boolean>();

  /**
   * Ask viamochi-id who this connection's friends are. When it can't answer, the last list it gave stays (a restart
   * of viamochi-id must not make everyone's friends vanish), and the connection asks again at its next presence check.
   */
  async function loadFriends(c: Conn, account: string, token: string): Promise<void> {
    try {
      c.friends = new Set(await deps.friendsOf(account, token));
      knownFriends.set(account, c.friends);
      c.friendsStale = false;
    } catch {
      c.friends = knownFriends.get(account) ?? c.friends;
      c.friendsStale = true;
    }
  }

  const sendTo = (account: string, msg: ServerMessage) => conns.get(account)?.send(msg);

  // ── Room: letting players in, and the waiting line ────────────────────────────────────────────

  /** Places taken: connections, and players let in who haven't connected yet. */
  const taken = () => conns.size + letIn.size;

  async function isPaid(account: string): Promise<boolean> {
    const known = paidCache.get(account);
    if (known && Date.now() - known.at < PAID_KEPT_MS) return known.paid;
    let paid = false;
    try { paid = await deps.paid(account); } catch { paid = known?.paid ?? false; }
    paidCache.set(account, { paid, at: Date.now() });
    return paid;
  }

  /** The line in order: buyers first, then by when they joined. */
  const line = () => [...waiting.entries()].sort(([, a], [, b]) => Number(b.paid) - Number(a.paid) || a.since - b.since).map(([a]) => a);

  async function enter(account: string): Promise<EnterAnswer> {
    if (!deps.open()) return { status: 'closed' };
    sweep();
    // Already here, or in a game (coming back to it never waits), or let in a moment ago.
    if (conns.has(account) || matchOf.has(account) || letIn.has(account)) {
      if (!conns.has(account)) letIn.set(account, Date.now() + LET_IN_MS);
      waiting.delete(account);
      return { status: 'in' };
    }
    const paid = await isPaid(account);
    const spot = waiting.get(account);
    if (spot) { spot.asked = Date.now(); spot.paid = paid; } else waiting.set(account, { since: Date.now(), paid, asked: Date.now() });
    const order = line();
    const room = deps.maxPlayers - taken();
    const position = order.indexOf(account);
    if (position < room) {
      waiting.delete(account);
      letIn.set(account, Date.now() + LET_IN_MS);
      if (spot) deps.log('live.let_in', { waited: Math.round((Date.now() - spot.since) / 1000), paid });
      return { status: 'in' };
    }
    if (!spot) deps.log('live.waiting', { position: position - room + 1, paid, players: taken() });
    return { status: 'waiting', position: position - Math.max(0, room) + 1, paid };
  }

  function hereNow(account: string, person?: Person, peer?: boolean): HereAnswer {
    here.set(account, { at: Date.now(), person });
    if (peer !== undefined) peerCapable.set(account, peer);
    const pg = peers.get(matchOf.get(account) ?? '');
    if (pg) pg.seen[seatIn(pg.record, account)!] = Date.now();
    const m = matches.get(matchOf.get(account) ?? '');
    const notes: ChallengeNote[] = [];
    for (const ch of challenges.values()) {
      if (ch.to !== account) continue;
      notes.push({ id: ch.id, from: ch.fromPerson, options: ch.options, lives: ch.lives });
    }
    return { open: deps.open(), challenges: notes, sent: sentBy(account), match: m && !m.end ? m.id : pg ? pg.record.id : null, peer: peerNote(account) ?? undefined };
  }

  /** Let go of what's run out: presence, places in line, places kept, idle connections. */
  function sweep() {
    const now = Date.now();
    for (const [a, h] of here) if (now - h.at > HERE_MS) { here.delete(a); void deps.store.seen(a, new Date(h.at).toISOString()).catch(() => {}); }
    for (const [a, w] of waiting) if (now - w.asked > WAITING_KEPT_MS) waiting.delete(a);
    for (const [code, v] of codes) if (v.expires < now) codes.delete(code);
    for (const [a, until] of letIn) if (until < now) letIn.delete(a);
    for (const pg of [...peers.values()]) {
      if (now - Math.max(...pg.seen) > PEER_GONE_MS || now - pg.moved > PEER_IDLE_MS) void endPeer(pg, { winner: null, how: 'called-off' });
      for (const box of pg.mail) while (box.length && now - box[0].at > PEER_SIGNAL_MS) box.shift();
    }
    for (const [id, e] of peersEnded) if (now - e.at > PEER_ENDED_MS) peersEnded.delete(id);
    for (const c of conns.values()) {
      if (now - c.active < IDLE_CONNECTION_MS || inGame(c.account!)) continue;
      c.send({ t: 'idle' });
      c.close();
      conns.delete(c.account!);
      afterClose(c);
    }
  }
  const sweeper = setInterval(sweep, 30_000);

  /** Once a day (and soon after starting): replays older than 30 days are deleted. */
  const prune = () => void deps.store.pruneReplays(new Date())
    .then((n) => { if (n) deps.log('live.replays_pruned', { removed: n }); })
    .catch((e) => deps.log('live.prune_failed', { message: (e as Error).message }));
  const pruneFirst = setTimeout(prune, 5 * 60_000);
  const pruner = setInterval(prune, 24 * 60 * 60_000);

  // ── Presence ──────────────────────────────────────────────────────────────────────────────────

  const statusOf = (account: string): FriendStatus['status'] => {
    if (!conns.has(account)) return Date.now() - (here.get(account)?.at ?? 0) <= HERE_MS ? 'online' : 'offline';
    const m = matches.get(matchOf.get(account) ?? '');
    return (m && !m.end) || peers.has(matchOf.get(account) ?? '') ? 'playing' : 'online';
  };

  /** Tell this account's online friends how it is now. */
  function announce(account: string) {
    const c = conns.get(account);
    const friends = c?.friends ?? new Set<string>();
    for (const f of friends) {
      const fc = conns.get(f);
      if (fc?.friends.has(account)) fc.send({ t: 'presence', friend: { id: account, status: statusOf(account), lastSeen: c ? undefined : new Date().toISOString(), person: c?.person } });
    }
  }

  /** Every friend's status at once: their records and last-seen are read side by side, not one friend after another. */
  function statuses(c: Conn): Promise<FriendStatus[]> {
    return Promise.all([...c.friends].map(async (f) => {
      const status = statusOf(f);
      // The records and last-seen are extras: storage not answering leaves them out rather than the whole list.
      const [seen, record] = await Promise.all([
        status === 'offline' ? lastSeen(f).catch(() => undefined) : undefined, tally(c.account!, f).catch(() => undefined),
      ]);
      return { id: f, status, lastSeen: seen, person: conns.get(f)?.person ?? (status === 'online' ? here.get(f)?.person : undefined), record };
    }));
  }

  // Presence is asked for every 30 s while Play a friend is open: records and last-seen are remembered, not read each time.
  const tallies = new Map<string, Tally>();
  const tally = async (a: string, b: string) => {
    const key = `${a}|${b}`;
    let t = tallies.get(key);
    if (!t) { t = await deps.store.tally(a, b); tallies.set(key, t); }
    return t;
  };
  const seenCache = new Map<string, { at: string | undefined; read: number }>();
  const lastSeen = async (a: string) => {
    const known = seenCache.get(a);
    if (known && Date.now() - known.read < 5 * 60_000) return known.at;
    const at = await deps.store.lastSeen(a);
    seenCache.set(a, { at, read: Date.now() });
    return at;
  };

  // ── Matches ───────────────────────────────────────────────────────────────────────────────────

  const host: MatchHost = {
    send: sendTo,
    save(m) {
      // At most one write a second per match: a burst of moves is one write.
      if (saving.has(m.id)) return;
      saving.set(m.id, setTimeout(() => {
        saving.delete(m.id);
        void (m.end ? deps.store.finishMatch(m.record) : deps.store.saveMatch(m.record))
          .catch((e) => deps.log('live.save_failed', { match: m.id, message: (e as Error).message }));
      }, 1000));
    },
    async finished(m) {
      const [a, b] = [m.account(0), m.account(1)];
      // The end of a game counts as something happening: both players get their time on the result screen.
      for (const acct of [a, b]) { const c = conns.get(acct); if (c) c.active = Date.now(); }
      deps.log('live.match_ended', { match: m.id, kind: m.record.rules.kind, how: m.end?.how, winner: m.end?.winner, moves: m.record.played.length });
      for (const acct of [a, b]) announce(acct);
      return recordResult(m.record);
    },
    rematch(m) {
      forget(m);
      const r = m.record;
      startMatch([r.seats[0], r.seats[1]], r.options, other(m.state.startingYarn));
    },
    forget,
  };

  /** A game that counts is over: one more win, loss or draw in each friend's record against the other. */
  async function recordResult(r: MatchRecord): Promise<[Tally | undefined, Tally | undefined]> {
    const [a, b] = [r.seats[0].person.id, r.seats[1].person.id];
    const w = r.end?.winner;
    if (!r.rules.counts || w === null || w === undefined) return [undefined, undefined];
    try {
      const resultFor = (seat: PlayerId) => (w === 'draw' ? 'draw' : w === seat ? 'win' : 'loss');
      const both = [await deps.store.addResult(a, b, resultFor(0)), await deps.store.addResult(b, a, resultFor(1))] as [Tally, Tally];
      tallies.set(`${a}|${b}`, both[0]);
      tallies.set(`${b}|${a}`, both[1]);
      return both;
    } catch (e) {
      deps.log('live.record_failed', { match: r.id, message: (e as Error).message });
      return [undefined, undefined];
    }
  }

  function forget(m: Match) {
    if (matches.get(m.id) !== m) return;   // already forgotten (both left, then the result's time ran out)
    matches.delete(m.id);
    for (const seat of [0, 1] as PlayerId[]) if (matchOf.get(m.account(seat)) === m.id) matchOf.delete(m.account(seat));
  }

  function startMatch(seats: MatchRecord['seats'], options: ChallengeOptions | null, firstPlayer?: PlayerId): Match {
    const record: MatchRecord = {
      id: newMatchId(), rules: friendRules(options ?? { pace: 'relaxed', teaching: false, startersOnly: false }), options,
      seats, seed: newSeed(), firstPlayer, played: [], createdAt: new Date().toISOString(), rulesVersion: RULES_VERSION, end: null,
    };
    const m = new Match(record, host);
    matches.set(m.id, m);
    for (const s of seats) {
      matchOf.set(s.person.id, m.id);
      for (const ch of [...challenges.values()]) if (ch.from === s.person.id || ch.to === s.person.id) endChallenge(ch, 'busy');
    }
    m.start();
    host.save(m);
    for (const s of seats) announce(s.person.id);
    deps.log('live.match_started', { match: m.id, kind: record.rules.kind, teaching: record.rules.teaching, pace: options?.pace, lives: seats.map((s) => s.lives) });
    return m;
  }

  // ── Friend games played directly between the two devices ──────────────────────────────────────

  const seatIn = (r: MatchRecord, account: string): PlayerId | null =>
    r.seats[0].person.id === account ? 0 : r.seats[1].person.id === account ? 1 : null;

  /** The game played directly that this account is in, if any, and its seat. */
  function peerNote(account: string): PeerNote | null {
    const pg = peers.get(matchOf.get(account) ?? '');
    return pg ? { match: pg.record.id, seat: seatIn(pg.record, account)! } : null;
  }

  function addPeer(record: MatchRecord): PeerGame {
    const now = Date.now();
    const pg: PeerGame = { record, seen: [now, now], trying: [null, null], hostPlayed: record.played.length, device: null, mail: [[], []], moved: now };
    peers.set(record.id, pg);
    for (const s of record.seats) matchOf.set(s.person.id, record.id);
    return pg;
  }

  /** At most one write a second per game, as for the API's own games. */
  function savePeer(pg: PeerGame) {
    const id = pg.record.id;
    if (saving.has(id)) return;
    saving.set(id, setTimeout(() => {
      saving.delete(id);
      if (peers.get(id) !== pg) return;
      void deps.store.saveMatch(pg.record).catch((e) => deps.log('live.save_failed', { match: id, message: (e as Error).message }));
    }, 1000));
  }

  /** A Friend game played directly: the hub keeps its record and tells both games ("I'm here" tells one that isn't connected). */
  function startPeer(seats: MatchRecord['seats'], options: ChallengeOptions | null, firstPlayer?: PlayerId): PeerGame {
    const record: MatchRecord = {
      id: newMatchId(), rules: friendRules(options ?? { pace: 'relaxed', teaching: false, startersOnly: false }), options,
      seats, seed: newSeed(), firstPlayer, played: [], createdAt: new Date().toISOString(), rulesVersion: RULES_VERSION, end: null, peer: true,
    };
    const pg = addPeer(record);
    for (const s of seats) for (const ch of [...challenges.values()]) if (ch.from === s.person.id || ch.to === s.person.id) endChallenge(ch, 'busy');
    savePeer(pg);
    seats.forEach((s, seat) => sendTo(s.person.id, { t: 'peer', match: record.id, seat: seat as PlayerId }));
    for (const s of seats) announce(s.person.id);
    deps.log('live.match_started', { match: record.id, kind: record.rules.kind, peer: true, teaching: record.rules.teaching, pace: options?.pace, lives: seats.map((s) => s.lives) });
    return pg;
  }

  /** A game played directly is over: the result is recorded, and the replay kept, as for the API's own games. */
  async function endPeer(pg: PeerGame, end: MatchEnd): Promise<[Tally | null, Tally | null]> {
    const id = pg.record.id;
    if (peers.get(id) !== pg) return peersEnded.get(id)?.records ?? [null, null];
    peers.delete(id);
    const seats: [string, string] = [pg.record.seats[0].person.id, pg.record.seats[1].person.id];
    for (const a of seats) if (matchOf.get(a) === id) matchOf.delete(a);
    pg.record.end = end;
    const entry = { end, records: [null, null] as [Tally | null, Tally | null], seats, at: Date.now(), record: pg.record, next: null as MatchRecord | null };
    peersEnded.set(id, entry);
    deps.log('live.match_ended', { match: id, kind: pg.record.rules.kind, peer: true, how: end.how, winner: end.winner, moves: pg.record.played.length });
    for (const a of seats) announce(a);
    const r = await recordResult(pg.record);
    entry.records = [r[0] ?? null, r[1] ?? null];
    await deps.store.finishMatch(pg.record).catch((e) => deps.log('live.save_failed', { match: id, message: (e as Error).message }));
    return entry.records;
  }

  /**
   * The two devices can't reach each other: the hub takes the game over from its copy of the record, and it carries on
   * as one of its own. Both devices hear so (their next poll) and connect here as for any online game.
   */
  function serve(pg: PeerGame) {
    const id = pg.record.id;
    peers.delete(id);
    const record: MatchRecord = { ...pg.record };
    delete record.peer;
    const m = new Match(record, host);
    matches.set(id, m);
    m.start(true);
    host.save(m);
    deps.log('live.peer_served', { match: id, moves: record.played.length });
  }

  /** Both devices have been trying to reach each other for a while, and the hub's copy has every move: take it over. */
  function shouldServe(pg: PeerGame): boolean {
    const now = Date.now();
    const [a, b] = pg.trying;
    return a !== null && b !== null && now - pg.seen[0] < PEER_TRYING_MS && now - pg.seen[1] < PEER_TRYING_MS
      && now - Math.max(a, b) >= PEER_LINK_MS && pg.hostPlayed === pg.record.played.length;
  }

  /** A record's moves as a device sent them, cleaned, or null when they don't make sense. */
  function cleanPlayed(x: unknown): Played[] | null {
    if (!Array.isArray(x) || x.length > MAX_PLAYED) return null;
    const out: Played[] = [];
    for (const p of x as Played[]) {
      if (!p || (p.seat !== 0 && p.seat !== 1) || !p.action || typeof p.action !== 'object' || typeof p.action.t !== 'string') return null;
      out.push(p.auto === true ? { seat: p.seat, action: p.action, auto: true } : { seat: p.seat, action: p.action });
    }
    return out;
  }

  const END_HOWS: EndHow[] = ['played', 'conceded', 'timeout', 'left', 'claimed', 'called-off'];
  function cleanEnd(x: unknown): MatchEnd | null {
    const e = x as MatchEnd | null;
    if (!e || typeof e !== 'object' || !END_HOWS.includes(e.how) || ![0, 1, 'draw', null].includes(e.winner as never)) return null;
    return { winner: e.winner, how: e.how };
  }

  /**
   * A device about its game played directly (PEER_PATH): `what` is
   *   record  (seat 0) the record, to run the game: after a reload, or on another device (which then runs it);
   *   poll    what's waiting for it (the other device's offer or answer), and whether the hub has taken the game over;
   *   signal  an offer (seat 0) or answer (seat 1) for the other device;
   *   save    (seat 0) the record after a move, checked by playing it through; with `end` when the game is over;
   *   end     conceding, or ending a game whose other player has been gone too long, while the devices aren't connected;
   *   rematch (seat 0) both asked for another game.
   */
  async function peer(account: string, id: string, what: string, body: Record<string, unknown>): Promise<[number, unknown]> {
    const now = Date.now();
    const pg = peers.get(id);
    const served = matches.get(id);
    const ended = peersEnded.get(id);
    const r = pg?.record ?? served?.record;
    const seat = r ? seatIn(r, account) : ended ? ([0, 1] as PlayerId[]).find((s) => ended.seats[s] === account) ?? null : null;
    if (seat === null) return [404, { error: 'not_found' }];
    const device = typeof body.device === 'string' ? body.device.slice(0, 64) : null;
    const hostOnly = what === 'record' || what === 'save' || what === 'rematch';
    if (hostOnly && seat !== 0) return [403, { error: 'not_host' }];
    const gone = (): PeerPollAnswer => ({ signals: [], serve: !!served, end: ended?.end ?? served?.end ?? null, replaced: false });
    const replaced = seat === 0 && !!pg && !!device && !!pg.device && device !== pg.device;
    if (pg) pg.seen[seat] = now;

    switch (what) {
      case 'record': {
        if (!pg) return [200, { record: null, ...gone() }];
        if (device) pg.device = device;
        return [200, { record: pg.record }];
      }
      case 'poll': {
        if (!pg) return [200, gone()];
        if (replaced) return [200, { signals: [], serve: false, end: null, replaced: true } satisfies PeerPollAnswer];
        pg.trying[seat] = body.linked === true ? null : pg.trying[seat] ?? now;
        if (seat === 0 && typeof body.played === 'number') pg.hostPlayed = body.played;
        if (shouldServe(pg)) { serve(pg); return [200, { signals: [], serve: true, end: null, replaced: false } satisfies PeerPollAnswer]; }
        const signals = pg.mail[seat].splice(0).map(({ kind, attempt, sdp }) => ({ kind, attempt, sdp }));
        return [200, { signals, serve: false, end: null, replaced: false } satisfies PeerPollAnswer];
      }
      case 'signal': {
        if (!pg) return [200, gone()];
        const sig = body.signal as PeerSignal | undefined;
        const kind = seat === 0 ? 'offer' : 'answer';
        if (!sig || sig.kind !== kind || typeof sig.attempt !== 'string' || sig.attempt.length > 64 || typeof sig.sdp !== 'string' || sig.sdp.length > 20_000) return [400, { error: 'bad_signal' }];
        const box = pg.mail[other(seat)];
        box.push({ kind, attempt: sig.attempt, sdp: sig.sdp, at: now });
        while (box.length > MAX_MAIL) box.shift();
        return [200, { ok: true }];
      }
      case 'save': {
        if (!pg) return [200, { ok: !!ended, end: ended?.end ?? null, records: ended?.records, serve: !!served } satisfies PeerSaveAnswer];
        if (replaced) return [200, { ok: false, end: null, replaced: true } satisfies PeerSaveAnswer];
        const played = cleanPlayed(body.played);
        if (!played) return [400, { error: 'bad_record' }];
        // A move is never rewritten, except taken back in a teaching game.
        const had = pg.record.played;
        if (!pg.record.rules.teaching && JSON.stringify(played.slice(0, had.length)) !== JSON.stringify(had)) return [409, { error: 'conflict' }];
        let state;
        try { state = rebuild({ ...pg.record, played }, played.length); } catch { return [400, { error: 'illegal' }]; }
        const end = body.end === undefined || body.end === null ? null : cleanEnd(body.end);
        if (body.end && !end) return [400, { error: 'bad_end' }];
        // A game played to its end ends as it was played; one still going can't end as "played".
        if (end && ((end.how === 'played') !== (state.winner !== null) || (end.how === 'played' && end.winner !== state.winner))) return [400, { error: 'bad_end' }];
        if (played.length > had.length) pg.moved = now;
        pg.record.played = played;
        pg.hostPlayed = played.length;
        if (!end) { savePeer(pg); return [200, { ok: true, end: null } satisfies PeerSaveAnswer]; }
        const records = await endPeer(pg, end);
        return [200, { ok: true, end, records } satisfies PeerSaveAnswer];
      }
      case 'end': {
        if (!pg) return [200, { ok: !!ended, end: ended?.end ?? null, records: ended?.records, serve: !!served } satisfies PeerSaveAnswer];
        const how = body.how;
        let end: MatchEnd;
        if (how === 'concede') end = { winner: other(seat), how: 'conceded' };
        else if (how === 'claim' || how === 'call-off') {
          if (now - pg.seen[other(seat)] < pg.record.rules.dropGraceMs) return [409, { error: 'not_yet' }];
          end = how === 'claim' ? { winner: seat, how: 'claimed' } : { winner: null, how: 'called-off' };
        } else return [400, { error: 'bad_end' }];
        const records = await endPeer(pg, end);
        return [200, { ok: true, end, records } satisfies PeerSaveAnswer];
      }
      case 'rematch': {
        if (!ended) return [409, { error: 'not_over' }];
        if (ended.next) return [200, { record: ended.next }];
        const [a, b] = ended.seats;
        if (inGame(a) || inGame(b)) return [409, { error: 'busy' }];
        const r0 = ended.record;
        const next = startPeer([r0.seats[0], r0.seats[1]], r0.options, other(rebuild(r0, 0).startingYarn)).record;
        ended.next = next;
        return [200, { record: next }];
      }
    }
    return [404, { error: 'not_found' }];
  }

  // ── Challenges ────────────────────────────────────────────────────────────────────────────────

  function endChallenge(ch: Challenge, why: 'declined' | 'cancelled' | 'expired' | 'offline' | 'busy' | 'started') {
    if (!challenges.delete(ch.id)) return;
    clearTimeout(ch.timer);
    // The place kept for a friend who never connected goes back.
    if (!conns.has(ch.to) && why !== 'started') letIn.delete(ch.to);
    sendTo(ch.from, { t: 'challenge-ended', id: ch.id, why });
    sendTo(ch.to, { t: 'challenge-ended', id: ch.id, why });
    if (why !== 'started') deps.log('live.challenge_ended', { from: ch.from, to: ch.to, why });
  }

  /** This account's own requests still waiting for an answer. */
  const sentBy = (account: string): SentNote[] => [...challenges.values()]
    .filter((ch) => ch.from === account).map((ch) => ({ id: ch.id, to: ch.to, left: Math.max(0, ch.expires - Date.now()) }));

  const inGame = (account: string) => {
    const id = matchOf.get(account) ?? '';
    const m = matches.get(id);
    return (!!m && !m.end) || peers.has(id);
  };

  async function challenge(c: Conn, msg: Extract<ClientMessage, { t: 'challenge' }>) {
    const me = c.account!;
    const options = cleanOptions(msg.options);
    const lives = cleanLives(msg.lives);
    const error = (message: string) => c.send({ t: 'error', message });
    if (!options || lives === null || typeof msg.to !== 'string') return error('That request to play didn’t make sense.');
    // A friend may be connected, or only "here" (the game open, not playing online): the challenge reaches them either way.
    const them = conns.get(msg.to);
    if (!c.friends.has(msg.to) || (them && !them.friends.has(me))) return error('You can only play with a friend.');
    // Before anything else: they may have stepped away for a moment since asking.
    for (const ch of challenges.values()) {
      if (ch.from === me && ch.to === msg.to) return error('You’ve already asked them to play.');
      // They asked first, and now you ask them: you both want to play, so this is a yes to theirs.
      if (ch.from === msg.to && ch.to === me) return accept(c, { t: 'accept', id: ch.id, deck: msg.deck, lives: msg.lives });
    }
    if (statusOf(msg.to) === 'offline') return error('They aren’t online right now.');
    if (inGame(me)) return error('Finish your game first.');
    if (inGame(msg.to)) return error('They’re in a game.');
    const deck = cleanDeck(msg.deck);
    const problem = deck ? await checkDeck(me, deck, options.startersOnly) : 'That deck isn’t one you can play.';
    if (problem) return error(problem);
    // Keep a place for the friend, so answering never puts them in the waiting line. No place: say so now.
    if (!them && !letIn.has(msg.to)) {
      if (taken() >= deps.maxPlayers) return error('Online play is full right now, so your friend couldn’t join. Try again in a few minutes.');
      letIn.set(msg.to, Date.now() + CHALLENGE_MS + LET_IN_MS);
    }
    const id = newMatchId();
    const ch: Challenge = {
      id, from: me, fromPerson: c.person, to: msg.to, deck: deck!, options, lives,
      expires: Date.now() + CHALLENGE_MS, timer: setTimeout(() => endChallenge(ch, 'expired'), CHALLENGE_MS),
    };
    challenges.set(id, ch);
    c.send({ t: 'sent', id, to: msg.to, left: CHALLENGE_MS });
    them?.send({ t: 'challenge', id, from: c.person, options, lives });
    deps.log('live.challenge', { from: me, to: msg.to, pace: options.pace, teaching: options.teaching });
  }

  /** A deck's problem, if any. Its cards couldn't be checked (storage not answering): say so, rather than nothing at all. */
  async function checkDeck(account: string, deck: DeckList, startersOnly: boolean): Promise<string | null> {
    try { return await deps.checkDeck(account, deck, startersOnly); } catch (e) {
      deps.log('live.check_deck_failed', { message: (e as Error).message });
      return 'Couldn’t check your deck just now. Please try again in a moment.';
    }
  }

  async function accept(c: Conn, msg: Extract<ClientMessage, { t: 'accept' }>) {
    const ch = challenges.get(msg.id);
    const error = (message: string) => c.send({ t: 'error', message });
    if (!ch || ch.to !== c.account) return error('That game isn’t open any more.');
    const lives = cleanLives(msg.lives);
    const deck = cleanDeck(msg.deck);
    if (lives === null) return error('That handicap didn’t make sense.');
    const problem = deck ? await checkDeck(c.account, deck, ch.options.startersOnly) : 'That deck isn’t one you can play.';
    if (problem) return error(problem);
    if (!challenges.has(ch.id)) return error('That game isn’t open any more.');
    endChallenge(ch, 'started');
    const seats: MatchRecord['seats'] = [{ person: ch.fromPerson, deck: ch.deck, lives: ch.lives }, { person: c.person, deck: deck!, lives }];
    // Both games can play it directly: the hub only introduces them.
    if (deps.peers?.() && peerCapable.get(ch.from) && peerCapable.get(c.account)) { startPeer(seats, ch.options); return; }
    const m = startMatch(seats, ch.options);
    // The one who asked isn't connected (the game in the background, or closed): the game waits for them like any
    // dropped connection, and their game opens it when it's back ("I'm here" and welcome both bring the match).
    if (!conns.has(ch.from)) m.dropped(0);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────────────────────

  async function hello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.protocol !== PROTOCOL || msg.rules !== RULES_VERSION) { c.send({ t: 'update' }); return; }
    const who = typeof msg.token === 'string' ? await deps.verify(msg.token, typeof msg.name === 'string' ? msg.name : undefined) : null;
    if (!who) { c.send({ t: 'error', message: 'signed_out' }); c.close(); return; }
    if (!deps.open()) { c.send({ t: 'closed' }); c.close(); return; }
    // Only a player who was let in (or is in a game, or already connected on another device) may connect.
    if (!conns.has(who.id) && !matchOf.has(who.id) && !letIn.has(who.id)) { c.send({ t: 'full' }); c.close(); return; }
    letIn.delete(who.id);
    here.delete(who.id);
    const avatar = typeof msg.avatar === 'string' && /^[a-z0-9-]{1,40}$/.test(msg.avatar) ? msg.avatar : 'cat';
    c.account = who.id;
    c.token = msg.token;
    c.person = { id: who.id, name: who.name.slice(0, 40) || 'A friend', avatar };
    peerCapable.set(who.id, msg.peer === true);
    await loadFriends(c, who.id, msg.token);
    // The newest connection wins: the same account on a second device, or a reload.
    const older = conns.get(who.id);
    conns.set(who.id, c);
    if (older && older !== c) { older.send({ t: 'error', message: 'replaced' }); older.close(); }
    const m = matches.get(matchOf.get(who.id) ?? '');
    // With the requests waiting both ways, so the game never shows a request as gone between two messages.
    const incoming = [...challenges.values()].filter((ch) => ch.to === who.id)
      .map((ch) => ({ id: ch.id, from: ch.fromPerson, options: ch.options, lives: ch.lives }));
    const pg = peers.get(matchOf.get(who.id) ?? '');
    c.send({ t: 'welcome', you: c.person, friends: await statuses(c), match: m && !m.end ? m.id : pg ? pg.record.id : null, sent: sentBy(who.id), incoming, peer: peerNote(who.id) });
    if (m) m.connected(m.seatOf(who.id)!);
    announce(who.id);
  }

  async function receive(c: Conn, text: string) {
    if (text.length > MAX_MESSAGE) return;
    let msg: ClientMessage;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') { await hello(c, msg); return; }
    const me = c.account;
    if (!me) return;
    if (msg.t !== 'friends') c.active = Date.now();
    switch (msg.t) {
      case 'friends':
        if (msg.again || c.friendsStale) {
          await loadFriends(c, me, c.token);
          announce(me);
        }
        c.send({ t: 'friends', friends: await statuses(c) });
        return;
      case 'code': {
        for (const [code, v] of codes) if (v.account === me) codes.delete(code);
        if (typeof msg.code === 'string' && validCode(msg.code)) codes.set(normalizeCode(msg.code), { account: me, person: c.person, expires: Date.now() + CODE_MS });
        return;
      }
      case 'lookup': {
        if (typeof msg.code !== 'string') return;
        const now = Date.now();
        c.lookups = c.lookups.filter((t) => now - t < 60_000);
        if (c.lookups.length >= LOOKUPS_PER_MINUTE) { c.send({ t: 'error', message: 'Too many codes tried. Wait a minute.' }); return; }
        c.lookups.push(now);
        const found = codes.get(normalizeCode(msg.code));
        const live = found && found.expires > now ? found : null;
        c.send({ t: 'looked', code: normalizeCode(msg.code), person: live && live.account !== me ? live.person : null, yours: live?.account === me });
        return;
      }
      case 'added': {
        // Only a nudge to look again: the friend's game asks viamochi-id who its friends are, and believes that.
        if (typeof msg.friend !== 'string') return;
        await loadFriends(c, me, c.token);
        if (!c.friends.has(msg.friend)) return;
        sendTo(msg.friend, { t: 'added', by: c.person });
        for (const [code, v] of codes) if (v.account === msg.friend) codes.delete(code);   // used up
        c.send({ t: 'friends', friends: await statuses(c) });
        return;
      }
      case 'challenge': await challenge(c, msg); return;
      case 'accept': await accept(c, msg); return;
      case 'decline': case 'cancel': {
        const ch = challenges.get(msg.id);
        if (ch && (msg.t === 'decline' ? ch.to : ch.from) === me) endChallenge(ch, msg.t === 'decline' ? 'declined' : 'cancelled');
        return;
      }
    }
    // Everything else is about a match.
    const m = matches.get((msg as { match?: string }).match ?? '');
    const seat = m?.seatOf(me);
    if (!m || seat === null || seat === undefined) {
      // A game played directly isn't played through here: its devices talk to each other.
      if (msg.t === 'rejoin' && !peers.has(msg.match)) c.send({ t: 'error', message: 'That game is over.' });
      return;
    }
    m.handle(seat, msg);
  }

  function closed(c: Conn) {
    const me = c.account;
    if (!me || conns.get(me) !== c) return;
    conns.delete(me);
    afterClose(c);
  }

  function afterClose(c: Conn) {
    const me = c.account!;
    void deps.store.seen(me, new Date().toISOString()).catch(() => {});
    seenCache.delete(me);
    // Challenges stay: a request to play is kept until it's answered, cancelled or runs out (CHALLENGE_MS), however
    // the players' games come and go meanwhile.
    // A code shown stays known for its 15 minutes: it may have been sent by text, to a friend who types it later.
    const m = matches.get(matchOf.get(me) ?? '');
    if (m) m.dropped(m.seatOf(me)!);
    announce(me);
  }

  return {
    /** A new connection. `send` and `close` talk to its socket. */
    connect(send: (msg: ServerMessage) => void, close: () => void): Connection {
      const c: Conn = { account: null, person: { id: '', name: '', avatar: '' }, token: '', friends: new Set(), send, close, lookups: [], active: Date.now() };
      // One message at a time per connection, in order, even when one waits on viamochi-id.
      let queue = Promise.resolve();
      return {
        receive(text) {
          queue = queue.then(() => receive(c, text)).catch((e) => deps.log('live.error', { message: (e as Error).message }));
        },
        closed() { queue = queue.then(() => closed(c)); },
      };
    },
    /** Pick up the games that were going when the API last stopped. The players find them waiting when they return. */
    async restore() {
      for (const r of await deps.store.liveMatches()) {
        // A game played directly: its devices carry on as they were; the hub keeps its copy again.
        if (r.peer) { addPeer(r); continue; }
        try {
          const m = new Match(r, host);
          matches.set(m.id, m);
          for (const s of r.seats) matchOf.set(s.person.id, m.id);
          m.start(true);
        } catch (e) {
          deps.log('live.restore_failed', { match: r.id, message: (e as Error).message });
        }
      }
    },
    /** "Let me in": in, a place in the waiting line, or closed. */
    enter,
    /** "I'm here": the game is open but not playing online. */
    here: hereNow,
    /** A device about its Friend game played directly (PEER_PATH). */
    peer,
    /** For tests and the stats: how many are connected, playing and waiting. */
    counts: () => ({ connected: conns.size, matches: matches.size, peers: peers.size, challenges: challenges.size, waiting: waiting.size, letIn: letIn.size, here: here.size }),
    stop: () => { clearInterval(sweeper); clearInterval(pruner); clearTimeout(pruneFirst); },
  };
}

/** A deck as a client sent it, cleaned: known cards only, whole numbers. */
function cleanDeck(d: unknown): DeckList | null {
  const x = d as DeckList;
  if (!x || typeof x !== 'object' || typeof x.hero !== 'string' || !CARDS[x.hero] || !x.cards || typeof x.cards !== 'object') return null;
  const cards: Record<string, number> = {};
  for (const [id, n] of Object.entries(x.cards)) if (CARDS[id] && Number.isInteger(n) && n > 0 && n <= 9) cards[id] = n;
  return { name: typeof x.name === 'string' ? x.name.slice(0, 40) : 'Deck', hero: x.hero, cards };
}
