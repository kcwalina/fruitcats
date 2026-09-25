// An online game's own parts of the game screen (docs/pvp-plan.md): the other player's Pawtrait and emotes, the
// clock, "Hold on", what to do when the other player runs out of time or drops, a teaching game's hints and
// take-backs, the Versus splash and the result. main.ts draws the board the same way for Solo and online; it asks
// this file for these pieces, and sends a move here instead of applying it.
//
// The board is drawn from the view the server sends (viewFor): never the other player's hand or deck.

import { CARDS, cardName, other, type Action, type GameState, type PlayerId, type PlayerView } from '@fruitcats/engine';
import {
  EMOTES,
  type ClockView, type Emote, type MatchEnd, type MatchInfo, type ServerMessage,
} from '@fruitcats/match';
import { pawtrait } from './account';
import { live, send } from './live';
import { artUrl, cardUrl, esc } from './ui';

export interface Online {
  info: MatchInfo;
  clock: ClockView;
  /** When the clock was sent (this device's time): its `left` counts down from here. */
  clockAt: number;
  showing: [boolean, boolean];
  end: MatchEnd | null;
  rematch: [boolean, boolean];
  /** The other player's connection dropped: until when they may come back (this device's time); 0 = past. */
  away: { seat: PlayerId; until: number } | null;
  emotes: { seat: PlayerId; text: string; at: number }[];
  muted: boolean;
  emoting: boolean;
  /** The ⋯ menu beside Rules and Home (Concede, Show my hand, Mute). */
  menu: boolean;
  /** A teaching game's suggested move. */
  hint: Action | null;
  /** Someone used a "Hold on" just now. */
  held: { seat: PlayerId; at: number } | null;
  nudgedAt: number;
  /** The Versus splash shows until then. */
  versusUntil: number;
  conceding: boolean;
  /** A move was sent and the server hasn't answered yet: don't send another. */
  sent: boolean;
  /** Someone took a move back just now. */
  undone: { seat: PlayerId; at: number } | null;
}

export let ol: Online | null = null;

export const mySeat = (): PlayerId => ol?.info.seat ?? 0;
export const theirSeat = (): PlayerId => other(mySeat());
export const them = () => ol!.info.players[theirSeat()];
export const teaching = () => !!ol?.info.rules.teaching;

/** A match message: a new game (with the Versus splash), or the game again after reconnecting. */
export function enterMatch(msg: Extract<ServerMessage, { t: 'match' }>) {
  const fresh = ol?.info.id !== msg.info.id && msg.view.actions <= 2 && !msg.end;
  const muted = ol?.muted ?? false;
  ol = {
    info: msg.info, clock: msg.clock, clockAt: Date.now(), showing: msg.showing, end: msg.end, rematch: msg.rematch,
    away: null, emotes: [], muted, emoting: false, menu: false, hint: null, held: null, nudgedAt: 0,
    versusUntil: fresh ? Date.now() + 3200 : 0, conceding: false, sent: false, undone: null,
  };
}

/** Stop drawing the match here without leaving it (it can be rejoined). */
export function forgetOnline() { ol = null; }

export function leaveMatch() {
  if (ol) send({ t: 'leave', match: ol.info.id });
  if (ol && live.match === ol.info.id) live.match = null;
  ol = null;
}

/** Everything from the server about this match apart from the views, which main.ts animates. True if it's ours. */
export function onlineMessage(msg: ServerMessage): boolean {
  if (!ol || !('match' in msg) || msg.match !== ol.info.id) return false;
  switch (msg.t) {
    case 'view':
      ol.clock = msg.clock; ol.clockAt = Date.now(); ol.showing = msg.showing; ol.sent = false; ol.hint = null;
      if (msg.undone !== undefined) ol.undone = { seat: msg.undone, at: Date.now() };
      break;
    case 'clock':
      ol.clock = msg.clock; ol.clockAt = Date.now();
      if (msg.held !== undefined) ol.held = { seat: msg.held, at: Date.now() };
      break;
    case 'emote':
      if (!ol.muted || msg.seat === mySeat()) ol.emotes.push({ seat: msg.seat, text: EMOTES[msg.emote], at: Date.now() });
      break;
    case 'away': ol.away = { seat: msg.seat, until: Date.now() + msg.left }; break;
    case 'back': ol.away = null; break;
    case 'nudge':
      ol.nudgedAt = Date.now();
      navigator.vibrate?.([120, 80, 120]);
      break;
    case 'hint': ol.hint = msg.action; break;
    case 'end': ol.end = msg.end; ol.conceding = false; break;
    case 'rematch': ol.rematch = msg.wants; break;
  }
  return true;
}

// ── The clock ───────────────────────────────────────────────────────────────────────────────────

/** Ms left in the clock's current phase, now. */
function left(): number | null {
  if (!ol || ol.clock.left === null) return null;
  return Math.max(0, ol.clock.left - (Date.now() - ol.clockAt));
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function clockText(): string {
  if (!ol) return '';
  const c = ol.clock;
  const ms = left();
  if (c.phase === 'overtime') return 'Out of time';
  if (c.phase === 'paused') return 'Paused';
  if (ms === null) return '';
  return c.phase === 'reserve' ? `Reserve ${fmt(ms)}` : fmt(ms);
}

/** The clock beside the Pawtrait of whoever is deciding. */
export function clockChip(seat: PlayerId): string {
  if (!ol || ol.end || ol.clock.seat !== seat || ol.clock.phase === 'none' || ol.clock.phase === 'ask') return '';
  const ms = left();
  const low = ms !== null && ms < 10_000 && ol.clock.phase !== 'paused';
  return `<span class="clock-chip ${ol.clock.phase} ${low ? 'low' : ''}" data-clock="${seat}">${clockText()}</span>`;
}

/**
 * The Pawtrait on the board, in the same place and size as in Solo. Everything online adds sits on it and takes no room:
 * the clock under it, emote bubbles over it, and on yours a small 🐾 badge that opens the emotes.
 */
export function playerFace(seat: PlayerId): string {
  if (!ol) return '';
  const now = Date.now();
  const bubble = ol.emotes.filter((e) => e.seat === seat && now - e.at < 3000).at(-1);
  const mine = seat === mySeat();
  const list = (Object.keys(EMOTES) as Emote[]).filter((e) => teaching() || !['hint', 'goodtry'].includes(e));
  return `${pawtrait(ol.info.players[seat].avatar, 'board-pawtrait')}
    ${bubble ? `<span class="emote-bubble ${mine ? 'mine' : ''}">${esc(bubble.text)}</span>` : ''}
    ${clockChip(seat)}
    ${mine && !ol.end ? `<button class="emote-open" data-click="ol:emotes" aria-expanded="${ol.emoting}" aria-label="Say something" title="Say something">🐾</button>` : ''}
    ${mine && ol.emoting ? `<div class="emote-menu">${list.map((e) => `<button data-click="ol:emote:${e}">${esc(EMOTES[e])}</button>`).join('')}</div>` : ''}`;
}

// Once a second: the clock's numbers, redrawn in place (no full render, so a card being dragged isn't disturbed).
let redraw: () => void = () => {};
export function onlineTicks(render: () => void) { redraw = render; }
window.setInterval(() => {
  if (!ol) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-clock]')) {
    el.textContent = clockText();
    const ms = left();
    el.classList.toggle('low', ms !== null && ms < 10_000 && ol.clock.phase !== 'paused');
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-away]')) el.textContent = ol.away ? fmt(Math.max(0, ol.away.until - Date.now())) : '';
  const ask = document.querySelector<HTMLElement>('[data-ask]');
  if (ask) ask.textContent = String(Math.ceil((left() ?? 0) / 1000));
  // Emote bubbles fade after 3 s; the claim buttons appear when they may be used.
  const now = Date.now();
  const bubbles = ol.emotes.some((e) => now - e.at >= 3000 && now - e.at < 4000);
  const claimable = (ol.clock.phase === 'overtime' && ol.clock.claimIn !== null && ol.clock.claimIn - (now - ol.clockAt) <= 0 && ol.clock.claimIn - (now - ol.clockAt) > -1000)
    || (ol.away && ol.away.until <= now && ol.away.until > now - 1000);
  if (bubbles || claimable) redraw();
}, 1000);

// ── The prompt bar ──────────────────────────────────────────────────────────────────────────────

/**
 * What an online game adds to the prompt bar. `mine`: the game is waiting on you. Returns text to show instead of
 * the usual (when the other player is deciding), and buttons to add.
 */
export function onlineBar(s: GameState, mine: boolean): { text: string | null; buttons: string } {
  if (!ol || s.winner !== null || ol.end) return { text: null, buttons: '' };
  const c = ol.clock;
  const name = esc(them().name);
  const now = Date.now();
  const buttons: string[] = [];
  let text: string | null = null;
  const held = ol.held && now - ol.held.at < 5000 && ol.held.seat === theirSeat() ? ` <span class="turn-hint">${name} needs a moment.</span>` : '';
  const undone = ol.undone && now - ol.undone.at < 6000
    ? `<div class="notice">↶ ${ol.undone.seat === mySeat() ? 'You took back your move.' : `${name} took back a move.`}</div>` : '';

  if (ol.away) {
    const gone = ol.away.until <= now;
    text = gone
      ? `<b>${name} hasn’t come back.</b> Keep waiting, or end the game.`
      : `<b>${name}’s connection dropped.</b> Waiting <span data-away>${fmt(ol.away.until - now)}</span> for them to come back.`;
    if (gone) buttons.push(
      ...(ol.info.rules.kind === 'friend' ? ['<button data-click="ol:end:call-off">Call it off</button>'] : []),
      '<button class="primary" data-click="ol:end:claim">Take the win</button>',
    );
    return { text: undone + text, buttons: buttons.join('') };
  }

  if (!mine) {
    if (c.phase === 'overtime' && c.seat === theirSeat()) {
      const claimIn = c.claimIn === null ? null : c.claimIn - (now - ol.clockAt);
      text = `<b>${name} is out of time.</b> Give them more, or nudge them.`;
      buttons.push('<button data-click="ol:time:nudge">Nudge</button>', '<button class="primary" data-click="ol:time:give">Give more time</button>');
      if (claimIn !== null && claimIn <= 0) {
        text = `<b>${name} is out of time</b> and hasn’t moved for a while.`;
        buttons.push('<button data-click="ol:end:call-off">Call it off</button>', '<button data-click="ol:end:claim">Take the win</button>');
      }
    } else if (c.phase === 'ask') {
      text = `<span class="dots">${name} is deciding whether to answer</span>`;
    } else {
      text = `<span class="dots">${name}’s turn: they take one action, then it’s yours again</span>${held}`;
    }
    if (teaching() && lastMoveWasMine(s)) buttons.unshift('<button data-click="ol:undo">↶ Take back</button>');
    return { text: undone + text, buttons: buttons.join('') };
  }

  // Your decision.
  if (c.phase === 'ask') {
    buttons.push(`<button data-click="ol:hold" title="Keep this question open">Wait <small>(<span data-ask>${Math.ceil((left() ?? 0) / 1000)}</span>)</small></button>`);
  } else if (c.phase !== 'none' && c.phase !== 'paused' && c.holdOns[mySeat()] > 0 && ol.info.rules.clock.holdOns) {
    buttons.push(`<button data-click="ol:hold" title="Adds ${Math.round(ol.info.rules.clock.holdOnMs / 60_000)} minute(s) to this move">Hold on <small>(${c.holdOns[mySeat()]})</small></button>`);
  }
  if (c.phase === 'overtime') text = '<b>You’re out of time.</b> Make your move, or tap Hold on.';
  if (now - ol.nudgedAt < 6000) text = `<b>${name} nudged you:</b> your move!`;
  if (teaching()) {
    buttons.push('<button data-click="ol:hint">What should I do?</button>');
    if (lastMoveWasMine(s)) buttons.push('<button data-click="ol:undo">↶ Take back</button>');
  }
  return { text: text ? undone + text : (undone || null), buttons: buttons.join('') };
}

/** Was the last thing in the story yours? (A take-back is offered then; the server decides if it's allowed.) */
function lastMoveWasMine(s: GameState): boolean {
  const last = [...s.log].reverse().find((e) => e.player !== undefined && !/lets it happen|keeps/.test(e.text));
  return last?.player === mySeat();
}

/** A teaching game's suggested move, in words. */
export function hintText(s: GameState, a: Action): string {
  const me = s.players[mySeat()];
  const card = (uid: number) => cardName(me.hand.find((c) => c.uid === uid)?.id ?? me.yard.find((u) => u.uid === uid)?.id ?? '');
  const unit = (uid: number) => cardName(s.players.flatMap((p) => p.yard).find((u) => u.uid === uid)?.id ?? '');
  const target = (t?: { kind: 'unit'; uid: number } | { kind: 'hero'; player: PlayerId }) =>
    !t ? '' : t.kind === 'hero' ? (t.player === mySeat() ? ' on your Hero Cat' : ' on their Hero Cat') : ` on ${unit(t.uid)}`;
  switch (a.t) {
    case 'mulligan': return a.uids.length ? `Swap ${a.uids.map(card).join(', ')}.` : 'Keep this hand.';
    case 'setupPlant': return `Plant ${a.uids.map(card).join(' and ')} as Treats.`;
    case 'discard': return `Discard ${a.uids.map(card).join(', ')}.`;
    case 'plant': return `Bury ${card(a.uid)} as a Treat.`;
    case 'skipPlant': return 'Skip planting this round.';
    case 'play': return `Play ${card(a.uid)}${target(a.target)}.`;
    case 'attack': return `Attack${target(a.target).replace(' on', '')} with ${a.attacker.kind === 'hero' ? 'your Big Cat' : unit(a.attacker.uid)}.`;
    case 'ability': return `Use your Hero Cat’s ability${target(a.target)}.`;
    case 'takeYarn': return 'Take the Yarn Ball.';
    case 'pass': return 'Pass: nothing here is worth doing right now.';
    case 'pounce': return `Pounce with ${card(a.uid)}${target(a.target)}!`;
    case 'decline': return 'Let it happen.';
    case 'lucky': return `Play it for free${target(a.target)}.`;
    case 'keepLucky': return 'Keep it in your hand.';
    case 'choose': return `Choose${target(a.target)}.`;
  }
  return '';
}

// ── Side buttons, emotes ────────────────────────────────────────────────────────────────────────

/**
 * One ⋯ button beside Rules, Settings and Home, the same in every online game, so the row never grows or wraps. It
 * opens the rest: Concede, Show my hand (teaching games), Mute their emotes.
 */
export function onlineSideButtons(): string {
  if (!ol || ol.end) return '';
  const show = teaching()
    ? `<button data-click="ol:show" aria-pressed="${ol.showing[mySeat()]}">${ol.showing[mySeat()] ? 'Hide my hand' : 'Show my hand'}</button>` : '';
  const concede = ol.conceding
    ? '<button class="danger" data-click="ol:concede">Yes, concede</button>'
    : '<button data-click="ol:concedeask">Concede…</button>';
  return `<div class="game-menu-wrap">
    <button class="game-menu-open" data-click="ol:menu" aria-expanded="${ol.menu}" aria-label="More" title="More">⋯</button>
    ${ol.menu ? `<div class="game-menu">${show}
      <button data-click="ol:mute">${ol.muted ? 'Show their emotes' : 'Mute their emotes'}</button>
      ${concede}</div>` : ''}
  </div>`;
}

// ── Versus and the result ───────────────────────────────────────────────────────────────────────

export function renderVersus(s: PlayerView): string {
  if (!ol || Date.now() > ol.versusUntil) return '';
  const side = (seat: PlayerId) => {
    const p = ol!.info.players[seat];
    const lives = s.players[seat].lives.length;
    return `<div class="vs-side ${seat === mySeat() ? 'me' : 'them'}">
      ${pawtrait(p.avatar, 'vs-face')}
      <b>${esc(seat === mySeat() ? 'You' : p.name)}</b>
      <img class="vs-hero" src="${artUrl(`${s.players[seat].hero.id}-kitten`)}" alt="">
      <small>${esc(cardName(s.players[seat].hero.id))}${lives < 9 ? ` · starts with ${lives} Lives` : ''}</small>
    </div>`;
  };
  const r = ol.info.rules;
  const first = s.startingYarn === mySeat() ? 'You take' : `${esc(them().name)} takes`;
  return `<div class="overlay versus" data-click="ol:versus">
    <div class="vs-card">
      <div class="vs-sides">${side(mySeat())}<span class="vs-word">vs</span>${side(theirSeat())}</div>
      <p>${first} the Yarn Ball first${r.teaching ? ' · Teaching game' : ''}</p>
    </div>
  </div>`;
}

/** The end of an online game: who won and how, your record against them, Rematch. */
export function renderOnlineResult(s: GameState): string {
  if (!ol?.end) return '';
  const e = ol.end;
  const name = esc(them().name);
  const won = e.winner === mySeat();
  const lost = e.winner === theirSeat();
  const heading = e.how === 'called-off' ? 'Called off' : e.winner === 'draw' ? 'A draw!' : won ? 'You win!' : lost && teaching() ? 'Good game!' : 'You lose!';
  const why = e.how === 'conceded' ? (won ? `${name} conceded.` : 'You conceded.')
    : e.how === 'timeout' ? (won ? `${name} ran out of time.` : 'You ran out of time.')
    : e.how === 'left' ? (won ? `${name} left the game.` : 'You were away too long.')
    : e.how === 'claimed' ? (won ? `${name} was away.` : `${name} took the win while you were away.`)
    : e.how === 'called-off' ? 'Nobody wins; it doesn’t count.' : '';
  // A teaching game ends kindly for whoever is learning: what they managed, not only that they lost.
  const foe = s.players[theirSeat()];
  const took = 9 - (foe.handicap ?? 0) - foe.lives.length;
  const kind = teaching() && lost
    ? `<p class="result-kind">You took <b>${took}</b> of ${esc(them().name)}’s Lives. Every game teaches you something: play again!</p>` : '';
  const record = e.record ? `<p class="result-record">You ${e.record.wins} – ${e.record.losses} ${name}${e.record.draws ? ` · ${e.record.draws} drawn` : ''}</p>` : '';
  const heroSeat = won || e.winner === 'draw' || e.winner === null ? mySeat() : theirSeat();
  const wantsMine = ol.rematch[mySeat()], wantsTheirs = ol.rematch[theirSeat()];
  const rematch = ol.info.rules.rematch
    ? `<button class="primary" data-click="ol:rematch" ${wantsMine ? 'disabled' : ''}>${wantsMine ? `Waiting for ${name}…` : wantsTheirs ? `${name} wants a rematch: Play!` : 'Rematch'}</button>` : '';
  return `<div class="overlay">
    <div class="game-over ${won ? 'won' : 'lost'}">
      <img src="${artUrl(`${s.players[heroSeat].hero.id}-bigcat`)}" alt="">
      <h2>${heading}</h2>
      <p>${esc(why)} ${e.how === 'played' || e.how === 'conceded' ? `(${s.round} rounds)` : ''}</p>
      ${kind}${record}
      <div class="buttons">${rematch}<button data-click="ol:home">Home</button></div>
    </div>
  </div>`;
}

/** The other player's hand, face up, when they're showing it (a teaching game). */
export function shownHand(s: GameState): string | null {
  if (!ol || !ol.showing[theirSeat()]) return null;
  const hand = s.players[theirSeat()].hand;
  return `<div class="foe-hand shown" title="${esc(them().name)} is showing you their hand">${hand
    .map((c) => (CARDS[c.id] ? `<img src="${cardUrl(c.id)}" data-zoom="${cardUrl(c.id)}" data-zoom-card="${c.id}" alt="${esc(CARDS[c.id].name)}">` : '<div class="card-back"></div>')).join('')}</div>`;
}

// ── Clicks ──────────────────────────────────────────────────────────────────────────────────────

/** An `ol:` click. Returns 'home' when the player leaves for Home. */
export function onlineClick(action: string): 'home' | void {
  if (!ol) return action === 'home' ? 'home' : undefined;
  const id = ol.info.id;
  const [what, arg] = [action.split(':')[0], action.split(':')[1]];
  switch (what) {
    case 'versus': ol.versusUntil = 0; return;
    case 'hold': send({ t: 'hold', match: id }); return;
    case 'time': send({ t: 'time', match: id, what: arg as 'give' | 'nudge' }); return;
    case 'end': send({ t: 'end', match: id, how: arg as 'claim' | 'call-off' }); return;
    case 'menu': ol.menu = !ol.menu; ol.conceding = false; ol.emoting = false; return;
    case 'concedeask': ol.conceding = true; return;
    case 'concede': send({ t: 'end', match: id, how: 'concede' }); ol.conceding = false; ol.menu = false; return;
    case 'hint': send({ t: 'hint', match: id }); return;
    case 'undo': send({ t: 'undo', match: id }); return;
    case 'show': send({ t: 'show', match: id, on: !ol.showing[mySeat()] }); ol.menu = false; return;
    case 'emotes': ol.emoting = !ol.emoting; ol.menu = false; return;
    case 'emote': send({ t: 'emote', match: id, emote: arg as Emote }); ol.emoting = false; return;
    case 'mute': ol.muted = !ol.muted; ol.menu = false; return;
    case 'rematch': send({ t: 'rematch', match: id }); return;
    case 'home': return 'home';
  }
}
