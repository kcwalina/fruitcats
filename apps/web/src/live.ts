// The game's connection to online play (docs/pvp-plan.md): one WebSocket to the Fruitcats API while signed in, for
// friends' presence, friend codes, challenges and online matches. It reconnects by itself after a drop, backing off.
//
// This file only keeps the connection and what the server last said. The screens are friends.ts (Play a friend) and
// online.ts (an online game); main.ts draws them.

import { RULES_VERSION } from '@fruitcats/engine';
import {
  LIVE_PATH, PROTOCOL,
  type ChallengeOptions, type ClientMessage, type FriendStatus, type Person, type ServerMessage,
} from '@fruitcats/match';
import { API } from './api';
import { session, token } from './auth';

export interface Challenge { id: string; from: Person; options: ChallengeOptions; lives: number }

/** What the server last said: read by the screens. */
export const live = {
  connected: false,
  /** This game is older than the server's: it must reload to play online. */
  outdated: false,
  you: null as Person | null,
  friends: new Map<string, FriendStatus>(),
  /** Challenges for you, newest last. */
  incoming: [] as Challenge[],
  /** The match you're in (going, or just finished), if any. */
  match: null as string | null,
};

type Listener = (msg: ServerMessage) => void;
const listeners: Listener[] = [];
/** Hear every message from the server (after `live` is updated). */
export function onLive(fn: Listener) { listeners.push(fn); }

let socket: WebSocket | null = null;
let wanted = false;
let retry = 0;
let retryTimer: number | undefined;
let render: () => void = () => {};

/** Connect while signed in, and stay connected. Safe to call again (after signing in). */
export function startLive(host: { render(): void }) {
  render = host.render;
  if (wanted || !session()) return;
  wanted = true;
  retry = 0;
  void open();
}

/** Signed out: close and forget. */
export function stopLive() {
  if (!wanted && !socket) return;
  wanted = false;
  window.clearTimeout(retryTimer);
  socket?.close();
  socket = null;
  live.connected = false;
  live.friends.clear();
  live.incoming = [];
  live.match = null;
}

export function send(msg: ClientMessage): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN || !live.connected) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

async function open() {
  const t = await token();
  if (!t || !wanted) return;
  const url = API.replace(/^http/, 'ws') + LIVE_PATH;
  const ws = new WebSocket(url);
  socket = ws;
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
    if (was) render();
    if (!wanted || live.outdated) return;
    // 1 s, 2 s, 4 s … up to 30 s; straight away when the page comes back into view.
    const wait = Math.min(30_000, 1000 * 2 ** retry++);
    retryTimer = window.setTimeout(() => void open(), wait);
  };
}

/** Back from the background (a phone locks, a tab is hidden): reconnect now rather than waiting out the backoff. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !wanted || socket) return;
  window.clearTimeout(retryTimer);
  retry = 0;
  void open();
});

function received(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome':
      live.connected = true;
      retry = 0;
      live.you = msg.you;
      live.friends = new Map(msg.friends.map((f) => [f.id, f]));
      live.match = msg.match;
      break;
    case 'update':
      live.outdated = true;
      break;
    case 'error':
      // Signed out, or this account connected again elsewhere (another tab or device): stop reconnecting here.
      if (msg.message === 'signed_out' || msg.message === 'replaced') wanted = false;
      break;
    case 'friends':
      live.friends = new Map(msg.friends.map((f) => [f.id, f]));
      break;
    case 'presence':
      live.friends.set(msg.friend.id, { ...live.friends.get(msg.friend.id), ...msg.friend });
      break;
    case 'challenge':
      live.incoming = [...live.incoming.filter((c) => c.id !== msg.id), { id: msg.id, from: msg.from, options: msg.options, lives: msg.lives }];
      break;
    case 'challenge-ended':
      live.incoming = live.incoming.filter((c) => c.id !== msg.id);
      break;
    case 'match':
      live.match = msg.end ? null : msg.info.id;
      break;
    case 'end':
      if (live.match === msg.match) live.match = null;
      break;
  }
  for (const fn of listeners) fn(msg);
  // A match's own messages are drawn by whoever listens for them (main.ts animates views before drawing them).
  if (!MATCH_MESSAGES.has(msg.t)) render();
}

const MATCH_MESSAGES = new Set<ServerMessage['t']>(['match', 'view', 'clock', 'emote', 'away', 'back', 'nudge', 'hint', 'end', 'rematch']);
