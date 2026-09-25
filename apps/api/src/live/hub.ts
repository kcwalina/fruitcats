// Online play's switchboard (docs/pvp-plan.md): each signed-in game keeps one connection here, which carries
//   - presence: which of your friends are online, or in a game;
//   - friend codes: the code you're showing (as a QR code or typed), so a friend who scans it sees who you are before
//     adding you. Adding itself is viamochi-id's (the game redeems the code there, as before);
//   - challenges: Friend's way into a match. (Ranked's, the queue, comes later and ends the same way: startMatch);
//   - the matches themselves (match.ts).
//
// Who is friends with whom is viamochi-id's: the hub asks it with the player's own token when they connect, and again
// when they say their friends changed. A challenge is only sent between two people on each other's lists.
//
// The hub knows nothing about sockets: socket.ts turns a WebSocket into connect/receive/closed, and the tests use
// plain functions.

import { CARDS, RULES_VERSION, other, type DeckList, type PlayerId } from '@fruitcats/engine';
import {
  PROTOCOL, cleanLives, cleanOptions, friendRules, normalizeCode, validCode,
  type ChallengeOptions, type ClientMessage, type FriendStatus, type Person, type ServerMessage, type Tally,
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
  send(msg: ServerMessage): void;
  close(): void;
  /** Code lookups in the last minute, so codes can't be guessed by trying them all. */
  lookups: number[];
}

interface Challenge {
  id: string;
  from: string;
  to: string;
  deck: DeckList;
  options: ChallengeOptions;
  lives: number;
  timer: ReturnType<typeof setTimeout>;
}

/** A challenge nobody answers is withdrawn after this long. */
export const CHALLENGE_MS = 60_000;
/** A friend code works for 15 minutes (viamochi-id's rule); after that the hub forgets it too. */
const CODE_MS = 15 * 60_000;
const LOOKUPS_PER_MINUTE = 12;
const MAX_MESSAGE = 64 * 1024;

export function createHub(deps: HubDeps) {
  const conns = new Map<string, Conn>();                 // account → its connection (the newest one)
  const matches = new Map<string, Match>();              // match id → match
  const matchOf = new Map<string, string>();             // account → the match it's in
  const challenges = new Map<string, Challenge>();
  const codes = new Map<string, { account: string; person: Person; expires: number }>();
  const saving = new Map<string, ReturnType<typeof setTimeout>>();

  const sendTo = (account: string, msg: ServerMessage) => conns.get(account)?.send(msg);

  // ── Presence ──────────────────────────────────────────────────────────────────────────────────

  const statusOf = (account: string): FriendStatus['status'] => {
    if (!conns.has(account)) return 'offline';
    const m = matches.get(matchOf.get(account) ?? '');
    return m && !m.end ? 'playing' : 'online';
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

  async function statuses(c: Conn): Promise<FriendStatus[]> {
    const out: FriendStatus[] = [];
    for (const f of c.friends) {
      const status = statusOf(f);
      out.push({
        id: f, status,
        lastSeen: status === 'offline' ? await deps.store.lastSeen(f) : undefined,
        person: conns.get(f)?.person,
        record: await deps.store.tally(c.account!, f),
      });
    }
    return out;
  }

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
      deps.log('live.match_ended', { match: m.id, kind: m.record.rules.kind, how: m.end?.how, winner: m.end?.winner, moves: m.record.played.length });
      for (const acct of [a, b]) announce(acct);
      const w = m.end?.winner;
      if (!m.record.rules.counts || w === null || w === undefined) return [undefined, undefined];
      try {
        const resultFor = (seat: PlayerId) => (w === 'draw' ? 'draw' : w === seat ? 'win' : 'loss');
        return [await deps.store.addResult(a, b, resultFor(0)), await deps.store.addResult(b, a, resultFor(1))] as [Tally, Tally];
      } catch (e) {
        deps.log('live.record_failed', { match: m.id, message: (e as Error).message });
        return [undefined, undefined];
      }
    },
    rematch(m) {
      forget(m);
      const r = m.record;
      startMatch([r.seats[0], r.seats[1]], r.options, other(m.state.startingYarn));
    },
    forget,
  };

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

  // ── Challenges ────────────────────────────────────────────────────────────────────────────────

  function endChallenge(ch: Challenge, why: 'declined' | 'cancelled' | 'expired' | 'offline' | 'busy' | 'started') {
    if (!challenges.delete(ch.id)) return;
    clearTimeout(ch.timer);
    sendTo(ch.from, { t: 'challenge-ended', id: ch.id, why });
    sendTo(ch.to, { t: 'challenge-ended', id: ch.id, why });
  }

  const inGame = (account: string) => { const m = matches.get(matchOf.get(account) ?? ''); return !!m && !m.end; };

  async function challenge(c: Conn, msg: Extract<ClientMessage, { t: 'challenge' }>) {
    const me = c.account!;
    const options = cleanOptions(msg.options);
    const lives = cleanLives(msg.lives);
    const error = (message: string) => c.send({ t: 'error', message });
    if (!options || lives === null || typeof msg.to !== 'string') return error('That challenge didn’t make sense.');
    const them = conns.get(msg.to);
    if (!c.friends.has(msg.to) || !them?.friends.has(me)) return error('You can only challenge a friend.');
    if (inGame(me)) return error('Finish your game first.');
    if (inGame(msg.to)) return error(`${them.person.name} is in a game.`);
    for (const ch of challenges.values())
      if ((ch.from === me && ch.to === msg.to) || (ch.from === msg.to && ch.to === me)) return error('There’s already a challenge between you.');
    const deck = cleanDeck(msg.deck);
    const problem = deck ? await deps.checkDeck(me, deck, options.startersOnly) : 'That deck isn’t one you can play.';
    if (problem) return error(problem);
    const id = newMatchId();
    const ch: Challenge = { id, from: me, to: msg.to, deck: deck!, options, lives, timer: setTimeout(() => endChallenge(ch, 'expired'), CHALLENGE_MS) };
    challenges.set(id, ch);
    c.send({ t: 'sent', id, to: msg.to });
    them.send({ t: 'challenge', id, from: c.person, options, lives });
    deps.log('live.challenge', { from: me, to: msg.to, pace: options.pace, teaching: options.teaching });
  }

  async function accept(c: Conn, msg: Extract<ClientMessage, { t: 'accept' }>) {
    const ch = challenges.get(msg.id);
    const error = (message: string) => c.send({ t: 'error', message });
    if (!ch || ch.to !== c.account) return error('That challenge is no longer open.');
    const lives = cleanLives(msg.lives);
    const deck = cleanDeck(msg.deck);
    if (lives === null) return error('That handicap didn’t make sense.');
    const problem = deck ? await deps.checkDeck(c.account, deck, ch.options.startersOnly) : 'That deck isn’t one you can play.';
    if (problem) return error(problem);
    const from = conns.get(ch.from);
    if (!challenges.has(ch.id)) return error('That challenge is no longer open.');
    if (!from) { endChallenge(ch, 'offline'); return; }
    endChallenge(ch, 'started');
    startMatch([{ person: from.person, deck: ch.deck, lives: ch.lives }, { person: c.person, deck: deck!, lives }], ch.options);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────────────────────

  async function hello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.protocol !== PROTOCOL || msg.rules !== RULES_VERSION) { c.send({ t: 'update' }); return; }
    const who = typeof msg.token === 'string' ? await deps.verify(msg.token, typeof msg.name === 'string' ? msg.name : undefined) : null;
    if (!who) { c.send({ t: 'error', message: 'signed_out' }); c.close(); return; }
    const avatar = typeof msg.avatar === 'string' && /^[a-z0-9-]{1,40}$/.test(msg.avatar) ? msg.avatar : 'cat';
    c.account = who.id;
    c.token = msg.token;
    c.person = { id: who.id, name: who.name.slice(0, 40) || 'A friend', avatar };
    try { c.friends = new Set(await deps.friendsOf(who.id, msg.token)); } catch { c.friends = new Set(); }
    // The newest connection wins: the same account on a second device, or a reload.
    const older = conns.get(who.id);
    conns.set(who.id, c);
    if (older && older !== c) { older.send({ t: 'error', message: 'replaced' }); older.close(); }
    const m = matches.get(matchOf.get(who.id) ?? '');
    c.send({ t: 'welcome', you: c.person, friends: await statuses(c), match: m && !m.end ? m.id : null });
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
    switch (msg.t) {
      case 'friends':
        try { c.friends = new Set(await deps.friendsOf(me, c.token)); } catch { /* keep the list we had */ }
        c.send({ t: 'friends', friends: await statuses(c) });
        announce(me);
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
        try { c.friends = new Set(await deps.friendsOf(me, c.token)); } catch { /* keep the list we had */ }
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
    if (!m || seat === null || seat === undefined) { if (msg.t === 'rejoin') c.send({ t: 'error', message: 'That game is over.' }); return; }
    m.handle(seat, msg);
  }

  function closed(c: Conn) {
    const me = c.account;
    if (!me || conns.get(me) !== c) return;
    conns.delete(me);
    void deps.store.seen(me, new Date().toISOString()).catch(() => {});
    for (const ch of [...challenges.values()]) if (ch.from === me || ch.to === me) endChallenge(ch, 'offline');
    for (const [code, v] of codes) if (v.account === me) codes.delete(code);
    const m = matches.get(matchOf.get(me) ?? '');
    if (m) m.dropped(m.seatOf(me)!);
    announce(me);
  }

  return {
    /** A new connection. `send` and `close` talk to its socket. */
    connect(send: (msg: ServerMessage) => void, close: () => void): Connection {
      const c: Conn = { account: null, person: { id: '', name: '', avatar: '' }, token: '', friends: new Set(), send, close, lookups: [] };
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
    /** For tests and the stats: how many are connected and playing. */
    counts: () => ({ connected: conns.size, matches: matches.size, challenges: challenges.size }),
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
