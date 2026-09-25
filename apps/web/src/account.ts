// The Via Mochi account window: "Sign in or create account", and the Account row in Settings. Only shown when the
// ACCOUNTS flag is on (src/flags.ts). One window for both signing in and signing up, so there's nothing to get wrong:
//   1. your email;
//   1b. if it's new and accounts are still for playtesters only: the invite code they were sent;
//   2. if it's new: your name, birth year and the Terms (asked before the code, so there's only one code to type);
//   3. the code from the email;
//   4. if the account hasn't agreed to the current Terms of Use yet (made before they existed, or they've changed):
//      agree, or sign out. There's no closing this step.
// The version each account agreed to is kept in the account (auth.ts, TERMS_VERSION).
// Talking to the account service is src/auth.ts; this file is only the screens.

import {
  AuthError, agreeToTerms, accountExists, needsTerms, refreshAccount, requestSupportCode, sendSupport, invitesRequired, useInvite, avatarCatalog, avatarUrl, chooseAvatar, deleteAccount, exportData, myAvatars,
  resend, restoredOnSignIn, session,
  startSignIn, startSignUp, submitCode, type Avatar, type Pending,
} from './auth';
import { signOutAndForget, startSync } from './sync';
import { ONLINE } from './flags';
import { BASE, esc } from './ui';

type Step = 'email' | 'invite' | 'details' | 'code' | 'terms' | 'welcome';

interface Host { render(): void }

let open = false;
let step: Step = 'email';
let busy = false;
let error = '';
let reason = '';
let email = '';
let displayName = '';
let birthYear = '';
let agreed = false;
let code = '';
let invite = '';
/** The email already has a sign-in but no account yet (made before invites): after the invite, sign in. */
let inviteThenSignIn = false;
let pending: Pending | null = null;
/** Where to go once signed in: the tile that asked for an account. */
let then: (() => void) | null = null;

const MIN_AGE = 13;

export const accountOpen = () => open;
export const signedIn = () => session() !== null;

/** Open the window. `why` is one line on why an account is needed; `after` runs once signed in. */
export function openAccount(host: Host, why = '', after: (() => void) | null = null) {
  hostRef = host;
  open = true; step = 'email'; error = ''; busy = false; reason = why; then = after;
  code = ''; pending = null; agreed = false;
  host.render();
  focusFirst();
}

export function closeAccount(host: Host) {
  if (step === 'terms' && needsTerms()) return;   // agree or sign out
  open = false; then = null; host.render();
}

/** A signed-in device whose account hasn't agreed to the current Terms: ask now, before anything else. */
export async function askForTermsIfNeeded(host: Host) {
  if (!needsTerms() || open) return;
  // This device's copy says "not agreed": ask the account before asking the player, who may well have agreed already
  // (on another device, or here before the copy was last saved).
  await refreshAccount();
  if (!needsTerms() || open) return;
  hostRef = host;
  open = true; step = 'terms'; error = ''; busy = false; agreed = false; then = null;
  host.render();
}

/** Why an account is worth having, in the player's terms. Shown before they sign in. */
const BENEFITS = [
  ['Your collection, everywhere', 'Cards and decks are kept in your account, on phone, tablet, computer and Steam.'],
  ['Safe if you lose your device', 'New phone? Sign in and everything is there. Nothing lives only on one device.'],
  ['Buy once, keep it', 'Cards from the Store stay in your account wherever you play signed in, whichever store you bought them in.'],
  ['Play your friends', ONLINE ? 'Add friends and play them online, each on your own device.' : 'Add friends and play them online, when that arrives.'],
];

function benefits(): string {
  return `<ul class="account-benefits">${BENEFITS.map(([title, text]) =>
    `<li><b>${title}</b><span>${text}</span></li>`).join('')}</ul>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────

export function renderAccount(): string {
  if (!open) return '';
  const body = step === 'email' ? emailStep() : step === 'invite' ? inviteStep() : step === 'terms' ? termsStep() : step === 'details' ? detailsStep() : step === 'code' ? codeStep() : welcomeStep();
  return `<div class="overlay" data-account-overlay>
    <div class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
      ${step === 'terms' ? '' : '<button class="icon-button account-close" data-click="acct:close" aria-label="Close" title="Close">×</button>'}
      ${body}
      <p class="account-error" role="alert">${esc(error)}</p>
    </div>
  </div>`;
}

function emailStep(): string {
  return `
    <img class="account-cat" src="${BASE}ui/cat-jam-kitten.webp" alt="">
    <h2 id="account-title">Sign in or create account</h2>
    ${reason ? `<p class="account-why">${esc(reason)}</p>` : ''}
    ${benefits()}
    <label class="account-field">Your email
      <input data-acct="email" type="email" inputmode="email" autocomplete="email" enterkeyhint="next"
        value="${esc(email)}" placeholder="you@example.com" ${busy ? 'disabled' : ''}>
    </label>
    <button class="primary account-go" data-click="acct:email" ${busy ? 'disabled' : ''}>${busy ? 'One moment…' : 'Continue'}</button>
    <p class="account-small">No password. We email you a code each time you sign in on a new device.
      Trouble signing in? <button class="link-button" data-click="acct:contact">Contact us</button></p>`;
}

function inviteStep(): string {
  return `
    <img class="account-cat" src="${BASE}ui/cat-jam-kitten.webp" alt="">
    <h2 id="account-title">Got an invite code?</h2>
    <p class="account-why">Fruitcats accounts are open to playtesters for now.
      Type the invite code you were sent.</p>
    <p class="account-small">New account for <b>${esc(email)}</b></p>
    <label class="account-field">Invite code
      <input data-acct="invite" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next"
        maxlength="40" value="${esc(invite)}" ${busy ? 'disabled' : ''}>
    </label>
    <button class="primary account-go" data-click="acct:invite" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Continue'}</button>
    <p class="account-small">No code yet? You can still play Solo.
      <button class="link-button" data-click="acct:back">Use a different email</button></p>`;
}

function detailsStep(): string {
  return `
    <h2 id="account-title">Create your account</h2>
    <p class="account-why">New to Via Mochi: <b>${esc(email)}</b><br><button class="link-button" data-click="acct:back">Use a different email</button></p>
    <label class="account-field">Display name <small>What friends see</small>
      <input data-acct="name" maxlength="40" autocomplete="nickname" enterkeyhint="next" value="${esc(displayName)}" ${busy ? 'disabled' : ''}>
    </label>
    <label class="account-field">Birth year <small>Accounts are for ages ${MIN_AGE} and up</small>
      <input data-acct="year" inputmode="numeric" maxlength="4" autocomplete="bday-year" enterkeyhint="next"
        placeholder="e.g. 1990" value="${esc(birthYear)}" ${busy ? 'disabled' : ''}>
    </label>
    <label class="account-agree">
      <input type="checkbox" data-acct="agree" ${agreed ? 'checked' : ''} ${busy ? 'disabled' : ''}>
      <span>I agree to the <a href="${BASE}terms.html" target="_blank" rel="noopener">Terms of Use</a> and have read the
        <a href="${BASE}privacy.html" target="_blank" rel="noopener">Privacy Policy</a></span>
    </label>
    <button class="primary account-go" data-click="acct:details" ${busy ? 'disabled' : ''}>${busy ? 'Sending your code…' : 'Email me a code'}</button>`;
}

function codeStep(): string {
  const length = pending?.codeLength ?? 8;
  return `
    <h2 id="account-title">Check your email</h2>
    <p class="account-why">We emailed your ${length}-digit code to <b>${esc(pending?.sentTo ?? email)}</b>.</p>
    <p class="account-spam"><b>Don’t see it?</b> Check your <b>Spam</b> or <b>Junk</b> folder: the first email from us
      often lands there. It comes from <span class="nowrap">no-reply@mail.viamochi.com</span>. Marking it
      <b>Not spam</b> helps the next one reach your inbox.</p>
    <label class="account-field">Code
      <input data-acct="code" class="account-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${length}"
        enterkeyhint="done" value="${esc(code)}" ${busy ? 'disabled' : ''}>
    </label>
    <button class="primary account-go" data-click="acct:code" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : pending?.flow === 'signUp' ? 'Create account' : 'Sign in'}</button>
    <p class="account-small">Still nothing after a minute? <button class="link-button" data-click="acct:resend" ${busy ? 'disabled' : ''}>Send a new code</button>.
      Wrong email? <button class="link-button" data-click="acct:back">Change it</button>.</p>`;
}

function termsStep(): string {
  return `
    <img class="account-cat" src="${BASE}ui/cat-jam-kitten.webp" alt="">
    <h2 id="account-title">Before you continue</h2>
    <p class="account-why">Please read the Terms of Use and the Privacy Policy for your Via Mochi account.
      They say what you can do with the game and your cards, and how we look after your data.</p>
    <p class="account-terms-links">
      <a href="${BASE}terms.html" target="_blank" rel="noopener">Terms of Use</a>
      <a href="${BASE}privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
    </p>
    ${session()?.birthYear == null ? `<label class="account-field">Birth year <small>Fruitcats accounts are for ages ${MIN_AGE} and up</small>
      <input data-acct="year" inputmode="numeric" maxlength="4" autocomplete="bday-year" enterkeyhint="next"
        placeholder="e.g. 1990" value="${esc(birthYear)}" ${busy ? 'disabled' : ''}>
    </label>` : ''}
    <label class="account-agree">
      <input type="checkbox" data-acct="agree" ${agreed ? 'checked' : ''} ${busy ? 'disabled' : ''}>
      <span>I agree to the Terms of Use and have read the Privacy Policy</span>
    </label>
    <button class="primary account-go" data-click="acct:terms" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Continue'}</button>
    <p class="account-small">Don’t agree? <button class="link-button" data-click="acct:termsno" ${busy ? 'disabled' : ''}>Sign out</button>
      and keep playing Solo.</p>`;
}

function welcomeStep(): string {
  const s = session();
  return `
    <img class="account-cat" src="${BASE}ui/cat-jam.webp" alt="">
    <h2 id="account-title">${pending?.flow === 'signUp' ? 'Welcome to Via Mochi' : 'Welcome back'}${s?.displayName ? `, ${esc(s.displayName)}` : ''}!</h2>
    <p class="account-why">${restoredOnSignIn ? 'Your account was going to be deleted: signing in has kept it, with everything in it.'
      : 'You’re signed in on this device. Your collection is kept in your account.'}</p>
    <button class="primary account-go" data-click="acct:done">Continue</button>`;
}

/** Settings' Account panel: opened from its row, so Sign out is never next to the everyday settings. */
let panel = false;
let confirmingSignOut = false;
let confirmingDelete = false;
let panelNote = '';
let panelBusy = false;

// ── Contact us ──────────────────────────────────────────────────────────────────────────────────
//
// A message to the team, answered by email. Signed-in players are answered at their account's email; anyone else
// types one and confirms it with a code emailed to it, like signing in, before the message goes. It's a view in the
// Settings panel, like Account, and the sign-in window links to it.

let contactOpen = false;
let contactEmail = '';
let contactMessage = '';
let contactNote = '';
let contactSent = false;
let contactBusy = false;
/** Signed out: the confirmation code's length once it's emailed, which shows the code step (0 = not yet). */
let contactCodeLength = 0;
let contactCode = '';

/** The Settings row that opens "Contact us". */
export function renderContactRow(): string {
  return `<button class="account-row" data-click="acct:contact" aria-label="Contact us">
      <span class="account-who"><b>Contact us</b><small>Questions, problems or ideas: we read every message</small></span>
      <span class="account-chevron" aria-hidden="true">›</span>
    </button>`;
}

function renderContact(): string {
  const s = session();
  const head = `<div class="account-panel-head">
      <button class="icon-button account-back" data-click="acct:panelback" aria-label="Back to Settings" title="Back to Settings">‹</button>
      <h2>Contact us</h2>
      <span class="account-back-balance" aria-hidden="true"></span>
    </div>`;
  if (contactSent) return `${head}
    <p class="account-why"><b>Thanks, your message is on its way.</b> We’ll answer by email${s ? ', at your account’s address' : ''},
      usually within a couple of days. The answer may land in Spam or Junk.</p>
    <button data-click="acct:contactagain">Send another message</button>`;
  return `${head}
    ${!s && contactCodeLength ? `
    <p class="account-why">We emailed a code to <b>${esc(contactEmail)}</b>. Type it here to send your message.</p>
    <label class="account-field">Code
      <input data-acct="contactcode" class="account-code" inputmode="numeric" autocomplete="one-time-code" enterkeyhint="send"
        maxlength="${contactCodeLength}" value="${esc(contactCode)}" ${contactBusy ? 'disabled' : ''}>
    </label>
    <button class="primary account-go" data-click="acct:contactverify" ${contactBusy ? 'disabled' : ''}>${contactBusy ? 'Sending…' : 'Send message'}</button>
    <p class="account-error" role="alert">${esc(contactNote)}</p>
    <p class="account-small">Still nothing after a minute? Look in Spam or Junk, or
      <button class="link-button" data-click="acct:contactresend" ${contactBusy ? 'disabled' : ''}>send a new code</button>.
      Wrong email? <button class="link-button" data-click="acct:contactedit" ${contactBusy ? 'disabled' : ''}>Change it</button>.</p>` : `
    <p class="account-why">Stuck, found a bug, or have an idea? Tell us here and we’ll answer by email.</p>
    ${s ? '<p class="account-section-note">We’ll answer at your account’s email address.</p>'
      : `<label class="account-field">Your email <small>So we can answer you. We’ll email you a code to confirm it.</small>
        <input data-acct="contactemail" type="email" inputmode="email" autocomplete="email" value="${esc(contactEmail)}"
          placeholder="you@example.com" ${contactBusy ? 'disabled' : ''}>
      </label>`}
    <label class="account-field">Your message
      <textarea data-acct="contactmessage" class="contact-message" rows="6" maxlength="4000"
        placeholder="What happened, and on which device?" ${contactBusy ? 'disabled' : ''}>${esc(contactMessage)}</textarea>
    </label>
    <button class="primary account-go" data-click="acct:contactsend" ${contactBusy ? 'disabled' : ''}>${contactBusy ? (s ? 'Sending…' : 'One moment…') : s ? 'Send' : 'Continue'}</button>
    <p class="account-error" role="alert">${esc(contactNote)}</p>`}`;
}

export const accountPanelOpen = () => panel;
/** "Contact us" is showing: its Send is the main button, so the panel's Done steps back. */
export const contactPanelOpen = () => panel && contactOpen;
export function closeAccountPanel() {
  panel = false; confirmingSignOut = false; confirmingDelete = false; picking = false; panelNote = '';
  contactOpen = false; contactNote = ''; contactCodeLength = 0; contactCode = '';
}

const initial = (name: string) => esc(name.trim().charAt(0).toUpperCase() || '?');

/**
 * A Pawtrait, however big `cls` makes it. Legend Pawtraits are unmistakable at any size: a turning rainbow-gold foil
 * ring, a golden glow and a shine that sweeps across. A set's Signature card (Reaper, for Heat Wave) gets a step above:
 * a turning ring of molten lava with a flickering glow and rising embers. Everyday ones are a plain picture.
 */
const SIGNATURE = new Set(['legend-reaper']);
export function pawtrait(id: string, cls: string): string {
  if (SIGNATURE.has(id)) {
    return `<span class="signature-frame ${cls}"><img src="${avatarUrl(id)}" alt="">`
      + `<span class="sig-embers" aria-hidden="true">${'<i></i>'.repeat(7)}</span></span>`;
  }
  if (!id.startsWith('legend-')) return `<img class="${cls}" src="${avatarUrl(id)}" alt="">`;
  return `<span class="legend-frame ${cls}"><img src="${avatarUrl(id)}" alt=""><span class="legend-shine"></span></span>`;
}

/** The signed-in player's face: their Pawtrait, or their initial until it has loaded. */
function face(size: '' | 'small' = ''): string {
  const s = session();
  if (s?.avatar) return pawtrait(s.avatar, `account-avatar ${size} is-image`);
  return `<span class="account-avatar ${size}" aria-hidden="true">${s ? initial(s.displayName || s.email) : '?'}</span>`;
}

// ── The Pawtrait picker ─────────────────────────────────────────────────────────────────────────
//
// Everyday Pawtraits are for everyone. Legend Pawtraits come with a Legendary card: own the card and its Pawtrait
// is yours. Nobody owns a Pawtrait alone; friends can wear the same one.

type Filter = 'all' | 'everyday' | 'legend';
let picking = false;
let filter: Filter = 'all';
let avatars: Avatar[] = [];
let owned = new Set<string>();
let wearing = '';
let pickerBusy = false;
let pickerError = '';

/**
 * Fetch the catalog and start downloading every Pawtrait image, so the picker opens instantly. Called when Settings
 * opens (and by the picker itself); safe to call often.
 */
export function warmPawtraits() {
  if (!session()) return;
  void avatarCatalog().then((all) => {
    if (!avatars.length) avatars = all;
    for (const a of all) { const img = new Image(); img.decoding = 'async'; img.src = avatarUrl(a.id); preloaded.push(img); }
  }).catch(() => { /* the picker retries and shows the error */ });
}
const preloaded: HTMLImageElement[] = [];

async function openPicker(host: Host) {
  picking = true; pickerError = '';
  // Show what's known right away: the catalog if it's loaded, what you wear, and what everyone owns. What you've
  // unlocked arrives a moment later from your account.
  wearing = session()?.avatar ?? wearing;
  if (!owned.size) owned = new Set(avatars.filter((a) => a.kind === 'everyday' || a.id === 'legend-mochi').map((a) => a.id));
  pickerBusy = !avatars.length;
  host.render();
  try {
    const [all, mine] = await Promise.all([avatarCatalog(), myAvatars()]);
    avatars = all; owned = mine.owned; wearing = mine.avatar;
  } catch (e) { pickerError = e instanceof AuthError ? e.message : 'Couldn’t load the Pawtraits.'; }
  pickerBusy = false;
  if (picking) host.render();
}

/**
 * A player's Pawtrait for the game board, or '' when there's none to show. You wear your own (signed in); a computer
 * opponent wears the everyday Pawtrait of the fruit family its deck leads.
 */
const FAMILY_PAWTRAIT: Record<string, string> = {
  Citrus: 'orange', Orchard: 'apple', Tropical: 'pineapple', Berry: 'strawberry', Melon: 'watermelon', Garden: 'peapod',
};
export function boardFace(who: 'you' | 'computer', family: string): string {
  const id = who === 'you' ? session()?.avatar : FAMILY_PAWTRAIT[family] ?? 'lemon';
  return id ? pawtrait(id, 'board-pawtrait') : '';
}

function renderPicker(): string {
  const shown = avatars.filter((a) => filter === 'all' || a.kind === filter);
  const chip = (f: Filter, label: string) =>
    `<button class="${filter === f ? 'chosen' : ''}" data-click="acct:filter:${f}" aria-pressed="${filter === f}">${label}</button>`;
  const tile = (a: Avatar) => {
    const mine = owned.has(a.id);
    const title = a.kind === 'legend' ? `${a.name} · Legend Pawtrait` : a.name;
    return `<button class="pawtrait ${a.kind} ${a.id === wearing ? 'wearing' : ''} ${mine ? '' : 'locked'}"
        data-click="acct:wear:${a.id}" ${pickerBusy ? 'disabled' : ''} title="${esc(title)}" aria-label="${esc(title)}${mine ? '' : ' (locked)'}">
        ${pawtrait(a.id, 'pawtrait-img')}
        ${a.id === wearing ? '<span class="pawtrait-wearing" aria-hidden="true">✓</span>' : ''}
        ${mine ? '' : `<span class="pawtrait-lock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" fill="currentColor"/></svg>${esc(a.name)}</span>`}
      </button>`;
  };
  return `<div class="account-panel-head">
      <button class="icon-button account-back" data-click="acct:pickerback" aria-label="Back to Account" title="Back to Account">‹</button>
      <h2>Pawtraits</h2>
      <span class="account-back-balance" aria-hidden="true"></span>
    </div>
    <div class="segmented pawtrait-filter">${chip('all', 'All')}${chip('everyday', 'Everyday')}${chip('legend', 'Legend')}</div>
    ${filter === 'legend' ? '<p class="account-section-note">Legend Pawtraits come with Legendary cards. Own the card and its Pawtrait is yours to wear.</p>' : ''}
    ${pickerBusy && !avatars.length ? '<p class="account-section-note">Loading…</p>' : sections(shown, tile)}
    <p class="account-error" role="alert">${esc(pickerError)}</p>`;
}

/** The grid, in two shelves when both kinds are shown: Everyday, then Legend Pawtraits. */
function sections(shown: Avatar[], tile: (a: Avatar) => string): string {
  const everyday = shown.filter((a) => a.kind === 'everyday');
  const legend = shown.filter((a) => a.kind === 'legend');
  const grid = (list: Avatar[]) => `<div class="pawtrait-grid">${list.map(tile).join('')}</div>`;
  if (!everyday.length || !legend.length) return grid(shown);
  return `<div class="pawtrait-shelves">
      <h3 class="pawtrait-shelf">Everyday</h3>${grid(everyday)}
      <h3 class="pawtrait-shelf legend">Legend Pawtraits <small>come with Legendary cards</small></h3>${grid(legend)}
    </div>`;
}

async function wear(host: Host, id: string) {
  if (!owned.has(id)) {
    const a = avatars.find((x) => x.id === id);
    pickerError = `${a?.name ?? 'This'} is a Legend Pawtrait: it comes with ${a?.cardName ?? 'a Legendary card'}.`;
    host.render();
    return;
  }
  if (id === wearing) return;
  pickerBusy = true; pickerError = '';
  host.render();
  try { await chooseAvatar(id); wearing = id; } catch (e) { pickerError = e instanceof AuthError ? e.message : 'Couldn’t change your Pawtrait.'; }
  pickerBusy = false;
  host.render();
}

/** The Account row at the top of Settings: who's signed in, and the way into the Account panel. */
export function renderAccountRow(): string {
  const s = session();
  const name = s ? s.displayName || s.email : '';
  return `<button class="account-row" data-click="acct:panel" aria-label="Account">
      ${face('small')}
      <span class="account-who"><b>${s ? esc(name) : 'Account'}</b><small>${s ? 'Signed in' : 'Not signed in'}</small></span>
      <span class="account-chevron" aria-hidden="true">›</span>
    </button>`;
}

/** The Account panel, shown in place of the other settings. */
export function renderAccountPanel(): string {
  if (contactOpen) return renderContact();
  if (picking) return renderPicker();
  const s = session();
  const head = `<div class="account-panel-head">
      <button class="icon-button account-back" data-click="acct:panelback" aria-label="Back to Settings" title="Back to Settings">‹</button>
      <h2>Account</h2>
      <span class="account-back-balance" aria-hidden="true"></span>
    </div>`;
  if (!s) {
    return `${head}
      <p class="account-section-note">You’re not signed in. Solo play works without an account; a free Via Mochi account adds:</p>
      ${benefits()}
      <button class="primary account-section-button" data-click="acct:open">Sign in or create account</button>
      ${panelNote ? `<p class="account-section-note" role="status"><b>${esc(panelNote)}</b></p>` : ''}`;
  }
  const name = s.displayName || s.email;
  const since = s.signedInAt
    ? new Date(s.signedInAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const signOut = confirmingSignOut ? `
      <div class="account-confirm" role="alertdialog" aria-label="Sign out?">
        <p><b>Sign out on this device?</b> Your account and collection stay safe; sign in again any time with your email.</p>
        <div class="account-confirm-buttons">
          <button data-click="acct:signoutcancel">Stay signed in</button>
          <button class="danger" data-click="acct:signout">Sign out</button>
        </div>
      </div>` : '<button class="account-section-button" data-click="acct:signoutask">Sign out</button>';
  const deletion = confirmingDelete ? `
      <div class="account-confirm" role="alertdialog" aria-label="Delete your account?">
        <p><b>Delete your Via Mochi account?</b> In 30 days your account, collection, decks and Pawtraits are erased for
        good, and you’re signed out everywhere now. Changed your mind? Sign in again before then and nothing is lost.</p>
        <div class="account-confirm-buttons">
          <button data-click="acct:deletecancel">Keep my account</button>
          <button class="danger" data-click="acct:delete" ${panelBusy ? 'disabled' : ''}>Delete account</button>
        </div>
      </div>` : '';
  return `${head}
      <div class="account-card">
        <button class="account-face-button" data-click="acct:picker" aria-label="Change your Pawtrait">${face()}<span class="account-face-edit">Change</span></button>
        <span class="account-who"><b>${esc(name)}</b><small>${esc(s.email)}</small></span>
      </div>
      <p class="account-section-note">Signed in on this device${since ? ` since ${esc(since)}` : ''}. Your collection and decks are kept in your Via Mochi account.</p>
      ${signOut}
      <div class="account-more">
        <button class="link-button" data-click="acct:export" ${panelBusy ? 'disabled' : ''}>Export my data</button>
        <button class="link-button danger-link" data-click="acct:deleteask">Delete account</button>
      </div>
      ${deletion}
      <p class="account-section-note" role="status">${esc(panelNote)}</p>`;
}

// ── Events ──────────────────────────────────────────────────────────────────────────────────────

/** Typing: kept without redrawing, so the text cursor stays put. */
export function accountInput(input: HTMLInputElement) {
  const field = input.dataset.acct;
  if (field === 'email') email = input.value.trim();
  else if (field === 'name') displayName = input.value;
  else if (field === 'year') birthYear = input.value.replace(/\D/g, '');
  else if (field === 'agree') agreed = input.checked;
  else if (field === 'invite') invite = input.value;
  else if (field === 'contactemail') contactEmail = input.value;
  else if (field === 'contactmessage') contactMessage = input.value;
  else if (field === 'contactcode') {
    contactCode = input.value.replace(/\D/g, '');
    // A pasted or autofilled code sends straight away, as when signing in.
    if (contactCodeLength && contactCode.length === contactCodeLength && !contactBusy) void accountClick(hostRef!, 'contactverify');
  }
  else if (field === 'code') {
    code = input.value.replace(/\D/g, '');
    // A pasted or autofilled code signs in straight away.
    if (pending && code.length === pending.codeLength && !busy) void accountClick(hostRef!, 'code');
  }
}

/** Enter moves on, like the step's button. */
export function accountEnter(input: HTMLInputElement, host: Host) {
  const field = input.dataset.acct;
  if (field === 'email') void accountClick(host, 'email');
  else if (field === 'name') document.querySelector<HTMLInputElement>('[data-acct="year"]')?.focus();
  else if (field === 'year') input.blur();
  else if (field === 'code') void accountClick(host, 'code');
  else if (field === 'invite') void accountClick(host, 'invite');
  else if (field === 'contactcode') void accountClick(host, 'contactverify');
}

let hostRef: Host | null = null;

export async function accountClick(host: Host, action: string) {
  hostRef = host;
  if (action === 'open') { openAccount(host); return; }
  if (action === 'close') { closeAccount(host); return; }
  if (action === 'contact') {
    // Also reached from the sign-in window ("Trouble signing in?"), which closes for it.
    open = false; panel = true; contactOpen = true; contactNote = ''; host.render(); return;
  }
  if (action === 'contactagain') { contactSent = false; contactMessage = ''; host.render(); return; }
  if (action === 'contactedit') { contactCodeLength = 0; contactCode = ''; contactNote = ''; host.render(); return; }
  if (action === 'contactsend' || action === 'contactresend') {
    if (contactBusy) return;
    if (!contactMessage.trim()) { contactNote = 'Please write your message.'; host.render(); return; }
    const signedIn = !!session();
    if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) { contactNote = 'Please enter your email address, so we can answer you.'; host.render(); return; }
    contactBusy = true; contactNote = ''; host.render();
    try {
      // Signed out, the message waits for the code emailed to the address given.
      if (signedIn) { await sendSupport(contactMessage.trim(), contactEmail.trim()); contactSent = true; contactMessage = ''; }
      else {
        contactCodeLength = await requestSupportCode(contactEmail.trim()); contactCode = '';
        if (action === 'contactresend') contactNote = 'We’ve sent a new code. Use the one in the newest email.';
      }
    } catch (e) { contactNote = e instanceof AuthError ? e.message : 'Your message couldn’t be sent. Please try again.'; }
    contactBusy = false; host.render();
    if (contactCodeLength) document.querySelector<HTMLInputElement>('[data-acct="contactcode"]')?.focus();
    return;
  }
  if (action === 'contactverify') {
    if (contactBusy) return;
    if (contactCode.length !== contactCodeLength) { contactNote = `Please type the ${contactCodeLength}-digit code from the email.`; host.render(); return; }
    contactBusy = true; contactNote = ''; host.render();
    try {
      await sendSupport(contactMessage.trim(), contactEmail.trim(), contactCode);
      contactSent = true; contactMessage = ''; contactCodeLength = 0; contactCode = '';
    } catch (e) { contactNote = e instanceof AuthError ? e.message : 'Your message couldn’t be sent. Please try again.'; }
    contactBusy = false; host.render();
    document.querySelector<HTMLInputElement>('[data-acct="contactcode"]')?.select();
    return;
  }
  if (action === 'panel') { panel = true; confirmingSignOut = false; picking = false; host.render(); return; }
  if (action === 'picker') { void openPicker(host); return; }
  if (action === 'pickerback') { picking = false; host.render(); return; }
  if (action.startsWith('filter:')) { filter = action.slice(7) as Filter; host.render(); return; }
  if (action.startsWith('wear:')) { void wear(host, action.slice(5)); return; }
  if (action === 'panelback') { closeAccountPanel(); host.render(); return; }
  if (action === 'signoutask') { confirmingSignOut = true; host.render(); return; }
  if (action === 'signoutcancel') { confirmingSignOut = false; host.render(); return; }
  if (action === 'deleteask') { confirmingDelete = true; confirmingSignOut = false; host.render(); return; }
  if (action === 'deletecancel') { confirmingDelete = false; host.render(); return; }
  if (action === 'export') {
    panelBusy = true; panelNote = 'Gathering your data…'; host.render();
    try {
      const file = new Blob([await exportData()], { type: 'application/json' });
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: 'via-mochi-account.json' });
      link.click();
      URL.revokeObjectURL(link.href);
      panelNote = 'Your data is in via-mochi-account.json.';
    } catch (e) { panelNote = e instanceof AuthError ? e.message : 'Couldn’t gather your data.'; }
    panelBusy = false; host.render(); return;
  }
  if (action === 'delete') {
    panelBusy = true; host.render();
    try {
      const when = await deleteAccount();
      await signOutAndForget();
      confirmingDelete = false;
      panelNote = `Your account will be deleted on ${when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}. `
        + 'Sign in again before then to keep it.';
    } catch (e) { panelNote = e instanceof AuthError ? e.message : 'Couldn’t delete your account.'; }
    panelBusy = false; host.render(); return;
  }
  if (action === 'signout') { await signOutAndForget(); confirmingSignOut = false; host.render(); return; }
  if (action === 'back') { step = 'email'; error = ''; code = ''; pending = null; host.render(); focusFirst(); return; }
  if (action === 'done') { const next = then; open = false; then = null; if (next) next(); host.render(); return; }
  if (busy) return;
  error = '';

  if (action === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error = 'Please enter your email address.'; host.render(); return; }
    await work(host, async () => {
      inviteThenSignIn = false;
      if (await accountExists(email)) { pending = await startSignIn(email); code = ''; step = 'code'; }
      else step = (await invitesRequired()) ? 'invite' : 'details';
    });
  } else if (action === 'invite') {
    if (!invite.trim()) { error = 'Please type your invite code.'; host.render(); return; }
    await work(host, async () => {
      await useInvite(invite);
      if (inviteThenSignIn) { pending = await startSignIn(email); code = ''; step = 'code'; }
      else step = 'details';
    });
  } else if (action === 'details') {
    const year = Number(birthYear);
    const thisYear = new Date().getFullYear();
    if (!displayName.trim()) error = 'Please choose a display name.';
    else if (!(year >= 1900 && year <= thisYear)) error = 'Please enter your birth year, like 1990.';
    else if (thisYear - year < MIN_AGE) error = `Sorry, Via Mochi accounts are for ages ${MIN_AGE} and up. You can still play Solo!`;
    else if (!agreed) error = 'Please agree to the Terms of Use.';
    if (error) { host.render(); return; }
    await work(host, async () => {
      pending = await startSignUp(email, displayName.trim(), year);
      code = ''; step = 'code';
    });
  } else if (action === 'code') {
    if (!pending) return;
    if (code.length !== pending.codeLength) { error = `The code has ${pending.codeLength} digits.`; host.render(); return; }
    await work(host, async () => {
      try { await submitCode(pending!, code); }
      catch (e) {
        // Signed in to an email that never finished making its account: it needs an invite like any new one.
        if (e instanceof AuthError && e.code === 'invite_required' && pending?.flow === 'signIn') {
          inviteThenSignIn = true; pending = null; step = 'invite';
          throw new AuthError('invite_required', 'This email doesn’t have an account yet. Type your invite code to make one.');
        }
        throw e;
      }
      // A new account ticked the Terms before its code; an existing one may not have agreed to these Terms yet.
      if (pending?.flow === 'signUp') agreeToTerms(Number(birthYear) || undefined);   // saved in the background, not waited for
      step = needsTerms() ? 'terms' : 'welcome';
      startSync(host);
    });
  } else if (action === 'terms') {
    // An account made elsewhere (the Artist Studio) has no birth year yet: the game asks for it here.
    const askYear = session()?.birthYear == null;
    const year = Number(birthYear), thisYear = new Date().getFullYear();
    if (askYear && !(year >= 1900 && year <= thisYear)) { error = 'Please enter your birth year, like 1990.'; host.render(); return; }
    if (askYear && thisYear - year < MIN_AGE) { error = `Sorry, Fruitcats accounts are for ages ${MIN_AGE} and up. Sign out to keep playing Solo.`; host.render(); return; }
    if (!agreed) { error = 'Please tick the box to agree, or sign out.'; host.render(); return; }
    // No waiting on the service: the agreement is kept here and saved in the background (auth.ts, agreeToTerms).
    agreeToTerms(askYear ? year : undefined);
    step = pending ? 'welcome' : 'email';
    if (!pending) open = false;
    host.render();
  } else if (action === 'termsno') {
    await signOutAndForget();
    open = false; then = null; step = 'email'; host.render();
  } else if (action === 'resend') {
    if (!pending) return;
    await work(host, async () => { pending = await resend(pending!); code = ''; error = 'We sent a new code.'; });
  }
}

async function work(host: Host, run: () => Promise<void>) {
  busy = true;
  host.render();
  try { await run(); } catch (e) {
    error = e instanceof AuthError ? e.message : 'Something went wrong. Please try again.';
    if (e instanceof AuthError && e.code === 'expired') { step = pending ? 'code' : 'email'; }
    if (e instanceof AuthError && e.code === 'user_already_exists') step = 'email';
    if (e instanceof AuthError && e.code === 'invite_required') step = 'invite';
  }
  busy = false;
  host.render();
  focusFirst();
}

function focusFirst() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.account-dialog input:not([type=checkbox]):not(:disabled)');
    if (input && document.activeElement !== input) input.focus();
  });
}
