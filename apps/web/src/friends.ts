// Play a friend (docs/pvp-plan.md): what the Home screen's Friend tile opens. It asks one thing, who do you want to
// play? Your friends are the list, online first; adding a friend is the last entry of that same list. Picking a
// friend leads to the challenge (deck, pace, teaching game, handicap), then waiting for them; a friend's challenge
// to you is answered here too. There's no friends page of its own: friends are how a game starts.
//
// Adding a friend, with both phones together: one shows its code as a QR code, the other scans it inside the game,
// sees whose code it is, and taps Add. Or type the code. The friendship itself is viamochi-id's (auth.ts); the
// Fruitcats API (live.ts) only says whose code it is, and tells the other phone once it's used.

import type { DeckList } from '@fruitcats/engine';
import { MIN_LIVES, PACES, type ChallengeOptions, type Pace, type Person } from '@fruitcats/match';
import { pawtrait } from './account';
import { AuthError, listFriends, newFriendCode, redeemFriendCode, removeFriend, type Friend } from './auth';
import { live, onLive, send } from './live';
import { canScan, codeFromQr, qrSvg, scan } from './qr';
import { backButton, esc, settingsButton } from './ui';

export interface FriendsHost {
  render(): void;
  /** The deck carousel (Solo's), with only the starter decks when a game is for starter decks only. */
  deckPicker(startersOnly: boolean): string;
  /** The deck in the middle of the carousel, when it can be played. */
  chosenDeck(startersOnly: boolean): DeckList | null;
  /** Whether this device has finished a game before (a first-timer is offered a teaching game). */
  hasPlayed(): boolean;
}

type View =
  | { kind: 'list' }
  | { kind: 'setup'; friend: string }
  | { kind: 'waiting'; friend: string; id: string | null; since: number }
  | { kind: 'accept'; id: string };

/** The Add a friend sheet: its menu, showing your code, scanning theirs, confirming whose it is, and done. */
type AddStep =
  | { kind: 'menu' }
  | { kind: 'show'; code: string; expires: number }
  | { kind: 'scan' }
  | { kind: 'confirm'; code: string; person: Person | null }
  | { kind: 'done'; person: { id: string; name: string; avatar: string } };

let host: FriendsHost | null = null;
/** Whether the Add a friend sheet is open. */
let adding = false;
let view: View = { kind: 'list' };
let add: AddStep = { kind: 'menu' };
/** Your friends from viamochi-id: names and Pawtraits, even while they're offline. */
let people = new Map<string, Friend>();
let loaded = false;
let note = '';
let busy = false;
let managing: string | null = null;
let confirming: 'remove' | 'block' | null = null;
let typed = '';
let scanner: { stop(): void } | null = null;
let codeTimer: number | undefined;
let wakeLock: { release(): Promise<void> } | null = null;

// The challenge being set up.
let options: ChallengeOptions = { pace: 'relaxed', teaching: false, startersOnly: false };
let myLives = 9;

export const friendsView = () => view.kind;

export function openFriends(h: FriendsHost, answer?: string) {
  host = h;
  view = answer ? { kind: 'accept', id: answer } : { kind: 'list' };
  note = ''; managing = null; confirming = null;
  if (answer) myLives = 9;
  void loadFriends();
  send({ t: 'friends' });
}

/** Leaving the screen: stop the camera and the code, and withdraw a challenge still waiting. */
export function closeFriends() {
  stopShowing();
  scanner?.stop(); scanner = null;
  if (view.kind === 'waiting' && view.id) send({ t: 'cancel', id: view.id });
  view = { kind: 'list' };
}

async function loadFriends() {
  try {
    people = new Map((await listFriends()).map((f) => [f.id, f]));
    loaded = true;
  } catch (e) {
    // Offline from viamochi-id (or a local API with fake sign-in): friends who are online still show, from presence.
    loaded = true;
    if (!live.friends.size) note = e instanceof AuthError ? e.message : 'Couldn’t load your friends.';
  }
  host?.render();
}

// ── Who's who ───────────────────────────────────────────────────────────────────────────────────

interface Row { id: string; name: string; avatar: string; status: 'online' | 'playing' | 'offline'; lastSeen?: string; record?: { wins: number; losses: number; draws: number } }

function rows(): Row[] {
  const ids = new Set([...people.keys(), ...live.friends.keys()]);
  const out: Row[] = [];
  for (const id of ids) {
    const f = people.get(id), s = live.friends.get(id);
    if (!f && !s?.person) continue;
    out.push({
      id, name: f?.displayName || s?.person?.name || 'A friend', avatar: f?.avatar || s?.person?.avatar || 'cat',
      status: s?.status ?? 'offline', lastSeen: s?.lastSeen, record: s?.record,
    });
  }
  const rank = { online: 0, playing: 1, offline: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}

const nameOf = (id: string) => rows().find((r) => r.id === id)?.name ?? 'your friend';
const personOf = (id: string): { name: string; avatar: string } => {
  const r = rows().find((x) => x.id === id);
  return { name: r?.name ?? 'Your friend', avatar: r?.avatar ?? 'cat' };
};

function lastSeenText(iso?: string): string {
  if (!iso) return 'Offline';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Last seen today';
  if (days === 1) return 'Last seen yesterday';
  if (days < 30) return `Last seen ${days} days ago`;
  return 'Offline';
}

const recordText = (r?: Row['record']) =>
  r && r.wins + r.losses + r.draws ? `You ${r.wins} – ${r.losses}${r.draws ? ` · ${r.draws} drawn` : ''}` : '';

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────

export function renderFriends(): string {
  const body = view.kind === 'setup' ? renderSetup(view.friend)
    : view.kind === 'waiting' ? renderWaiting(view.friend, view.since)
    : view.kind === 'accept' ? renderAccept(view.id)
    : renderList();
  const title = view.kind === 'setup' ? `Play ${esc(nameOf(view.friend))}` : view.kind === 'accept' ? 'A challenge' : 'Play a friend';
  const back = view.kind === 'list' ? backButton() : backButton('pf:back', 'Back');
  return `
  <div class="menu friends">
    <div class="setup-bar">${back}<h2>${title}</h2>${settingsButton()}</div>
    ${!live.connected ? `<p class="pf-offline">${live.outdated ? 'A new version of Fruitcats is ready. <button class="link-button" data-click="pf:reload">Reload</button> to play online.' : 'Connecting…'}</p>` : ''}
    ${body}
    ${adding ? renderAdd() : ''}
  </div>`;
}

function renderList(): string {
  const list = rows();
  const incoming = live.incoming.map((c) => `
    <li class="pf-challenge">
      ${pawtrait(c.from.avatar, 'pf-face')}
      <span class="pf-who"><b>${esc(c.from.name)} wants to play</b><small>${esc(challengeLine(c.options, c.lives))}</small></span>
      <span class="pf-challenge-buttons">
        <button class="primary" data-click="pf:answer:${c.id}">Pick a deck</button>
        <button data-click="pf:decline:${c.id}">Not now</button>
      </span>
    </li>`).join('');
  const friendRow = (r: Row) => {
    const can = r.status === 'online' && live.connected;
    const status = r.status === 'online' ? 'Online' : r.status === 'playing' ? 'In a game' : lastSeenText(r.lastSeen);
    const menu = managing === r.id ? (confirming ? `
      <div class="account-confirm" role="alertdialog">
        <p>${confirming === 'block'
          ? `<b>Block ${esc(r.name)}?</b> They’re removed from your friends and can’t use your friend codes.`
          : `<b>Remove ${esc(r.name)} from your friends?</b> You can add each other again with a new code.`}</p>
        <div class="account-confirm-buttons">
          <button data-click="pf:manage:${r.id}">Cancel</button>
          <button class="danger" data-click="pf:${confirming}:${r.id}" ${busy ? 'disabled' : ''}>${confirming === 'block' ? 'Block' : 'Remove'}</button>
        </div>
      </div>` : `
      <div class="friend-menu">
        <button class="link-button" data-click="pf:ask:remove">Remove friend</button>
        <button class="link-button danger-link" data-click="pf:ask:block">Block</button>
      </div>`) : '';
    return `<li class="pf-friend ${r.status}">
      <div class="pf-row">
        <button class="pf-pick" data-click="${can ? `pf:pick:${r.id}` : `pf:why:${r.id}`}" ${can ? '' : 'aria-disabled="true"'}>
          <span class="pf-face-wrap">${pawtrait(r.avatar, 'pf-face')}<span class="pf-dot ${r.status}" aria-hidden="true"></span></span>
          <span class="pf-who"><b>${esc(r.name)}</b><small>${esc(status)}${recordText(r.record) ? ` · ${esc(recordText(r.record))}` : ''}</small></span>
          ${can ? '<span class="pf-play">Play</span>' : ''}
        </button>
        <button class="icon-button pf-more" data-click="pf:manage:${r.id}" aria-label="More for ${esc(r.name)}" aria-expanded="${managing === r.id}">⋯</button>
      </div>
      ${menu}
    </li>`;
  };
  const rejoin = live.match && !live.incoming.length ? `<button class="pf-rejoin" data-click="pf:rejoin">Your game is still going · <b>Rejoin</b></button>` : '';
  const empty = loaded && !list.length ? `
    <div class="pf-empty">
      <img src="${esc(`${import.meta.env.BASE_URL}ui/mode-friend.webp`)}" alt="">
      <p>Add a friend to play them.</p>
    </div>` : '';
  return `
  <div class="setup-body pf-body">
    ${rejoin}
    ${incoming ? `<section class="pf-section"><h3>Challenges for you</h3><ul class="pf-list">${incoming}</ul></section>` : ''}
    <section class="pf-section">
      ${list.length ? '<h3>Who do you want to play?</h3>' : ''}
      ${!loaded && !list.length ? '<p class="account-section-note">Loading…</p>' : ''}
      ${empty}
      <ul class="pf-list">
        ${list.map(friendRow).join('')}
        <li><button class="pf-add" data-click="pf:add"><span class="pf-plus" aria-hidden="true">+</span> Add a friend</button></li>
      </ul>
    </section>
    <p class="pf-note" role="status">${esc(note)}</p>
  </div>`;
}

function challengeLine(o: ChallengeOptions, lives: number): string {
  const parts = [o.teaching ? 'Teaching game' : PACES[o.pace].label];
  if (o.startersOnly) parts.push('Starter decks');
  if (lives < 9) parts.push(`they start with ${lives} Lives`);
  return parts.join(' · ');
}

function livesStepper(): string {
  return `
    <div class="pf-option">
      <span class="pf-option-name">Your Lives<small>${myLives === 9 ? 'All 9' : `A handicap: you start with ${myLives}`}</small></span>
      <div class="pf-stepper">
        <button class="icon-button" data-click="pf:lives:-1" ${myLives <= MIN_LIVES ? 'disabled' : ''} aria-label="One Life fewer">−</button>
        <b aria-live="polite">${myLives}</b>
        <button class="icon-button" data-click="pf:lives:1" ${myLives >= 9 ? 'disabled' : ''} aria-label="One Life more">+</button>
      </div>
    </div>`;
}

function renderSetup(friend: string): string {
  const pace = (p: Pace) => `<button class="${options.pace === p ? 'chosen' : ''}" data-click="pf:pace:${p}" aria-pressed="${options.pace === p}">${PACES[p].label}</button>`;
  const deck = host!.chosenDeck(options.startersOnly);
  const toggle = (key: 'teaching' | 'startersOnly', name: string, small: string) => `
    <label class="pf-option pf-toggle">
      <span class="pf-option-name">${name}<small>${small}</small></span>
      <input type="checkbox" data-pf="${key}" ${options[key] ? 'checked' : ''}>
    </label>`;
  return `
  <div class="setup-body pf-body pf-setup">
    ${host!.deckPicker(options.startersOnly)}
    <section class="pf-options">
      ${toggle('teaching', 'Teaching game', `For a friend who’s new: no timer, hints, take-backs, open hands. It doesn’t count.`)}
      ${options.teaching ? '' : `<div class="pf-option"><span class="pf-option-name">Pace<small>${PACES[options.pace].blurb}</small></span>
        <div class="segmented">${pace('relaxed')}${pace('quick')}${pace('untimed')}</div></div>`}
      ${toggle('startersOnly', 'Starter decks only', 'You both play a starter deck')}
      ${livesStepper()}
    </section>
    <div class="setup-footer">
      <button class="play-button" data-click="pf:challenge" ${deck && live.connected && !busy ? '' : 'disabled'}>Challenge ${esc(nameOf(friend))}</button>
      <p class="pf-note" role="status">${esc(note)}</p>
    </div>
  </div>`;
}

function renderWaiting(friend: string, since: number): string {
  const me = live.you;
  const them = personOf(friend);
  const left = Math.max(0, 60 - Math.floor((Date.now() - since) / 1000));
  return `
  <div class="setup-body pf-body pf-waiting">
    <div class="pf-versus">
      ${me ? pawtrait(me.avatar, 'pf-big-face') : ''}
      <span class="pf-vs">vs</span>
      ${pawtrait(them.avatar, 'pf-big-face')}
    </div>
    <p class="pf-waiting-text">Waiting for ${esc(them.name)}…</p>
    <div class="pf-ring" style="--p:${left / 60}" data-pf-countdown="${since}"><span>${left}</span></div>
    <button data-click="pf:cancel">Cancel</button>
  </div>`;
}

function renderAccept(id: string): string {
  const c = live.incoming.find((x) => x.id === id);
  if (!c) return `<div class="setup-body pf-body"><p class="pf-note">That challenge is no longer open.</p><button data-click="pf:back">Back</button></div>`;
  const deck = host!.chosenDeck(c.options.startersOnly);
  return `
  <div class="setup-body pf-body pf-setup">
    <div class="pf-from">${pawtrait(c.from.avatar, 'pf-face')}<span class="pf-who"><b>${esc(c.from.name)} wants to play</b><small>${esc(challengeLine(c.options, c.lives))}</small></span></div>
    ${!host!.hasPlayed() && !c.options.teaching ? `<p class="pf-tip">New to Fruitcats? Say <b>Not now</b> and ask ${esc(c.from.name)} for a <b>Teaching game</b>: no timer, hints, and take-backs.</p>` : ''}
    ${host!.deckPicker(c.options.startersOnly)}
    <section class="pf-options">${livesStepper()}</section>
    <div class="setup-footer">
      <div class="resume-buttons">
        <button class="play-button twin" data-click="pf:decline:${c.id}"><span class="twin-name">Not now</span></button>
        <button class="play-button twin" data-click="pf:accept:${c.id}" ${deck && !busy ? '' : 'disabled'}><span class="twin-name">Play</span></button>
      </div>
      <p class="pf-note" role="status">${esc(note)}</p>
    </div>
  </div>`;
}

function renderAdd(): string {
  let body = '';
  if (add.kind === 'menu') {
    body = `
      <h2 id="pf-add-title">Add a friend</h2>
      <p class="account-section-note">Together? One of you shows a code, the other scans it.</p>
      <div class="pf-add-choices">
        <button class="primary" data-click="pf:show">Show my code</button>
        ${canScan() ? '<button class="primary" data-click="pf:scan">Scan a code</button>' : ''}
      </div>
      <label class="account-field">Or type your friend’s code
        <input data-pf="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="K7M-4Q2" enterkeyhint="go" value="${esc(typed)}">
      </label>
      <p class="pf-note" role="status">${esc(note)}</p>`;
  } else if (add.kind === 'show') {
    body = `
      <h2 id="pf-add-title">Your friend code</h2>
      <div class="pf-qr">${qrSvg(add.code)}</div>
      <p class="friend-code" aria-label="Your friend code">${esc(add.code.slice(0, 3))}-${esc(add.code.slice(3))}</p>
      <p class="account-section-note">Your friend scans this in Fruitcats (Play a friend → Add a friend → Scan a code), or types it. It works once.</p>
      <p class="pf-note" role="status">${esc(note)}</p>`;
  } else if (add.kind === 'scan') {
    body = `
      <h2 id="pf-add-title">Scan your friend’s code</h2>
      <div class="pf-camera"><video data-pf-video playsinline muted></video><span class="pf-frame" aria-hidden="true"></span></div>
      <p class="account-section-note">Point the camera at the code on your friend’s screen.</p>
      <p class="pf-note" role="status">${esc(note)}</p>`;
  } else if (add.kind === 'confirm') {
    const who = add.person;
    body = who ? `
      ${pawtrait(who.avatar, 'pf-big-face')}
      <h2 id="pf-add-title">Add ${esc(who.name)} as a friend?</h2>
      <p class="account-section-note">You’ll see when each other is online, and can play each other.</p>
      <div class="account-confirm-buttons pf-add-choices"><button data-click="pf:addcancel">Cancel</button><button class="primary" data-click="pf:addyes" ${busy ? 'disabled' : ''}>Add</button></div>
      <p class="pf-note" role="status">${esc(note)}</p>` : `
      <h2 id="pf-add-title">Add the friend with code ${esc(add.code.slice(0, 3))}-${esc(add.code.slice(3))}?</h2>
      <p class="account-section-note">Their code isn’t on a screen right now, so we can’t show who it is. Add them only if they gave you this code.</p>
      <div class="account-confirm-buttons pf-add-choices"><button data-click="pf:addcancel">Cancel</button><button class="primary" data-click="pf:addyes" ${busy ? 'disabled' : ''}>Add</button></div>
      <p class="pf-note" role="status">${esc(note)}</p>`;
  } else {
    const who = add.person;
    const online = live.friends.get(who.id)?.status === 'online';
    body = `
      ${pawtrait(who.avatar, 'pf-big-face')}
      <h2 id="pf-add-title">You and ${esc(who.name)} are now friends!</h2>
      <div class="pf-add-choices">
        ${online ? `<button class="primary" data-click="pf:pick:${who.id}">Play ${esc(who.name)}</button>` : ''}
        <button data-click="pf:addclose">Done</button>
      </div>`;
  }
  return `<div class="overlay" data-pf-overlay>
    <div class="account-dialog pf-add-sheet" role="dialog" aria-modal="true" aria-labelledby="pf-add-title">
      <button class="icon-button account-close" data-click="pf:addclose" aria-label="Close" title="Close">×</button>
      ${body}
    </div>
  </div>`;
}

/** A challenge that just came in, for any screen but Play a friend and a game in progress: a small banner. */
export function renderChallengeBanner(onFriendsScreen: boolean, inOnlineGame: boolean): string {
  const c = live.incoming.at(-1);
  if (!c || onFriendsScreen || inOnlineGame) return '';
  return `<div class="pf-banner" role="status">
    ${pawtrait(c.from.avatar, 'pf-face')}
    <span class="pf-who"><b>${esc(c.from.name)} wants to play</b><small>${esc(challengeLine(c.options, c.lives))}</small></span>
    <button class="primary" data-click="pf:see:${c.id}">See</button>
    <button class="icon-button" data-click="pf:decline:${c.id}" aria-label="Not now" title="Not now">×</button>
  </div>`;
}

/** After each render: the camera into its video, and the waiting ring ticking down. */
export function friendsMounted() {
  if (add.kind === 'scan' && !scanner) {
    const video = document.querySelector<HTMLVideoElement>('[data-pf-video]');
    if (video) startScanning(video);
  }
  if (add.kind === 'scan' && scanner) {
    // A re-render replaced the video element: move the stream to the new one.
    const video = document.querySelector<HTMLVideoElement>('[data-pf-video]');
    if (video && !video.srcObject && scannerVideo?.srcObject) { video.srcObject = scannerVideo.srcObject; void video.play().catch(() => {}); scannerVideo = video; }
  }
}
let scannerVideo: HTMLVideoElement | null = null;

// The waiting ring: redrawn in place each second, without redrawing the screen.
window.setInterval(() => {
  const ring = document.querySelector<HTMLElement>('[data-pf-countdown]');
  if (!ring) return;
  const left = Math.max(0, 60 - Math.floor((Date.now() - Number(ring.dataset.pfCountdown)) / 1000));
  ring.style.setProperty('--p', String(left / 60));
  ring.firstElementChild!.textContent = String(left);
}, 1000);

// ── Adding a friend ─────────────────────────────────────────────────────────────────────────────

async function showCode() {
  busy = true; note = '';
  host?.render();
  try {
    const c = await newFriendCode();
    const code = c.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    add = { kind: 'show', code, expires: new Date(c.expires).getTime() };
    send({ t: 'code', code });
    keepAwake();
    // A new code a little before this one runs out, for as long as the code is on screen.
    window.clearTimeout(codeTimer);
    codeTimer = window.setTimeout(() => { if (add.kind === 'show') void showCode(); }, Math.max(10_000, add.expires - Date.now() - 20_000));
  } catch (e) {
    note = e instanceof AuthError ? e.message : 'Couldn’t make a code.';
  }
  busy = false;
  host?.render();
}

function stopShowing() {
  window.clearTimeout(codeTimer);
  if (add.kind === 'show') send({ t: 'code', code: null });
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/** Keep the screen on while the code is showing, so it doesn't lock as the friend lines up the camera. */
function keepAwake() {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  if (wakeLock || !nav.wakeLock) return;
  void nav.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
}

function startScanning(video: HTMLVideoElement) {
  scannerVideo = video;
  const s = scan(video);
  scanner = s;
  s.found.then((code) => {
    scanner = null;
    if (!code || add.kind !== 'scan') return;
    lookUp(code);
  }).catch(() => {
    scanner = null;
    if (add.kind !== 'scan') return;
    add = { kind: 'menu' };
    note = 'Couldn’t open the camera. Allow the camera for this site, or type the code instead.';
    host?.render();
  });
}

let lookingUp = '';
function lookUp(code: string) {
  lookingUp = code;
  if (!send({ t: 'lookup', code })) { add = { kind: 'confirm', code, person: null }; host?.render(); return; }
  note = 'One moment…';
  host?.render();
}

async function addFriend(code: string) {
  busy = true; note = '';
  host?.render();
  try {
    const f = await redeemFriendCode(code);
    people.set(f.id, f);
    send({ t: 'added', friend: f.id });
    add = { kind: 'done', person: { id: f.id, name: f.displayName || 'your friend', avatar: f.avatar } };
    typed = '';
  } catch (e) {
    note = e instanceof AuthError ? e.message : 'That code didn’t work.';
  }
  busy = false;
  host?.render();
}

// ── The server's news ───────────────────────────────────────────────────────────────────────────

onLive((msg) => {
  switch (msg.t) {
    case 'sent':
      if (view.kind === 'waiting' && view.friend === msg.to) view.id = msg.id;
      return;
    case 'challenge-ended':
      if (view.kind === 'waiting' && view.id === msg.id && msg.why !== 'started') {
        const name = nameOf(view.friend);
        note = msg.why === 'declined' ? `${name} can’t play right now.` : msg.why === 'expired' ? `No answer from ${name}.`
          : msg.why === 'busy' ? `${name} started another game.` : msg.why === 'offline' ? `${name} went offline.` : '';
        view = { kind: 'list' };
      }
      if (view.kind === 'accept' && view.id === msg.id && msg.why !== 'started') {
        note = msg.why === 'cancelled' ? 'They withdrew the challenge.' : 'That challenge is no longer open.';
        view = { kind: 'list' };
      }
      return;
    case 'looked':
      if (add.kind === 'scan' || lookingUp === msg.code) {
        lookingUp = '';
        note = '';
        if (msg.yours) { add = { kind: 'menu' }; note = 'That’s your own code: your friend scans it.'; return; }
        add = { kind: 'confirm', code: msg.code, person: msg.person };
      }
      return;
    case 'added':
      // Someone used your code. Look again at who your friends are (viamochi-id's list is the one we believe).
      void listFriends().then((list) => {
        people = new Map(list.map((f) => [f.id, f]));
        const f = people.get(msg.by.id);
        if (f && add.kind === 'show') {
          stopShowing();
          add = { kind: 'done', person: { id: f.id, name: f.displayName || msg.by.name, avatar: f.avatar } };
        }
        send({ t: 'friends' });
        host?.render();
      }).catch(() => {});
      return;
    case 'match':
      busy = false;
      if (view.kind === 'waiting' || view.kind === 'accept' || view.kind === 'setup') view = { kind: 'list' };
      return;
    case 'error':
      if (msg.message === 'signed_out' || msg.message === 'replaced') return;
      busy = false;
      note = msg.message;
      if (view.kind === 'waiting' && !view.id) view = { kind: 'setup', friend: view.friend };
      if (add.kind === 'scan' || lookingUp) { lookingUp = ''; add = { kind: 'menu' }; }
      return;
  }
});

// ── Events ──────────────────────────────────────────────────────────────────────────────────────

export function friendsInput(input: HTMLInputElement) {
  const field = input.dataset.pf;
  if (field === 'code') {
    // Formats as you type (K7M-4Q2), and looks the code up as soon as the sixth character is in.
    const raw = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
    typed = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
    if (input.value !== typed) input.value = typed;
    if (raw.length === 6) { const code = codeFromQr(raw); if (code) lookUp(code); }
    return;
  }
  if (field === 'teaching' || field === 'startersOnly') {
    options = { ...options, [field]: input.checked };
    host?.render();
  }
}

export function friendsClick(action: string, h: FriendsHost): void {
  host = h;
  const [what, arg] = [action.split(':')[0], action.split(':').slice(1).join(':')];
  switch (what) {
    case 'back':
      if (view.kind === 'waiting' && view.id) send({ t: 'cancel', id: view.id });
      view = { kind: 'list' }; note = '';
      break;
    case 'reload': location.reload(); return;
    case 'pick':
      if (add.kind !== 'menu') closeAdd();
      view = { kind: 'setup', friend: arg }; note = ''; myLives = 9;
      break;
    case 'why': {
      const s = live.friends.get(arg)?.status;
      note = s === 'playing' ? `${nameOf(arg)} is in a game right now.` : `${nameOf(arg)} isn’t online. You can play when they are.`;
      break;
    }
    case 'manage': managing = managing === arg ? null : arg; confirming = null; break;
    case 'ask': confirming = arg as 'remove' | 'block'; break;
    case 'remove': case 'block': void removeOrBlock(arg, what === 'block'); return;
    case 'pace': options = { ...options, pace: arg as Pace }; break;
    case 'lives': myLives = Math.max(MIN_LIVES, Math.min(9, myLives + Number(arg))); break;
    case 'challenge': {
      if (view.kind !== 'setup') return;
      const deck = h.chosenDeck(options.startersOnly);
      if (!deck) return;
      if (!send({ t: 'challenge', to: view.friend, deck, options, lives: myLives })) { note = 'Not connected. Try again in a moment.'; break; }
      view = { kind: 'waiting', friend: view.friend, id: null, since: Date.now() };
      note = '';
      break;
    }
    case 'cancel':
      if (view.kind === 'waiting' && view.id) send({ t: 'cancel', id: view.id });
      view = view.kind === 'waiting' ? { kind: 'setup', friend: view.friend } : { kind: 'list' };
      break;
    case 'see': case 'answer': view = { kind: 'accept', id: arg }; note = ''; myLives = 9; break;
    case 'decline':
      send({ t: 'decline', id: arg });
      live.incoming = live.incoming.filter((c) => c.id !== arg);
      if (view.kind === 'accept') view = { kind: 'list' };
      break;
    case 'accept': {
      const c = live.incoming.find((x) => x.id === arg);
      const deck = c ? h.chosenDeck(c.options.startersOnly) : null;
      if (!c || !deck) return;
      busy = true;
      send({ t: 'accept', id: c.id, deck, lives: myLives });
      break;
    }
    case 'rejoin': if (live.match) send({ t: 'rejoin', match: live.match }); return;
    case 'add': add = { kind: 'menu' }; note = ''; typed = ''; adding = true; break;
    case 'show': void showCode(); return;
    case 'scan': add = { kind: 'scan' }; note = ''; break;
    case 'addyes': if (add.kind === 'confirm') void addFriend(add.code); return;
    case 'addcancel': add = { kind: 'menu' }; note = ''; break;
    case 'addclose': closeAdd(); break;
  }
  h.render();
}

function closeAdd() {
  stopShowing();
  scanner?.stop(); scanner = null;
  adding = false;
  add = { kind: 'menu' };
  note = '';
}
/** Whether the Add a friend sheet is open (Escape closes it). */
export const addOpen = () => adding;
export function closeAddSheet() { closeAdd(); host?.render(); }

async function removeOrBlock(id: string, block: boolean) {
  busy = true;
  host?.render();
  try {
    await removeFriend(id, block);
    people.delete(id);
    live.friends.delete(id);
    note = block ? 'Blocked.' : 'Removed.';
    send({ t: 'friends' });
  } catch (e) {
    note = e instanceof AuthError ? e.message : 'Couldn’t do that.';
  }
  busy = false; managing = null; confirming = null;
  host?.render();
}
