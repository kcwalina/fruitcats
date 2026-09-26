// Talking to the Studio's API (apps/api/src/studio/studio.ts). Signed in with the Via Mochi account (src/auth.ts);
// in development with `?dev`, with a pretend account against the local API (npm run studio:dev -w @fruitcats/api).

import { refreshAccount, session, token } from '../auth';
import { apiPolicy, fetchRetry } from '../net';

export const DEV = import.meta.env.DEV && new URLSearchParams(location.search).has('dev');
const API = DEV ? 'http://localhost:8787' : 'https://api.fruitcats.viamochi.com';
const DEV_USER = 'studio-dev-user';

export interface Me { id: string | null; name: string; role: 'owner' | 'artist' | 'agent'; sets: string[] | '*'; terms?: string | null }

export interface Version {
  id: string;
  kind: 'sketch' | 'final';
  format: 'webp' | 'png' | 'jpeg';
  width: number;
  height: number;
  bytes: number;
  byName: string;
  at: string;
  note?: string;
}

export interface Comment {
  id: string;
  picture: string;
  text: string;
  at: string;
  author: 'owner' | 'artist' | 'ai';
  authorName: string;
  version?: string;
  pinX?: number;
  pinY?: number;
  replyTo?: string;
  done: boolean;
  doneBy?: string;
}

export interface Suggestion {
  id: string;
  picture: string;
  field: string;
  value: string;
  why?: string;
  state: 'open' | 'accepted' | 'declined';
  reply?: string;
  at: string;
  byName: string;
}

export interface SetView {
  role: 'owner' | 'artist' | 'agent';
  /** The signed-in account is this project's artist (a reviewer can be one too, e.g. to practise). */
  artist?: boolean;
  set: string;
  pictures: Record<string, { state: string; stateAt?: string; stateBy?: string; frame?: string; versions: Version[] }>;
  comments: Comment[];
  suggestions: Suggestion[];
  milestones: Record<string, boolean>;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

// ── Development accounts ─────────────────────────────────────────────────────────────────────────

export const DEV_ACCOUNTS: [string, string][] = [['owner', 'Reviewer (owner)'], ['basil', 'Basil (artist)'], ['newcomer', 'Newcomer (not invited)']];

export function devUser(): string | null {
  try { return localStorage.getItem(DEV_USER); } catch { return null; }
}
export function setDevUser(id: string | null) {
  try { if (id) localStorage.setItem(DEV_USER, id); else localStorage.removeItem(DEV_USER); } catch { /* the session only */ }
}

async function authorization(): Promise<string | null> {
  if (DEV) {
    const id = devUser();
    const name = DEV_ACCOUNTS.find(([x]) => x === id)?.[1].replace(/ \(.*\)$/, '') ?? id;
    return id ? `Dev ${id}:${name}` : null;
  }
  const t = await token();
  if (t) return `Bearer ${t}`;
  // Still signed in, but no fresh token could be had: the account service is down or restarting. That's "can't reach
  // it right now", never "signed out" (which sent artists back to the sign-in page mid-work).
  if (session()) throw new ApiError(0, 'offline');
  return null;
}

async function call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  let auth = await authorization();
  if (!auth) throw new ApiError(401, 'signed_out');
  let res: Response;
  const method = init.method ?? (init.json !== undefined ? 'POST' : 'GET');
  // Never waits for ever (net.ts): a request stuck while the API restarts would leave every button waiting behind it.
  const send = (authorization: string) => fetchRetry(`${API}/v1/studio/${path}`, {
    method,
    headers: { Authorization: authorization, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  }, apiPolicy(method));
  try {
    res = await send(auth);
    // Turned away: the token may be older than this device thought. A fresh one, and one more try.
    if (res.status === 401 && !DEV && await refreshAccount() && (auth = await authorization())) res = await send(auth);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? 'server');
  return body as T;
}

export const me = () => call<Me>('me');
export const acceptTerms = (version: string) => call<{ terms: string }>('terms', { json: { version, adult: true } });
export const acceptInvite = (code: string) => call<{ set: string }>(`invites/${encodeURIComponent(code)}`, { json: {} });
export const setView = (set: string) => call<SetView>(set);
/**
 * A comment or suggestion sent again after it failed (no answer in time, the server restarting) carries the same request
 * id as the first try, so the server adds it once however many times it arrives. A new one gets a new id.
 */
const requestIds = new Map<string, string>();
async function sendOnce<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const what = JSON.stringify([path, body]);
  const requestId = requestIds.get(what) ?? [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  requestIds.set(what, requestId);
  const answer = await call<T>(path, { json: { ...body, requestId } });
  requestIds.delete(what);
  return answer;
}

export const comment = (set: string, key: string, body: { text: string; version?: string; pin?: { x: number; y: number }; replyTo?: string }) =>
  sendOnce<Comment>(`${set}/pictures/${key}/comments`, body);
export const markDone = (set: string, id: string, done: boolean) => call<Comment>(`${set}/comments/${id}`, { json: { done } });
export const setFrame = (set: string, key: string, palette: string) => call<{ palette: string }>(`${set}/pictures/${key}/frame`, { json: { palette } });
export const review = (set: string, key: string, state: string) => call(`${set}/pictures/${key}/review`, { json: { state } });
export const openStep = (set: string, id: string, open: boolean) => call(`${set}/milestones/${id}`, { json: { open } });
export const suggest = (set: string, body: { picture: string; field: string; value: string; why: string }) =>
  sendOnce<Suggestion>(`${set}/suggestions`, body);
export const decide = (set: string, id: string, state: string, reply = '') => call<Suggestion>(`${set}/suggestions/${id}`, { json: { state, reply } });
export const artists = (set: string) => call<{
  artists: { id: string; name: string; email?: string; joined: string }[];
  invites: { code: string; url: string; note: string; expires: string }[];
}>(`${set}/artists`);
export const addArtist = (set: string, email: string) => call<{ id: string; name: string; email: string }>(`${set}/artists`, { json: { email } });
export const invite = (set: string, note: string) => call<{ code: string; url: string; expires: string }>(`${set}/invites`, { json: { note } });
export const removeArtist = (set: string, id: string) => call(`${set}/artists/${id}`, { method: 'DELETE' });

const UPLOAD_STALL_MS = 45_000;

/** Upload a picture, reporting progress from 0 to 1. Resolves once the server has stored and checked it. */
export async function upload(set: string, key: string, file: File, kind: 'sketch' | 'final' | 'frame', note: string,
  progress: (fraction: number) => void): Promise<Version> {
  const auth = await authorization();
  if (!auth) throw new ApiError(401, 'signed_out');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/v1/studio/${set}/pictures/${key}?kind=${kind}&note=${encodeURIComponent(note)}`);
    xhr.setRequestHeader('Authorization', auth);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    // A connection that dies mid-upload can leave the bar still for ever: with nothing sent for 45 seconds (and no
    // answer), it's given up on and the artist can try again.
    let stalled = 0;
    const watch = () => {
      window.clearTimeout(stalled);
      stalled = window.setTimeout(() => { xhr.abort(); reject(new ApiError(0, 'stalled')); }, UPLOAD_STALL_MS);
    };
    xhr.upload.onprogress = (e) => { watch(); if (e.lengthComputable) progress(e.loaded / e.total); };
    // All sent, now the server stores and checks it: that's quick, but still not waited on for ever.
    xhr.upload.onload = watch;
    xhr.onloadend = () => window.clearTimeout(stalled);
    xhr.onload = () => {
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 201) resolve(body as unknown as Version);
      else reject(new ApiError(xhr.status, body.error ?? 'server'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'offline'));
    xhr.send(file);
    watch();
  });
}

/** A final can be 30 MB: on a slow connection that takes minutes, so each attempt gets three. */
const IMAGE_POLICY = { ...apiPolicy('GET'), attemptMs: 180_000, budgetMs: 370_000 };

/** A stored version as a local address for <img>. Versions never change, so each is fetched once. */
const images = new Map<string, Promise<string>>();
export function imageUrl(set: string, key: string, version: string): Promise<string> {
  const id = `${set}/${key}/${version}`;
  let url = images.get(id);
  if (!url) {
    url = (async () => {
      const auth = await authorization();
      const res = await fetchRetry(`${API}/v1/studio/${set}/pictures/${key}/${version}`, { headers: auth ? { Authorization: auth } : {} }, IMAGE_POLICY);
      if (!res.ok) throw new ApiError(res.status, 'image');
      return URL.createObjectURL(await res.blob());
    })();
    url.catch(() => images.delete(id));
    images.set(id, url);
  }
  return url;
}

/** Plain words for an error. */
export function explain(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  const words: Record<string, string> = {
    offline: 'Can’t reach the Studio. Check your connection and try again.',
    try_again: 'The Studio’s server isn’t answering right now (it may be restarting). Please try again in a minute: nothing was lost.',
    stalled: 'Upload stalled: try again.',
    signed_out: 'You’re signed out. Please sign in again.',
    not_invited: 'This account isn’t invited to this set yet.',
    invite_not_found: 'That invite link has expired or doesn’t exist. Please ask us for a new one.',
    invite_used: 'That invite link was already used by another account. Please ask us for a new one.',
    not_a_picture: 'That file isn’t an image the Studio can read. Please send WebP, PNG or JPEG.',
    too_large: 'That file is too big (more than 30 MB).',
    bad_size: 'That image’s size can’t be right. Please check it.',
    not_stored: 'The upload didn’t arrive intact. Please try again: nothing was lost.',
    owner_only: 'Only a reviewer can do that.',
    adults_only: 'The Studio is for adults: please confirm you’re 18 or older.',
    terms: 'Please accept the Studio’s terms first.',
    no_account: 'No game account uses that email. Check the spelling, or ask them to create an account in the game first.',
    bad_email: 'That doesn’t look like an email address.',
  };
  // Any other 5xx is the server having a moment, not the artist doing something wrong.
  if (!words[code] && e instanceof ApiError && e.status >= 500) return words.try_again;
  return words[code] ?? 'Something went wrong. Please try again.';
}
