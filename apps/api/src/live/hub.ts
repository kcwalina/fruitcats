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
// The hub knows nothing about sockets: socket.ts turns a WebSocket into connect/receive/closed, and the tests use
// plain functions.

import { CARDS, RULES_VERSION, other, type DeckList, type PlayerId } from '@fruitcats/engine';
import {
  HERE_MS, PROTOCOL, cleanLives, cleanOptions, friendRules, normalizeCode, validCode,
  type ChallengeNote, type ChallengeOptions, type ClientMessage, type EnterAnswer, type FriendStatus, type HereAnswer, type Person,
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
  timer: ReturnType<typeof setTimeout>;
  /** One of the two lost their connection: the challenge ends unless they're back before this runs. */
  away?: ReturnType<typeof setTimeout>;
}

/** A challenge nobody answers is withdrawn after this long. (A friend who isn't connected hears of it within HERE_EVERY_MS.) */
export const CHALLENGE_MS = 120_000;
/**
 * A player whose connection drops while a challenge is open keeps it this long. A phone closes the connection as soon
 * as the game goes to the background, and the first thing someone does after asking is often to text their friend
 * "I sent it": that mustn't withdraw the challenge.
 */
export const CHALLENGE_AWAY_MS = 60_000;
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

  function hereNow(account: string, person?: Person): HereAnswer {
    here.set(account, { at: Date.now(), person });
    const m = matches.get(matchOf.get(account) ?? '');
    const notes: ChallengeNote[] = [];
    for (const ch of challenges.values()) {
      if (ch.to !== account) continue;
      notes.push({ id: ch.id, from: ch.fromPerson, options: ch.options, lives: ch.lives });
    }
    return { open: deps.open(), challenges: notes, match: m && !m.end ? m.id : null };
  }

  /** Let go of what's run out: presence, places in line, places kept, idle connections. */
  function sweep() {
    const now = Date.now();
    for (const [a, h] of here) if (now - h.at > HERE_MS) { here.delete(a); void deps.store.seen(a, new Date(h.at).toISOString()).catch(() => {}); }
    for (const [a, w] of waiting) if (now - w.asked > WAITING_KEPT_MS) waiting.delete(a);
    for (const [code, v] of codes) if (v.expires < now) codes.delete(code);
    for (const [a, until] of letIn) if (until < now) letIn.delete(a);
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
      const w = m.end?.winner;
      if (!m.record.rules.counts || w === null || w === undefined) return [undefined, undefined];
      try {
        const resultFor = (seat: PlayerId) => (w === 'draw' ? 'draw' : w === seat ? 'win' : 'loss');
        const both = [await deps.store.addResult(a, b, resultFor(0)), await deps.store.addResult(b, a, resultFor(1))] as [Tally, Tally];
        tallies.set(`${a}|${b}`, both[0]);
        tallies.set(`${b}|${a}`, both[1]);
        return both;
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
    clearTimeout(ch.away);
    // The place kept for a friend who never connected goes back.
    if (!conns.has(ch.to) && why !== 'started') letIn.delete(ch.to);
    sendTo(ch.from, { t: 'challenge-ended', id: ch.id, why });
    sendTo(ch.to, { t: 'challenge-ended', id: ch.id, why });
    if (why !== 'started') deps.log('live.challenge_ended', { from: ch.from, to: ch.to, why });
  }

  const inGame = (account: string) => { const m = matches.get(matchOf.get(account) ?? ''); return !!m && !m.end; };

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
    const ch: Challenge = { id, from: me, fromPerson: c.person, to: msg.to, deck: deck!, options, lives, timer: setTimeout(() => endChallenge(ch, 'expired'), CHALLENGE_MS) };
    challenges.set(id, ch);
    c.send({ t: 'sent', id, to: msg.to });
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
    const m = startMatch([{ person: ch.fromPerson, deck: ch.deck, lives: ch.lives }, { person: c.person, deck: deck!, lives }], ch.options);
    // The one who asked stepped away for a moment (another app): the game waits for them like any dropped connection,
    // and they're taken into it when they come back (welcome's match).
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
    await loadFriends(c, who.id, msg.token);
    // The newest connection wins: the same account on a second device, or a reload.
    const older = conns.get(who.id);
    conns.set(who.id, c);
    if (older && older !== c) { older.send({ t: 'error', message: 'replaced' }); older.close(); }
    const m = matches.get(matchOf.get(who.id) ?? '');
    // Back within CHALLENGE_AWAY_MS: the challenges this player is part of carry on.
    for (const ch of challenges.values()) if (ch.from === who.id || ch.to === who.id) { clearTimeout(ch.away); ch.away = undefined; }
    const sent = [...challenges.values()].filter((ch) => ch.from === who.id).map((ch) => ch.id);
    c.send({ t: 'welcome', you: c.person, friends: await statuses(c), match: m && !m.end ? m.id : null, sent });
    // Challenges sent while this game was only "here", or away for a moment.
    for (const ch of challenges.values())
      if (ch.to === who.id) c.send({ t: 'challenge', id: ch.id, from: ch.fromPerson, options: ch.options, lives: ch.lives });
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
    if (!m || seat === null || seat === undefined) { if (msg.t === 'rejoin') c.send({ t: 'error', message: 'That game is over.' }); return; }
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
    // A challenge waits a moment for a player who stepped away (see CHALLENGE_AWAY_MS).
    for (const ch of challenges.values()) {
      if (ch.from !== me && ch.to !== me) continue;
      clearTimeout(ch.away);
      ch.away = setTimeout(() => { if (!conns.has(me)) endChallenge(ch, 'offline'); }, CHALLENGE_AWAY_MS);
    }
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
    /** For tests and the stats: how many are connected, playing and waiting. */
    counts: () => ({ connected: conns.size, matches: matches.size, challenges: challenges.size, waiting: waiting.size, letIn: letIn.size, here: here.size }),
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
