// Talking to the Studio's API (apps/api/src/studio/studio.ts). Signed in with the Via Mochi account (src/auth.ts);
// in development with `?dev`, with a pretend account against the local API (npm run studio:dev -w @fruitcats/api).

import { token } from '../auth';

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
  pictures: Record<string, { state: string; stateAt?: string; stateBy?: string; versions: Version[] }>;
  comments: Comment[];
  suggestions: Suggestion[];
  milestones: Record<string, boolean>;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

// ── Development accounts ─────────────────────────────────────────────────────────────────────────

export const DEV_ACCOUNTS: [string, string][] = [['owner', 'Krzysztof (reviewer)'], ['basil', 'Basil (artist)'], ['newcomer', 'Newcomer (not invited)']];

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
  return t ? `Bearer ${t}` : null;
}

async function call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const auth = await authorization();
  if (!auth) throw new ApiError(401, 'signed_out');
  let res: Response;
  try {
    res = await fetch(`${API}/v1/studio/${path}`, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers: { Authorization: auth, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      cache: 'no-store',
    });
  } catch {
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
export const comment = (set: string, key: string, body: { text: string; version?: string; pin?: { x: number; y: number }; replyTo?: string }) =>
  call<Comment>(`${set}/pictures/${key}/comments`, { json: body });
export const markDone = (set: string, id: string, done: boolean) => call<Comment>(`${set}/comments/${id}`, { json: { done } });
export const review = (set: string, key: string, state: string) => call(`${set}/pictures/${key}/review`, { json: { state } });
export const openStep = (set: string, id: string, open: boolean) => call(`${set}/milestones/${id}`, { json: { open } });
export const suggest = (set: string, body: { picture: string; field: string; value: string; why: string }) =>
  call<Suggestion>(`${set}/suggestions`, { json: body });
export const decide = (set: string, id: string, state: string, reply = '') => call<Suggestion>(`${set}/suggestions/${id}`, { json: { state, reply } });
export const artists = (set: string) => call<{
  artists: { id: string; name: string; email?: string; joined: string }[];
  invites: { code: string; url: string; note: string; expires: string }[];
}>(`${set}/artists`);
export const addArtist = (set: string, email: string) => call<{ id: string; name: string; email: string }>(`${set}/artists`, { json: { email } });
export const invite = (set: string, note: string) => call<{ code: string; url: string; expires: string }>(`${set}/invites`, { json: { note } });
export const removeArtist = (set: string, id: string) => call(`${set}/artists/${id}`, { method: 'DELETE' });

/** Upload a picture, reporting progress from 0 to 1. Resolves once the server has stored and checked it. */
export async function upload(set: string, key: string, file: File, kind: 'sketch' | 'final', note: string,
  progress: (fraction: number) => void): Promise<Version> {
  const auth = await authorization();
  if (!auth) throw new ApiError(401, 'signed_out');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/v1/studio/${set}/pictures/${key}?kind=${kind}&note=${encodeURIComponent(note)}`);
    xhr.setRequestHeader('Authorization', auth);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress(e.loaded / e.total); };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 201) resolve(body as unknown as Version);
      else reject(new ApiError(xhr.status, body.error ?? 'server'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'offline'));
    xhr.send(file);
  });
}

/** A stored version as a local address for <img>. Versions never change, so each is fetched once. */
const images = new Map<string, Promise<string>>();
export function imageUrl(set: string, key: string, version: string): Promise<string> {
  const id = `${set}/${key}/${version}`;
  let url = images.get(id);
  if (!url) {
    url = (async () => {
      const auth = await authorization();
      const res = await fetch(`${API}/v1/studio/${set}/pictures/${key}/${version}`, { headers: auth ? { Authorization: auth } : {} });
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
  return words[code] ?? 'Something went wrong. Please try again.';
}
