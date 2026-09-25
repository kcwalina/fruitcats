// One online game between two players (docs/pvp-plan.md), the same for Friend games and Ranked: the rules it's made
// with (MatchRules) say how long a move may take, what happens when time runs out, and whether the teaching helps are
// on. Nothing here asks which mode it is.
//
// The server holds the whole game. Each player is sent only their view of it (viewFor): never the other player's
// hand, the deck order or the seed. A player's action is checked against the rules before it's applied.
//
// A match is kept as its seed plus the actions played (MatchRecord), so it can always be rebuilt the same way: after
// the API restarts, or to take back a move in a teaching game. The same record is the replay.

import {
  apply, chooseAction, createGame, IllegalAction, legalActions, other, viewFor,
  type Action, type DeckList, type GameState, type PlayerId, type PlayerView,
} from '@fruitcats/engine';
import {
  EMOTES, NUDGE_EVERY_MS, OVERTIME_CLAIM_MS,
  type ChallengeOptions, type ClientMessage, type ClockView, type MatchEnd, type MatchInfo, type MatchRules, type Person,
  type ServerMessage, type Tally,
} from '@fruitcats/match';

export interface SeatRecord { person: Person; deck: DeckList; lives: number }

/** One action, who took it, and whether the game took it for them (a Pounce question let go, time run out). */
export interface Played { seat: PlayerId; action: Action; auto?: true }

/** Everything needed to rebuild a match exactly. */
export interface MatchRecord {
  id: string;
  rules: MatchRules;
  options: ChallengeOptions | null;
  seats: [SeatRecord, SeatRecord];
  seed: number;
  firstPlayer?: PlayerId;
  played: Played[];
  createdAt: string;
  rulesVersion: number;
  end: MatchEnd | null;
}

/** What a match needs from the server around it. */
export interface MatchHost {
  send(account: string, msg: ServerMessage): void;
  /** The record changed: write it down. */
  save(m: Match): void;
  /** The game is over: record the result. Returns each seat's record against the other, when the game counts. */
  finished(m: Match): Promise<[Tally | undefined, Tally | undefined]>;
  /** Both players asked for a rematch. */
  rematch(m: Match): void;
  /** Both players have left the result screen: the match can be forgotten. */
  forget(m: Match): void;
}

/** A game left with both players gone this long is called off. */
const BOTH_GONE_MS = 30 * 60_000;
/** Emotes: at most one per this long, per player. */
const EMOTE_EVERY_MS = 1500;

type Phase = ClockView['phase'];

export class Match {
  readonly record: MatchRecord;
  state: GameState;
  private readonly host: MatchHost;

  // The clock: whose decision is being timed, in which phase, and until when.
  private phase: Phase = 'none';
  private clockSeat: PlayerId | null = null;
  private deadline: number | null = null;
  private phaseStart = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reserve: [number, number];
  private holdOns: [number, number];
  private strikes: [number, number] = [0, 0];
  private overtimeSince: number | null = null;
  /** While paused (a connection dropped): the phase that was running and the time it had left. */
  private paused: { phase: Phase; left: number | null } | null = null;

  /** When each player's connection dropped (null: connected). */
  private away: [number | null, number | null] = [null, null];
  private awayTimers: [ReturnType<typeof setTimeout> | undefined, ReturnType<typeof setTimeout> | undefined] = [undefined, undefined];
  private goneTimer: ReturnType<typeof setTimeout> | undefined;

  /** Teaching games: whether each player is showing their hand to the other. */
  private showing: [boolean, boolean] = [false, false];
  private wantsRematch: [boolean, boolean] = [false, false];
  private leftResult: [boolean, boolean] = [false, false];
  /** How many of the game's events each player has been sent, so each view carries only what's new. */
  private sentEvents: [number, number] = [0, 0];
  private lastNudge = 0;
  private lastEmote: [number, number] = [0, 0];

  constructor(record: MatchRecord, host: MatchHost) {
    this.record = record;
    this.host = host;
    this.state = rebuild(record, record.played.length);
    const c = record.rules.clock;
    this.reserve = [c.reserveMs, c.reserveMs];
    this.holdOns = [c.holdOns, c.holdOns];
    this.sentEvents = [this.state.events.length, this.state.events.length];
  }

  get id() { return this.record.id; }
  get end() { return this.record.end; }
  account(seat: PlayerId) { return this.record.seats[seat].person.id; }
  seatOf(account: string): PlayerId | null {
    return this.account(0) === account ? 0 : this.account(1) === account ? 1 : null;
  }

  /** Both players see the game start. A match rebuilt after a restart waits for them to come back. */
  start(restored = false) {
    if (restored) {
      this.away = [Date.now(), Date.now()];
      this.goneTimer = setTimeout(() => void this.finish({ winner: null, how: 'called-off' }), BOTH_GONE_MS);
      this.startDecision();
      return;
    }
    this.startDecision();
    for (const seat of [0, 1] as PlayerId[]) this.host.send(this.account(seat), this.matchMessage(seat));
  }

  // ── What each player is sent ──────────────────────────────────────────────────────────────────

  info(seat: PlayerId): MatchInfo {
    return {
      id: this.id, seat, players: [this.record.seats[0].person, this.record.seats[1].person],
      rules: this.record.rules, options: this.record.options,
    };
  }

  /** The whole match, for a player joining or coming back: no events to replay. */
  matchMessage(seat: PlayerId): ServerMessage {
    this.sentEvents[seat] = this.state.events.length;
    const view = this.viewOf(seat);
    return { t: 'match', info: this.info(seat), view, clock: this.clockView(), showing: this.showing, rematch: this.wantsRematch, end: this.end };
  }

  /** What this player may see, with only the events since their last view. */
  private viewOf(seat: PlayerId): PlayerView {
    const v = viewFor(this.state, seat);
    v.events = this.state.events.slice(this.sentEvents[seat]);
    this.sentEvents[seat] = this.state.events.length;
    const foe = other(seat);
    if (this.showing[foe]) v.players[foe].hand = structuredClone(this.state.players[foe].hand);
    return v;
  }

  private broadcast(undone?: PlayerId) {
    for (const seat of [0, 1] as PlayerId[])
      this.host.send(this.account(seat), { t: 'view', match: this.id, view: this.viewOf(seat), clock: this.clockView(), showing: this.showing, undone });
  }

  private sendClock(held?: PlayerId) {
    for (const seat of [0, 1] as PlayerId[]) this.host.send(this.account(seat), { t: 'clock', match: this.id, clock: this.clockView(), held });
  }

  private sendBoth(msg: ServerMessage) {
    for (const seat of [0, 1] as PlayerId[]) this.host.send(this.account(seat), msg);
  }

  clockView(): ClockView {
    const now = Date.now();
    const reserve: [number, number] = [...this.reserve];
    if (this.phase === 'reserve' && this.clockSeat !== null) reserve[this.clockSeat] = Math.max(0, reserve[this.clockSeat] - (now - this.phaseStart));
    return {
      seat: this.clockSeat,
      phase: this.phase,
      left: this.phase === 'paused' ? this.paused?.left ?? null : this.deadline === null ? null : Math.max(0, this.deadline - now),
      reserve,
      holdOns: [...this.holdOns],
      claimIn: this.phase === 'overtime' && this.overtimeSince !== null ? Math.max(0, this.overtimeSince + OVERTIME_CLAIM_MS - now) : null,
    };
  }

  // ── Messages from a player ────────────────────────────────────────────────────────────────────

  handle(seat: PlayerId, msg: ClientMessage) {
    const me = this.account(seat);
    const error = (message: string) => this.host.send(me, { t: 'error', message });
    switch (msg.t) {
      case 'rejoin': this.host.send(me, this.matchMessage(seat)); return;
      case 'emote': {
        if (!(msg.emote in EMOTES) || Date.now() - this.lastEmote[seat] < EMOTE_EVERY_MS) return;
        this.lastEmote[seat] = Date.now();
        this.sendBoth({ t: 'emote', match: this.id, seat, emote: msg.emote });
        return;
      }
      case 'rematch':
        if (!this.end || !this.record.rules.rematch || this.leftResult[other(seat)]) return;
        this.wantsRematch[seat] = true;
        if (this.wantsRematch[0] && this.wantsRematch[1]) { this.host.rematch(this); return; }
        this.sendBoth({ t: 'rematch', match: this.id, wants: [...this.wantsRematch] });
        return;
      case 'leave':
        this.leftResult[seat] = true;
        this.wantsRematch[seat] = false;
        if (this.end) this.host.send(this.account(other(seat)), { t: 'rematch', match: this.id, wants: [false, false] });
        if (this.leftResult[0] && this.leftResult[1]) this.host.forget(this);
        return;
    }
    if (this.end) return error('This game is over.');
    switch (msg.t) {
      case 'act': return this.act(seat, msg.seq, msg.action);
      case 'hold': return this.hold(seat);
      case 'time': return this.time(seat, msg.what);
      case 'end': return this.endBy(seat, msg.how);
      case 'hint': return this.hint(seat);
      case 'undo': return this.undo(seat);
      case 'show':
        if (!this.record.rules.teaching) return;
        this.showing[seat] = msg.on === true;
        this.broadcast();
        return;
    }
  }

  private act(seat: PlayerId, seq: number, action: Action) {
    const me = this.account(seat);
    // An action for an older state (a double tap, a message that crossed another) is dropped, never applied twice.
    if (seq !== this.state.actions) return this.host.send(me, this.matchMessage(seat));
    if (this.state.prompt?.player !== seat || this.phase === 'paused') return this.host.send(me, { t: 'error', message: 'It isn’t your turn to decide.' });
    this.stopClock();
    const before = this.state;
    try {
      this.state = apply(structuredClone(before), action);
    } catch (e) {
      this.state = before;
      this.resumeAfterRefusal();
      return this.host.send(me, { t: 'error', message: e instanceof IllegalAction ? 'That move isn’t allowed right now.' : 'Something went wrong with that move.' });
    }
    this.record.played.push({ seat, action });
    this.strikes[seat] = 0;
    this.afterChange();
  }

  /** The game makes the plainest move for this player: their time ran out, or a Pounce or Lucky question was let go. */
  private autoMove(seat: PlayerId) {
    if (this.state.prompt?.player !== seat) return;
    this.stopClock();
    const action = plainestMove(this.state);
    this.state = apply(structuredClone(this.state), action);
    this.record.played.push({ seat, action, auto: true });
    this.afterChange();
  }

  private afterChange() {
    if (this.state.winner !== null) { void this.finish({ winner: this.state.winner, how: 'played' }); return; }
    this.startDecision();
    this.broadcast();
    this.host.save(this);
  }

  // ── The clock ─────────────────────────────────────────────────────────────────────────────────

  private setPhase(phase: Phase, seat: PlayerId | null, ms: number | null, then?: () => void) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.clockSeat = seat;
    this.phaseStart = Date.now();
    this.deadline = ms === null ? null : Date.now() + ms;
    if (ms !== null && then) this.timer = setTimeout(then, ms);
  }

  /** A new decision: time it by the rules. */
  private startDecision() {
    const prompt = this.state.prompt;
    if (!prompt || this.state.winner !== null) { this.setPhase('none', null, null); return; }
    if (this.away[0] !== null || this.away[1] !== null) { this.setPhase('none', prompt.player, null); this.pause(); return; }
    const seat = prompt.player;
    this.overtimeSince = null;
    // Pounce and Lucky questions are asked every time (alwaysAsk) and let go after the same short wait whether or not
    // there's anything to play, so the wait tells the other player nothing.
    if (prompt.kind === 'pounce' || prompt.kind === 'lucky') { this.setPhase('ask', seat, this.record.rules.askMs, () => this.autoMove(seat)); return; }
    this.startMove(seat, this.record.rules.clock.moveMs);
  }

  private startMove(seat: PlayerId, ms: number | null) {
    if (ms === null) { this.setPhase('none', seat, null); return; }
    this.setPhase('move', seat, ms, () => this.outOfMove(seat));
  }

  private outOfMove(seat: PlayerId) {
    if (this.reserve[seat] > 0) { this.setPhase('reserve', seat, this.reserve[seat], () => this.outOfTime(seat)); this.sendClock(); return; }
    this.outOfTime(seat);
  }

  private outOfTime(seat: PlayerId) {
    if (this.phase === 'reserve') this.reserve[seat] = 0;
    if (this.record.rules.clock.onTimeout === 'auto') {
      this.strikes[seat]++;
      if (this.strikes[seat] >= this.record.rules.clock.strikes) { void this.finish({ winner: other(seat), how: 'timeout' }); return; }
      this.autoMove(seat);
      return;
    }
    // A Friend game: nothing happens by itself. The other player may give more time or nudge, and after a while
    // take the win or call the game off.
    this.setPhase('overtime', seat, null);
    this.overtimeSince = Date.now();
    this.timer = setTimeout(() => this.sendClock(), OVERTIME_CLAIM_MS);
    this.sendClock();
  }

  /** Before applying an action: count the reserve used, and stop the timer. */
  private stopClock() {
    if (this.phase === 'reserve' && this.clockSeat !== null) this.reserve[this.clockSeat] = Math.max(0, this.reserve[this.clockSeat] - (Date.now() - this.phaseStart));
    clearTimeout(this.timer);
  }

  /** A refused action didn't use the decision up: carry on timing it. */
  private resumeAfterRefusal() {
    const left = this.deadline === null ? null : Math.max(0, this.deadline - Date.now());
    const seat = this.clockSeat;
    if (seat === null || left === null) return;
    if (this.phase === 'ask') this.setPhase('ask', seat, left, () => this.autoMove(seat));
    else if (this.phase === 'move') this.setPhase('move', seat, left, () => this.outOfMove(seat));
    else if (this.phase === 'reserve') this.setPhase('reserve', seat, left, () => this.outOfTime(seat));
  }

  /** "Hold on": keep a Pounce or Lucky question open, or add time to a decision. */
  private hold(seat: PlayerId) {
    if (this.clockSeat !== seat || this.state.prompt?.player !== seat) return;
    if (this.phase === 'ask') { this.startMove(seat, this.record.rules.clock.moveMs); this.sendClock(seat); return; }
    if (!['move', 'reserve', 'overtime'].includes(this.phase) || this.holdOns[seat] <= 0) return;
    this.holdOns[seat]--;
    const extra = this.record.rules.clock.holdOnMs;
    if (this.phase === 'move') this.setPhase('move', seat, (this.deadline ?? Date.now()) - Date.now() + extra, () => this.outOfMove(seat));
    else { this.stopClock(); this.setPhase('move', seat, extra, () => this.outOfMove(seat)); }
    this.sendClock(seat);
  }

  /** The other player is out of time: give them another move's worth, or nudge them. */
  private time(seat: PlayerId, what: 'give' | 'nudge') {
    const foe = other(seat);
    if (this.phase !== 'overtime' || this.clockSeat !== foe) return;
    if (what === 'give') { this.startMove(foe, this.record.rules.clock.moveMs ?? 120_000); this.sendClock(); return; }
    if (Date.now() - this.lastNudge < NUDGE_EVERY_MS) return;
    this.lastNudge = Date.now();
    this.host.send(this.account(foe), { t: 'nudge', match: this.id });
  }

  private pause() {
    if (this.phase === 'paused') return;
    const left = this.deadline === null ? null : Math.max(0, this.deadline - Date.now());
    if (this.phase === 'reserve' && this.clockSeat !== null) this.reserve[this.clockSeat] = left ?? 0;
    this.paused = { phase: this.phase, left };
    clearTimeout(this.timer);
    this.phase = 'paused';
    this.deadline = null;
  }

  private resume() {
    const was = this.paused;
    this.paused = null;
    const seat = this.clockSeat;
    if (!was || seat === null || was.phase === 'none' || was.phase === 'ask') { this.startDecision(); return; }
    if (was.phase === 'overtime') { this.outOfTime(seat); return; }
    const left = was.left ?? 0;
    if (was.phase === 'move') this.setPhase('move', seat, left, () => this.outOfMove(seat));
    else this.setPhase('reserve', seat, left, () => this.outOfTime(seat));
  }

  // ── Connections ───────────────────────────────────────────────────────────────────────────────

  dropped(seat: PlayerId) {
    if (this.end) { this.handle(seat, { t: 'leave', match: this.id }); return; }
    if (this.away[seat] !== null) return;
    this.away[seat] = Date.now();
    this.pause();
    const grace = this.record.rules.dropGraceMs;
    this.host.send(this.account(other(seat)), { t: 'away', match: this.id, seat, left: grace });
    this.awayTimers[seat] = setTimeout(() => {
      // Ranked: gone too long is a loss. A Friend game waits: the one still there may take the win or call it off.
      if (this.record.rules.kind === 'ranked') void this.finish({ winner: other(seat), how: 'left' });
      else this.host.send(this.account(other(seat)), { t: 'away', match: this.id, seat, left: 0 });
    }, grace);
    if (this.away[other(seat)] !== null) this.goneTimer ??= setTimeout(() => void this.finish({ winner: null, how: 'called-off' }), BOTH_GONE_MS);
  }

  connected(seat: PlayerId) {
    if (this.away[seat] === null) return;
    clearTimeout(this.awayTimers[seat]);
    clearTimeout(this.goneTimer);
    this.goneTimer = undefined;
    this.away[seat] = null;
    if (this.end) return;
    this.host.send(this.account(other(seat)), { t: 'back', match: this.id, seat });
    if (this.away[other(seat)] === null) { this.resume(); this.sendClock(); }
  }

  /** May this player end the game in their favour, or call it off: the other player is gone, or out of time? */
  private mayClaim(seat: PlayerId): boolean {
    const foe = other(seat);
    const gone = this.away[foe] !== null && Date.now() - this.away[foe]! >= this.record.rules.dropGraceMs;
    const outOfTime = this.phase === 'overtime' && this.clockSeat === foe && this.overtimeSince !== null && Date.now() - this.overtimeSince >= OVERTIME_CLAIM_MS;
    const pausedOvertime = this.phase === 'paused' && this.paused?.phase === 'overtime' && this.clockSeat === foe;
    return gone || outOfTime || pausedOvertime;
  }

  private endBy(seat: PlayerId, how: 'concede' | 'claim' | 'call-off') {
    if (how === 'concede') { void this.finish({ winner: other(seat), how: 'conceded' }); return; }
    if (!this.mayClaim(seat)) { this.host.send(this.account(seat), { t: 'error', message: 'Not yet: they still have time.' }); return; }
    void this.finish(how === 'claim' ? { winner: seat, how: 'claimed' } : { winner: null, how: 'called-off' });
  }

  async finish(end: MatchEnd) {
    if (this.record.end) return;
    clearTimeout(this.timer);
    clearTimeout(this.goneTimer);
    for (const t of this.awayTimers) clearTimeout(t);
    this.phase = 'none';
    this.deadline = null;
    this.record.end = end;
    if (end.winner !== null && this.state.winner === null) this.state.winner = end.winner;
    this.broadcast();
    const records = await this.host.finished(this);
    for (const seat of [0, 1] as PlayerId[])
      this.host.send(this.account(seat), { t: 'end', match: this.id, end: { ...end, record: records[seat] } });
    this.host.save(this);
  }

  // ── Teaching games ────────────────────────────────────────────────────────────────────────────

  /** A suggested move, from the same AI as Solo. It never looks at hidden cards: it blanks the other hand first. */
  private hint(seat: PlayerId) {
    if (!this.record.rules.teaching || this.state.prompt?.player !== seat) return;
    let action: Action | null = null;
    try { action = chooseAction(structuredClone(this.state), { skill: 1 }); } catch { action = null; }
    this.host.send(this.account(seat), { t: 'hint', match: this.id, action });
  }

  /**
   * Take back your last move, if it showed you nothing new (no card drawn, no Life turned over, no mulligan) and the
   * other player hasn't moved since. Rebuilt from the seed and the moves before it.
   */
  private undo(seat: PlayerId) {
    if (!this.record.rules.teaching) return;
    const at = takeBackPoint(this.record, seat);
    if (at < 0) { this.host.send(this.account(seat), { t: 'error', message: 'That move can’t be taken back now.' }); return; }
    clearTimeout(this.timer);
    this.record.played = this.record.played.slice(0, at);
    this.state = rebuild(this.record, at);
    this.sentEvents = [this.state.events.length, this.state.events.length];
    this.startDecision();
    this.broadcast(seat);
    this.host.save(this);
  }
}

// ── Rules of the record ──────────────────────────────────────────────────────────────────────────

/** The game after the first `count` actions of the record, built from its seed. */
export function rebuild(r: MatchRecord, count: number): GameState {
  const names = r.seats.map((s) => s.person.name) as [string, string];
  if (names[0] === names[1]) names[1] = `${names[1]} 2`;
  const s = createGame({
    decks: [r.seats[0].deck, r.seats[1].deck], names, seed: r.seed, firstPlayer: r.firstPlayer,
    lives: [r.seats[0].lives, r.seats[1].lives], alwaysAsk: true,
  });
  for (let i = 0; i < count; i++) apply(s, r.played[i].action);
  return s;
}

/**
 * Where a take-back would rewind to (the index of the player's own last move), or -1 if it isn't allowed: the other
 * player moved since, or the move showed the player something new.
 */
export function takeBackPoint(r: MatchRecord, seat: PlayerId): number {
  let i = r.played.length - 1;
  // Moves the game made for the other player (a Pounce question let go) don't count as them moving.
  while (i >= 0 && r.played[i].seat !== seat && r.played[i].auto) i--;
  if (i < 0 || r.played[i].seat !== seat || r.played[i].auto) return -1;
  const action = r.played[i].action;
  if (action.t === 'mulligan') return -1;
  const before = rebuild(r, i).events.length;
  const after = rebuild(r, r.played.length).events.slice(before);
  if (after.some((e) => (e.t === 'draw' || e.t === 'lifeLost') && e.p === seat)) return -1;
  return i;
}

/** The move that changes least: pass, keep the hand, let the Pounce go, keep the Lucky card, the first choice. */
export function plainestMove(s: GameState): Action {
  const prompt = s.prompt!;
  const hand = s.players[prompt.player].hand;
  switch (prompt.kind) {
    case 'mulligan': return { t: 'mulligan', uids: [] };
    case 'setupPlant': return { t: 'setupPlant', uids: hand.slice(0, prompt.count).map((c) => c.uid) };
    case 'discard': return { t: 'discard', uids: hand.slice(-prompt.count).map((c) => c.uid) };
    case 'plant': return { t: 'skipPlant' };
    case 'action': return { t: 'pass' };
    case 'pounce': return { t: 'decline' };
    case 'lucky': return { t: 'keepLucky' };
    case 'choose': return legalActions(s)[0];
  }
}

export const newMatchId = () => crypto.randomUUID().replace(/-/g, '');
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
