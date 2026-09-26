// The game and online play (docs/pvp-plan.md). Two ways of being in touch with the Fruitcats API, so a game that isn't
// playing online costs next to nothing:
//
//   - "I'm here": while the game is open and signed in, a small request every 30 seconds (HERE_PATH). It's how friends
//     see you online, and how a friend's challenge reaches you. No connection is held.
//   - The connection: one WebSocket, only while playing online (Play a friend, waiting for an answer, a game). Before
//     connecting, the game asks to be let in (ENTER_PATH). Online play has room for a fixed number of players; when it's
//     full, the game shows your place in the waiting line and asks again every few seconds. Players who have bought
//     cards go first.
//
// This file only keeps the connection and what the server last said. The screens are friends.ts (Play a friend) and
// online.ts (an online game); main.ts draws them.

import { RULES_VERSION } from '@fruitcats/engine';
import {
  ENTER_EVERY_MS, ENTER_PATH, HERE_EVERY_MS, HERE_PATH, LIVE_PATH, PROTOCOL,
  type ChallengeNote, type ClientMessage, type EnterAnswer, type FriendStatus, type HereAnswer, type Person, type ServerMessage,
} from '@fruitcats/match';
import { API } from './api';
import { session, token } from './auth';
import { timeoutSignal } from './net';

export type Challenge = ChallengeNote;

/** What the server last said: read by the screens. */
export const live = {
  connected: false,
  /** Asking to be let in, or connecting: not connected yet. */
  connecting: false,
  /** This game is older than the server's: it must reload to play online. */
  outdated: false,
  /** Online play is switched on. */
  open: true,
  /** Online play is full: your place in the waiting line. */
  waiting: null as { position: number; paid: boolean } | null,
  /** The connection was closed after 10 quiet minutes, to make room: it reconnects when the player asks. */
  idle: false,
  /** This account connected on another device or tab, which took over: this one waits until the player asks. */
  elsewhere: false,
  you: null as Person | null,
  friends: new Map<string, FriendStatus>(),
  /** Challenges for you, newest last. */
  incoming: [] as Challenge[],
  /** A game you're in that's still going, if any. */
  match: null as string | null,
};

type Listener = (msg: ServerMessage) => void;
const listeners: Listener[] = [];
/** Hear every message from the server (after `live` is updated). */
export function onLive(fn: Listener) { listeners.push(fn); }

let render: () => void = () => {};
let signedIn = false;
let hereTimer: number | undefined;
let socket: WebSocket | null = null;
/** Whether the screen wants the connection now. */
let wanted = false;
let retry = 0;
let retryTimer: number | undefined;
/** Asking to be let in right now: a second connect() (the network coming back, the tab shown) waits for it. */
let entering = false;
const WELCOME_WITHIN_MS = 6000;
/** "I'm here" and asking to be let in are tiny: an answer slower than this won't come, so ask again instead. */
const POST_WITHIN_MS = 8000;

// ── "I'm here" ───────────────────────────────────────────────────────────────────────────────────

/** Signed in: say "I'm here" every 30 seconds while the game is open. Safe to call on every render. */
export function startLive(host: { render(): void }) {
  render = host.render;
  if (signedIn || !session()) return;
  signedIn = true;
  void sayHere();
}

/** Signed out: stop everything and forget. */
export function stopLive() {
  if (!signedIn && !socket) return;
  signedIn = false;
  window.clearTimeout(hereTimer);
  wantConnection(false);
  live.friends.clear();
  live.incoming = [];
  live.match = null;
  live.waiting = null;
}

async function sayHere() {
  window.clearTimeout(hereTimer);
  if (!signedIn) return;
  // Connected, the connection says it all; hidden (another tab, a locked phone), nothing is said.
  if (!live.connected && document.visibilityState === 'visible') {
    const s = session();
    const answer = await post<HereAnswer>(HERE_PATH, { avatar: s?.avatar ?? 'cat', name: s?.displayName });
    if (answer) {
      const changed = answer.open !== live.open || answer.match !== live.match
        || answer.challenges.map((c) => c.id).join() !== live.incoming.map((c) => c.id).join();
      live.open = answer.open;
      if (!live.connected) { live.incoming = answer.challenges; live.match = answer.match; }
      if (changed) render();
    }
  }
  hereTimer = window.setTimeout(() => void sayHere(), HERE_EVERY_MS);
}

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  const t = await token();
  if (!t) return null;
  try {
    const r = await fetch(API + path, {
      // Without a limit, a request lost on a dropped connection could leave "Connecting…" up for minutes.
      signal: timeoutSignal(POST_WITHIN_MS),
      method: 'POST', headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.ok ? (await r.json()) as T : null;
  } catch {
    return null;
  }
}

/** Back from the background: say "I'm here" (or reconnect) now rather than at the next tick. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (signedIn && !live.connected) void sayHere();
  if (wanted && !socket && !live.connecting) { window.clearTimeout(retryTimer); retry = 0; void connect(); }
});

// ── The connection ───────────────────────────────────────────────────────────────────────────────

/**
 * Whether the screen needs the connection: on Play a friend and in an online game, yes; anywhere else, no. Safe to call
 * on every render. After 10 quiet minutes the server closes it; it opens again only when the player asks (reconnect()).
 */
export function wantConnection(on: boolean) {
  if (on && (!signedIn || live.idle || live.elsewhere || !live.open || live.outdated)) return;
  if (on === wanted) return;
  wanted = on;
  window.clearTimeout(retryTimer);
  if (on) { retry = 0; void connect(); return; }
  live.waiting = null;
  live.connecting = false;
  const s = socket;
  socket = null;
  live.connected = false;
  s?.close();
  void sayHere();
}

/** The player asked to come back after the connection was closed for being quiet. */
export function reconnect() {
  live.idle = false;
  live.elsewhere = false;
  wanted = false;
  wantConnection(true);
  render();
}

export function send(msg: ClientMessage): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN || !live.connected) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

/** Ask to be let in; when full, wait in line (asking again every few seconds); then connect. */
async function connect() {
  if (!wanted || socket || entering) return;
  live.connecting = true;
  entering = true;
  let answer: EnterAnswer | null;
  try { answer = await post<EnterAnswer>(ENTER_PATH); } finally { entering = false; }
  // No longer wanted (the player left the screen) or connected meanwhile: "connecting" must not stay on.
  if (!wanted) { live.connecting = false; return; }
  if (socket) return;
  if (!answer) { live.connecting = false; later(); render(); return; }
  if (answer.status === 'closed') { live.open = false; live.connecting = false; live.waiting = null; wanted = false; render(); return; }
  if (answer.status === 'waiting') {
    const was = live.waiting;
    live.waiting = { position: answer.position, paid: answer.paid };
    if (!was || was.position !== answer.position) render();
    retryTimer = window.setTimeout(() => void connect(), ENTER_EVERY_MS);
    return;
  }
  live.waiting = null;
  await open();
}

/**
 * Try again after a failure: 1 s, 2 s, then every 3 s. The connection is only wanted while the player is looking at a
 * friends screen or a game, waiting for it, so a long back-off only makes them wait (a deploy restarting the API once
 * kept a player on "Connecting…" for 20 seconds). Asking to be let in costs the API next to nothing. Each wait is
 * moved by up to 30% either way, so every player dropped by the same restart doesn't come back in the same instant.
 */
function later() {
  if (!wanted || live.outdated) return;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void connect(), Math.min(3000, 1000 * 2 ** retry++) * (0.7 + 0.6 * Math.random()));
}

/** The network came back: try now rather than at the next retry. */
window.addEventListener('online', () => {
  if (wanted && !socket && !live.connecting) { window.clearTimeout(retryTimer); retry = 0; void connect(); }
});

async function open() {
  const t = await token();
  if (!wanted) { live.connecting = false; return; }
  // No token (the account service unreachable): try again later rather than stop at "Connecting…".
  if (!t) { live.connecting = false; later(); render(); return; }
  const ws = new WebSocket(API.replace(/^http/, 'ws') + LIVE_PATH);
  socket = ws;
  // Normally welcomed in well under a second. A socket stuck half-open (the API restarting) is given up on and tried
  // again, rather than left to the browser's own timeout.
  window.setTimeout(() => { if (socket === ws && !live.connected) ws.close(); }, WELCOME_WITHIN_MS);
  ws.onopen = () => {
    // A local API with fake sign-in takes the name from here; the real one reads it from the token.
    const s = session();
    ws.send(JSON.stringify({ t: 'hello', token: t, protocol: PROTOCOL, rules: RULES_VERSION, avatar: s?.avatar ?? 'cat', name: s?.displayName } satisfies ClientMessage));
  };
  ws.onmessage = (e) => {
    let msg: ServerMessage;
    try { msg = JSON.parse(String(e.data)); } catch { return; }
    received(msg);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    const was = live.connected;
    live.connected = false;
    live.connecting = false;
    if (was) render();
    later();
  };
}

function received(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome':
      live.connected = true;
      live.connecting = false;
      retry = 0;
      live.you = msg.you;
      live.friends = new Map(msg.friends.map((f) => [f.id, f]));
      live.match = msg.match;
      live.incoming = [];   // the server sends the challenges still open right after this
      // A game still going: back into it.
      if (msg.match) send({ t: 'rejoin', match: msg.match });
      break;
    case 'update': live.outdated = true; wanted = false; break;
    case 'closed': live.open = false; wanted = false; break;
    case 'full': retry = 0; break;   // the place ran out before connecting: ask again (onclose)
    case 'idle': live.idle = true; wanted = false; break;
    case 'error':
      // This account connected on another device or tab, or the sign-in wasn't accepted: stop until the player asks,
      // so two tabs never take the connection from each other back and forth.
      if (msg.message === 'replaced') { live.elsewhere = true; wanted = false; }
      if (msg.message === 'signed_out') { live.idle = true; wanted = false; }
      break;
    case 'friends': live.friends = new Map(msg.friends.map((f) => [f.id, f])); break;
    case 'presence': live.friends.set(msg.friend.id, { ...live.friends.get(msg.friend.id), ...msg.friend }); break;
    case 'challenge':
      live.incoming = [...live.incoming.filter((c) => c.id !== msg.id), { id: msg.id, from: msg.from, options: msg.options, lives: msg.lives }];
      break;
    case 'challenge-ended': live.incoming = live.incoming.filter((c) => c.id !== msg.id); break;
    case 'match': live.match = msg.end ? null : msg.info.id; break;
    case 'end': if (live.match === msg.match) live.match = null; break;
  }
  for (const fn of listeners) fn(msg);
  // A match's own messages are drawn by whoever listens for them (main.ts animates views before drawing them).
  if (!MATCH_MESSAGES.has(msg.t)) render();
}

const MATCH_MESSAGES = new Set<ServerMessage['t']>(['match', 'view', 'clock', 'emote', 'away', 'back', 'nudge', 'hint', 'end', 'rematch']);
