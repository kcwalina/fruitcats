// Via Mochi sign-in (docs/accounts.md). The only module that knows about Microsoft Entra: the game asks it to
// start with an email, check a code, and hand out a token; nothing else changes if Entra is ever replaced.
//
// Entra's "native authentication" API sends the one-time codes. Browsers can't call it directly, so every call goes
// through viamochi-id's /auth pass-through. The Entra token is then swapped at viamochi-id for our own Via Mochi
// token, which is what our APIs accept.

import { API } from './api';
import { NO_RETRY, NetError, SAFE_RETRY, fetchRetry, requestId, type RetryPolicy } from './net';

// viamochi-id accepts calls from the game's sites and from a dev server on port 5173 only. A dev server on another port
// (a second checkout running side by side) goes through its own /__id proxy instead (vite.config.ts).
const ID_SERVICE = import.meta.env.DEV && location.port !== '5173' ? `${location.origin}/__id` : 'https://id.viamochi.com';
const CLIENT_ID = '1ed2eaf3-3330-4328-9ca3-1519f681b6a2';
const SCOPE = `openid offline_access api://${CLIENT_ID}/play`;
const BIRTH_YEAR = 'extension_6758f33d2f4d4c119a640bcbadfe8dc5_BirthYear';
const SESSION_KEY = 'viamochi-session';
/** The Terms of Use version a new account accepts (docs/legal/terms-of-use.md). */
export const TERMS_VERSION = '2026-09-draft-1';

export interface Session {
  userId: string;
  displayName: string;
  email: string;
  /** Entra's refresh token: keeps this device signed in. */
  refreshToken: string;
  /** Our Via Mochi token and when it expires (ms since epoch). */
  token: string;
  expires: number;
  /** When this device signed in (ms since epoch). */
  signedInAt: number;
  /** The avatar ("Pawtrait") this account wears. */
  avatar?: string;
  /** The version of the Terms of Use this account last agreed to (null: never). */
  terms?: string | null;
  /** Agreed on this device, not yet recorded in the account (saved in the background; see acceptTerms). */
  termsPending?: string;
  /** The account's birth year, for the age checks (13+ for an account, 18+ to buy). Null until the account has one:
   *  an account made in the Artist Studio gives it at the game's Terms step. */
  birthYear?: number | null;
  /** Entra has refused to renew this sign-in (see `refusedRefresh`): when first and last, how many times, and its latest
   *  reason. Gone once a renewal works. */
  refused?: { first: number; last: number; tries: number; why?: string };
}

/**
 * Where a sign-in stands between the email and the code. Kept only in memory. Each step that has worked is kept here,
 * so a tap that fails part-way (the network drops) tries only what's left the next time, and never sends a used
 * code to Entra again.
 */
export interface Pending {
  flow: 'signIn' | 'signUp';
  email: string;
  continuationToken: string;
  /** "k•••@m•••.com": where the code went, as Entra shows it. */
  sentTo: string;
  codeLength: number;
  /** A new account (it stays one if its sign-in has to start again as an ordinary sign-in). */
  newAccount: boolean;
  /** A new account's details, to start its sign-up again if Entra forgets it (its continuation token expires). */
  displayName?: string;
  birthYear?: number;
  /** Sign-up: the email is confirmed and the account made; only signing in to it is left. */
  confirmed?: string;
  /** Entra accepted the code; only the exchange for our own token is left. */
  entra?: Record<string, any>;
}

export class AuthError extends Error {
  /** Entra's own description of the failure, for diagnosis only (never shown to players). */
  detail?: string;
  constructor(readonly code: string, message: string) { super(message); }
}

// ── The session on this device ──────────────────────────────────────────────────────────────────

export function session(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null; } catch { return null; }
}

function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode: signed in until the page closes */ }
}

export function signOut() { saveSession(null); }

/**
 * A refresh already under way. Sync, the Store and the Terms all ask for a token when the game starts; they share one
 * refresh instead of each starting their own (three at once made the Terms wait half a minute on a slow service).
 */
let refreshing: Promise<string | null> | null = null;

/** A Via Mochi token for our APIs, refreshed quietly when it's about to expire. Null when signed out. */
export async function token(): Promise<string | null> {
  const s = session();
  if (!s) return null;
  if (s.expires - Date.now() > 60_000) return s.token;
  refreshing ??= refresh(s).finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Entra saying no to a renewal isn't final: it can answer that way during its own trouble, and a player who loses a
 * signed-in session has to wait for a code email again. Like any app, a device stays signed in for months: it keeps the
 * sign-in through any number of refusals (and any time offline), asks again no sooner than REFUSED_RETRY_MS, and gives up
 * only once Entra has kept refusing for REFUSED_FOR_MS, when the sign-in really is gone.
 */
const REFUSED_RETRY_MS = 5 * 60_000;
const REFUSED_TRIES = 3;
const REFUSED_FOR_MS = 90 * 24 * 60 * 60_000;

function refusedRefresh(e: AuthError) {
  const now = session();
  if (!now) return;
  const at = Date.now(), first = now.refused?.first ?? at, tries = (now.refused?.tries ?? 0) + 1;
  const why = [e.code, e.detail].filter(Boolean).join(': ').slice(0, 300);
  if (tries >= REFUSED_TRIES && at - first >= REFUSED_FOR_MS) signOut();
  else saveSession({ ...now, refused: { first, last: at, tries, why } });
  console.warn('Entra refused to renew the sign-in:', why);
}

async function refresh(s: Session): Promise<string | null> {
  // Refused a moment ago: don't ask Entra again yet (the caller carries on signed in, without a fresh token).
  if (s.refused && Date.now() - s.refused.last < REFUSED_RETRY_MS) return null;
  try {
    const entra = await entraPost('oauth2/v2.0/token', { grant_type: 'refresh_token', refresh_token: s.refreshToken, scope: SCOPE });
    // Entra hands out a new refresh token each time: kept at once, so an exchange that fails below doesn't leave this
    // device holding only the old one.
    const now = session();
    if (now && entra.refresh_token) saveSession({ ...now, refreshToken: entra.refresh_token });
    return (await finish(entra, s.email)).token;
  } catch (e) {
    // Being offline, or our service being down or slow, never signs the player out: they're still signed in once it's
    // back. Entra rejecting the refresh token counts against the sign-in, but only a long run of them ends it.
    if (e instanceof AuthError && (e.code === 'invalid_grant' || e.code === 'expired')) refusedRefresh(e);
    return null;
  }
}

/**
 * Refresh this device's copy of the account (name, Pawtrait, Terms agreed) from the account service now, whatever the
 * token's age. The device's copy can be old: a session saved by an older version of the game, or by the iPhone
 * Home Screen app still running one. True when the account answered.
 */
export async function refreshAccount(): Promise<boolean> {
  const s = session();
  if (!s) return false;
  refreshing ??= refresh(s).finally(() => { refreshing = null; });
  return (await refreshing) !== null;
}

/** Why there's no token: signed out, or the service can't be reached right now. */
function noToken(): AuthError {
  return session() ? new AuthError('timeout', 'Via Mochi isn’t answering right now. Please try again in a minute.')
    : new AuthError('signed_out', 'Please sign in again.');
}

// ── Signing in and creating accounts ────────────────────────────────────────────────────────────

/** Is there already an account for this email? Sends nothing. */
export async function accountExists(email: string): Promise<boolean> {
  try {
    const started = await entraPost('oauth2/v2.0/initiate', { username: email, challenge_type: 'oob redirect' });
    initiated = { email, token: started.continuation_token, at: Date.now() };
    return true;
  } catch (e) {
    if (e instanceof AuthError && e.code === 'user_not_found') return false;
    throw e;
  }
}

/**
 * The sign-in `accountExists` just started, so emailing the code doesn't ask Entra again (each call is a round trip
 * to Entra through our service: about half a second, more when either is busy).
 */
let initiated: { email: string; token: string; at: number } | null = null;

/** Existing account: email the code. */
export async function startSignIn(email: string, newAccount = false): Promise<Pending> {
  const cached = initiated?.email === email && Date.now() - initiated.at < 5 * 60_000 ? initiated.token : null;
  initiated = null;
  const base = { flow: 'signIn', email, newAccount } as const;
  if (cached) {
    try { return await challenge(base, 'oauth2/v2.0/challenge', cached); } catch (e) {
      // Entra forgot the sign-in accountExists started (the player took a while): start another, rather than say a
      // code has expired before any was sent.
      if (!(e instanceof AuthError && e.code === 'expired')) throw e;
    }
  }
  const token = (await entraPost('oauth2/v2.0/initiate', { username: email, challenge_type: 'oob redirect' })).continuation_token;
  return challenge(base, 'oauth2/v2.0/challenge', token);
}

// ── Invite codes (playtest) ─────────────────────────────────────────────────────────────────────
//
// While accounts are for playtesters only, a new account needs an invite code. The account service decides whether
// one is needed (none once sign-up opens to everyone) and counts each account against its code.

/** The invite code for the account being created, sent with the sign-up and the first token exchange. */
let inviteCode = '';

/** Does creating an account need an invite code right now? */
export async function invitesRequired(): Promise<boolean> {
  const r = await request(`${ID_SERVICE}/invites/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '' }),
  }, true);
  if (r.status !== 403 && !r.ok) throw await failed(r, 'Something went wrong. Please try again.');
  return r.status === 403;
}

/** Check an invite code, and use it for the account about to be created. */
export async function useInvite(code: string): Promise<void> {
  const r = await request(`${ID_SERVICE}/invites/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  }, true);
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw toError(r.status, json);
  inviteCode = code.trim();
}

/** New account: its details go in first, then the code confirms the email. */
export async function startSignUp(email: string, displayName: string, birthYear?: number): Promise<Pending> {
  const started = await entraPost('signup/v1.0/start', {
    username: email, challenge_type: 'oob redirect', invite_code: inviteCode,
    // One Via Mochi account for every app: only the name is needed. Each app asks its own questions (the game asks
    // the birth year at sign-up, or at its Terms step for an account made elsewhere).
    attributes: JSON.stringify({ displayName, ...(birthYear ? { [BIRTH_YEAR]: String(birthYear) } : {}) }),
  });
  return challenge({ flow: 'signUp', email, newAccount: true, displayName, birthYear }, 'signup/v1.0/challenge', started.continuation_token);
}

/**
 * The code out of whatever landed in the box: iPhone Mail turns an 8-digit code into a phone link, and "Copy link"
 * pastes "tel:12345678" (2026-09-26), so everything but digits goes. A longer run keeps its last digits (a "+1" a
 * phone app added in front).
 */
export function codeDigits(text: string, length: number): string {
  const digits = text.replace(/\D/g, '');
  return length > 0 && digits.length > length ? digits.slice(-length) : digits;
}

/** Send the code again. If Entra has forgotten this sign-in (it keeps one for minutes), start it again. */
export async function resend(p: Pending): Promise<Pending> {
  const base = { flow: p.flow, email: p.email, newAccount: p.newAccount, displayName: p.displayName, birthYear: p.birthYear };
  try {
    return await challenge(base, p.flow === 'signIn' ? 'oauth2/v2.0/challenge' : 'signup/v1.0/challenge', p.continuationToken);
  } catch (e) {
    if (!(e instanceof AuthError && e.code === 'expired')) throw e;
  }
  // "Send a new code" used to fail for good once the continuation token expired: the only way out was to start over.
  if (p.flow === 'signIn') return startSignIn(p.email, p.newAccount);
  try { return await startSignUp(p.email, p.displayName ?? '', p.birthYear); } catch (e) {
    // The account was made before the sign-up was lost: sign in to it instead.
    if (e instanceof AuthError && e.code === 'user_already_exists') return startSignIn(p.email, true);
    throw e;
  }
}

/**
 * Check the code; on success this device is signed in. Each step that worked is kept on `p`, so after a failure the
 * next tap does only what's left. When a new code had to be sent, `p` is updated to it and the error says so
 * (code 'code_resent').
 */
export async function submitCode(p: Pending, code: string): Promise<Session> {
  if (!p.entra && p.flow === 'signIn') {
    p.entra = await usingCode(p, () => entraPost('oauth2/v2.0/token', { continuation_token: p.continuationToken, grant_type: 'oob', oob: code, scope: SCOPE }));
  } else if (!p.entra) {
    p.confirmed ??= (await usingCode(p, () => entraPost('signup/v1.0/continue', { continuation_token: p.continuationToken, grant_type: 'oob', oob: code }))).continuation_token;
    try {
      p.entra = await entraPost('oauth2/v2.0/token', {
        continuation_token: p.confirmed!, grant_type: 'continuation_token', username: p.email, scope: SCOPE,
      });
    } catch (e) {
      if (!(e instanceof AuthError) || e.code === 'network' || e.code === 'timeout' || OUR_WORDS.has(e.code)) throw e;
      // The account is made but Entra won't sign in with that continuation token any more: sign in the ordinary way.
      replace(p, await startSignIn(p.email, true));
      throw new AuthError('code_resent', 'Your account is ready. We’ve emailed you a new code to sign in.');
    }
  }
  try { return await finish(p.entra!, p.email); } catch (e) {
    if (e instanceof AuthError && e.code === 'entra_expired' && p.entra?.refresh_token) {
      // Left for an hour after the code worked: Entra's token has run out, but its refresh token gets a new one.
      p.entra = await entraPost('oauth2/v2.0/token', { grant_type: 'refresh_token', refresh_token: p.entra.refresh_token, scope: SCOPE });
      return finish(p.entra, p.email);
    }
    if (e instanceof AuthError && (e.code === 'invite_required' || OUR_WORDS.has(e.code))) throw e;
    throw new AuthError('exchange', 'Signed in, but we couldn’t reach your Via Mochi account. Tap Try again.');
  }
}

/** A step that uses the code. An expired code gets a new one sent at once, rather than asking the player to. */
async function usingCode<T>(p: Pending, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) {
    if (!(e instanceof AuthError && e.code === 'expired')) throw e;
  }
  replace(p, await resend(p));
  throw new AuthError('code_resent', 'That code has expired. We’ve sent you a new one.');
}

/** Swap a pending sign-in for a new one in place: the screens hold on to the same object. */
function replace(p: Pending, next: Pending) {
  Object.assign(p, { confirmed: undefined, entra: undefined }, next);
}

async function challenge(base: Pick<Pending, 'flow' | 'email' | 'newAccount' | 'displayName' | 'birthYear'>, path: string, continuationToken: string): Promise<Pending> {
  const r = await entraPost(path, { continuation_token: continuationToken, challenge_type: 'oob redirect' });
  if (r.challenge_type !== 'oob') throw new AuthError('redirect', 'This account can’t sign in here yet.');
  return { ...base, continuationToken: r.continuation_token, sentTo: r.challenge_target_label ?? base.email, codeLength: r.code_length ?? 8 };
}

/** Swap Entra's token for ours and remember the session. */
async function finish(entra: Record<string, any>, email: string): Promise<Session> {
  const r = await request(`${ID_SERVICE}/token`, {
    method: 'POST', headers: { Authorization: `Bearer ${entra.access_token}`, ...(inviteCode ? { 'X-Invite-Code': inviteCode } : {}) },
  }, true);
  if (r.status === 401) throw new AuthError('entra_expired', 'Please sign in again.');
  if (r.status === 403) throw toError(403, await r.json().catch(() => ({})));
  if (!r.ok) throw await failed(r, 'Signed in, but Via Mochi couldn’t open your account. Please try again.', 'exchange');
  const ours = await r.json();
  restoredOnSignIn = !!ours.restored;
  // An agreement made on this device and not yet saved in the account survives a refresh: dropping it here made the
  // Terms come back at the next start although the player had agreed.
  const pending = session()?.termsPending;
  const s: Session = {
    userId: ours.user.id, displayName: ours.user.displayName ?? '', email,
    refreshToken: entra.refresh_token, token: ours.access_token, expires: Date.now() + ours.expires_in * 1000,
    signedInAt: session()?.signedInAt ?? Date.now(),
    avatar: ours.user.avatar,
    terms: ours.user.terms ?? null,
    // Given at the Terms step and not yet saved in the account: kept, like the agreement.
    birthYear: ours.user.birthYear ?? session()?.birthYear ?? null,
    ...(pending && pending !== ours.user.terms ? { termsPending: pending } : {}),
  };
  saveSession(s);
  return s;
}

/** True right after a sign-in that cancelled a scheduled deletion ("Welcome back: your account is kept"). */
export let restoredOnSignIn = false;

// ── Export and delete ───────────────────────────────────────────────────────────────────────────


/** Everything held for this account, by the account service and by Fruitcats, as one file's contents. */
export async function exportData(): Promise<string> {
  const t = await token();
  if (!t) throw noToken();
  const get = async (url: string) => {
    const r = await request(url, { headers: { Authorization: `Bearer ${t}` } }, true);
    if (!r.ok) throw await failed(r, 'Couldn’t gather your data. Please try again.');
    return r.json();
  };
  const [account, fruitcats] = await Promise.all([get(`${ID_SERVICE}/me/export`), get(`${API}/v1/export`)]);
  return JSON.stringify({ exported: new Date().toISOString(), viaMochiAccount: account, fruitcats }, null, 2);
}

/** Schedule this account's deletion (30 days; signing in again before then cancels it). Returns the date. */
export async function deleteAccount(): Promise<Date> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }, true);
  if (!r.ok) throw await failed(r, 'Couldn’t delete your account. Please try again.');
  return new Date((await r.json()).deleteAfter);
}

// ── Friends ─────────────────────────────────────────────────────────────────────────────────────

export interface Friend { id: string; displayName: string | null; avatar: string; since: string }

async function withToken(path: string, init: RequestInit, retry: boolean): Promise<Response> {
  let t = await token();
  if (!t) throw noToken();
  const send = (bearer: string) => request(`${ID_SERVICE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bearer}` } }, retry);
  const r = await send(t);
  // Turned away (a 401 happens before the service does anything, so asking again is safe): this device's token may be
  // older than it thinks. A fresh one, and one more try, before the answer is believed.
  if (r.status !== 401 || !await refreshAccount() || !(t = await token())) return r;
  return send(t);
}

/**
 * A call to one of our other services (the Fruitcats API) with this account's token, as `policy` allows (net.ts).
 * Null when there's no token (signed out, or the account service can't be reached right now). A 401 gets a fresh token
 * and one more try, as withToken. Throws a NetError when no answer came at all.
 */
export async function authedFetch(url: string, init: RequestInit, policy: RetryPolicy): Promise<Response | null> {
  let t = await token();
  if (!t) return null;
  const send = (bearer: string) => fetchRetry(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bearer}` } }, policy);
  const r = await send(t);
  if (r.status !== 401 || !await refreshAccount() || !(t = await token())) return r;
  return send(t);
}

export async function listFriends(): Promise<Friend[]> {
  const r = await withToken('/friends', {}, true);
  if (!r.ok) throw await failed(r, 'Couldn’t load your friends. Please try again.');
  return (await r.json()).friends;
}

/** A new friend code to give someone: "K7M-4Q2", good for 15 minutes and one use. */
export async function newFriendCode(): Promise<{ code: string; expires: string }> {
  // Safe to repeat: a code nobody saw is simply never used.
  const r = await withToken('/friends/code', { method: 'POST' }, true);
  if (!r.ok) throw await failed(r, 'Couldn’t make a code. Please try again.');
  return r.json();
}

export async function redeemFriendCode(code: string): Promise<Friend> {
  const r = await withToken('/friends/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  }, false);   // one use: a second try would find it used
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw json.message ? new AuthError('friend_code', json.message) : failedWith(r.status, json, 'That code didn’t work.');
  return json.friend;
}

export async function removeFriend(id: string, block = false): Promise<void> {
  const r = await withToken(block ? `/friends/${id}/block` : `/friends/${id}`, { method: block ? 'POST' : 'DELETE' }, true);
  if (!r.ok) throw await failed(r, 'Couldn’t do that. Please try again.');
}

// ── Avatars ("Pawtraits") ────────────────────────────────────────────────────────────────────────

export interface Avatar { id: string; name: string; kind: 'everyday' | 'legend'; cardId: string | null; cardName: string | null }

/** Bumped when the images are redrawn: browsers keep them for a week. */
const AVATAR_VERSION = 4;
export const avatarUrl = (id: string) => `${ID_SERVICE}/avatars/${id}.webp?v=${AVATAR_VERSION}`;

let catalog: Avatar[] | null = null;
/** Every avatar there is. Cached for the session. */
export async function avatarCatalog(): Promise<Avatar[]> {
  if (catalog) return catalog;
  const r = await request(`${ID_SERVICE}/avatars`, {}, true);
  if (!r.ok) throw await failed(r, 'Couldn’t load the Pawtraits. Please try again.');
  return (catalog = await r.json());
}

/** The avatars this account may wear, and the one it wears. Also refreshes the session's copy. */
export async function myAvatars(): Promise<{ avatar: string; owned: Set<string> }> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me`, { headers: { Authorization: `Bearer ${t}` } }, true);
  if (!r.ok) throw await failed(r, 'Couldn’t load your account. Please try again.');
  const me = await r.json();
  const s = session();
  if (s && s.avatar !== me.avatar) saveSession({ ...s, avatar: me.avatar });
  return { avatar: me.avatar, owned: new Set<string>(me.avatars) };
}

/**
 * "Contact us", signed out: emails a code to `email`, which the player types to send their message (so every answer
 * goes to an inbox that asked for it). Returns the code's length.
 */
export async function requestSupportCode(email: string): Promise<number> {
  const r = await request(`${ID_SERVICE}/support/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }, false);   // it emails a code
  if (!r.ok) throw await supportError(r, 'We couldn’t email you a code. Please try again.');
  return (await r.json()).codeLength ?? 8;
}

/** "Contact us": emailed to the team, answered by email (the account's, or `email`, confirmed by `code`, when signed out). */
export async function sendSupport(message: string, email: string, code?: string): Promise<void> {
  const t = session() ? await token() : null;
  // One id for the message, whichever attempt gets through: the service drops a copy it has already had, so trying
  // again never sends the team the same message twice.
  const r = await request(`${ID_SERVICE}/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId(), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ message, email, code, app: 'Fruitcats', device: navigator.userAgent }),
  }, true);
  if (!r.ok) throw await supportError(r, 'Your message couldn’t be sent. Please try again.');
}

/** The service's own words when it has them (a wrong code, a sender's daily limit); the IP limit comes bare. */
async function supportError(r: Response, fallback: string): Promise<AuthError> {
  const json = await r.json().catch(() => ({}));
  if (json.message) return new AuthError(json.error ?? 'support', json.message);
  if (json.error_description && OUR_WORDS.has(json.error)) return new AuthError(json.error, json.error_description);
  if (r.status === 429) return new AuthError('too_many', 'You’ve sent a few messages already. Please wait an hour, or reply to our email.');
  return failedWith(r.status, json, fallback);
}

/** Has this account still to agree to the current Terms of Use and Privacy Policy? */
export function needsTerms(): boolean {
  const s = session();
  return !!s && ((s.terms !== TERMS_VERSION && s.termsPending !== TERMS_VERSION) || s.birthYear == null);
}

/**
 * The player agreed to the current Terms of Use and Privacy Policy. The game carries on at once: the agreement is kept
 * on this device and recorded in the account in the background, tried again at each start until it's saved
 * (saveAgreedTerms). A slow or restarting service never holds the player at the dialog.
 */
export function agreeToTerms(birthYear?: number): void {
  const s = session();
  if (!s) return;
  saveSession({ ...s, termsPending: TERMS_VERSION, ...(birthYear && s.birthYear == null ? { birthYear } : {}) });
  void saveAgreedTerms();
}

/** Record an agreement made on this device in the account, if one is waiting. Quiet: it tries again next time. */
export async function saveAgreedTerms(): Promise<void> {
  if (session()?.termsPending !== TERMS_VERSION) return;
  try { await acceptTerms(); } catch { /* next start */ }
}

/** Record the agreement in the account now (a new account, at sign-up; and saveAgreedTerms). */
export async function acceptTerms(): Promise<void> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me/terms`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: TERMS_VERSION, ...(session()?.birthYear ? { birthYear: session()!.birthYear } : {}) }),
  }, true);
  if (!r.ok) throw await failed(r, 'Couldn’t save that. Please try again.');
  const s = session();
  if (s) saveSession({ ...s, terms: TERMS_VERSION, termsPending: undefined });
}

export async function chooseAvatar(id: string): Promise<void> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me/avatar`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  }, true);
  if (!r.ok) throw new AuthError('avatar', (await r.json().catch(() => ({}))).message ?? 'Couldn’t change your Pawtrait.');
  const s = session();
  if (s) saveSession({ ...s, avatar: id });
}

// ── Talking to Entra through the pass-through ────────────────────────────────────────────────────

/**
 * Entra calls that can safely happen twice: starting a sign-in or sign-up (nothing is sent until the challenge) and
 * refreshing a token. A challenge emails a code, and a code or continuation token is used up, so those never are.
 */
function safeToRepeat(path: string, fields: Record<string, string>): boolean {
  return path === 'oauth2/v2.0/initiate' || path === 'signup/v1.0/start'
    || (path === 'oauth2/v2.0/token' && fields.grant_type === 'refresh_token');
}

async function entraPost(path: string, fields: Record<string, string>): Promise<Record<string, any>> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, ...fields });
  const r = await request(`${ID_SERVICE}/auth/${path}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, safeToRepeat(path, fields));
  const json = await r.json().catch(() => ({}));
  if (r.ok && json.challenge_type !== 'redirect') return json;
  throw Object.assign(toError(r.status, json), { detail: json.error_description });
}

/**
 * When the current tap in a sign-in window must be done by (ms since epoch; 0: no tap). Signing up makes three or
 * four calls in a row; each has its own limit, but together they could keep the button busy for a minute.
 */
let tapDeadline = 0;
const TAP_MS = 28_000;

/** Run one tap's calls (a sign-in window's button) within TAP_MS in all. */
export async function oneTap<T>(run: () => Promise<T>): Promise<T> {
  tapDeadline = Date.now() + TAP_MS;
  try { return await run(); } finally { tapDeadline = 0; }
}

/**
 * Every call to the account service. Never waits for ever (a stuck request left a greyed-out button and "Loading…"
 * with no way out), and a call that's safe to repeat (`retry`) is tried again after a dropped connection or a busy
 * service (net.ts).
 */
async function request(url: string, init: RequestInit, retry: boolean): Promise<Response> {
  try { return await fetchRetry(url, init, retry ? SAFE_RETRY : NO_RETRY, tapDeadline); } catch (e) {
    if (e instanceof NetError && e.kind === 'timeout')
      throw new AuthError('timeout', 'Via Mochi isn’t answering right now. Please try again in a minute.');
    throw new AuthError('network', 'You seem to be offline. Check your connection and try again.');
  }
}

/**
 * The account service's own errors whose description is written for players (2026-09-26): "We've sent several codes
 * to this address…" (429), and Entra or the service being down for a while (503).
 */
const OUR_WORDS = new Set(['too_many_codes', 'entra_unavailable', 'unavailable']);

/** A failed answer from the account service, in the service's own words when it has them. */
async function failed(r: Response, fallback: string, code = 'failed'): Promise<AuthError> {
  return failedWith(r.status, await r.json().catch(() => ({})), fallback, code);
}

function failedWith(status: number, json: Record<string, any>, fallback: string, code = 'failed'): AuthError {
  if (json.error_description && OUR_WORDS.has(json.error)) return new AuthError(json.error, json.error_description);
  if (status === 429) return new AuthError('too_many', 'Too many tries. Wait a few minutes, then try again.');
  if (status >= 500) return new AuthError('down', 'Via Mochi isn’t answering right now. Please try again in a minute.');
  return new AuthError(code, fallback);
}

/** Entra's errors, in words a player understands. */
function toError(status: number, json: Record<string, any>): AuthError {
  const error: string = json.error ?? (status === 429 ? 'too_many' : 'unknown');
  const sub: string = json.suberror ?? '';
  if (json.challenge_type === 'redirect') return new AuthError('redirect', 'This account can’t sign in here yet.');
  if (error === 'invite_required') return new AuthError('invite_required', json.error_description ?? 'Please enter your invite code.');
  if (json.error_description && OUR_WORDS.has(error)) return new AuthError(error, json.error_description);
  if (status === 429) return new AuthError('too_many', 'Too many tries. Wait a few minutes, then try again.');
  if (status === 502 || status === 503 || status === 504)
    return new AuthError('down', 'Via Mochi isn’t answering right now. Please try again in a minute.');
  if (sub === 'invalid_oob_value') return new AuthError('wrong_code', 'That code doesn’t match. Check the latest email and try again.');
  if (error === 'expired_token') return new AuthError('expired', 'That code has expired. Send a new one.');
  if (error === 'user_not_found') return new AuthError('user_not_found', 'There’s no account with that email.');
  if (error === 'user_already_exists') return new AuthError('user_already_exists', 'There’s already an account with that email. Sign in instead.');
  if (error === 'invalid_request' && /username/i.test(json.error_description ?? '')) return new AuthError('bad_email', 'That doesn’t look like an email address.');
  return new AuthError(error, 'Something went wrong signing in. Please try again.');
}
