// Online play (docs/pvp-plan.md), end to end through the hub: two players connect, one challenges the other, they play
// a whole game from their own views, and the result is recorded. The clock, dropped connections, the teaching helps,
// the handicap and friend codes too. Sockets and viamochi-id are replaced by plain functions; time is faked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECKS, HIDDEN, RULES_VERSION, legalActions, type Action, type PlayerView } from '@fruitcats/engine';
import {
  ASK_MS, OVERTIME_CLAIM_MS, PACES, PROTOCOL, rankedRules, type ChallengeOptions, type ClientMessage, type ServerMessage,
} from '@fruitcats/match';
import { CHALLENGE_MS, createHub } from '../src/live/hub';
import { IDLE_MS, Match, RESULT_KEEP_MS, type MatchHost, type MatchRecord } from '../src/live/match';
import { tableStore } from '../src/live/records';
import type { Row, Table } from '../src/tables';

function memoryTable(): Table {
  const rows = new Map<string, Row>();
  let tag = 0;
  const key = (p: string, r: string) => `${p}|${r}`;
  return {
    async list<T extends Row>(p: string) { return [...rows.values()].filter((r) => r.partitionKey === p).map((r) => structuredClone(r) as T); },
    async get<T extends Row>(p: string, r: string) { const x = rows.get(key(p, r)); return x ? structuredClone(x) as T : null; },
    async put(row) { rows.set(key(row.partitionKey, row.rowKey), structuredClone(row)); },
    async add(row) { if (rows.has(key(row.partitionKey, row.rowKey))) return false; rows.set(key(row.partitionKey, row.rowKey), structuredClone(row)); return true; },
    async remove(p, r) { rows.delete(key(p, r)); },
    async batch(steps) {
      for (const s of steps) {
        const have = rows.get(key(s.row.partitionKey, s.row.rowKey));
        if (s.op === 'create' && have) return false;
        if (s.op === 'replace' && have?.etag !== s.etag) return false;
      }
      for (const s of steps) rows.set(key(s.row.partitionKey, s.row.rowKey), { ...structuredClone(s.row), etag: String(++tag) });
      return true;
    },
    async where() { throw new Error('not used here'); },
  };
}

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32);
const NAMES: Record<string, string> = { [A]: 'Sam', [B]: 'Pippin', [C]: 'Stranger', [D]: 'Dot' };
/** Sam and Pippin are friends; the stranger and Dot are nobody's. */
const FRIENDS: Record<string, string[]> = { [A]: [B], [B]: [A], [C]: [], [D]: [] };
/** Dot has bought cards. */
const PAID = new Set([D]);
let maxPlayers = 100;
let open = true;
/** viamochi-id, or the storage behind the deck check, not answering (restarting). */
let idDown = false;
let storageDown = false;
const STARTER = DECKS['zest-rush'];
const OTHER = DECKS['orchard-guard'];
const RELAXED: ChallengeOptions = { pace: 'relaxed', teaching: false, startersOnly: false };

/** Let the hub's awaits finish (real microtasks and I/O turns, while timers are fake). */
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

let store: ReturnType<typeof tableStore>;
let hub: ReturnType<typeof createHub>;

function makeHub() {
  hub?.stop();
  store = tableStore(memoryTable(), memoryTable(), memoryTable());
  hub = createHub({
    async paid(account) { return PAID.has(account); },
    get maxPlayers() { return maxPlayers; },
    open: () => open,
    store,
    async verify(token) { const id = token.slice(4); return NAMES[id] ? { id, name: NAMES[id] } : null; },
    async friendsOf(account) { if (idDown) throw new Error('friends: 503'); return FRIENDS[account] ?? []; },
    async checkDeck(_account, deck, startersOnly) {
      if (storageDown) throw new Error('storage: 503');
      if (deck.hero === 'nobody') return 'not yours';
      if (startersOnly && deck.name === 'My tuned deck') return 'This game is for starter decks only.';
      return null;
    },
    log() {},
  });
}

interface Player {
  id: string;
  inbox: ServerMessage[];
  send(m: ClientMessage | Record<string, unknown>): void;
  drop(): void;
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined;
  view: PlayerView | null;
  match: string | null;
}

/** Ask to be let in, then connect. */
async function connect(id: string, letIn = true): Promise<Player> {
  if (letIn) expect(await hub.enter(id)).toEqual({ status: 'in' });
  const inbox: ServerMessage[] = [];
  const p: Player = {
    id, inbox, view: null, match: null,
    send: (m) => conn.receive(JSON.stringify(m)),
    drop: () => conn.closed(),
    last: (t) => [...inbox].reverse().find((m) => m.t === t) as never,
  };
  const conn = hub.connect((m) => {
    inbox.push(m);
    if (m.t === 'match') { p.view = m.view; p.match = m.info.id; }
    if (m.t === 'view') p.view = m.view;
  }, () => {});
  p.send({ t: 'hello', token: `tok-${id}`, protocol: PROTOCOL, rules: RULES_VERSION, avatar: 'cat-jam' });
  await flush();
  return p;
}

async function startGame(options = RELAXED, livesA = 9, livesB = 9): Promise<[Player, Player]> {
  const sam = await connect(A), pippin = await connect(B);
  sam.send({ t: 'challenge', to: B, deck: STARTER, options, lives: livesA });
  await flush();
  const ch = pippin.last('challenge')!;
  pippin.send({ t: 'accept', id: ch.id, deck: OTHER, lives: livesB });
  await flush();
  return [sam, pippin];
}

/** A simple player: keeps its hand, plants its first cards, then picks a random legal move. */
function choose(v: PlayerView, rnd: () => number): Action {
  const prompt = v.prompt!;
  const hand = v.players[v.seat].hand;
  if (prompt.kind === 'mulligan') return { t: 'mulligan', uids: [] };
  if (prompt.kind === 'setupPlant') return { t: 'setupPlant', uids: hand.slice(0, prompt.count).map((c) => c.uid) };
  if (prompt.kind === 'discard') return { t: 'discard', uids: hand.slice(0, prompt.count).map((c) => c.uid) };
  const legal = legalActions(v);
  return legal[Math.floor(rnd() * legal.length)];
}

function rng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
}

/** Both players move whenever it's their turn, until the game ends. */
async function playOut(players: Player[], seed = 1) {
  const rnd = rng(seed);
  for (let i = 0; i < 5000; i++) {
    const mover = players.find((p) => p.view?.prompt && p.view.winner === null);
    if (!mover || players.some((p) => p.last('end'))) return;
    mover.send({ t: 'act', match: mover.match!, seq: mover.view!.actions, action: choose(mover.view!, rnd) });
    await flush();
  }
  throw new Error('the game never ended');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  maxPlayers = 100;
  open = true;
  idDown = false;
  storageDown = false;
  makeHub();
});
afterEach(() => { vi.useRealTimers(); });

describe('presence and challenges', () => {
  it('tells friends who is online, and nobody else', async () => {
    const sam = await connect(A);
    expect(sam.last('welcome')!.friends).toEqual([expect.objectContaining({ id: B, status: 'offline' })]);
    const pippin = await connect(B);
    expect(pippin.last('welcome')!.friends[0]).toMatchObject({ id: A, status: 'online' });
    expect(sam.last('presence')!.friend).toMatchObject({ id: B, status: 'online' });
    const stranger = await connect(C);
    expect(stranger.last('welcome')!.friends).toEqual([]);
    expect(sam.inbox.filter((m) => m.t === 'presence').length).toBe(1);
  });

  it('only lets friends challenge each other', async () => {
    const sam = await connect(A);
    await connect(C);
    sam.send({ t: 'challenge', to: C, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('error')!.message).toMatch(/only play with a friend/);
  });

  it('refuses a deck the player can’t play', async () => {
    const sam = await connect(A);
    await connect(B);
    sam.send({ t: 'challenge', to: B, deck: { ...STARTER, hero: 'nobody' }, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('error')).toBeDefined();
    expect(sam.last('sent')).toBeUndefined();
  });

  it('withdraws a challenge nobody answers', async () => {
    const sam = await connect(A);
    const pippin = await connect(B);
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(pippin.last('challenge')).toBeDefined();
    vi.advanceTimersByTime(CHALLENGE_MS + 1);
    expect(sam.last('challenge-ended')!.why).toBe('expired');
    expect(pippin.last('challenge-ended')!.why).toBe('expired');
  });

  it('lets the friend say not now', async () => {
    const sam = await connect(A);
    const pippin = await connect(B);
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    pippin.send({ t: 'decline', id: pippin.last('challenge')!.id });
    await flush();
    expect(sam.last('challenge-ended')!.why).toBe('declined');
    expect(hub.counts().matches).toBe(0);
  });

  it('holds a starters-only game to starter decks', async () => {
    const sam = await connect(A);
    await connect(B);
    sam.send({ t: 'challenge', to: B, deck: { ...STARTER, name: 'My tuned deck' }, options: { ...RELAXED, startersOnly: true }, lives: 9 });
    await flush();
    expect(sam.last('error')!.message).toMatch(/starter decks only/);
  });
});

describe('a service restarting', () => {
  it('keeps the friends viamochi-id last gave while it can’t be asked, and asks again at the next presence check', async () => {
    const sam = await connect(A);
    sam.drop();
    await flush();
    idDown = true;
    const again = await connect(A);
    expect(again.last('welcome')!.friends.map((f) => f.id)).toEqual([B]);
    idDown = false;
    FRIENDS[A] = [B, D];
    try {
      again.send({ t: 'friends' });
      await flush();
      expect(again.last('friends')!.friends.map((f) => f.id)).toEqual([B, D]);
    } finally { FRIENDS[A] = [B]; }
  });

  it('asks again for friends it never had, rather than showing none', async () => {
    idDown = true;
    const sam = await connect(A);
    expect(sam.last('welcome')!.friends).toEqual([]);
    idDown = false;
    sam.send({ t: 'friends' });
    await flush();
    expect(sam.last('friends')!.friends.map((f) => f.id)).toEqual([B]);
  });

  it('says so when a deck can’t be checked right now, instead of saying nothing', async () => {
    const sam = await connect(A);
    await connect(B);
    storageDown = true;
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('error')!.message).toMatch(/Couldn’t check your deck/);
  });
});

describe('a match', () => {
  it('starts with each player on their own seat, seeing only their own hand', async () => {
    const [sam, pippin] = await startGame();
    const ms = sam.last('match')!, mp = pippin.last('match')!;
    expect(ms.info.id).toBe(mp.info.id);
    expect(ms.info.seat).toBe(0);
    expect(mp.info.seat).toBe(1);
    expect(ms.info.players.map((p) => p.name)).toEqual(['Sam', 'Pippin']);
    expect(ms.view.players[0].hand.every((c) => c.id !== HIDDEN)).toBe(true);
    expect(ms.view.players[1].hand.every((c) => c.id === HIDDEN)).toBe(true);
    expect(ms.view.seed).toBe(0);
    expect(sam.last('presence')).toMatchObject({ friend: { id: B, status: 'playing' } });
  });

  it('refuses a move out of turn, and a move for an old state', async () => {
    const [sam, pippin] = await startGame();
    const waiting = sam.view!.prompt ? pippin : sam;
    waiting.send({ t: 'act', match: waiting.match!, seq: waiting.view!.actions, action: { t: 'pass' } });
    await flush();
    expect(waiting.last('error')!.message).toMatch(/isn’t your turn/);
    const mover = waiting === sam ? pippin : sam;
    const before = mover.inbox.length;
    mover.send({ t: 'act', match: mover.match!, seq: mover.view!.actions + 5, action: { t: 'mulligan', uids: [] } });
    await flush();
    expect(mover.inbox.slice(before).map((m) => m.t)).toEqual(['match']);   // sent the game again, nothing applied
  });

  it('plays a whole game from the players’ own views and records the result', async () => {
    const [sam, pippin] = await startGame();
    await playOut([sam, pippin]);
    const end = sam.last('end')!.end;
    expect(end.how).toBe('played');
    expect(end.winner).not.toBeNull();
    expect(sam.view!.winner).toBe(end.winner);
    expect(sam.inbox.filter((m) => m.t === 'view').length).toBeGreaterThan(50);
    const other = pippin.last('end')!.end;
    if (end.winner === 0) { expect(end.record).toEqual({ wins: 1, losses: 0, draws: 0 }); expect(other.record).toEqual({ wins: 0, losses: 1, draws: 0 }); }
    if (end.winner === 1) { expect(end.record).toEqual({ wins: 0, losses: 1, draws: 0 }); expect(other.record).toEqual({ wins: 1, losses: 0, draws: 0 }); }
    expect(await store.tally(A, B)).toEqual(end.record ?? { wins: 0, losses: 0, draws: 0 });
    // Every view either player got kept the other's hand hidden.
    for (const [p, foe] of [[sam, 1], [pippin, 0]] as const)
      for (const m of p.inbox) if (m.t === 'view' || m.t === 'match') expect(m.view.players[foe].hand.every((c) => c.id === HIDDEN)).toBe(true);
    // The finished game is kept as a replay, and no longer as a live one.
    vi.advanceTimersByTime(2000);
    await flush();
    expect(await store.liveMatches()).toEqual([]);
  });

  it('lets a Pounce question go after the same short wait, whether or not there is anything to play', async () => {
    const [sam, pippin] = await startGame();
    const rnd = rng(3);
    let asked = 0;
    for (let i = 0; i < 400 && asked < 3; i++) {
      const mover = [sam, pippin].find((p) => p.view?.prompt);
      if (!mover) break;
      if (mover.view!.prompt!.kind === 'pounce') {
        asked++;
        const other = mover === sam ? pippin : sam;
        expect(other.last('view')!.clock).toMatchObject({ phase: 'ask', seat: mover.view!.seat });
        const seq = mover.view!.actions;
        vi.advanceTimersByTime(ASK_MS + 1);
        await flush();
        expect(mover.view!.actions).toBe(seq + 1);   // let go for them
        continue;
      }
      mover.send({ t: 'act', match: mover.match!, seq: mover.view!.actions, action: choose(mover.view!, rnd) });
      await flush();
    }
    expect(asked).toBeGreaterThan(0);
  });

  it('shows each player’s handicap to both', async () => {
    const [sam, pippin] = await startGame(RELAXED, 6, 9);
    expect(sam.view!.players[0].lives.length).toBe(6);
    expect(pippin.view!.players[0].lives.length).toBe(6);
    expect(pippin.view!.players[0].handicap).toBe(3);
    expect(pippin.view!.players[1].lives.length).toBe(9);
  });

  it('can be conceded', async () => {
    const [sam, pippin] = await startGame();
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    expect(pippin.last('end')!.end).toMatchObject({ winner: 1, how: 'conceded', record: { wins: 1, losses: 0, draws: 0 } });
  });

  it('offers a rematch when both want one, with the other player going first', async () => {
    const [sam, pippin] = await startGame();
    const first = sam.last('match')!.view.startingYarn;
    const old = sam.match;
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    sam.send({ t: 'rematch', match: old! });
    await flush();
    expect(pippin.last('rematch')!.wants).toEqual([true, false]);
    pippin.send({ t: 'rematch', match: old! });
    await flush();
    expect(sam.match).not.toBe(old);
    expect(sam.last('match')!.view.startingYarn).toBe(first === 0 ? 1 : 0);
  });
});

describe('the clock in a Friend game', () => {
  it('never moves for a player who runs out of time; the other player decides', async () => {
    const [sam, pippin] = await startGame({ ...RELAXED, pace: 'quick' });
    const mover = sam.view!.prompt ? sam : pippin;
    const other = mover === sam ? pippin : sam;
    const seq = mover.view!.actions;
    vi.advanceTimersByTime(PACES.quick.clock.moveMs! + 1);
    await flush();
    expect(other.last('clock')!.clock).toMatchObject({ phase: 'overtime', seat: mover.view!.seat });
    expect(mover.view!.actions).toBe(seq);                         // nothing was played for them
    other.send({ t: 'end', match: other.match!, how: 'claim' });
    await flush();
    expect(other.last('error')!.message).toMatch(/Not yet/);
    other.send({ t: 'time', match: other.match!, what: 'nudge' });
    await flush();
    expect(mover.last('nudge')).toBeDefined();
    other.send({ t: 'time', match: other.match!, what: 'give' });
    await flush();
    expect(other.last('clock')!.clock.phase).toBe('move');
    vi.advanceTimersByTime(PACES.quick.clock.moveMs! + OVERTIME_CLAIM_MS + 1);
    await flush();
    other.send({ t: 'end', match: other.match!, how: 'call-off' });
    await flush();
    expect(mover.last('end')!.end).toEqual({ winner: null, how: 'called-off' });
    expect(await store.tally(A, B)).toEqual({ wins: 0, losses: 0, draws: 0 });  // called off: not counted
  });

  it('gives each player "Hold on" taps', async () => {
    const [sam, pippin] = await startGame({ ...RELAXED, pace: 'quick' });
    const mover = sam.view!.prompt ? sam : pippin;
    mover.send({ t: 'hold', match: mover.match! });
    await flush();
    const clock = mover.last('clock')!;
    expect(clock.held).toBe(mover.view!.seat);
    expect(clock.clock.holdOns[mover.view!.seat]).toBe(1);
    expect(clock.clock.left).toBeGreaterThan(PACES.quick.clock.moveMs!);
  });

  it('pauses while a player’s connection is down, and carries on when they are back', async () => {
    const [sam, pippin] = await startGame({ ...RELAXED, pace: 'quick' });
    pippin.drop();
    await flush();
    expect(sam.last('away')).toMatchObject({ seat: 1 });
    expect(sam.last('clock')!.clock.phase).toBe('paused');
    vi.advanceTimersByTime(PACES.quick.clock.moveMs! * 3);
    await flush();
    expect(sam.last('end')).toBeUndefined();
    // The one still there can still make their own move (the mulligan comes first for seat 0).
    if (sam.view!.prompt) {
      const seq = sam.view!.actions;
      sam.send({ t: 'act', match: sam.match!, seq, action: { t: 'mulligan', uids: [] } });
      await flush();
      expect(sam.view!.actions).toBe(seq + 1);
    }
    const back = await connect(B);
    expect(back.last('welcome')!.match).toBe(sam.match);
    back.send({ t: 'rejoin', match: sam.match! });
    await flush();
    expect(back.last('match')!.info.seat).toBe(1);
    expect(sam.last('back')).toMatchObject({ seat: 1 });
  });

  it('lets the one still there take the win once a dropped friend is gone too long', async () => {
    const [sam, pippin] = await startGame();
    pippin.drop();
    await flush();
    vi.advanceTimersByTime(3 * 60_000 + 1);
    await flush();
    expect(sam.last('away')!.left).toBe(0);
    sam.send({ t: 'end', match: sam.match!, how: 'claim' });
    await flush();
    expect(sam.last('end')!.end).toMatchObject({ winner: 0, how: 'claimed' });
  });
});

describe('room for a fixed number of players', () => {
  it('lets players in while there is room, then keeps a waiting line, buyers first', async () => {
    maxPlayers = 2;
    const sam = await connect(A);
    await connect(B);
    expect(await hub.enter(C)).toEqual({ status: 'waiting', position: 1, paid: false });
    // Dot has bought cards: ahead of the stranger, who joined first.
    expect(await hub.enter(D)).toEqual({ status: 'waiting', position: 1, paid: true });
    expect(await hub.enter(C)).toEqual({ status: 'waiting', position: 2, paid: false });
    // Someone leaves: the first in line gets the place.
    sam.drop();
    await flush();
    expect(await hub.enter(C)).toEqual({ status: 'waiting', position: 1, paid: false });
    expect(await hub.enter(D)).toEqual({ status: 'in' });
  });

  it('forgets a place in line nobody asks about any more', async () => {
    maxPlayers = 1;
    await connect(A);
    expect((await hub.enter(C)).status).toBe('waiting');
    vi.advanceTimersByTime(61_000);   // swept every 30 s; kept 30 s after it was last asked for
    expect(hub.counts().waiting).toBe(0);
  });

  it('refuses a connection that wasn’t let in', async () => {
    const stranger = await connect(C, false);
    expect(stranger.last('full')).toBeDefined();
    expect(hub.counts().connected).toBe(0);
  });

  it('never makes a player wait to come back to their game', async () => {
    maxPlayers = 2;
    const [, pippin] = await startGame();
    pippin.drop();
    await flush();
    await connect(C);                                   // the place is taken meanwhile
    expect(await hub.enter(B)).toEqual({ status: 'in' });
  });

  it('closes a connection that does nothing for 10 minutes, but never one in a game', async () => {
    const [sam] = await startGame();
    const dot = await connect(D);
    vi.advanceTimersByTime(11 * 60_000);
    expect(dot.last('idle')).toBeDefined();
    expect(sam.last('idle')).toBeUndefined();
    expect(hub.counts().connected).toBe(2);
  });

  it('can be switched off', async () => {
    open = false;
    expect(await hub.enter(A)).toEqual({ status: 'closed' });
    const sam = await connect(A, false);
    expect(sam.last('closed')).toBeDefined();
    expect(hub.here(A).open).toBe(false);
  });
});

describe('"I’m here", without a connection', () => {
  it('shows a friend online, and brings them a challenge, keeping them a place', async () => {
    maxPlayers = 2;
    expect(hub.here(B)).toEqual({ open: true, challenges: [], match: null });   // Pippin's game is open, not connected
    const sam = await connect(A);
    expect(sam.last('welcome')!.friends[0]).toMatchObject({ id: B, status: 'online' });
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('sent')).toBeDefined();
    const [note] = hub.here(B).challenges;
    expect(note).toMatchObject({ from: { name: 'Sam' }, options: RELAXED });
    // A place was kept for Pippin: online play is now full for anyone else.
    expect((await hub.enter(C)).status).toBe('waiting');
    const pippin = await connect(B);
    expect(pippin.last('challenge')!.id).toBe(note.id);
    pippin.send({ t: 'accept', id: note.id, deck: OTHER, lives: 9 });
    await flush();
    expect(pippin.last('match')).toBeDefined();
  });

  it('won’t challenge a friend who isn’t around', async () => {
    const sam = await connect(A);
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('error')!.message).toMatch(/aren’t online/);
    hub.here(B);
    vi.advanceTimersByTime(80_000);
    sam.send({ t: 'challenge', to: B, deck: STARTER, options: RELAXED, lives: 9 });
    await flush();
    expect(sam.last('sent')).toBeUndefined();
  });

  it('tells a player whose game is going', async () => {
    const [sam, pippin] = await startGame();
    pippin.drop();
    await flush();
    expect(hub.here(B).match).toBe(sam.match);
  });
});

describe('what a move sends', () => {
  it('sends only the new lines of the story', async () => {
    const [sam, pippin] = await startGame();
    const mover = sam.view!.prompt ? sam : pippin;
    const before = mover.last('match')!.view.log.length;
    mover.send({ t: 'act', match: mover.match!, seq: mover.view!.actions, action: { t: 'mulligan', uids: [] } });
    await flush();
    const v = mover.last('view')!;
    expect(v.logFrom).toBe(before);
    expect(v.view.log.length).toBeLessThan(4);
  });
});

describe('replays', () => {
  it('keeps a finished game for 30 days, then deletes it', async () => {
    const [sam] = await startGame();
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    const now = Date.now();
    expect(await store.pruneReplays(new Date(now + 29 * 86_400_000))).toBe(0);
    expect(await store.pruneReplays(new Date(now + 32 * 86_400_000))).toBe(1);
    expect(await store.pruneReplays(new Date(now + 33 * 86_400_000))).toBe(0);
  });
});

describe('letting go of games', () => {
  it('forgets a finished game once both players have left it', async () => {
    const [sam, pippin] = await startGame();
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    expect(hub.counts().matches).toBe(1);   // kept for the result screen and a rematch
    sam.send({ t: 'leave', match: sam.match! });
    pippin.send({ t: 'leave', match: pippin.match! });
    await flush();
    expect(hub.counts().matches).toBe(0);
  });

  it('forgets a finished game nobody leaves, after a while', async () => {
    const [sam] = await startGame();
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    vi.advanceTimersByTime(RESULT_KEEP_MS + 1);
    expect(hub.counts().matches).toBe(0);
  });

  it('calls off a game both players abandoned, then forgets it', async () => {
    const [sam, pippin] = await startGame();
    sam.drop(); pippin.drop();
    await flush();
    vi.advanceTimersByTime(30 * 60_000 + 1);
    await flush();
    vi.advanceTimersByTime(2000);
    await flush();
    expect(await store.liveMatches()).toEqual([]);          // moved to the finished games
    vi.advanceTimersByTime(RESULT_KEEP_MS + 1);
    expect(hub.counts().matches).toBe(0);
  });

  it('calls off a game nobody has moved in for a day, even with a player still there', async () => {
    const [sam] = await startGame({ ...RELAXED, pace: 'untimed' });
    vi.advanceTimersByTime(IDLE_MS + 1);
    await flush();
    expect(sam.last('end')!.end).toEqual({ winner: null, how: 'called-off' });
  });
});

describe('the clock in Ranked', () => {
  function rankedMatch() {
    const sent: { to: string; msg: ServerMessage }[] = [];
    const host: MatchHost = {
      send: (to, msg) => sent.push({ to, msg }), save() {}, async finished() { return [undefined, undefined]; }, rematch() {}, forget() {},
    };
    const record: MatchRecord = {
      id: 'r1', rules: rankedRules(), options: null, seed: 11, played: [], createdAt: new Date().toISOString(), rulesVersion: RULES_VERSION, end: null,
      seats: [{ person: { id: A, name: 'Sam', avatar: 'cat' }, deck: STARTER, lives: 9 }, { person: { id: B, name: 'Pippin', avatar: 'cat' }, deck: OTHER, lives: 9 }],
    };
    const m = new Match(record, host);
    m.start();
    return { m, sent };
  }

  it('uses the reserve, then makes the plainest move, and three timeouts in a row lose', async () => {
    const { m } = rankedMatch();
    const c = rankedRules().clock;
    const seat = m.state.prompt!.player;
    vi.advanceTimersByTime(c.moveMs! + 1);
    expect(m.clockView().phase).toBe('reserve');
    vi.advanceTimersByTime(c.reserveMs + 1);
    expect(m.record.played.at(-1)).toMatchObject({ seat, auto: true, action: { t: 'mulligan', uids: [] } });
    for (let i = 0; i < 20 && !m.end; i++) vi.advanceTimersByTime(c.moveMs! + ASK_MS + 1);
    await flush();
    expect(m.end).toMatchObject({ how: 'timeout' });
  });
});

describe('teaching games', () => {
  const TEACHING: ChallengeOptions = { pace: 'quick', teaching: true, startersOnly: true };

  it('has no timer, and doesn’t count', async () => {
    const [sam, pippin] = await startGame(TEACHING);
    expect(sam.last('match')!.info.rules).toMatchObject({ teaching: true, counts: false, clock: { moveMs: null } });
    sam.send({ t: 'end', match: sam.match!, how: 'concede' });
    await flush();
    expect(pippin.last('end')!.end.record).toBeUndefined();
  });

  it('suggests a move, and lets a player show their hand', async () => {
    const [sam, pippin] = await startGame(TEACHING);
    const mover = sam.view!.prompt ? sam : pippin;
    const other = mover === sam ? pippin : sam;
    mover.send({ t: 'hint', match: mover.match! });
    await flush();
    expect(mover.last('hint')!.action).toBeTruthy();
    other.send({ t: 'show', match: other.match!, on: true });
    await flush();
    expect(mover.view!.players[other.view!.seat].hand.every((c) => c.id !== HIDDEN)).toBe(true);
  });

  it('takes back a move that showed nothing new', async () => {
    const [sam, pippin] = await startGame(TEACHING);
    const rnd = rng(9);
    // Play until someone has an action that isn't a pass, a draw or a Life lost, then take it back.
    for (let i = 0; i < 300; i++) {
      const mover = [sam, pippin].find((p) => p.view?.prompt)!;
      const v = mover.view!;
      if (v.prompt!.kind === 'action') {
        const play = legalActions(v).find((a) => a.t === 'play' || a.t === 'attack');
        if (play) {
          const seq = v.actions;
          mover.send({ t: 'act', match: mover.match!, seq, action: play });
          await flush();
          mover.send({ t: 'undo', match: mover.match! });
          await flush();
          if (mover.last('view')!.undone === v.seat) {
            expect(mover.view!.actions).toBe(seq);
            expect(mover.view!.prompt?.player).toBe(v.seat);
            return;
          }
          continue;
        }
      }
      mover.send({ t: 'act', match: mover.match!, seq: v.actions, action: choose(v, rnd) });
      await flush();
    }
    throw new Error('never got to take a move back');
  });
});

describe('friend codes', () => {
  it('shows who a code belongs to before adding, and tells them once added', async () => {
    const sam = await connect(A);
    const pippin = await connect(B);
    sam.send({ t: 'code', code: 'K7M-4Q2' });
    pippin.send({ t: 'lookup', code: 'k7m4q2' });
    await flush();
    expect(pippin.last('looked')).toMatchObject({ code: 'K7M4Q2', person: { id: A, name: 'Sam' }, yours: false });
    sam.send({ t: 'lookup', code: 'K7M4Q2' });
    await flush();
    expect(sam.last('looked')).toMatchObject({ person: null, yours: true });
    pippin.send({ t: 'added', friend: A });
    await flush();
    expect(sam.last('added')!.by).toMatchObject({ id: B, name: 'Pippin' });
    // The code is used up.
    pippin.send({ t: 'lookup', code: 'K7M4Q2' });
    await flush();
    expect(pippin.last('looked')!.person).toBeNull();
  });

  it('still knows a code sent by text after its phone has left, until it runs out', async () => {
    const sam = await connect(A);
    sam.send({ t: 'code', code: 'K7M4Q2' });
    await flush();
    sam.drop();
    await flush();
    const pippin = await connect(B);
    pippin.send({ t: 'lookup', code: 'K7M-4Q2' });
    await flush();
    expect(pippin.last('looked')!.person).toMatchObject({ name: 'Sam' });
    vi.advanceTimersByTime(16 * 60_000);
    pippin.send({ t: 'lookup', code: 'K7M-4Q2' });
    await flush();
    expect(pippin.last('looked')!.person).toBeNull();
  });

  it('won’t let codes be guessed by trying them all', async () => {
    const pippin = await connect(B);
    for (let i = 0; i < 15; i++) pippin.send({ t: 'lookup', code: `AAAA${String(i).padStart(2, '0')}` });
    await flush();
    expect(pippin.last('error')!.message).toMatch(/Too many/);
  });
});

describe('after a restart', () => {
  it('picks up a game that was going, and the players find it waiting', async () => {
    const [sam] = await startGame();
    const id = sam.match!;
    sam.send({ t: 'act', match: id, seq: sam.view!.actions, action: { t: 'mulligan', uids: [] } });
    await flush();
    vi.advanceTimersByTime(1500);
    await flush();
    const saved = await store.liveMatches();
    expect(saved.map((r) => r.id)).toEqual([id]);

    // A new hub on the same tables, as after a restart.
    const kept = store;
    hub.stop();
    hub = createHub({
      async paid() { return false; }, maxPlayers: 100, open: () => true,
      store: kept, async verify(token) { const x = token.slice(4); return { id: x, name: NAMES[x] }; },
      async friendsOf(a) { return FRIENDS[a]; }, async checkDeck() { return null; }, log() {},
    });
    await hub.restore();
    const back = await connect(A);
    expect(back.last('welcome')!.match).toBe(id);
    back.send({ t: 'rejoin', match: id });
    await flush();
    expect(back.last('match')!.view.actions).toBe(saved[0].played.length);
  });
});
