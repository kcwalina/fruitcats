// Via Mochi sign-in (docs/accounts.md). The only module that knows about Microsoft Entra: the game asks it to
// start with an email, check a code, and hand out a token; nothing else changes if Entra is ever replaced.
//
// Entra's "native authentication" API sends the one-time codes. Browsers can't call it directly, so every call goes
// through viamochi-id's /auth pass-through. The Entra token is then swapped at viamochi-id for our own Via Mochi
// token, which is what our APIs accept.

import { API } from './api';

// viamochi-id accepts calls from the game's sites and from a dev server on port 5173 only. A dev server on another port
// (a second checkout running side by side) goes through its own /__id proxy instead (vite.config.ts).
const ID_SERVICE = import.meta.env.DEV && location.port !== '5173' ? `${location.origin}/__id` : 'https://id.viamochi.com';
const CLIENT_ID = '1ed2eaf3-3330-4328-9ca3-1519f681b6a2';
const SCOPE = `openid offline_access api://${CLIENT_ID}/play`;
const BIRTH_YEAR = 'extension_6758f33d2f4d4c119a640bcbadfe8dc5_BirthYear';
const SESSION_KEY = 'viamochi-session';
/** The Terms of Use version a new account accepts (docs/legal/terms-of-use.md). */
/** How long any call to the account service may take before the game gives up and says so. */
const REQUEST_TIMEOUT_MS = 15_000;
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
}

/** Where a sign-in stands between the email and the code. Kept only in memory. */
export interface Pending {
  flow: 'signIn' | 'signUp';
  email: string;
  continuationToken: string;
  /** "k•••@m•••.com": where the code went, as Entra shows it. */
  sentTo: string;
  codeLength: number;
}

export class AuthError extends Error {
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

/** A Via Mochi token for our APIs, refreshed quietly when it's about to expire. Null when signed out. */
export async function token(): Promise<string | null> {
  const s = session();
  if (!s) return null;
  if (s.expires - Date.now() > 60_000) return s.token;
  try {
    const entra = await entraPost('oauth2/v2.0/token', { grant_type: 'refresh_token', refresh_token: s.refreshToken, scope: SCOPE });
    return (await finish(entra, s.email)).token;
  } catch (e) {
    // Only Entra rejecting the refresh token signs the player out. Being offline, or our service being down or slow,
    // doesn't: they're still signed in once it's back.
    if (e instanceof AuthError && (e.code === 'invalid_grant' || e.code === 'expired')) signOut();
    return null;
  }
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
    await entraPost('oauth2/v2.0/initiate', { username: email, challenge_type: 'oob redirect' });
    return true;
  } catch (e) {
    if (e instanceof AuthError && e.code === 'user_not_found') return false;
    throw e;
  }
}

/** Existing account: email the code. */
export async function startSignIn(email: string): Promise<Pending> {
  const started = await entraPost('oauth2/v2.0/initiate', { username: email, challenge_type: 'oob redirect' });
  return challenge('signIn', email, 'oauth2/v2.0/challenge', started.continuation_token);
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
  });
  return r.status === 403;
}

/** Check an invite code, and use it for the account about to be created. */
export async function useInvite(code: string): Promise<void> {
  const r = await request(`${ID_SERVICE}/invites/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw toError(r.status, json);
  inviteCode = code.trim();
}

/** New account: its details go in first, then the code confirms the email. */
export async function startSignUp(email: string, displayName: string, birthYear: number): Promise<Pending> {
  const started = await entraPost('signup/v1.0/start', {
    username: email, challenge_type: 'oob redirect', invite_code: inviteCode,
    attributes: JSON.stringify({ displayName, [BIRTH_YEAR]: String(birthYear) }),
  });
  return challenge('signUp', email, 'signup/v1.0/challenge', started.continuation_token);
}

/** Send the code again. */
export function resend(p: Pending): Promise<Pending> {
  return challenge(p.flow, p.email, p.flow === 'signIn' ? 'oauth2/v2.0/challenge' : 'signup/v1.0/challenge', p.continuationToken);
}

/** Check the code; on success this device is signed in. */
export async function submitCode(p: Pending, code: string): Promise<Session> {
  if (p.flow === 'signIn') {
    const entra = await entraPost('oauth2/v2.0/token', { continuation_token: p.continuationToken, grant_type: 'oob', oob: code, scope: SCOPE });
    return finish(entra, p.email);
  }
  const confirmed = await entraPost('signup/v1.0/continue', { continuation_token: p.continuationToken, grant_type: 'oob', oob: code });
  const entra = await entraPost('oauth2/v2.0/token', {
    continuation_token: confirmed.continuation_token, grant_type: 'continuation_token', username: p.email, scope: SCOPE,
  });
  return finish(entra, p.email);
}

async function challenge(flow: Pending['flow'], email: string, path: string, continuationToken: string): Promise<Pending> {
  const r = await entraPost(path, { continuation_token: continuationToken, challenge_type: 'oob redirect' });
  if (r.challenge_type !== 'oob') throw new AuthError('redirect', 'This account can’t sign in here yet.');
  return { flow, email, continuationToken: r.continuation_token, sentTo: r.challenge_target_label ?? email, codeLength: r.code_length ?? 8 };
}

/** Swap Entra's token for ours and remember the session. */
async function finish(entra: Record<string, any>, email: string): Promise<Session> {
  const r = await request(`${ID_SERVICE}/token`, {
    method: 'POST', headers: { Authorization: `Bearer ${entra.access_token}`, ...(inviteCode ? { 'X-Invite-Code': inviteCode } : {}) },
  });
  if (r.status === 403) throw toError(403, await r.json().catch(() => ({})));
  if (!r.ok) throw new AuthError('exchange', 'Signed in, but Via Mochi couldn’t open your account. Please try again.');
  const ours = await r.json();
  restoredOnSignIn = !!ours.restored;
  const s: Session = {
    userId: ours.user.id, displayName: ours.user.displayName ?? '', email,
    refreshToken: entra.refresh_token, token: ours.access_token, expires: Date.now() + ours.expires_in * 1000,
    signedInAt: session()?.signedInAt ?? Date.now(),
    avatar: ours.user.avatar,
    terms: ours.user.terms ?? null,
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
    const r = await request(url, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) throw new AuthError('export', 'Couldn’t gather your data. Please try again.');
    return r.json();
  };
  const [account, fruitcats] = await Promise.all([get(`${ID_SERVICE}/me/export`), get(`${API}/v1/export`)]);
  return JSON.stringify({ exported: new Date().toISOString(), viaMochiAccount: account, fruitcats }, null, 2);
}

/** Schedule this account's deletion (30 days; signing in again before then cancels it). Returns the date. */
export async function deleteAccount(): Promise<Date> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new AuthError('delete', 'Couldn’t delete your account. Please try again.');
  return new Date((await r.json()).deleteAfter);
}

// ── Friends ─────────────────────────────────────────────────────────────────────────────────────

export interface Friend { id: string; displayName: string | null; avatar: string; since: string }

async function withToken(path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  if (!t) throw noToken();
  return request(`${ID_SERVICE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
}

export async function listFriends(): Promise<Friend[]> {
  const r = await withToken('/friends');
  if (!r.ok) throw new AuthError('friends', 'Couldn’t load your friends. Please try again.');
  return (await r.json()).friends;
}

/** A new friend code to give someone: "K7M-4Q2", good for 15 minutes and one use. */
export async function newFriendCode(): Promise<{ code: string; expires: string }> {
  const r = await withToken('/friends/code', { method: 'POST' });
  if (!r.ok) throw new AuthError('friends', 'Couldn’t make a code. Please try again.');
  return r.json();
}

export async function redeemFriendCode(code: string): Promise<Friend> {
  const r = await withToken('/friends/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError('friend_code', json.message ?? 'That code didn’t work.');
  return json.friend;
}

export async function removeFriend(id: string, block = false): Promise<void> {
  const r = await withToken(block ? `/friends/${id}/block` : `/friends/${id}`, { method: block ? 'POST' : 'DELETE' });
  if (!r.ok) throw new AuthError('friends', 'Couldn’t do that. Please try again.');
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
  const r = await request(`${ID_SERVICE}/avatars`, {});
  if (!r.ok) throw new AuthError('avatars', 'Couldn’t load the Pawtraits. Please try again.');
  return (catalog = await r.json());
}

/** The avatars this account may wear, and the one it wears. Also refreshes the session's copy. */
export async function myAvatars(): Promise<{ avatar: string; owned: Set<string> }> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new AuthError('me', 'Couldn’t load your account. Please try again.');
  const me = await r.json();
  const s = session();
  if (s && s.avatar !== me.avatar) saveSession({ ...s, avatar: me.avatar });
  return { avatar: me.avatar, owned: new Set<string>(me.avatars) };
}

/** Wear an avatar. */
/** "Contact us": emailed to the team, answered by email (the account's, or `email` when signed out). */
export async function sendSupport(message: string, email: string): Promise<void> {
  const t = session() ? await token() : null;
  const r = await request(`${ID_SERVICE}/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ message, email, app: 'Fruitcats', device: navigator.userAgent }),
  });
  if (r.status === 429) throw new AuthError('too_many', 'You’ve sent a few messages already. Please wait an hour, or reply to our email.');
  if (!r.ok) throw new AuthError('support', (await r.json().catch(() => ({}))).message ?? 'Your message couldn’t be sent. Please try again.');
}

/** Has this account still to agree to the current Terms of Use and Privacy Policy? */
export function needsTerms(): boolean {
  const s = session();
  return !!s && s.terms !== TERMS_VERSION;
}

/** The player agreed to the current Terms of Use and Privacy Policy: recorded in their account. */
export async function acceptTerms(): Promise<void> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me/terms`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: TERMS_VERSION }),
  });
  if (!r.ok) throw new AuthError('terms', 'Couldn’t save that. Please try again.');
  const s = session();
  if (s) saveSession({ ...s, terms: TERMS_VERSION });
}

export async function chooseAvatar(id: string): Promise<void> {
  const t = await token();
  if (!t) throw noToken();
  const r = await request(`${ID_SERVICE}/me/avatar`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  });
  if (!r.ok) throw new AuthError('avatar', (await r.json().catch(() => ({}))).message ?? 'Couldn’t change your Pawtrait.');
  const s = session();
  if (s) saveSession({ ...s, avatar: id });
}

// ── Talking to Entra through the pass-through ────────────────────────────────────────────────────

async function entraPost(path: string, fields: Record<string, string>): Promise<Record<string, any>> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, ...fields });
  const r = await request(`${ID_SERVICE}/auth/${path}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const json = await r.json().catch(() => ({}));
  if (r.ok && json.challenge_type !== 'redirect') return json;
  throw toError(r.status, json);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  // Never wait for ever: a stuck request leaves a greyed-out button and "Loading…" with no way out.
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new AuthError('timeout', 'Via Mochi isn’t answering right now. Please try again in a minute.');
    throw new AuthError('network', 'You seem to be offline. Check your connection and try again.');
  }
}

/** Entra's errors, in words a player understands. */
function toError(status: number, json: Record<string, any>): AuthError {
  const error: string = json.error ?? (status === 429 ? 'too_many' : 'unknown');
  const sub: string = json.suberror ?? '';
  if (json.challenge_type === 'redirect') return new AuthError('redirect', 'This account can’t sign in here yet.');
  if (error === 'invite_required') return new AuthError('invite_required', json.error_description ?? 'Please enter your invite code.');
  if (status === 429) return new AuthError('too_many', 'Too many tries. Wait a few minutes, then try again.');
  if (sub === 'invalid_oob_value') return new AuthError('wrong_code', 'That code doesn’t match. Check the latest email and try again.');
  if (error === 'expired_token') return new AuthError('expired', 'That code has expired. Send a new one.');
  if (error === 'user_not_found') return new AuthError('user_not_found', 'There’s no account with that email.');
  if (error === 'user_already_exists') return new AuthError('user_already_exists', 'There’s already an account with that email. Sign in instead.');
  if (error === 'invalid_request' && /username/i.test(json.error_description ?? '')) return new AuthError('bad_email', 'That doesn’t look like an email address.');
  return new AuthError(error, 'Something went wrong signing in. Please try again.');
}
