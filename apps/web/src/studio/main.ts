// The Artist Studio (docs/artist-studio-plan.md): where artists upload the pictures they make for Fruitcats. For each set it shows the steps
// in order (the brief's milestones), what each picture needs, and the artist's pictures on their cards, in the game
// and as wallpapers. Artists upload each version; nothing is ever overwritten. Comments from the Fruitcats team,
// from AI agents and from the artist sit beside each picture, each labelled with who wrote it.
//
// Pages (in the address's #): a project's home (#/bp1; for a reviewer it also assigns the artist), a picture
// (#/bp1/BP1-X01), and the list of projects (#/). One render() draws the page from `S`; clicks and typing are handled by
// data-click and data-in attributes, as in the game.

import '../content';
import { registerSet, type SetData } from '@fruitcats/engine';
import { session, signOut } from '../auth';
import { BASE, esc } from '../ui';
import * as api from './api';
import { DEV, devUser, setDevUser, type Comment, type Me, type SetView, type Suggestion, type Version } from './api';
import {
  FIELD_NAMES, STATE_NAMES, TIER_NAMES, keyOf, nextAction, nextPicture, overall, sketchFirst, stateOf, steps, versionsOf,
  type Brief, type BriefPicture, type State,
} from './brief';
import { DEVICES, LOCK_CLOCK, announcementPreview, cardPreview, finishesOf, gamePreview, pawtraitPreview, wallpaper } from './previews';
import { renderSignIn, signInClick, signInEnter, signInInput } from './signin';
import './studio.css';

interface SetEntry { set: string; code: string; name: string; status: string; folder: string }
interface LocalPicture { url: string; file: File; width: number; height: number; format: string }
type Tab = 'card' | 'picture' | 'game' | 'wallpaper';
type Route = { page: 'sets' } | { page: 'home'; code: string } | { page: 'all'; code: string } | { page: 'picture'; code: string; key: string };

const S = {
  route: { page: 'sets' } as Route,
  /** Signed in and known to the Studio; null while signed out, or when looking around without an account. */
  me: null as Me | null,
  guest: false,
  booting: true,
  fatal: '',
  invite: new URLSearchParams(location.search).get('invite'),
  sets: [] as SetEntry[],
  briefs: new Map<string, Brief>(),
  views: new Map<string, SetView>(),
  /** Pictures chosen on this computer and not uploaded (yet), by picture key. */
  local: new Map<string, LocalPicture>(),
  /** Which version each picture's previews show (default: the newest). */
  chosen: new Map<string, string>(),
  images: new Map<string, string>(),
  tab: 'card' as Tab,
  finish: new Map<string, string>(),
  // The picture page's forms.
  uploadKind: 'sketch' as 'sketch' | 'final',
  uploadNote: '',
  uploading: null as null | { key: string; fraction: number },
  uploadError: '',
  draft: new Map<string, string>(),
  replyTo: null as string | null,
  pinning: false,
  pin: null as null | { x: number; y: number },
  showDone: false,
  suggesting: null as null | { field: string; value: string; why: string },
  toast: '',
  // The owner's artists page.
  roster: null as Awaited<ReturnType<typeof api.artists>> | null,
  inviteNote: '',
  newInvite: '',
  busy: false,
  error: '',
  /** Signed in, but the Studio's server didn't answer. */
  unreachable: false,
  assignEmail: '',
  /** The picture just sent, for the wizard's “sent” line. */
  justSent: '',
  assignError: '',
  /** A reviewer looking at a project the way its artist sees it (to try the Studio, or to check what they see). */
  asArtist: false,
  /** A reviewer's choice per project: see it as the artist, or review it. */
  reviewMode: new Map<string, 'artist' | 'review'>(),
};

/** Reviewing: signed in as a reviewer, and not looking through the artist's eyes. */
const reviewing = () => S.me?.role === 'owner' && !S.asArtist;

/** On opening a project: a reviewer who is its artist sees it as the artist, unless they chose to review it. */
function chooseMode(code: string) {
  if (S.me?.role !== 'owner') { S.asArtist = false; return; }
  S.asArtist = S.reviewMode.get(code) === 'artist' || (!S.reviewMode.has(code) && !!S.views.get(code)?.artist);
}

const root = document.getElementById('studio')!;

// ── Starting up ──────────────────────────────────────────────────────────────────────────────────

const signedIn = () => (DEV ? devUser() !== null : session() !== null);

function parseRoute(): Route {
  const [code, key] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!code) return { page: 'sets' };
  if (key === 'artists') return { page: 'home', code };
  if (key === 'all') return { page: 'all', code };
  if (key) return { page: 'picture', code, key };
  return { page: 'home', code };
}

function go(hash: string) {
  if (location.hash === hash) { void onRoute(); return; }
  location.hash = hash;
}

async function boot() {
  S.booting = true;
  render();
  try {
    const index = await fetch(`${BASE}studio/index.json`, { cache: 'no-cache' }).then((r) => r.json()) as { sets: SetEntry[] };
    S.sets = index.sets;
  } catch {
    S.fatal = 'The Studio couldn’t load. Please reload the page.';
  }
  if (signedIn()) await enter();
  S.booting = false;
  await onRoute();
}

/** Signed in: who am I to the Studio, and accept an invite if the link had one. */
async function enter() {
  try {
    if (S.invite) {
      const { set } = await api.acceptInvite(S.invite);
      S.invite = null;
      history.replaceState(null, '', `${location.pathname}${DEV ? '?dev' : ''}#/${set}`);
    }
    S.me = await api.me();
    S.error = '';
    S.unreachable = false;
  } catch (e) {
    S.error = api.explain(e);
    // Signed in, but the Studio's server didn't answer: say so, rather than showing the sign-in form again.
    S.unreachable = !(e instanceof api.ApiError && e.status === 401);
    S.me = null;
  }
}

async function onRoute() {
  S.route = parseRoute();
  S.justSent = '';
  S.pinning = false; S.pin = null; S.replyTo = null; S.suggesting = null; S.uploadError = ''; S.newInvite = '';
  const mine = visibleSets();
  if (S.route.page === 'sets' && mine.length === 1 && (S.me || S.guest)) { go(`#/${mine[0].code}`); return; }
  if (S.route.page !== 'sets') {
    await loadSet(S.route.code);
    chooseMode(S.route.code);
    if (S.me?.role === 'owner') {
      try { S.roster = await api.artists(S.route.code); } catch (e) { S.error = api.explain(e); }
    }
  }
  render();
  window.scrollTo(0, 0);
}

/** The sets this person may open: an artist's own sets; everything for the owner, agents and guests. */
function visibleSets(): SetEntry[] {
  if (S.guest || S.me?.sets === '*') return S.sets;
  const mine = S.me?.sets ?? [];
  return S.sets.filter((s) => mine.includes(s.code));
}

async function loadSet(code: string) {
  if (!S.briefs.has(code)) {
    try {
      const [brief, data] = await Promise.all([
        fetch(`${BASE}studio/${code}/brief.json`, { cache: 'no-cache' }).then((r) => r.json()) as Promise<Brief>,
        fetch(`${BASE}packs/${code}/set.json`, { cache: 'no-cache' }).then((r) => r.json()) as Promise<SetData>,
      ]);
      try { registerSet(data); } catch { /* the previews that need card data are skipped */ }
      for (const c of [...data.cards, ...(data.tokens ?? [])]) setCards.set(c.id, c as unknown as CardWords);
      S.briefs.set(code, brief);
    } catch {
      return;
    }
  }
  await refresh(code);
}

async function refresh(code: string, quiet = false) {
  if (!S.me) return;
  try {
    const view = await api.setView(code);
    const before = JSON.stringify(S.views.get(code) ?? null);
    S.views.set(code, view);
    if (quiet && before !== JSON.stringify(view)) render();
  } catch (e) {
    if (!quiet) S.error = api.explain(e);
  }
}

// New comments and reviews arrive by themselves while the page is open.
setInterval(() => {
  if (document.hidden || !S.me || S.route.page === 'sets' || S.uploading) return;
  void refresh(S.route.code, true);
}, 20_000);

window.addEventListener('hashchange', () => void onRoute());

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const when = (iso: string) => {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 1 / 1440) return 'just now';
  if (days < 1 / 24) return `${Math.round(days * 1440)} min ago`;
  if (days < 1) return `${Math.round(days * 24)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const kb = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`);

function title(p: BriefPicture): string {
  if (p.kind === 'pawtrait') return `Pawtrait: ${p.file.replace(/^legend-|\.webp$/g, '').replace(/^\w/, (c) => c.toUpperCase())}`;
  if (p.kind === 'announcement') return 'Announcement key art';
  return faceName(p) ?? p.workingName ?? p.file;
}

/** The card's name on this face (a Hero Cat's Kitten and Big Cat are named differently). */
function faceName(p: BriefPicture): string | null {
  const card = cardData(p);
  if (!card) return null;
  const face = p.side === 'kitten' ? card.kitten : p.side === 'bigcat' ? card.bigCat : card;
  return face?.name ?? card.name;
}

/** The words on each card of the loaded sets: names, rules text and flavour. */
interface CardWords { name: string; type: string; text?: string; flavor?: string; kitten?: { name: string; text?: string }; bigCat?: { name: string; text?: string } }
const setCards = new Map<string, CardWords>();
const cardData = (p: BriefPicture) => (p.card ? (setCards.get(p.card) ?? null) : null);

const sideLabel = (p: BriefPicture) => (p.side === 'kitten' ? 'Kitten' : p.side === 'bigcat' ? 'Big Cat' : '');

function stateChip(state: State): string {
  return `<span class="chip state-${state}">${STATE_NAMES[state]}</span>`;
}

const authorLabel = (c: { author: string; authorName: string }) =>
  c.author === 'ai' ? `<span class="who ai" title="Written by an AI assistant">${esc(c.authorName)} <b>AI</b></span>`
    : c.author === 'owner' ? `<span class="who owner">${esc(c.authorName)} <b>Reviewer</b></span>`
      : `<span class="who artist">${esc(c.authorName)} <b>Artist</b></span>`;

function lastSeenKey(code: string) { return `studio-seen-${S.me?.id ?? 'guest'}-${code}`; }
function lastSeen(code: string): string { try { return localStorage.getItem(lastSeenKey(code)) ?? ''; } catch { return ''; } }
function markSeen(code: string) { try { localStorage.setItem(lastSeenKey(code), new Date().toISOString()); } catch { /* fine */ } }

/** Comments by someone else since this person last looked at the set's home. */
function unread(code: string, key?: string): Comment[] {
  const view = S.views.get(code);
  if (!view || !S.me) return [];
  const seen = lastSeen(code);
  const mineKind = S.me.role === 'owner' ? 'owner' : 'artist';
  return view.comments.filter((c) => c.at > seen && c.author !== mineKind && (!key || c.picture === key));
}

// ── Pictures: which one the previews show ────────────────────────────────────────────────────────

/** The picture the previews show for a key: a picture chosen on this computer, or a stored version. */
function shown(code: string, key: string): { url: string | null; version: Version | null; local: LocalPicture | null; loading: boolean } {
  const local = S.local.get(key);
  if (local) return { url: local.url, version: null, local, loading: false };
  const versions = versionsOf(S.views.get(code) ?? null, key);
  if (!versions.length) return { url: null, version: null, local: null, loading: false };
  const id = S.chosen.get(key) ?? versions[versions.length - 1].id;
  const version = versions.find((v) => v.id === id) ?? versions[versions.length - 1];
  return { ...image(code, key, version.id), version, local: null };
}

function image(code: string, key: string, version: string): { url: string | null; loading: boolean } {
  const id = `${code}/${key}/${version}`;
  const url = S.images.get(id);
  if (url) return { url, loading: false };
  api.imageUrl(code, key, version).then((u) => { S.images.set(id, u); render(); }).catch(() => {});
  return { url: null, loading: true };
}

/** Checks on a picture against its brief: size, shape and file type. */
/**
 * What the Studio says about a chosen picture. A sketch may be any size or format: at most a calm note. A finished
 * picture must be exactly the brief's size, as WebP; otherwise it can't be sent (`blocked`), and `fix` says why.
 */
function checks(p: BriefPicture, w: number, h: number, format: string, kind: 'sketch' | 'final'): { notes: string[]; blocked: boolean; fix: string } {
  const [bw, bh] = p.size;
  const exact = w === bw && h === bh;
  const sameShape = Math.abs(w / h - bw / bh) < 0.01;
  if (kind === 'sketch') {
    const notes = [`${w} × ${h} pixels. Any size is fine for a sketch.`];
    if (!sameShape) notes.push(`Its shape differs from the card’s picture (${bw} × ${bh}), so it looks stretched on the card. That’s fine for a sketch.`);
    return { notes, blocked: false, fix: '' };
  }
  const wrong: string[] = [];
  if (!exact) wrong.push(`${bw} × ${bh} pixels (this one is ${w} × ${h})`);
  if (format !== 'webp') wrong.push(`a WebP file (this one is ${format.toUpperCase()})`);
  return wrong.length
    ? { notes: [], blocked: true, fix: `A finished picture must be ${wrong.join(' and ')}. Please export it again and choose it here. Or send this one as a sketch.` }
    : { notes: [`${w} × ${h} pixels, WebP: exactly right.`], blocked: false, fix: '' };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

function render() {
  // Keep the text cursor where it was: the page is redrawn as a whole.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focus = active?.dataset?.in ? { id: active.dataset.in, start: active.selectionStart, end: active.selectionEnd } : null;
  root.innerHTML = page();
  if (focus) {
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-in="${focus.id}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } }
  }
  void fillWallpapers();
}

function page(): string {
  if (S.fatal) return `<main class="empty"><h1>Sorry</h1><p>${esc(S.fatal)}</p></main>`;
  if (S.booting) return `<main class="empty"><div class="spinner"></div></main>`;
  if (!S.me && !S.guest && S.unreachable && signedIn()) {
    return `<main class="empty"><h1>The Studio can’t reach its server</h1>
      <p>You’re signed in, but the Studio’s server didn’t answer just now. It’s usually back within a minute or two. Nothing you sent is lost.</p>
      <p><button class="btn primary" data-click="recheck">Try again</button> <button class="btn ghost" data-click="signout">Sign out</button></p></main>`;
  }
  if (!S.me && !S.guest) {
    return renderSignIn(!!S.invite, S.error) + (S.invite ? '' : `<p class="si-guest"><button class="link" data-click="guest">Look around without signing in</button></p>`);
  }
  const r = S.route;
  const body = r.page === 'sets' ? setsPage() : r.page === 'home' ? (reviewing() ? homePage(r.code) : wizardPage(r.code))
    : r.page === 'all' ? picturesPage(r.code) : reviewing() ? picturePage(r.code, r.key) : wizardPage(r.code, r.key);
  return `${topBar()}${S.error ? `<div class="banner error">${esc(S.error)} <button class="link" data-click="dismiss">Close</button></div>` : ''}
    ${S.guest ? `<div class="banner">You’re looking around without signing in. Pictures you choose stay on this computer. <button class="link" data-click="signin">Sign in</button></div>` : ''}
    ${body}${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

function topBar(): string {
  const r = S.route;
  const set = r.page !== 'sets' ? S.sets.find((s) => s.code === r.code) : null;
  const who = S.me ? esc(S.me.name) : 'Guest';
  const view = set ? S.views.get(set.code) : undefined;
  const switcher = set && S.me?.role === 'owner' ? `<div class="seg top-seg" role="radiogroup" aria-label="How to see this project">
      <button class="${S.asArtist ? 'on' : ''}" data-click="asartist:1" role="radio" aria-checked="${S.asArtist}">${view?.artist ? 'Artist' : 'As the artist'}</button>
      <button class="${S.asArtist ? '' : 'on'}" data-click="asartist:0" role="radio" aria-checked="${!S.asArtist}">Reviewer</button></div>` : '';
  return `<header class="top">
    <a class="brand" href="#/"><img src="${BASE}icons/icon-192.png" alt=""><span>Fruitcats <b>Artist Studio</b></span></a>
    ${set ? `<nav class="crumbs"><a href="#/${set.code}">${esc(set.name)}</a>${r.page === 'picture' ? ` <span>›</span> <span>${esc(pictureTitle(r.code, r.key))}</span>` : ''}</nav>` : '<span></span>'}
    <div class="me">${switcher}
      <a class="btn ghost small" href="${BASE}docs.html" target="_blank" rel="noopener">Guide</a>
      <span class="me-name">${who}</span>
      ${S.me ? '<button class="btn ghost small" data-click="signout">Sign out</button>' : ''}</div>
  </header>`;
}

function pictureTitle(code: string, key: string): string {
  const p = S.briefs.get(code)?.pictures.find((x) => keyOf(x) === key);
  return p ? `${title(p)}${sideLabel(p) ? ` (${sideLabel(p)})` : ''}` : key;
}

/** A project that couldn't load: say so, and offer to try again, rather than spin. */
function notLoaded(): string {
  return `<main class="empty"><h1>This project didn’t load</h1><p>The Studio couldn’t fetch it just now. Nothing you uploaded is affected.</p>
    <p><button class="btn primary" data-click="retry">Try again</button></p></main>`;
}

// ── The list of sets ─────────────────────────────────────────────────────────────────────────────

function setsPage(): string {
  const mine = visibleSets();
  if (!mine.length) {
    return `<main class="empty"><h1>Welcome, ${esc(S.me?.name ?? '')}</h1>
      <p>You’re signed in as <b>${esc(S.me?.name ?? '')}</b>, but no project is assigned to this account yet.
        Once your reviewer assigns one, it opens here whenever you sign in.</p>
      <p><button class="btn" data-click="recheck">Check again</button></p>
      ${S.me?.id ? `<p class="muted small">Your account id, if we ask for it: <code>${esc(S.me.id)}</code></p>` : ''}</main>`;
  }
  return `<main class="sets"><h1>Projects</h1><div class="set-grid">${mine.map((s) => {
    const brief = S.briefs.get(s.code);
    return `<a class="set-tile" href="#/${s.code}"><b>${esc(s.name)}</b><span>${esc(s.set)}${brief ? ` · ${brief.pictures.length} pictures` : ''}</span></a>`;
  }).join('')}</div></main>`;
}

// ── A set's home ─────────────────────────────────────────────────────────────────────────────────

/** A project's home for a reviewer. (An artist's home is the wizard.) */
function homePage(code: string): string {
  const brief = S.briefs.get(code);
  return brief ? reviewerHome(code, brief, S.views.get(code) ?? null) : notLoaded();
}

// ── The artist's wizard: one thing to do at a time ──────────────────────────────────────────────

const welcomeKey = (code: string) => `studio-welcomed-${S.me?.id ?? 'guest'}-${code}`;
function welcomed(code: string): boolean { try { return localStorage.getItem(welcomeKey(code)) === '1'; } catch { return true; } }

/** What an artist sees when they open their project: a welcome the first time, then always the one picture to do now. */
function wizardPage(code: string, chosen?: string): string {
  const brief = S.briefs.get(code);
  if (!brief) return notLoaded();
  const view = S.views.get(code) ?? null;
  const { approved, total } = overall(brief, view);
  const started = brief.pictures.some((x) => versionsOf(view, keyOf(x)).length);
  const banner = S.asArtist && !view?.artist ? `<div class="as-artist">You’re seeing <b>${esc(brief.name)}</b> the way its artist sees it. Switch back with <b>Reviewer</b> at the top.</div>` : '';

  if (!started && !welcomed(code) && !chosen) {
    return `<main class="wizard">${banner}<section class="wz-card wz-welcome">
      <small>${esc(brief.name)}</small>
      <h1>Welcome${S.me?.name ? `, ${esc(S.me.name)}` : ''}!</h1>
      <p class="wz-lead">You’ll make <b>${total} pictures</b> for ${esc(brief.name)}, one at a time.</p>
      <p class="wz-tools"><b>Make your pictures with the tools of your choice</b>, as you always do. This site is only for
        <b>uploading</b> them: you see each one on the real card, and we reply here.</p>
      <ol class="wz-how"><li><b>Read</b> what the picture should show.</li><li><b>Make a sketch</b> in your own tools, and <b>upload</b> it here.</li>
        <li><b>We reply</b> here, with comments on your sketch.</li><li><b>Upload the finished picture.</b></li></ol>
      <p>The Studio always shows you what to do next. Every version you upload is kept safely.</p>
      <button class="btn primary big" data-click="welcome:${code}">Start with the first picture</button>
    </section></main>`;
  }

  const next = nextPicture(brief, view);
  const picked = chosen ? brief.pictures.find((x) => keyOf(x) === chosen) ?? null : null;
  const current = picked ?? next;
  const progress = `<div class="wz-progress"><div class="bar"><i style="width:${total ? Math.round((approved / total) * 100) : 0}%"></i></div>
    <span>${approved} of ${total} pictures done</span></div>`;
  const sent = S.justSent ? `<div class="wz-sent">✓ ${esc(S.justSent)} is sent. We’ll reply on it here.</div>` : '';
  const side = wizardSide(code, brief, view, current, next);

  if (!current) {
    const withUs = brief.pictures.filter((x) => stateOf(view, keyOf(x)) === 'waiting');
    const done = approved === total && total > 0;
    return `<div class="wz-layout">${side}<main class="wizard">${banner}${progress}${sent}<section class="wz-card">
      ${done ? `<h1>Every picture is done</h1><p class="wz-lead">Thank you for your work on ${esc(brief.name)}!</p>`
        : `<h1>That’s everything for now</h1>
          <p class="wz-lead">We’re looking at what you sent. Our replies appear here, and the next picture opens as soon as we approve ${withUs.length === 1 ? 'it' : 'them'}.
            Meanwhile you can open any of your pictures on the left and send a new version.</p>`}
    </section></main></div>`;
  }

  const key = keyOf(current);
  const state = stateOf(view, key);
  const versions = versionsOf(view, key);
  const n = brief.pictures.indexOf(current) + 1;
  const name = `${title(current)}${sideLabel(current) ? ` (${sideLabel(current)})` : ''}`;
  const sketch = sketchFirst(current) && state === 'none';
  const heading = state === 'changes' ? `Upload a new version of ${name}` : state === 'sketch-ok' ? `Upload the finished ${name}`
    : state === 'approved' ? `${name} is approved` : state === 'waiting' ? `${name}: sent for review`
      : sketch ? `Upload a sketch of ${name}` : `Upload ${name}`;
  const lead = state === 'changes' ? 'We asked for a few changes, below. Make them in your own tools, then upload the new version here.'
    : state === 'sketch-ok' ? 'We like your sketch. Finish the picture in your own tools, then upload it here.'
      : state === 'approved' ? 'Done. If you change it later in your own tools, you can upload a new version here: it comes back to us for a look.'
        : state === 'waiting' ? 'We’re looking at it and will reply here. You can upload a new version any time.'
          : sketch ? 'Make a rough sketch in your own tools (the pose, the composition and the main colours), then upload it here. We’ll reply before you finish it.'
            : 'Make it in your own tools, then upload it here: a sketch if you’d like an early opinion, or the finished picture.';
  const asks = (view?.comments ?? []).filter((c) => c.picture === key && !c.done && c.author !== 'artist');
  const pic = shown(code, key);
  const facts = [`${current.size[0]} × ${current.size[1]} pixels`, current.kind === 'pawtrait' ? 'shown as a circle' : '',
    current.signature === 'requested' ? 'please sign it in a corner' : '', current.showcase ? 'showcase art: face visible, heroic pose, dramatic light, lots of detail' : '']
    .filter(Boolean).join(' · ');
  const away = picked && next && keyOf(next) !== key;
  return `<div class="wz-layout">${side}<main class="wizard">${banner}${progress}${sent}
    ${away ? `<div class="wz-away">You’re looking at an earlier picture. <a class="btn primary small" href="#/${code}">Back to your next task</a></div>` : ''}
    <section class="wz-card">
      <small>Picture ${n} of ${total} · ${esc(TIER_NAMES[current.tier])}</small>
      <h1>${esc(heading)}</h1>
      <p class="wz-lead">${esc(lead)}</p>
      ${asks.length ? `<div class="wz-asks">${asks.map((c) => `<p>${authorLabel(c)} ${esc(c.text)}</p>`).join('')}</div>` : ''}
      <div class="wz-two">
        <div class="wz-brief">
          <h3>What the picture shows</h3><p>${esc(current.draw)}</p>
          ${current.mustKeep?.length ? `<h3>Please keep</h3><ul>${current.mustKeep.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          <p class="muted small">${esc(facts)}</p>
          ${openFields(code, current)}
        </div>
        <div class="wz-upload">${uploadBox(current, versions)}</div>
      </div>
    </section>
    ${pic.url ? `<section class="wz-card"><h2>How it looks</h2>${versionStrip(key, versions, pic)}${previewTabs(code, current, pic)}</section>` : ''}
    ${versions.length ? commentsPanel(code, current, pic.version) : ''}
  </main></div>`;
}

/** The wizard's list: the next task, then every picture the artist has worked on, by step. */
function wizardSide(code: string, brief: Brief, view: SetView | null, current: BriefPicture | null, next: BriefPicture | null): string {
  const onNext = !!next && current === next;
  const worked = (x: BriefPicture) => versionsOf(view, keyOf(x)).length > 0 || x === next;
  const groups = steps(brief, view).map((st) => ({ st, items: st.pictures.filter(worked) })).filter((g) => g.items.length);
  const item = (x: BriefPicture) => {
    const k = keyOf(x), url = shown(code, k).url, state = stateOf(view, k);
    return `<a class="wz-item ${current === x ? 'on' : ''}" href="#/${code}/${k}">
      <span class="wz-thumb ${x.kind === 'pawtrait' ? 'round' : ''}" style="${url ? `background-image:url(${url})` : ''}"></span>
      <span><b>${esc(title(x))}${sideLabel(x) ? ` <i>${sideLabel(x)}</i>` : ''}</b><small class="st-${state}">${x === next && state === 'none' ? 'Next' : STATE_NAMES[state]}</small></span></a>`;
  };
  return `<aside class="wz-side">
    <a class="btn ${onNext ? 'ghost' : 'primary'} wide" href="#/${code}">${next ? 'Your next task' : 'Where things stand'}</a>
    <h4>Your pictures</h4>
    ${groups.length ? groups.map((g) => `<div class="wz-group"><small>${esc(g.st.milestone.title)}</small>${g.items.map(item).join('')}</div>`).join('')
      : '<p class="muted small">Pictures you send appear here, so you can come back to them.</p>'}
    <a class="small" href="#/${code}/all">All ${brief.pictures.length} pictures of the project</a>
  </aside>`;
}

function homeHead(code: string, brief: Brief, hero: string | null, approved: number, total: number, extra = ''): string {
  return `<section class="home-head" style="${hero ? `--hero:url(${hero})` : ''}">
      <div>
        <small>${esc(brief.set)} · ${S.sets.find((s) => s.code === code)?.status === 'released' ? 'Released' : 'In the works'}</small>
        <h1>${esc(brief.name)}</h1>
        ${brief.about ? `<p>${esc(brief.about)}</p>` : ''}${extra}
      </div>
      <div class="ring" style="--p:${total ? approved / total : 0}"><b>${approved}</b><span>of ${total}<br>approved</span></div>
    </section>`;
}

/** The project as its reviewer sees it: who draws it, what's waiting for review, and every picture. */
function reviewerHome(code: string, brief: Brief, view: SetView | null): string {
  const { approved, total } = overall(brief, view);
  const artists = S.roster?.artists ?? [];
  const assign = `<div class="assign"><input data-in="assignemail" type="email" placeholder="The artist’s email, as in their game account" value="${esc(S.assignEmail)}">
      <button class="btn primary" data-click="assign:${code}" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : 'Assign'}</button></div>
    ${S.assignError ? `<p class="error">${esc(S.assignError)}</p>` : ''}`;
  const head = homeHead(code, brief, null, approved, total);
  const allLink = `<p class="all-link"><a href="#/${code}/all">See all ${total} pictures</a></p>`;

  // A new project: the one thing to do is choose its artist.
  if (!artists.length) {
    return `<main class="home">${head}
      <section class="panel attention"><h2>Assign an artist</h2>
        <p>This is the only thing to do for now. Type the email of the game account of the artist who will make the pictures for ${esc(brief.name)}.
          We check that the account exists. They then open <b>${esc(`${location.origin}${location.pathname}`)}</b>, sign in, and start.</p>
        ${assign}</section>${allLink}</main>`;
  }

  const who = artists.map((a) => esc(a.name)).join(' and ');
  const toReview = brief.pictures.filter((p) => stateOf(view, keyOf(p)) === 'waiting');
  const suggestions = (view?.suggestions ?? []).filter((x) => x.state === 'open');
  const news = unread(code).filter((c) => c.author === 'artist');
  const current = nextPicture(brief, view);
  const task = toReview.length || suggestions.length || news.length
    ? `<section class="panel attention"><h2>To review</h2>
        ${toReview.map((p) => `<a class="news-item" href="#/${code}/${keyOf(p)}"><b>${esc(title(p))}${sideLabel(p) ? ` (${sideLabel(p)})` : ''}</b>:
          ${versionsOf(view, keyOf(p)).at(-1)?.kind === 'sketch' ? 'a new sketch' : 'a new picture'}. Approve it or ask for changes.</a>`).join('')}
        ${suggestions.map((x) => `<a class="news-item" href="#/${code}/${x.picture}">${esc(x.byName)} suggests a new ${esc((FIELD_NAMES[x.field] ?? x.field).toLowerCase())} for <b>${esc(pictureTitle(code, x.picture))}</b>: “${esc(x.value)}”</a>`).join('')}
        ${news.map((c) => `<a class="news-item" href="#/${code}/${c.picture}">${esc(c.authorName)} wrote on <b>${esc(pictureTitle(code, c.picture))}</b>: ${esc(c.text.slice(0, 140))}</a>`).join('')}
        ${news.length ? `<button class="link" data-click="seen:${code}">Mark messages as read</button>` : ''}</section>`
    : `<section class="panel"><h2>Nothing for you to do right now</h2>
        <p>${current ? `${who} is on picture ${brief.pictures.indexOf(current) + 1} of ${total}: <b>${esc(title(current))}</b>. When they send it, it appears here for you to review.`
          : approved === total ? 'Every picture is approved.' : `${who} has sent everything that’s open. It appears here as soon as there’s more.`}</p></section>`;
  return `<main class="home">${head}${task}
    <section class="panel quiet"><h2>Artist</h2>${artists.map((a) => `<div class="roster-row"><b>${esc(a.name)}</b>${a.email ? `<span>${esc(a.email)}</span>` : ''}
        <span class="grow"></span><button class="btn ghost small" data-click="remove:${code}:${a.id}">Remove…</button></div>`).join('')}
</section>
    ${allLink}</main>`;
}

/** Every picture of a project, in the artist's order: a reference, never the first thing anyone sees. */
function picturesPage(code: string): string {
  const brief = S.briefs.get(code);
  if (!brief) return notLoaded();
  const view = S.views.get(code) ?? null;
  return `<main class="home"><p class="all-link"><a href="#/${code}">‹ Back</a></p>
    <section class="panel"><h2>All pictures of ${esc(brief.name)}</h2>
      <p class="muted">In the order the artist draws them. Each step opens when the one before it is approved.</p>
      ${steps(brief, view).map((st, i) => `<div class="rstep"><h3>${i + 1}. ${esc(st.milestone.title)}</h3>
        <div class="thumbs">${st.pictures.map((p) => thumb(code, p, true)).join('')}</div></div>`).join('')}
    </section></main>`;
}

function thumb(code: string, p: BriefPicture, reachable: boolean): string {
  const key = keyOf(p), state = stateOf(S.views.get(code) ?? null, key);
  const url = shown(code, key).url;
  const pic = p.kind === 'pawtrait' ? `<div class="thumb-paw" style="${url ? `background-image:url(${url})` : ''}"></div>`
    : p.kind === 'announcement' ? `<div class="thumb-wide" style="${url ? `background-image:url(${url})` : ''}"></div>`
      : cardPreview(code, key, finishesOf(p).at(-1)!.finish, url, 104);
  const dot = unread(code, key).length ? '<i class="dot" title="New comments"></i>' : '';
  const inner = `${pic}<b>${esc(title(p))}</b><small>${sideLabel(p) ? `${sideLabel(p)} · ` : ''}${TIER_NAMES[p.tier]}</small>${stateChip(state)}${dot}`;
  return reachable ? `<a class="thumb" href="#/${code}/${key}">${inner}</a>` : `<div class="thumb locked">${inner}</div>`;
}


// ── A picture ────────────────────────────────────────────────────────────────────────────────────

function picturePage(code: string, key: string): string {
  const brief = S.briefs.get(code);
  if (!brief) return notLoaded();
  const p = brief.pictures.find((x) => keyOf(x) === key);
  if (!p) return `<main class="empty"><h1>No such picture</h1><p><a href="#/${code}">Back to ${esc(brief.name)}</a></p></main>`;
  const view = S.views.get(code) ?? null;
  const state = stateOf(view, key);
  const versions = versionsOf(view, key);
  const pic = shown(code, key);
  const all = steps(brief, view);
  const at = all.findIndex((st) => st.pictures.includes(p));
  const stepInfo = { open: at < 0 || all[at].open, after: at > 0 ? all[at - 1].milestone.title : '' };
  const i = brief.pictures.indexOf(p);
  const prev = brief.pictures[i - 1], next = brief.pictures[i + 1];
  return `<main class="picture">
    <aside class="brief">
      <div class="brief-head"><small>${esc(TIER_NAMES[p.tier])}${p.style ? ` · ${p.style === 'sticker' ? 'Sticker style' : 'Painted scene'}` : ''}${p.main ? ' · Main picture' : ''}</small>
        <h1>${esc(title(p))}</h1>${sideLabel(p) ? `<p class="muted">${sideLabel(p)} form</p>` : ''}${stateChip(state)}</div>
      ${actionBox(p, state, versions, stepInfo.open, stepInfo.after)}
      <section><h3>What the picture shows</h3><p>${esc(p.draw)}</p></section>
      ${p.mustKeep?.length ? `<section><h3>Please keep</h3><ul>${p.mustKeep.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
        <p class="muted small">The game’s rules or other cards depend on these.</p></section>` : ''}
      ${cardText(p)}
      ${openFields(code, p)}
      <section class="facts"><h3>File</h3><p><b>${p.size[0]} × ${p.size[1]}</b> pixels, WebP${p.kind === 'pawtrait' ? ', shown as a circle' : ''}.
        ${p.signature === 'requested' ? '<br>Please <b>sign</b> this picture in a corner.' : p.signature === 'welcome' ? '<br>Your signature is welcome on this one.' : ''}
        ${p.showcase ? '<br>This is <b>showcase art</b>: the face clearly visible, a heroic pose, dramatic light, lots of detail.' : ''}</p></section>
      <nav class="prevnext">${prev ? `<a href="#/${code}/${keyOf(prev)}">‹ ${esc(title(prev))}</a>` : '<span></span>'}${next ? `<a href="#/${code}/${keyOf(next)}">${esc(title(next))} ›</a>` : ''}</nav>
    </aside>
    <section class="stage">
      ${versionStrip(key, versions, pic)}
      ${previewTabs(code, p, pic)}
      ${commentsPanel(code, p, pic.version)}
    </section>
  </main>`;
}

/** What to do now, the upload box and, for the owner, the review buttons. */
function actionBox(p: BriefPicture, state: State, versions: Version[], stepOpen: boolean, opensAfter: string): string {
  const key = keyOf(p);
  const owner = reviewing();
  const box = uploadBox(p, versions);

  if (owner) {
    const last = versions.at(-1);
    const review = !versions.length ? '<p class="muted small">Nothing uploaded yet.</p>' : `
      <p class="small">${last?.kind === 'sketch' ? 'The newest version is a <b>sketch</b>.' : 'The newest version is <b>finished</b>.'} Write what to change as a comment first: the artist sees both.</p>
      <div class="review-buttons">
        ${last?.kind === 'sketch' && state !== 'sketch-ok'
          ? `<button class="btn good" data-click="review:${key}:sketch-ok">Approve the sketch</button>`
          : state !== 'approved' ? `<button class="btn good" data-click="review:${key}:approved">Approve</button>` : ''}
        ${state !== 'changes' ? `<button class="btn warn" data-click="review:${key}:changes">Ask for changes</button>` : ''}
        ${last?.kind === 'sketch' && state !== 'approved' ? `<button class="link" data-click="review:${key}:approved">Approve as finished</button>` : ''}
        ${state !== 'waiting' && state !== 'none' ? `<button class="link" data-click="review:${key}:waiting">Undo (${esc(STATE_NAMES[state])})</button>` : ''}
      </div>`;
    return `<section class="action owner-review state-${state}"><small class="kicker">Your review</small>
      <h3>${esc(STATE_NAMES[state])}</h3>${review}
      <details class="owner-upload"><summary>Upload for the artist</summary>${box}</details></section>`;
  }

  const action = nextAction(p, state, versions);
  const lock = !stepOpen && state === 'none' ? `<p class="lock-note">🔒 This step opens when “${esc(opensAfter)}” is approved. Starting early is fine.</p>` : '';
  return `<section class="action state-${state}">
    <h3>${esc(action.title)}</h3><p>${esc(action.text)}</p>${lock}
    ${state === 'approved' ? '' : box}
  </section>`;
}

/** Choose a picture (drop or click), then check it, see it and send it. */
function uploadBox(p: BriefPicture, versions: Version[]): string {
  const key = keyOf(p);
  const local = S.local.get(key);
  const up = S.uploading?.key === key ? S.uploading : null;
  const where = p.kind === 'pawtrait' ? 'as a Pawtrait' : p.kind === 'announcement' ? 'as the announcement' : 'on the card';
  if (local) {
    const list = checks(p, local.width, local.height, local.format, S.uploadKind);
    const code = S.route.page === 'sets' ? '' : S.route.code;
    const onCard = p.kind === 'card' || p.kind === 'token'
      ? `<div class="local-card">${cardPreview(code, key, finishesOf(p).at(-1)!.finish, local.url, 250)}</div>` : '';
    return `<div class="local">
      ${onCard}
      <p><b>${esc(local.file.name)}</b> · ${kb(local.file.size)}</p>
      <ul class="checks">${list.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      ${list.fix ? `<p class="fix">${esc(list.fix)}</p>` : ''}
      ${S.guest ? '<p class="muted small">This picture is only on your computer. Sign in to send it to us.</p>' : `
        <div class="seg" role="radiogroup" aria-label="What is it?">
          <button class="${S.uploadKind === 'sketch' ? 'on' : ''}" data-click="kind:sketch" role="radio" aria-checked="${S.uploadKind === 'sketch'}">A sketch</button>
          <button class="${S.uploadKind === 'final' ? 'on' : ''}" data-click="kind:final" role="radio" aria-checked="${S.uploadKind === 'final'}">Finished</button></div>
        <label class="field">A note for us <small>optional</small><input data-in="note" value="${esc(S.uploadNote)}" placeholder="e.g. I tried a warmer background"></label>
        ${up ? `<div class="progress"><i style="width:${Math.round(up.fraction * 100)}%"></i></div><p class="small muted">Sending… ${Math.round(up.fraction * 100)}%</p>`
          : `<button class="btn primary wide" data-click="upload:${key}" ${list.blocked ? 'disabled' : ''}>Send to Fruitcats</button>`}`}
      ${up ? '' : `<button class="link" data-click="discard:${key}">${S.guest ? 'Choose another picture' : 'Don’t send it'}</button>`}
      ${S.uploadError ? `<p class="error">${esc(S.uploadError)}</p>` : ''}
    </div>`;
  } else {
    return `<label class="drop" data-drop="${key}">
      <input type="file" accept="image/webp,image/png,image/jpeg" data-file="${key}" hidden>
      <b>${versions.length ? 'Upload a new version' : 'Upload your picture'}</b>
      <span>Drop the file here, or click to choose it on your computer. You’ll see it ${where} before you send it.</span></label>`;
  }
}

/** The card's words, so the picture can fit them. */
function cardText(p: BriefPicture): string {
  const card = cardData(p);
  if (!card) return '';
  const face = p.side === 'kitten' ? card.kitten : p.side === 'bigcat' ? card.bigCat : card;
  const text = face?.text ?? '';
  return `<section><h3>On the card</h3><p><b>${esc(face?.name ?? card.name)}</b> · ${esc(card.type)}</p>
    ${text ? `<p class="rules">${esc(text).replace(/\n/g, '<br>')}</p>` : ''}${card.flavor && p.side !== 'bigcat' ? `<p class="flavor">${esc(card.flavor)}</p>` : ''}</section>`;
}

/** The things the artist may change, and their suggestions. */
function openFields(code: string, p: BriefPicture): string {
  const key = keyOf(p);
  const mine = (S.views.get(code)?.suggestions ?? []).filter((s) => s.picture === key);
  if (!p.open?.length && !mine.length) return '';
  const owner = reviewing();
  const form = S.suggesting ? `<div class="suggest-form">
      <label class="field">What to change<select data-in="sfield">${(p.open ?? []).map((f) => `<option value="${f}" ${S.suggesting!.field === f ? 'selected' : ''}>${esc(FIELD_NAMES[f] ?? f)}</option>`).join('')}</select></label>
      <label class="field">Your suggestion<input data-in="svalue" value="${esc(S.suggesting.value)}" placeholder="e.g. Ginger Snap, the Cookie Cat"></label>
      <label class="field">Why <small>optional</small><input data-in="swhy" value="${esc(S.suggesting.why)}"></label>
      <div class="row"><button class="btn primary small" data-click="suggestsend:${key}">Send suggestion</button><button class="link" data-click="suggestcancel">Cancel</button></div></div>` : '';
  return `<section class="open-fields"><h3>You may change</h3>
    ${p.open?.length ? `<p>${p.open.map((f) => `<span class="chip">${esc(FIELD_NAMES[f] ?? f)}</span>`).join(' ')}</p>
      <p class="muted small">If a name or a detail doesn’t fit the picture you have in mind, suggest a change. We decide together.</p>` : ''}
    ${mine.map((s) => suggestionRow(code, s, owner)).join('')}
    ${form || (S.guest || !p.open?.length ? '' : `<button class="btn ghost small" data-click="suggest:${p.open[0]}">Suggest a change</button>`)}
  </section>`;
}

function suggestionRow(code: string, s: Suggestion, owner: boolean): string {
  const label = s.state === 'accepted' ? 'Accepted' : s.state === 'declined' ? 'Not this time' : 'Waiting for us';
  return `<div class="suggestion ${s.state}"><p><b>${esc(FIELD_NAMES[s.field] ?? s.field)}:</b> “${esc(s.value)}” <span class="chip">${label}</span></p>
    ${s.why ? `<p class="small muted">${esc(s.why)}</p>` : ''}${s.reply ? `<p class="small">Reply: ${esc(s.reply)}</p>` : ''}
    ${owner && s.state === 'open' ? `<div class="row"><button class="btn good small" data-click="decide:${code}:${s.id}:accepted">Accept</button>
      <button class="btn ghost small" data-click="decide:${code}:${s.id}:declined">Decline</button></div>` : ''}</div>`;
}

function versionStrip(key: string, versions: Version[], pic: ReturnType<typeof shown>): string {
  if (!versions.length && !pic.local) return '';
  if (versions.length === 1 && !pic.local) {
    const v = versions[0];
    return `<p class="version-one">Version 1 · ${v.kind === 'sketch' ? 'Sketch' : 'Finished'} · ${when(v.at)}${v.note ? ` · “${esc(v.note)}”` : ''}</p>`;
  }
  const items = versions.map((v, n) => {
    const on = !pic.local && pic.version?.id === v.id;
    return `<button class="ver ${on ? 'on' : ''}" data-click="version:${key}:${v.id}" title="${esc(`${v.width} × ${v.height} ${v.format.toUpperCase()}, ${kb(v.bytes)}${v.note ? `: ${v.note}` : ''}`)}">
      <span>v${n + 1}</span><small>${v.kind === 'sketch' ? 'Sketch' : 'Finished'} · ${when(v.at)}</small></button>`;
  });
  if (pic.local) items.push(`<button class="ver on local"><span>On your computer</span><small>not sent</small></button>`);
  return `<div class="versions" aria-label="Versions">${items.join('')}</div>`;
}

function previewTabs(code: string, p: BriefPicture, pic: ReturnType<typeof shown>): string {
  const key = keyOf(p);
  const tabs: [Tab, string][] = p.kind === 'pawtrait' ? [['card', 'Pawtrait'], ['picture', 'Picture']]
    : p.kind === 'announcement' ? [['card', 'Announcement'], ['picture', 'Picture']]
      : [['card', 'On the card'], ['game', 'In the game'], ['wallpaper', 'Wallpapers'], ['picture', 'Picture']];
  const tab = tabs.some(([t]) => t === S.tab) ? S.tab : 'card';
  const url = pic.url;
  let body = '';
  if (pic.loading && !url) body = '<div class="spinner"></div>';
  else if (tab === 'picture') body = pictureView(code, key, url, pic.version);
  else if (p.kind === 'pawtrait') body = pawtraitPreview(url);
  else if (p.kind === 'announcement') body = announcementPreview(url, S.briefs.get(code)?.name ?? '');
  else if (tab === 'card') {
    const finishes = finishesOf(p);
    const finish = S.finish.get(key) ?? finishes.at(-1)!.finish;
    body = `${finishes.length > 1 ? `<div class="seg small">${finishes.map((f) => `<button class="${f.finish === finish ? 'on' : ''}" data-click="finish:${key}:${f.finish}">${f.label}</button>`).join('')}</div>` : ''}
      <div class="card-stage">${cardPreview(code, key, finish, url, 420, pinsFor(code, key, pic.version))}</div>
      <p class="pv-note">The card shows your whole picture, shrunk into its window. The rounded corners and the border cover a few pixels at the edges.</p>`;
  } else if (tab === 'game') body = gamePreview(p, url, code, key);
  else {
    body = url ? `<div class="walls">${DEVICES.map(([d, label]) => `<figure class="wall wall-${d}"><div class="wall-img" data-wall="${d}" style="--art:url(${url})"><div class="spinner"></div>${d === 'phone' ? LOCK_CLOCK : ''}</div><figcaption>${label}</figcaption></figure>`).join('')}</div>
      <p class="pv-note">Players can make any card they own into a wallpaper. A phone keeps only the middle of your picture, with the clock over its upper part.</p>`
      : '<p class="pv-empty">Upload a picture to see it as a wallpaper.</p>';
  }
  return `<div class="tabs" role="tablist">${tabs.map(([t, label]) => `<button role="tab" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" data-click="tab:${t}">${label}</button>`).join('')}</div>
    <div class="preview tab-${tab} ${url ? '' : 'is-empty'}" data-preview="${key}">${body}</div>`;
}

/** The comments' pins on a version, numbered as in the comments. */
function pinsFor(code: string, key: string, version: Version | null): string {
  const comments = (S.views.get(code)?.comments ?? []).filter((c) => c.picture === key && c.pinX !== undefined && (!version || c.version === version.id));
  return comments.map((c, n) => `<span class="pin ${c.author}" style="left:${c.pinX! * 100}%;top:${c.pinY! * 100}%" title="${esc(c.text)}"><i>${n + 1}</i></span>`).join('');
}

/** The picture itself, large, with the comments' pins on it. Click to pin a comment to a spot. */
function pictureView(code: string, key: string, url: string | null, version: Version | null): string {
  if (!url) return '<p class="pv-empty">No picture uploaded yet.</p>';
  const pins = pinsFor(code, key, version)
    + (S.pin ? `<span class="pin new" style="left:${S.pin.x * 100}%;top:${S.pin.y * 100}%"><i>+</i></span>` : '');
  return `<div class="bigpic ${S.pinning ? 'pinning' : ''}" data-pinboard="1"><img src="${url}" alt="">${pins}</div>
    ${S.pinning ? '<p class="pv-note"><b>Click the spot</b> your comment is about.</p>' : ''}`;
}

function commentsPanel(code: string, p: BriefPicture, version: Version | null): string {
  const key = keyOf(p);
  const view = S.views.get(code);
  if (!view) return S.guest ? '' : '<section class="comments"><div class="spinner"></div></section>';
  const all = view.comments.filter((c) => c.picture === key);
  const roots = all.filter((c) => !c.replyTo || !all.some((x) => x.id === c.replyTo));
  const replies = (id: string) => all.filter((c) => c.replyTo === id);
  const versions = versionsOf(view, key);
  const vName = (id?: string) => { const n = versions.findIndex((v) => v.id === id); return n >= 0 ? `v${n + 1}` : ''; };
  const pinNo = new Map(all.filter((c) => c.pinX !== undefined && (!version || c.version === version.id)).map((c, n) => [c.id, n + 1]));
  const one = (c: Comment, reply = false): string => `<article class="comment ${c.author} ${c.done ? 'is-done' : ''} ${reply ? 'reply' : ''}">
      <header>${authorLabel(c)}<span class="muted small">${when(c.at)}${c.version ? ` · on ${vName(c.version)}` : ''}${pinNo.has(c.id) ? ` · <button class="link" data-click="tab:picture">pin ${pinNo.get(c.id)}</button>` : ''}</span></header>
      <p>${esc(c.text).replace(/\n/g, '<br>')}</p>
      <footer>${reply ? '' : `<button class="link" data-click="reply:${c.id}">Reply</button>`}
        ${S.guest ? '' : `<button class="link" data-click="done:${c.id}:${c.done ? 0 : 1}">${c.done ? `Done${c.doneBy ? ` (${esc(c.doneBy)})` : ''} · undo` : 'Mark done'}</button>`}
        ${c.pinX !== undefined && c.version && c.version !== version?.id ? `<button class="link" data-click="version:${key}:${c.version}">See ${vName(c.version)}</button>` : ''}</footer>
    </article>${replies(c.id).map((r) => one(r, true)).join('')}`;
  const openRoots = roots.filter((c) => !c.done), doneRoots = roots.filter((c) => c.done);
  const replyingTo = S.replyTo ? all.find((c) => c.id === S.replyTo) : null;
  return `<section class="comments"><h3>Comments</h3>
    ${openRoots.length ? openRoots.map((c) => one(c)).join('') : '<p class="muted">No comments yet.</p>'}
    ${doneRoots.length ? `<button class="link" data-click="showdone">${S.showDone ? 'Hide' : 'Show'} ${doneRoots.length} done</button>${S.showDone ? doneRoots.map((c) => one(c)).join('') : ''}` : ''}
    ${S.guest ? '' : `<div class="composer">
      ${replyingTo ? `<p class="small">Replying to ${esc(replyingTo.authorName)} <button class="link" data-click="reply:">Cancel</button></p>` : ''}
      <textarea data-in="comment" rows="3" placeholder="${reviewing() ? 'What should change, or what you like…' : 'A question, or what you changed…'}">${esc(S.draft.get(key) ?? '')}</textarea>
      <div class="row">
        ${version ? `<button class="btn ghost small ${S.pinning || S.pin ? 'on' : ''}" data-click="pin">${S.pin ? '📍 Pinned: move it' : '📍 Point at a spot'}</button>` : ''}
        ${S.pin ? '<button class="link" data-click="unpin">Remove pin</button>' : ''}
        <span class="grow"></span>
        <button class="btn primary small" data-click="comment:${key}">Post</button></div>
    </div>`}
  </section>`;
}

// ── Wallpapers are drawn after the page, as they take a moment ───────────────────────────────────

async function fillWallpapers() {
  const holders = root.querySelectorAll<HTMLElement>('[data-wall]');
  if (!holders.length || S.route.page !== 'picture') return;
  const { code, key } = S.route;
  const p = S.briefs.get(code)?.pictures.find((x) => keyOf(x) === key);
  const pic = shown(code, key);
  if (!p || !pic.url) return;
  const artId = pic.local ? `local-${pic.local.file.name}-${pic.local.file.lastModified}` : `${code}/${key}/${pic.version?.id}`;
  for (const el of holders) {
    const made = wallpaper(p, pic.url, artId, el.dataset.wall as 'phone' | 'tablet' | 'computer');
    if (!made) { el.innerHTML = '<p class="pv-empty">No wallpaper for this picture.</p>'; continue; }
    made.then((src) => {
      if (!el.isConnected) return;
      el.querySelector('.spinner')?.remove();
      if (el.querySelector('img.wall-made')) return;
      const img = new Image();
      img.className = 'wall-made';
      img.alt = '';
      img.onload = () => { el.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; el.classList.add('ready'); };
      img.src = src;
      el.prepend(img);
    }).catch(() => { el.innerHTML = '<p class="pv-empty">Couldn’t draw this wallpaper.</p>'; });
  }
}

// ── Choosing a picture on this computer ──────────────────────────────────────────────────────────

async function choose(key: string, file: File) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const ok = await new Promise<boolean>((resolve) => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = url; });
  if (!ok) { S.uploadError = 'That file isn’t a picture the browser can open. Please use WebP, PNG or JPEG.'; render(); return; }
  const format = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpeg' : file.name.split('.').pop()?.toLowerCase() ?? '?';
  const old = S.local.get(key);
  if (old) URL.revokeObjectURL(old.url);
  S.local.set(key, { url, file, width: img.naturalWidth, height: img.naturalHeight, format });
  const p = S.route.page !== 'sets' ? S.briefs.get(S.route.code)?.pictures.find((x) => keyOf(x) === key) : undefined;
  const state = S.route.page !== 'sets' ? stateOf(S.views.get(S.route.code) ?? null, key) : 'none';
  // A sensible guess at what it is: a sketch first, then finished once the sketch is approved.
  S.uploadKind = p && (state === 'sketch-ok' || state === 'approved' || (!p.showcase && !p.main && format === 'webp' && img.naturalWidth === p.size[0])) ? 'final' : 'sketch';
  S.uploadError = '';
  if (S.tab === 'picture') S.tab = 'card';
  render();
}

async function send(key: string) {
  if (S.route.page === 'sets' || S.uploading) return;
  const code = S.route.code;
  const local = S.local.get(key);
  if (!local) return;
  const p = S.briefs.get(code)?.pictures.find((x) => keyOf(x) === key);
  if (p && checks(p, local.width, local.height, local.format, S.uploadKind).blocked) return;
  S.uploading = { key, fraction: 0 };
  S.uploadError = '';
  render();
  try {
    const v = await api.upload(code, key, local.file, S.uploadKind, S.uploadNote.trim(), (f) => {
      S.uploading = { key, fraction: f };
      const bar = root.querySelector<HTMLElement>('.progress i');
      if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    });
    // The stored picture is what the previews show from now on; it's the same file, so keep its address.
    S.images.set(`${code}/${key}/${v.id}`, local.url);
    S.local.delete(key);
    S.chosen.delete(key);
    S.uploadNote = '';
    S.uploading = null;
    S.justSent = pictureTitle(code, key);
    await refresh(code);
    flash('Sent. It’s safely stored, and we’ll have a look.');
  } catch (e) {
    S.uploading = null;
    S.uploadError = `${api.explain(e)} Your picture is still on your computer.`;
    render();
  }
}

function flash(text: string) {
  S.toast = text;
  render();
  setTimeout(() => { if (S.toast === text) { S.toast = ''; render(); } }, 4000);
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

async function act(action: string) {
  const [verb, ...args] = action.split(':');
  const code = S.route.page === 'sets' ? '' : S.route.code;
  const work = async (run: () => Promise<unknown>, after?: () => void) => {
    if (S.busy) return;
    S.busy = true;
    try { await run(); after?.(); S.error = ''; } catch (e) { S.error = api.explain(e); }
    S.busy = false;
    render();
  };
  switch (verb) {
    case 'guest': S.guest = true; await onRoute(); return;
    case 'signin': S.guest = false; render(); return;
    case 'signout': if (DEV) setDevUser(null); else signOut(); S.me = null; S.unreachable = false; S.error = ''; S.views.clear(); S.images.clear(); render(); return;
    case 'welcome': try { localStorage.setItem(welcomeKey(args[0]), '1'); } catch { /* shown again next time */ } render(); window.scrollTo(0, 0); return;
    case 'asartist': {
      S.asArtist = args[0] === '1';
      if (S.route.page !== 'sets') S.reviewMode.set(S.route.code, S.asArtist ? 'artist' : 'review');
      render(); window.scrollTo(0, 0); return;
    }
    case 'retry': S.error = ''; await onRoute(); return;
    case 'recheck': await enter(); await onRoute(); return;
    case 'dismiss': S.error = ''; render(); return;
    case 'seen': markSeen(args[0]); render(); return;
    case 'tab': S.tab = args[0] as Tab; render(); return;
    case 'finish': S.finish.set(args[0], args[1]); render(); return;
    case 'version': S.chosen.set(args[0], args[1]); S.local.delete(args[0]); render(); return;
    case 'kind': S.uploadKind = args[0] as 'sketch' | 'final'; render(); return;
    case 'discard': { const l = S.local.get(args[0]); if (l) URL.revokeObjectURL(l.url); S.local.delete(args[0]); S.uploadError = ''; render(); return; }
    case 'upload': await send(args[0]); return;
    case 'reply': S.replyTo = args[0] || null; render(); root.querySelector<HTMLTextAreaElement>('[data-in="comment"]')?.focus(); return;
    case 'showdone': S.showDone = !S.showDone; render(); return;
    case 'pin': S.pinning = true; S.tab = 'picture'; render(); return;
    case 'unpin': S.pin = null; S.pinning = false; render(); return;
    case 'comment': {
      const key = args[0];
      const text = (S.draft.get(key) ?? '').trim();
      if (!text) return;
      const version = shown(code, key).version?.id;
      await work(() => api.comment(code, key, { text, version, pin: S.pin ?? undefined, replyTo: S.replyTo ?? undefined }), () => {
        S.draft.delete(key); S.pin = null; S.pinning = false; S.replyTo = null;
      });
      await refresh(code); render();
      return;
    }
    case 'done': await work(() => api.markDone(code, args[0], args[1] === '1')); await refresh(code); render(); return;
    case 'review': await work(() => api.review(code, args[0], args[1])); await refresh(code); render(); return;
    case 'openstep': await work(() => api.openStep(code, args[0], args[1] === '1')); await refresh(code); render(); return;
    case 'suggest': S.suggesting = { field: args[0], value: '', why: '' }; render(); return;
    case 'suggestcancel': S.suggesting = null; render(); return;
    case 'suggestsend': {
      const s = S.suggesting;
      if (!s || !s.value.trim()) return;
      await work(() => api.suggest(code, { picture: args[0], field: s.field, value: s.value.trim(), why: s.why.trim() }), () => { S.suggesting = null; });
      await refresh(code); render();
      return;
    }
    case 'decide': await work(() => api.decide(args[0], args[1], args[2])); await refresh(args[0]); render(); return;
    case 'invite': await work(async () => { S.newInvite = (await api.invite(args[0], S.inviteNote.trim())).url; S.inviteNote = ''; S.roster = await api.artists(args[0]); }); return;
    case 'copy': try { await navigator.clipboard.writeText(S.newInvite); flash('Copied.'); } catch { flash('Couldn’t copy: select the link instead.'); } return;
    case 'assign': {
      const email = S.assignEmail.trim();
      if (!email) { S.assignError = 'Type the artist’s email first.'; render(); return; }
      S.assignError = '';
      if (S.busy) return;
      S.busy = true; render();
      try {
        const a = await api.addArtist(args[0], email);
        S.roster = await api.artists(args[0]);
        S.assignEmail = '';
        flash(`${a.name} (${a.email}) can now open ${S.briefs.get(args[0])?.name ?? 'this project'}.`);
      } catch (e) { S.assignError = api.explain(e); }
      S.busy = false; render();
      return;
    }
    case 'remove':
      if (!confirm('Remove this artist from the set? Their pictures and comments stay.')) return;
      await work(async () => { await api.removeArtist(args[0], args[1]); S.roster = await api.artists(args[0]); });
      return;
  }
}

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Pinning a comment: a click on the picture places the pin.
  const board = target.closest<HTMLElement>('[data-pinboard]');
  if (board && S.pinning) {
    const box = board.querySelector('img')!.getBoundingClientRect();
    S.pin = { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) };
    S.pinning = false;
    render();
    root.querySelector<HTMLTextAreaElement>('[data-in="comment"]')?.focus();
    return;
  }
  const el = target.closest<HTMLElement>('[data-click]');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.click!;
  if (!S.me && !S.guest && (action === 'recheck' || action === 'signout')) { void act(action); return; }
  if (!S.me && !S.guest && (action.startsWith('si:') || action.startsWith('dev:'))) {
    void signInClick(action.replace(/^si:/, ''), () => void afterSignIn(), render);
    return;
  }
  void act(action);
});

async function afterSignIn() {
  S.booting = true; render();
  await enter();
  S.booting = false;
  await onRoute();
}

root.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const f = el.dataset.in;
  if (!f) return;
  if (!S.me && !S.guest) { signInInput(el, () => void afterSignIn(), render); return; }
  if (f === 'comment' && S.route.page === 'picture') S.draft.set(S.route.key, el.value);
  else if (f === 'note') S.uploadNote = el.value;
  else if (f === 'invitenote') S.inviteNote = el.value;
  else if (f === 'assignemail') { S.assignEmail = el.value; S.assignError = ''; }
  else if (S.suggesting && f === 'svalue') S.suggesting.value = el.value;
  else if (S.suggesting && f === 'swhy') S.suggesting.why = el.value;
});

root.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.file && el.files?.[0]) void choose(el.dataset.file, el.files[0]);
  if (el.dataset.in === 'sfield' && S.suggesting) S.suggesting.field = el.value;
  if (!S.me && !S.guest && el.dataset.in === 'agree') signInInput(el, () => void afterSignIn(), render);
});

root.addEventListener('keydown', (e) => {
  const el = e.target as HTMLInputElement;
  if (e.key !== 'Enter' || !el.dataset?.in) return;
  if (!S.me && !S.guest) { signInEnter(el, () => void afterSignIn(), render); return; }
  if (el.dataset.in === 'comment' && (e.ctrlKey || e.metaKey) && S.route.page === 'picture') { e.preventDefault(); void act(`comment:${S.route.key}`); }
  if (el.dataset.in === 'assignemail' && S.route.page !== 'sets') { e.preventDefault(); void act(`assign:${S.route.code}`); }
});

// Dropping a file on the upload box.
root.addEventListener('dragover', (e) => {
  const zone = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
  if (zone) { e.preventDefault(); zone.classList.add('over'); }
});
root.addEventListener('dragleave', (e) => (e.target as HTMLElement).closest<HTMLElement>('[data-drop]')?.classList.remove('over'));
root.addEventListener('drop', (e) => {
  const zone = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
  const file = e.dataTransfer?.files[0];
  if (!zone || !file) return;
  e.preventDefault();
  void choose(zone.dataset.drop!, file);
});

void boot();
