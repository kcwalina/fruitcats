// The Artist Studio (docs/artist-studio-plan.md): where artists draw for Fruitcats. For each set it shows the steps
// in order (the brief's milestones), what each picture needs, and the artist's pictures on their cards, in the game
// and as wallpapers. Artists upload each version; nothing is ever overwritten. Comments from the Fruitcats team,
// from AI agents and from the artist sit beside each picture, each labelled with who wrote it.
//
// Pages (in the address's #): the set's home (#/bp1), a picture (#/bp1/BP1-X01), the set's artists (#/bp1/artists,
// owner only), and the list of sets (#/). One render() draws the page from `S`; clicks and typing are handled by
// data-click and data-in attributes, as in the game.

import '../content';
import { registerSet, type SetData } from '@fruitcats/engine';
import { session, signOut } from '../auth';
import { BASE, esc } from '../ui';
import * as api from './api';
import { DEV, devUser, setDevUser, type Comment, type Me, type SetView, type Suggestion, type Version } from './api';
import {
  FIELD_NAMES, STATE_NAMES, TIER_NAMES, keyOf, nextAction, nextPicture, overall, stateOf, steps, versionsOf,
  type Brief, type BriefPicture, type State,
} from './brief';
import { DEVICES, LOCK_CLOCK, announcementPreview, cardPreview, finishesOf, gamePreview, pawtraitPreview, wallpaper } from './previews';
import { renderSignIn, signInClick, signInEnter, signInInput } from './signin';
import './studio.css';

interface SetEntry { set: string; code: string; name: string; status: string; folder: string }
interface LocalPicture { url: string; file: File; width: number; height: number; format: string }
type Tab = 'card' | 'picture' | 'game' | 'wallpaper';
type Route = { page: 'sets' } | { page: 'home'; code: string } | { page: 'picture'; code: string; key: string } | { page: 'artists'; code: string };

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
};

const root = document.getElementById('studio')!;

// ── Starting up ──────────────────────────────────────────────────────────────────────────────────

const signedIn = () => (DEV ? devUser() !== null : session() !== null);

function parseRoute(): Route {
  const [code, key] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!code) return { page: 'sets' };
  if (key === 'artists') return { page: 'artists', code };
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
  } catch (e) {
    S.error = api.explain(e);
    if (e instanceof api.ApiError && e.status === 401) { S.me = null; return; }
    S.me = S.me ?? null;
  }
}

async function onRoute() {
  S.route = parseRoute();
  S.pinning = false; S.pin = null; S.replyTo = null; S.suggesting = null; S.uploadError = ''; S.newInvite = '';
  const mine = visibleSets();
  if (S.route.page === 'sets' && mine.length === 1 && (S.me || S.guest)) { go(`#/${mine[0].code}`); return; }
  if (S.route.page !== 'sets') {
    await loadSet(S.route.code);
    if (S.route.page === 'artists' && S.me?.role === 'owner') {
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
      S.error = 'This set has no brief yet.';
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
function checks(p: BriefPicture, w: number, h: number, format: string, kind: 'sketch' | 'final'): { ok: boolean; text: string }[] {
  const [bw, bh] = p.size;
  const list: { ok: boolean; text: string }[] = [];
  const sameShape = Math.abs(w / h - bw / bh) < 0.01;
  if (w === bw && h === bh) list.push({ ok: true, text: `${w} × ${h} pixels, as the brief asks` });
  else if (sameShape && kind === 'sketch') list.push({ ok: true, text: `${w} × ${h}: the right shape. The finished picture should be ${bw} × ${bh}.` });
  else if (sameShape) list.push({ ok: false, text: `${w} × ${h}: the right shape, but the finished picture should be exactly ${bw} × ${bh}.` });
  else list.push({ ok: false, text: `${w} × ${h} is a different shape from ${bw} × ${bh}: the card would stretch it. Please use ${bw} × ${bh}.` });
  if (format === 'webp') list.push({ ok: true, text: 'WebP' });
  else if (kind === 'sketch') list.push({ ok: true, text: `${format.toUpperCase()} is fine for a sketch. Please send the finished picture as WebP.` });
  else list.push({ ok: false, text: `${format.toUpperCase()}: please send the finished picture as WebP.` });
  return list;
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
  if (!S.me && !S.guest) {
    return renderSignIn(!!S.invite) + (S.invite ? '' : `<p class="si-guest"><button class="link" data-click="guest">Look around without signing in</button></p>`)
      + (S.error ? `<p class="si-guest si-error">${esc(S.error)}</p>` : '');
  }
  const r = S.route;
  const body = r.page === 'sets' ? setsPage() : r.page === 'home' ? homePage(r.code) : r.page === 'picture' ? picturePage(r.code, r.key) : artistsPage(r.code);
  return `${topBar()}${S.error ? `<div class="banner error">${esc(S.error)} <button class="link" data-click="dismiss">Close</button></div>` : ''}
    ${S.guest ? `<div class="banner">You’re looking around without signing in. Pictures you choose stay on this computer. <button class="link" data-click="signin">Sign in</button></div>` : ''}
    ${body}${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

function topBar(): string {
  const r = S.route;
  const set = r.page !== 'sets' ? S.sets.find((s) => s.code === r.code) : null;
  const who = S.me ? `${esc(S.me.name)}${S.me.role === 'owner' ? ' <span class="chip owner-chip">Reviewer</span>' : ''}` : 'Guest';
  return `<header class="top">
    <a class="brand" href="#/"><img src="${BASE}icons/icon-192.png" alt=""><span>Fruitcats <b>Artist Studio</b></span></a>
    ${set ? `<nav class="crumbs"><a href="#/${set.code}">${esc(set.name)}</a>${r.page === 'picture' ? ` <span>›</span> <span>${esc(pictureTitle(r.code, r.key))}</span>` : r.page === 'artists' ? ' <span>›</span> <span>Artists</span>' : ''}</nav>` : '<span></span>'}
    <div class="me">${set && S.me?.role === 'owner' ? `<a class="btn ghost small" href="#/${set.code}/artists">Artists</a>` : ''}
      <a class="btn ghost small" href="${BASE}docs.html" target="_blank" rel="noopener">Guide</a>
      <span class="me-name">${who}</span>
      ${S.me ? '<button class="btn ghost small" data-click="signout">Sign out</button>' : ''}</div>
  </header>`;
}

function pictureTitle(code: string, key: string): string {
  const p = S.briefs.get(code)?.pictures.find((x) => keyOf(x) === key);
  return p ? `${title(p)}${sideLabel(p) ? ` (${sideLabel(p)})` : ''}` : key;
}

// ── The list of sets ─────────────────────────────────────────────────────────────────────────────

function setsPage(): string {
  const mine = visibleSets();
  if (!mine.length) {
    return `<main class="empty"><h1>Welcome, ${esc(S.me?.name ?? '')}</h1>
      <p>You’re signed in as <b>${esc(S.me?.name ?? '')}</b>. Your reviewer can see that you’re here, and will add you to your project.
        Once they have, it opens here whenever you sign in.</p>
      <p><button class="btn" data-click="recheck">Check again</button></p>
      ${S.me?.id ? `<p class="muted small">Your account id, if we ask for it: <code>${esc(S.me.id)}</code></p>` : ''}</main>`;
  }
  return `<main class="sets"><h1>Your sets</h1><div class="set-grid">${mine.map((s) => {
    const brief = S.briefs.get(s.code);
    return `<a class="set-tile" href="#/${s.code}"><b>${esc(s.name)}</b><span>${esc(s.set)}${brief ? ` · ${brief.pictures.length} pictures` : ''}</span></a>`;
  }).join('')}</div></main>`;
}

// ── A set's home ─────────────────────────────────────────────────────────────────────────────────

function homePage(code: string): string {
  const brief = S.briefs.get(code);
  if (!brief) return `<main class="empty"><div class="spinner"></div></main>`;
  const view = S.views.get(code) ?? null;
  const all = steps(brief, view);
  const { approved, total } = overall(brief, view);
  const next = nextPicture(brief, view);
  const owner = S.me?.role === 'owner';
  const news = unread(code);
  // The header shows the artist's newest card picture, once there is one.
  const latest = brief.pictures.filter((p) => p.kind === 'card' && versionsOf(view, keyOf(p)).length)
    .sort((a, b) => (versionsOf(view, keyOf(b)).at(-1)!.at > versionsOf(view, keyOf(a)).at(-1)!.at ? 1 : -1))[0];
  const heroShown = latest ? shown(code, keyOf(latest)) : null;

  const waitingOnOwner = owner ? brief.pictures.filter((p) => stateOf(view, keyOf(p)) === 'waiting') : [];
  const nextCard = owner ? (waitingOnOwner.length ? (() => {
    const w = waitingOnOwner[0], key = keyOf(w);
    return `<a class="next" href="#/${code}/${key}">
      <div class="next-thumb">${cardPreview(code, key, finishesOf(w).at(-1)!.finish, shown(code, key).url, 120)}</div>
      <div><small>Waiting on you</small><h2>${esc(title(w))}${sideLabel(w) ? ` <span class="muted">(${sideLabel(w)})</span>` : ''}</h2>
        <p>${versionsOf(view, key).at(-1)?.kind === 'sketch' ? 'A new sketch' : 'A new picture'} to review${waitingOnOwner.length > 1 ? `, and ${waitingOnOwner.length - 1} more` : ''}.</p><span class="btn primary">Review it</span></div></a>`;
  })() : `<div class="next waiting"><div><small>Nothing waiting on you</small><h2>${next ? `The artist is on ${esc(title(next))}` : 'All caught up'}</h2>
      <p>New uploads show up here. You can also make an invite link on the <a href="#/${code}/artists">Artists</a> page.</p></div></div>`)
  : next ? (() => {
    const key = keyOf(next), state = stateOf(view, key);
    const action = nextAction(next, state, versionsOf(view, key));
    return `<a class="next" href="#/${code}/${key}">
      <div class="next-thumb">${cardPreview(code, key, finishesOf(next).at(-1)!.finish, shown(code, key).url, 120)}</div>
      <div><small>Your next step</small><h2>${esc(title(next))}${sideLabel(next) ? ` <span class="muted">(${sideLabel(next)})</span>` : ''}</h2>
        <p><b>${esc(action.title)}.</b> ${esc(action.text)}</p><span class="btn primary">Open this picture</span></div></a>`;
  })() : approved === total && total
    ? `<div class="next done"><div><small>All done</small><h2>Every picture is approved</h2><p>Thank you for your work on ${esc(brief.name)}!</p></div></div>`
    : `<div class="next waiting"><div><small>Your next step</small><h2>We’re reviewing your pictures</h2><p>You’ll see our comments on each picture. The next step opens when this one is approved.</p></div></div>`;

  return `<main class="home">
    <section class="home-head" style="${heroShown?.url ? `--hero:url(${heroShown.url})` : ''}">
      <div>
        <small>${esc(brief.set)} · ${S.sets.find((s) => s.code === code)?.status === 'released' ? 'Released' : 'In the works'}</small>
        <h1>${esc(brief.name)}</h1>
        ${brief.about ? `<p>${esc(brief.about)}</p>` : ''}
      </div>
      <div class="ring" style="--p:${total ? approved / total : 0}"><b>${approved}</b><span>of ${total}<br>approved</span></div>
    </section>
    ${nextCard}
    ${news.length ? `<section class="news"><h3>New since you last looked</h3>${news.slice(-6).reverse().map((c) =>
      `<a class="news-item" href="#/${code}/${c.picture}">${authorLabel(c)} on <b>${esc(pictureTitle(code, c.picture))}</b>: ${esc(c.text.slice(0, 140))}${c.text.length > 140 ? '…' : ''}</a>`).join('')}
      <button class="link" data-click="seen:${code}">Mark all as read</button></section>` : ''}
    ${owner ? ownerQueue(code, brief, view) : ''}
    <section class="steps">${all.map((st, i) => {
      const lockedBy = !st.open && i > 0 ? all[i - 1].milestone.title : '';
      return `<article class="step ${st.done ? 'done' : st.open ? 'open' : 'locked'}">
        <header><span class="step-n">${st.done ? '✓' : i + 1}</span><div><h3>${esc(st.milestone.title)}</h3>${st.milestone.note ? `<p>${esc(st.milestone.note)}</p>` : ''}
          ${lockedBy ? `<p class="lock">Opens when “${esc(lockedBy)}” is approved.</p>` : ''}</div>
          ${owner && !st.done && (!st.open || view?.milestones[String(st.milestone.id)]) ? `<button class="btn ghost small" data-click="openstep:${st.milestone.id}:${view?.milestones[String(st.milestone.id)] ? 0 : 1}">${view?.milestones[String(st.milestone.id)] ? 'Close early access' : 'Open now'}</button>` : ''}
          <div class="bar"><i style="width:${Math.round(st.progress * 100)}%"></i></div></header>
        <div class="thumbs">${st.pictures.map((p) => thumb(code, p, st.open || owner)).join('')}</div>
      </article>`;
    }).join('')}</section>
    ${brief.families || brief.style ? `<section class="about-set"><h3>About the set</h3>
      ${brief.style ? `<p><b>Style.</b> ${esc(brief.style)}</p>` : ''}${brief.audience ? `<p><b>For.</b> ${esc(brief.audience)}</p>` : ''}
      ${Object.entries(brief.families ?? {}).map(([name, f]) => `<p><b>${esc(name)} family.</b> ${esc(f.world)}${f.note ? ` (${esc(f.note)})` : ''}</p>`).join('')}</section>` : ''}
  </main>`;
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

/** For the owner: what's waiting for a review, and open suggestions. */
function ownerQueue(code: string, brief: Brief, view: SetView | null): string {
  const waiting = brief.pictures.filter((p) => stateOf(view, keyOf(p)) === 'waiting');
  const open = (view?.suggestions ?? []).filter((s) => s.state === 'open');
  if (!waiting.length && !open.length) return '';
  return `<section class="queue"><h3>Waiting for you</h3>
    ${waiting.map((p) => `<a class="news-item" href="#/${code}/${keyOf(p)}">Review <b>${esc(title(p))}${sideLabel(p) ? ` (${sideLabel(p)})` : ''}</b>: ${versionsOf(view, keyOf(p)).at(-1)?.kind === 'sketch' ? 'a sketch' : 'a finished picture'}</a>`).join('')}
    ${open.map((s) => `<a class="news-item" href="#/${code}/${s.picture}">Suggestion on <b>${esc(pictureTitle(code, s.picture))}</b>: ${esc(FIELD_NAMES[s.field] ?? s.field)} → “${esc(s.value)}”</a>`).join('')}
  </section>`;
}

// ── A picture ────────────────────────────────────────────────────────────────────────────────────

function picturePage(code: string, key: string): string {
  const brief = S.briefs.get(code);
  if (!brief) return `<main class="empty"><div class="spinner"></div></main>`;
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
      <section><h3>What to draw</h3><p>${esc(p.draw)}</p></section>
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
  const local = S.local.get(key);
  const owner = S.me?.role === 'owner';
  const up = S.uploading?.key === key ? S.uploading : null;
  const where = p.kind === 'pawtrait' ? 'as a Pawtrait' : p.kind === 'announcement' ? 'as the announcement' : 'on the card';
  let box = '';
  if (local) {
    const list = checks(p, local.width, local.height, local.format, S.uploadKind);
    box = `<div class="local">
      <p><b>${esc(local.file.name)}</b> · ${kb(local.file.size)}</p>
      <ul class="checks">${list.map((c) => `<li class="${c.ok ? 'ok' : 'warn'}">${c.ok ? '✓' : '!'} ${esc(c.text)}</li>`).join('')}</ul>
      ${S.guest ? '<p class="muted small">This picture is only on your computer. Sign in to send it to us.</p>' : `
        <div class="seg" role="radiogroup" aria-label="What is it?">
          <button class="${S.uploadKind === 'sketch' ? 'on' : ''}" data-click="kind:sketch" role="radio" aria-checked="${S.uploadKind === 'sketch'}">A sketch</button>
          <button class="${S.uploadKind === 'final' ? 'on' : ''}" data-click="kind:final" role="radio" aria-checked="${S.uploadKind === 'final'}">Finished</button></div>
        <label class="field">A note for us <small>optional</small><input data-in="note" value="${esc(S.uploadNote)}" placeholder="e.g. I tried a warmer background"></label>
        ${up ? `<div class="progress"><i style="width:${Math.round(up.fraction * 100)}%"></i></div><p class="small muted">Sending… ${Math.round(up.fraction * 100)}%</p>`
          : `<button class="btn primary wide" data-click="upload:${key}">Send to Fruitcats</button>`}`}
      ${up ? '' : `<button class="link" data-click="discard:${key}">${S.guest ? 'Choose another picture' : 'Don’t send it'}</button>`}
      ${S.uploadError ? `<p class="error">${esc(S.uploadError)}</p>` : ''}
    </div>`;
  } else {
    box = `<label class="drop" data-drop="${key}">
      <input type="file" accept="image/webp,image/png,image/jpeg" data-file="${key}" hidden>
      <b>${versions.length ? 'Upload a new version' : 'Choose your picture'}</b>
      <span>Drop it here, or click to choose. You’ll see it ${where} before you send it.</span></label>`;
  }

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
  const owner = S.me?.role === 'owner';
  const form = S.suggesting ? `<div class="suggest-form">
      <label class="field">What to change<select data-in="sfield">${(p.open ?? []).map((f) => `<option value="${f}" ${S.suggesting!.field === f ? 'selected' : ''}>${esc(FIELD_NAMES[f] ?? f)}</option>`).join('')}</select></label>
      <label class="field">Your suggestion<input data-in="svalue" value="${esc(S.suggesting.value)}" placeholder="e.g. Ginger Snap, the Cookie Cat"></label>
      <label class="field">Why <small>optional</small><input data-in="swhy" value="${esc(S.suggesting.why)}"></label>
      <div class="row"><button class="btn primary small" data-click="suggestsend:${key}">Send suggestion</button><button class="link" data-click="suggestcancel">Cancel</button></div></div>` : '';
  return `<section class="open-fields"><h3>You may change</h3>
    ${p.open?.length ? `<p>${p.open.map((f) => `<span class="chip">${esc(FIELD_NAMES[f] ?? f)}</span>`).join(' ')}</p>
      <p class="muted small">If a name or a detail doesn’t fit what you want to draw, suggest a change. We decide together.</p>` : ''}
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
      : '<p class="pv-empty">Choose a picture on the left to see it as a wallpaper.</p>';
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
  if (!url) return '<p class="pv-empty">No picture yet. Choose one on the left.</p>';
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
      <textarea data-in="comment" rows="3" placeholder="${S.me?.role === 'owner' ? 'What should change, or what you like…' : 'A question, or what you changed…'}">${esc(S.draft.get(key) ?? '')}</textarea>
      <div class="row">
        ${version ? `<button class="btn ghost small ${S.pinning || S.pin ? 'on' : ''}" data-click="pin">${S.pin ? '📍 Pinned: move it' : '📍 Point at a spot'}</button>` : ''}
        ${S.pin ? '<button class="link" data-click="unpin">Remove pin</button>' : ''}
        <span class="grow"></span>
        <button class="btn primary small" data-click="comment:${key}">Post</button></div>
    </div>`}
  </section>`;
}

// ── The owner's artists page ─────────────────────────────────────────────────────────────────────

function artistsPage(code: string): string {
  if (S.me?.role !== 'owner') return '<main class="empty"><p>Only reviewers see this page.</p></main>';
  const set = S.sets.find((s) => s.code === code);
  const r = S.roster;
  const studio = `${location.origin}${location.pathname}`;
  return `<main class="artists"><h1>Artists for ${esc(set?.name ?? code)}</h1>
    <section><h3>Waiting for access</h3>
      <p>An artist opens <b>${esc(studio)}</b> and signs in with their game account. They appear here, and you add them to this set.</p>
      ${r?.waiting.length ? r.waiting.map((w) => `<div class="roster-row"><b>${esc(w.name)}</b>${w.email ? `<span>${esc(w.email)}</span>` : ''}<span class="muted small">signed in ${when(w.at)}</span>
        <span class="grow"></span><button class="btn primary small" data-click="add:${code}:${w.id}">Add to ${esc(set?.name ?? code)}</button></div>`).join('')
        : '<p class="muted">No one is waiting.</p>'}
    </section>
    <section><h3>Artists</h3>${r?.artists.length ? r.artists.map((a) => `<div class="roster-row"><b>${esc(a.name)}</b><span class="muted small">joined ${when(a.joined)}</span>
      <span class="grow"></span><button class="btn ghost small" data-click="remove:${code}:${a.id}">Remove…</button></div>`).join('') : '<p class="muted">No one yet.</p>'}
      <p class="muted small">Removing an artist keeps their pictures and comments.</p></section>
  </main>`;
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
  const p = S.route.page === 'picture' ? S.briefs.get(S.route.code)?.pictures.find((x) => keyOf(x) === key) : undefined;
  const state = S.route.page === 'picture' ? stateOf(S.views.get(S.route.code) ?? null, key) : 'none';
  // A sensible guess at what it is: a sketch first, then finished once the sketch is approved.
  S.uploadKind = p && (state === 'sketch-ok' || state === 'approved' || (!p.showcase && !p.main && format === 'webp' && img.naturalWidth === p.size[0])) ? 'final' : 'sketch';
  S.uploadError = '';
  if (S.tab === 'picture') S.tab = 'card';
  render();
}

async function send(key: string) {
  if (S.route.page !== 'picture' || S.uploading) return;
  const code = S.route.code;
  const local = S.local.get(key);
  if (!local) return;
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
    case 'signout': if (DEV) setDevUser(null); else signOut(); S.me = null; S.views.clear(); S.images.clear(); render(); return;
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
    case 'add': await work(async () => { await api.addArtist(args[0], args[1]); S.roster = await api.artists(args[0]); }); return;
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
