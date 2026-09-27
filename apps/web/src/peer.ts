// A Friend game played directly between the two players' devices (@fruitcats/match, "Friend games played directly";
// docs/offline-and-costs.md). The device of the friend who asked (seat 0) runs the match (PeerHost); the other device
// talks to it over a WebRTC data channel, saying and hearing exactly what it would say to and hear from the API. The
// screens don't know the difference: live.ts hands a match's messages here instead of to the connection, and this file
// hands the host's (or the other device's) messages back to live.ts as if the API had sent them.
//
// The Fruitcats API only introduces the two devices: each asks it now and then for what the other left for it (an
// offer, an answer), with small requests and no connection held. Seat 0's device also sends it a copy of the record
// after each move (kept on this device first, and sent again until the API has it), and the result at the end. When
// the two devices can't reach each other for a while, the API takes the game over from its copy (`serve`), and the game
// carries on through the connection like any other online game.
//
// While the API doesn't answer, a game whose devices are connected simply carries on: the copies wait on this device
// and go when it answers again.
//
// For trying things out: `?nopeer` never plays directly (every Friend game on the API, as before); `?peerfail` says it
// can, but never connects, so the API takes the game over.

import {
  PEER_PATH, PEER_POLL_MS, PeerHost, peerWire, type PeerHostDeps,
  type ClientMessage, type MatchInfo, type MatchRecord, type PeerNote, type PeerPollAnswer, type PeerSaveAnswer,
  type PeerSignal, type ServerMessage, type Tally,
} from '@fruitcats/match';
import { API } from './api';
import { authedFetch } from './auth';
import { NO_RETRY } from './net';

const params = new URLSearchParams(location.search);
/** Whether this game can play a Friend game directly: told to the API, which starts one only when both can. */
export const PEER_ABLE = typeof RTCPeerConnection !== 'undefined' && !params.has('nopeer');
/** Try it out: say it can, then never connect (the API takes the game over). */
const NEVER_CONNECT = params.has('peerfail');

/** Public STUN servers: they only tell each device its own address on the internet. No game data goes through them. */
const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** Seat 0 makes a new offer when one hasn't led to a connection in this long. */
const OFFER_EVERY_MS = 8000;
/** How long to gather this device's addresses before sending an offer or answer with what it has. */
const GATHER_MS = 2500;
/** While connected: "are you still there?" this often, and the connection is given up after this long without a word. */
const PING_MS = 4000;
const SILENT_MS = 12_000;
/** While connected, the API is still asked now and then (the game may have ended there, or moved to another device). */
const LINKED_POLL_MS = 30_000;
/** The copy seat 0's device keeps of its game, so a reload (or the API not answering) loses nothing. */
const LOCAL_KEY = 'fruitcats-peer-game';
/** Waits between tries to send the API a copy it didn't get. */
const SAVE_RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

/** Which of this account's devices this is (a new one each time the game is opened). */
const DEVICE = crypto.randomUUID();

interface Running {
  note: PeerNote;
  /** Seat 0: the match itself. */
  host: PeerHost | null;
  /** The screen wants this game's messages (it asked for the game, or it just started). */
  attached: boolean;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  linked: boolean;
  attempt: string;
  attemptAt: number;
  lastHeard: number;
  pollTimer: number;
  pingTimer: number;
  /** Seat 1: the match as the host last sent it (for its rules, when the connection drops). */
  info: MatchInfo | null;
  ended: boolean;
  stopped: boolean;
}

let run: Running | null = null;

// ── What live.ts gives this file ─────────────────────────────────────────────────────────────────

let deliver: (msg: ServerMessage) => void = () => {};
let changed: (note: PeerNote | null) => void = () => {};
/** `onMessage`: a message for the screens, as if from the API. `onChange`: the game played directly is now this one, or none. */
export function onPeer(onMessage: (msg: ServerMessage) => void, onChange: (note: PeerNote | null) => void) {
  deliver = onMessage;
  changed = onChange;
}

/** The game played directly, if one is going. */
export const peerGame = (): PeerNote | null => (run && !run.stopped ? run.note : null);
/** Is this match played directly (its messages go here, not through the connection)? */
export const isPeerMatch = (id: string | null | undefined): boolean => !!id && peerGame()?.match === id;

// ── Starting, and stopping ───────────────────────────────────────────────────────────────────────

/**
 * A game played directly, as the API (or this device's own copy) says. `attach`: the player is looking at Play a friend
 * or the game, so it opens at once; otherwise it's kept going quietly until they ask for it (rejoin).
 */
export function startPeer(note: PeerNote, attach: boolean) {
  if (run && !run.stopped && run.note.match === note.match) {
    if (attach) attachScreen();
    return;
  }
  stopPeer();
  run = {
    note, host: null, attached: attach, pc: null, dc: null, linked: false, attempt: '', attemptAt: 0, lastHeard: 0,
    pollTimer: 0, pingTimer: 0, info: null, ended: false, stopped: false,
  };
  changed(note);
  if (note.seat === 0) void startHost(run);
  else void poll(run);
}

/** Stop everything about the game played directly (it's over, or the API took it over). */
export function stopPeer() {
  const r = run;
  if (!r) return;
  r.stopped = true;
  window.clearTimeout(r.pollTimer);
  window.clearInterval(r.pingTimer);
  r.host?.stop();
  closeConnection(r);
  run = null;
  changed(null);
}

/** The screen asks for the game (rejoin): the whole match, now, or as soon as the other device connects. */
function attachScreen() {
  if (!run) return;
  run.attached = true;
  if (run.host) run.host.open();
  else if (run.linked && run.dc) sendText(run, JSON.stringify({ t: 'rejoin', match: run.note.match } satisfies ClientMessage));
}

// ── Seat 0: running the match ────────────────────────────────────────────────────────────────────

async function startHost(r: Running) {
  const id = r.note.match;
  const local = loadLocal(id);
  const got = await call<{ record: MatchRecord | null } & Partial<PeerPollAnswer>>(id, 'record');
  if (r.stopped) return;
  if (got.status === 404 || got.body?.serve || (got.body && !got.body.record && got.body.end)) {
    // Taken over by the API, or over while this device was away (the other player took the win), or long gone.
    clearLocal(id);
    if (got.body?.end && r.attached) deliver({ t: 'end', match: id, end: got.body.end });
    stopPeer();
    return;
  }
  let record = got.body?.record ?? null;
  // This device's own copy may have moves the API hasn't been sent yet: it's the one that counts.
  if (local && (!record || local.played.length >= record.played.length)) record = local;
  if (!record) { r.pollTimer = window.setTimeout(() => void startHost(r), 5000); return; }
  r.host = new PeerHost(record, hostDeps(r));
  saveLocal(record);
  if (got.body?.record && record.played.length > got.body.record.played.length) void queueSave(r, record);
  if (r.attached) r.host.open();
  void poll(r);
}

/** What the match on this device needs from around it. */
function hostDeps(r: Running): PeerHostDeps {
  return {
    local: (msg) => { if (r.attached && run === r) deliver(msg); },
    save: (rec) => { saveLocal(rec); void queueSave(r, rec); },
    finished: async (rec) => {
      saveLocal(rec);
      const answer = await Promise.race([queueSave(r, rec), new Promise<null>((ok) => window.setTimeout(() => ok(null), 4000))]);
      return [answer?.records?.[0] ?? undefined, answer?.records?.[1] ?? undefined] as [Tally | undefined, Tally | undefined];
    },
    rematch: (rec) => void rematch(r, rec),
    forget: (rec) => { clearLocal(rec.id); if (run === r && r.host?.id === rec.id) stopPeer(); },
  };
}

/** Both players asked for another game: the API starts it (a new seed), and it's played over the same connection. */
async function rematch(r: Running, rec: MatchRecord) {
  const got = await call<{ record: MatchRecord }>(rec.id, 'rematch');
  if (run !== r) return;
  const next = got.body?.record;
  if (!next) {
    const no: ServerMessage = { t: 'rematch', match: rec.id, wants: [false, false] };
    deliver(no);
    if (r.linked) sendText(r, JSON.stringify(no));
    deliver({ t: 'error', message: 'Couldn’t start another game just now. Try again in a moment.' });
    return;
  }
  clearLocal(rec.id);
  r.host?.stop();
  r.note = { match: next.id, seat: 0 };
  changed(r.note);
  const host = r.host = new PeerHost(next, hostDeps(r));
  saveLocal(next);
  host.open();
  if (r.linked) host.linked((text) => sendText(r, text));
}

// ── Seat 0: copies of the record for the API ─────────────────────────────────────────────────────

interface Outbox { record: MatchRecord | null; sending: boolean; failures: number; waiting: ((a: PeerSaveAnswer | null) => void)[] }
const outboxes = new WeakMap<Running, Outbox>();

/** Send the API this record (the newest one wins), and again until it has it. Resolves with its answer. */
function queueSave(r: Running, rec: MatchRecord): Promise<PeerSaveAnswer | null> {
  let box = outboxes.get(r);
  if (!box) outboxes.set(r, box = { record: null, sending: false, failures: 0, waiting: [] });
  box.record = rec;
  const done = new Promise<PeerSaveAnswer | null>((ok) => box!.waiting.push(ok));
  void pump(r, box);
  return done;
}

async function pump(r: Running, box: Outbox) {
  if (box.sending || !box.record || r.stopped) return;
  const rec = box.record;
  const sent = { played: structuredClone(rec.played), end: rec.end };
  box.sending = true;
  const got = await call<PeerSaveAnswer>(rec.id, 'save', sent);
  box.sending = false;
  if (r.stopped) return;
  if (got.status >= 400 && got.status < 500 && got.status !== 408 && got.status !== 429) {
    // The API refused this copy (it shouldn't happen): sending it again wouldn't change that.
    console.warn('The API refused a copy of the game', got.status, got.body);
    box.record = null;
    for (const w of box.waiting.splice(0)) w(null);
    return;
  }
  const a = got.body;
  if (!a) {
    window.setTimeout(() => void pump(r, box), SAVE_RETRY_MS[Math.min(box.failures++, SAVE_RETRY_MS.length - 1)]);
    return;
  }
  box.failures = 0;
  if (a.replaced) { replaced(); return; }
  if (a.serve) { served(); return; }
  // Ended while this device wasn't there (the other player conceded, or took the win): end it here too.
  if (a.end && r.host && !r.host.match.end && !sent.end) void r.host.match.finish(a.end);
  if (box.record === rec && rec.played.length === sent.played.length && rec.end === sent.end) box.record = null;
  for (const w of box.waiting.splice(0)) w(a);
  if (box.record) void pump(r, box);
}

// ── Both seats: finding each other ───────────────────────────────────────────────────────────────

/** Ask the API what's waiting: often while not connected, now and then while connected. */
async function poll(r: Running) {
  window.clearTimeout(r.pollTimer);
  if (r.stopped) return;
  const id = r.note.match;
  const got = await call<PeerPollAnswer>(id, 'poll', { linked: r.linked, played: r.host?.match.record.played.length });
  if (r.stopped || run !== r || id !== r.note.match) return;
  const a = got.body;
  if (got.status === 404) { clearLocal(id); stopPeer(); return; }
  if (a?.replaced) { replaced(); return; }
  if (a?.serve) { served(); return; }
  if (a?.end) {
    if (r.host) { if (!r.host.match.end) void r.host.match.finish(a.end); }
    else if (!r.ended) { r.ended = true; if (r.attached) deliver({ t: 'end', match: id, end: a.end }); stopPeer(); return; }
  }
  for (const s of a?.signals ?? []) await signal(r, s);
  if (r.host && !r.linked && (!r.pc || Date.now() - r.attemptAt > OFFER_EVERY_MS)) void offer(r);
  r.pollTimer = window.setTimeout(() => void poll(r), r.linked ? LINKED_POLL_MS : PEER_POLL_MS);
}

function newConnection(r: Running): RTCPeerConnection {
  closeConnection(r);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  r.pc = pc;
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropped(r, r.dc);
  };
  return pc;
}

function closeConnection(r: Running) {
  const { pc, dc } = r;
  r.pc = null;
  r.dc = null;
  r.linked = false;
  window.clearInterval(r.pingTimer);
  try { dc?.close(); } catch { /* gone */ }
  try { pc?.close(); } catch { /* gone */ }
}

/** Wait until this device knows its addresses (or GATHER_MS), so one message carries them all. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((ok) => {
    const t = window.setTimeout(ok, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { window.clearTimeout(t); ok(); } });
  });
}

/** Seat 0: a new offer for the other device. */
async function offer(r: Running) {
  const attempt = crypto.randomUUID();
  r.attempt = attempt;
  r.attemptAt = Date.now();
  const pc = newConnection(r);
  wire(r, pc.createDataChannel('game', { ordered: true }));
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
  } catch { return; }
  if (r.attempt !== attempt || r.stopped || NEVER_CONNECT) return;
  await call(r.note.match, 'signal', { signal: { kind: 'offer', attempt, sdp: pc.localDescription?.sdp ?? '' } });
}

async function signal(r: Running, s: PeerSignal) {
  try {
    if (s.kind === 'answer' && r.host && s.attempt === r.attempt && r.pc?.signalingState === 'have-local-offer') {
      await r.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      return;
    }
    if (s.kind === 'offer' && !r.host) {
      // Seat 1 answers the newest offer, on a new connection.
      const pc = newConnection(r);
      r.attempt = s.attempt;
      pc.ondatachannel = (e) => wire(r, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (r.pc !== pc || r.stopped || NEVER_CONNECT) return;
      await call(r.note.match, 'signal', { signal: { kind: 'answer', attempt: s.attempt, sdp: pc.localDescription?.sdp ?? '' } });
    }
  } catch { /* an offer or answer that doesn't fit any more: the next one will */ }
}

function wire(r: Running, dc: RTCDataChannel) {
  dc.onopen = () => linked(r, dc);
  dc.onmessage = (e) => heard(r, String(e.data));
  dc.onclose = () => dropped(r, dc);
}

function sendText(r: Running, text: string) {
  try { if (r.dc?.readyState === 'open') r.dc.send(text); } catch { /* the connection is going: noticed by its close */ }
}

// ── Both seats: connected ────────────────────────────────────────────────────────────────────────

function linked(r: Running, dc: RTCDataChannel) {
  if (r.stopped || run !== r) { dc.close(); return; }
  r.dc = dc;
  r.linked = true;
  r.lastHeard = Date.now();
  window.clearInterval(r.pingTimer);
  r.pingTimer = window.setInterval(() => {
    if (Date.now() - r.lastHeard > SILENT_MS) { dropped(r, dc); return; }
    sendText(r, peerWire.ping);
  }, PING_MS);
  // The host sends the whole match; the other device only needs to be there.
  r.host?.linked((text) => sendText(r, text));
  void poll(r);   // tell the API they're connected, so it doesn't take the game over
}

function heard(r: Running, text: string) {
  r.lastHeard = Date.now();
  if (r.host) { r.host.fromGuest(text); return; }
  if (text === peerWire.ping) { sendText(r, peerWire.pong); return; }
  if (text === peerWire.pong) return;
  let msg: ServerMessage;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  if (msg.t === 'match') {
    r.info = msg.info;
    // A rematch: the host started the next game over the same connection.
    if (msg.info.id !== r.note.match) { r.note = { match: msg.info.id, seat: 1 }; changed(r.note); }
  }
  if (msg.t === 'end') r.ended = true;
  if (r.attached) deliver(msg);
}

function dropped(r: Running, dc: RTCDataChannel | null) {
  if (run !== r || (dc && r.dc !== dc && r.dc !== null)) return;
  const was = r.linked;
  closeConnection(r);
  if (!was) return;
  if (r.host) r.host.unlinked();
  else if (r.attached && r.info && !r.ended) deliver({ t: 'away', match: r.note.match, seat: 0, left: r.info.rules.dropGraceMs });
  void poll(r);
}

// ── What the screens send ────────────────────────────────────────────────────────────────────────

/** A message about the game played directly, from this device's player. False when it can't be sent right now. */
export function sendPeer(msg: ClientMessage): boolean {
  const r = run;
  if (!r || r.stopped) return false;
  if (msg.t === 'rejoin') { attachScreen(); return true; }
  if (r.host) { r.host.fromHere(msg); return true; }
  if (r.linked) {
    sendText(r, JSON.stringify(msg));
    if (msg.t === 'leave' && r.ended) window.setTimeout(() => { if (run === r) stopPeer(); }, 500);
    return true;
  }
  // Not connected to the other device: conceding, or ending a game they've left, goes through the API.
  if (msg.t === 'end') { void endThroughApi(r, msg.how); return true; }
  if (msg.t === 'leave') { stopPeer(); return true; }
  return false;
}

async function endThroughApi(r: Running, how: 'concede' | 'claim' | 'call-off') {
  const id = r.note.match;
  const got = await call<PeerSaveAnswer>(id, 'end', { how });
  if (run !== r) return;
  if (got.body?.end) {
    r.ended = true;
    const record = got.body.records?.[r.note.seat] ?? undefined;
    deliver({ t: 'end', match: id, end: { ...got.body.end, record } });
    return;
  }
  deliver({ t: 'error', message: got.status === 409 ? 'Not yet: they still have time.' : 'Couldn’t reach the other player or our servers. Try again in a moment.' });
}

function served() {
  const r = run;
  if (!r) return;
  clearLocal(r.note.match);
  stopPeer();   // live.ts connects, and the API sends the game (welcome, then rejoin)
}

function replaced() {
  const r = run;
  if (!r) return;
  stopPeer();
  deliver({ t: 'error', message: 'This game is being played on your other device.' });
}

// ── Coming and going ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  const r = run;
  if (!r || r.stopped) return;
  if (document.visibilityState === 'hidden') { r.host?.away(); return; }
  r.host?.back();
  void poll(r);
});

/** A game this device was running when it was last open (the API may not have answered yet, or at all). */
export function resumeLocalGame(): PeerNote | null {
  try {
    const rec = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as MatchRecord | null;
    return rec && !rec.end ? { match: rec.id, seat: 0 } : null;
  } catch { return null; }
}

function loadLocal(id: string): MatchRecord | null {
  try {
    const rec = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as MatchRecord | null;
    return rec?.id === id ? rec : null;
  } catch { return null; }
}
function saveLocal(rec: MatchRecord) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rec)); } catch { /* full, or private browsing: the API's copy remains */ }
}
function clearLocal(id: string) {
  try { if (loadLocal(id)) localStorage.removeItem(LOCAL_KEY); } catch { /* nothing kept */ }
}

// ── The API ──────────────────────────────────────────────────────────────────────────────────────

/** One small request about the game. Never retried here: the callers ask again on their own schedule. */
async function call<T>(id: string, what: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: T | null }> {
  try {
    const r = await authedFetch(`${API}${PEER_PATH}/${id}/${what}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: DEVICE, ...body }),
    }, { ...NO_RETRY, attemptMs: 8000, budgetMs: 8000 });
    if (!r) return { status: 0, body: null };
    return { status: r.status, body: r.ok ? await r.json() as T : null };
  } catch {
    return { status: 0, body: null };
  }
}

// In development only: the game played directly, for looking into it from the console.
if (import.meta.env.DEV) (window as unknown as { peerState?: () => unknown }).peerState = () => run && {
  note: run.note, host: !!run.host, attached: run.attached, linked: run.linked, attempt: run.attempt,
  pc: run.pc && { connection: run.pc.connectionState, ice: run.pc.iceConnectionState, signaling: run.pc.signalingState, gathering: run.pc.iceGatheringState },
  dc: run.dc?.readyState ?? null,
};
