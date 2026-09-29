// Kardix Studio, read-only (Stage 3 of docs/tcg/tcg-developer-platform.md): the project's files on the left, its cards
// or the selected file in the middle, the rulebook on the right, and what is wrong with it underneath. `kardix studio`
// serves this page and the project's files; the page loads the core itself and reads the project in the browser, and
// reads it again each time the server says a file changed. The core draws the cards (Stage 4), fetching the fonts and
// pictures each one uses as it draws it; a project whose cards can't be drawn shows their data instead.

import { Core, drawnFiles, type Diagnostic, type Json, type Project, type ProjectFile } from '../engine/host/core';

interface WorkspaceFile { path: string; size: number; modified: string }
type Record_ = { [key: string]: Json };
interface Card { document: string; key: string; card: Record_ }
interface Document { file: string; name: string | null; type: string | null }
interface Face { set: string; card: string; face: 'front' | 'back'; finish: string; file: string }

const state = {
  root: '',
  files: [] as WorkspaceFile[],
  sources: new Map<string, string>(),
  documents: [] as Document[],
  cards: [] as Card[],
  game: null as Record_ | null,
  rulebook: null as Record_ | null,
  diagnostics: [] as Diagnostic[],
  faces: [] as Face[],
  /** Why the cards can't be drawn, when they can't. */
  cannotDraw: '',
  selected: null as string | null,
  loadedAt: '',
  failure: '',
};

const isRecord = (v: Json | undefined): v is Record_ => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
const text = (o: Record_ | null | undefined, field: string) => (o && typeof o[field] === 'string' ? (o[field] as string) : undefined);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let core: Core | undefined;
let project: Project | undefined;
/** Each drawn face's picture (an object URL), or what stopped it, by the face's words. */
const drawn = new Map<string, { url?: string; error?: string }>();
/** Pictures by the draw list they were drawn from: a face whose list didn't change isn't drawn again. */
const byList = new Map<string, { url?: string; error?: string }>();
/** The fonts and pictures the loaded project has been given. */
const given = new Set<string>();
/** Fonts and pictures fetched for drawing, by path, with the file's size and time when fetched. A fetch that failed
 * isn't kept, so the next reading tries again. */
const fetched = new Map<string, { bytes: Uint8Array; stamp: string }>();
let generation = 0;

/** A file's size and time as listed; a font the host reads from the system isn't listed, and doesn't change. */
function stampOf(path: string): string {
  const file = state.files.find((f) => f.path === path);
  return file ? `${file.size} ${file.modified}` : 'unlisted';
}

async function fetchFile(path: string): Promise<Uint8Array | null> {
  if (!fetched.has(path)) {
    const stamp = stampOf(path);
    const response = await fetch(`api/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return null;
    fetched.set(path, { bytes: new Uint8Array(await response.arrayBuffer()), stamp });
  }
  return fetched.get(path)?.bytes ?? null;
}

/** Forgets the fonts and pictures that changed on disk, and the faces drawn with them. */
function forgetChangedFiles() {
  const changed = [...fetched].filter(([path, f]) => f.stamp !== stampOf(path)).map(([path]) => path);
  for (const path of changed) fetched.delete(path);
  if (!changed.length) return;
  for (const [list, entry] of byList) {
    if (drawnFiles(list).some((path) => changed.includes(path))) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      byList.delete(list);
    }
  }
}

const faceWords = (f: Face) => `${f.set} ${f.card} ${f.face} ${f.finish}`;

async function load() {
  try {
    core ??= await Core.load('kardix.wasm');
    const list = (await (await fetch('api/files', { cache: 'no-store' })).json()) as { root: string; files: WorkspaceFile[] };
    state.root = list.root;
    state.files = list.files.sort((a, b) => a.path.localeCompare(b.path));
    forgetChangedFiles();
    const alex = state.files.filter((f) => f.path.endsWith('.alex'));
    const files: ProjectFile[] = await Promise.all(alex.map(async (f) => ({
      path: f.path,
      bytes: new Uint8Array(await (await fetch(`api/file?path=${encodeURIComponent(f.path)}`, { cache: 'no-store' })).arrayBuffer()),
    })));
    state.sources = new Map(files.map((f) => [f.path, new TextDecoder().decode(f.bytes)]));

    project?.free();
    project = core.loadProject(files);
    state.diagnostics = project.diagnostics();
    state.documents = JSON.parse(project.query('documents')) as Document[];
    state.cards = JSON.parse(project.query('cards')) as Card[];
    const game = state.documents.find((d) => d.type === 'Game');
    const rulebook = state.documents.find((d) => d.type === 'Rulebook');
    state.game = game?.name ? asRecord(project.value(game.name)) : null;
    state.rulebook = rulebook?.name ? asRecord(project.value(rulebook.name)) : null;
    await prepareDrawing(project);
    state.failure = '';
    state.loadedAt = new Date().toLocaleTimeString();
  } catch (e) {
    state.failure = e instanceof Error ? e.message : String(e);
  }
  render();
  void drawAll();
}

const asRecord = (v: Json) => (isRecord(v) ? v : null);

/** Fetches the layout's fonts and lists the faces to draw; or says why the cards can't be drawn. */
async function prepareDrawing(loaded: Project) {
  drawn.clear();
  given.clear();
  state.faces = [];
  state.cannotDraw = '';
  const fonts = JSON.parse(loaded.query('fonts')) as string[] | { error: string };
  if (!Array.isArray(fonts)) {
    state.cannotDraw = fonts.error;
    return;
  }
  const missing: string[] = [];
  const files: ProjectFile[] = [];
  for (const font of fonts) {
    const bytes = await fetchFile(font);
    if (bytes) files.push({ path: font, bytes });
    else missing.push(font);
  }
  if (missing.length) {
    state.cannotDraw = missing.length === 1
      ? `the card layout's font ${missing[0]} is neither in the project nor installed.`
      : `the card layout's fonts ${missing.join(', ')} are neither in the project nor installed.`;
    return;
  }
  loaded.add(files);
  for (const f of files) given.add(f.path);
  const faces = JSON.parse(loaded.query('faces')) as Face[] | { error: string };
  if (!Array.isArray(faces)) {
    state.cannotDraw = faces.error;
    return;
  }
  state.faces = faces.filter((f) => f.finish === 'standard');
}

/** Draws each face in turn, fetching what it uses, and puts it on the page as it is done. */
async function drawAll() {
  const mine = ++generation;
  if (!project || !state.faces.length) return;
  // Every face laid out at once: one layout, not one per face.
  const lists = new Map<string, string>();
  const all = project.query('draw-lists finish=standard');
  if (all.startsWith('{')) {
    state.cannotDraw = (JSON.parse(all) as { error: string }).error;
    state.faces = [];
    render();
    return;
  }
  for (const part of all.split(/^=== /m).slice(1)) {
    const end = part.indexOf('\n');
    lists.set(part.slice(0, end).split(' ').slice(0, 4).join(' '), part.slice(end + 1));
  }
  for (const face of state.faces) {
    if (mine !== generation || !project) return;
    const words = faceWords(face);
    if (drawn.has(words)) continue;
    const list = lists.get(words) ?? '{"error":"The core laid out no such face."}';
    const known = byList.get(list);
    if (known) {
      drawn.set(words, known);
      showDrawn(face);
      continue;
    }
    let entry: { url?: string; error?: string };
    try {
      if (list.startsWith('{')) throw new Error((JSON.parse(list) as { error: string }).error);
      const files: ProjectFile[] = [];
      for (const path of drawnFiles(list)) {
        if (given.has(path)) continue;
        const bytes = await fetchFile(path);
        if (bytes) files.push({ path, bytes });
      }
      if (mine !== generation) return;
      project.add(files);
      for (const f of files) given.add(f.path);
      entry = { url: URL.createObjectURL(new Blob([project.png(list) as BlobPart], { type: 'image/png' })) };
    } catch (e) {
      entry = { error: e instanceof Error ? e.message : String(e) };
    }
    if (entry.url) byList.set(list, entry);
    drawn.set(words, entry);
    showDrawn(face);
  }
}

function showDrawn(face: Face) {
  const slot = app.querySelector<HTMLElement>(`[data-face="${CSS.escape(faceWords(face))}"]`);
  if (slot) slot.innerHTML = drawnView(face);
}

function drawnView(face: Face): string {
  const entry = drawn.get(faceWords(face));
  if (!entry) return '<span class="quiet">Drawing…</span>';
  if (entry.error) return `<span class="bad-note">${esc(entry.error)}</span>`;
  return `<img src="${entry.url}" alt="${esc(face.card)}${face.face === 'back' ? ' (back)' : ''}">`;
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

function render() {
  const errors = state.diagnostics.filter((d) => d.severity === 'error').length;
  const title = text(state.game, 'name') ?? state.root;
  app.innerHTML = `
    <header>
      <b>${esc(title)}</b>
      <span class="${errors ? 'bad' : 'good'}">${errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'No errors'}</span>
      <small>${state.cards.length} card${state.cards.length === 1 ? '' : 's'} · read at ${esc(state.loadedAt)}</small>
    </header>
    ${state.failure ? `<p class="failure">${esc(state.failure)}</p>` : ''}
    <main>
      <nav>${fileTree()}</nav>
      <section class="middle">${state.selected ? fileView(state.selected) : cardsView()}${diagnosticsView()}</section>
      <aside>${rulebookView()}</aside>
    </main>`;
}

function fileTree(): string {
  const counts = new Map<string, number>();
  for (const d of state.diagnostics) counts.set(d.file, (counts.get(d.file) ?? 0) + 1);
  const item = (f: WorkspaceFile) => {
    const n = counts.get(f.path);
    return `<button class="file ${state.selected === f.path ? 'on' : ''}" data-file="${esc(f.path)}">${esc(f.path)}${n ? `<i>${n}</i>` : ''}</button>`;
  };
  return `<button class="file ${state.selected === null ? 'on' : ''}" data-file="">Cards</button>
    <h3>Files</h3>${state.files.filter((f) => f.path.endsWith('.alex')).map(item).join('')}
    <h3>Other files</h3>${state.files.filter((f) => !f.path.endsWith('.alex')).map(item).join('')}`;
}

function fileView(path: string): string {
  const source = state.sources.get(path);
  if (source === undefined) {
    return /\.(webp|png|jpe?g|svg)$/i.test(path)
      ? `<h2>${esc(path)}</h2><img class="picture" src="api/file?path=${encodeURIComponent(path)}" alt="">`
      : `<h2>${esc(path)}</h2><p class="quiet">Not a text file.</p>`;
  }
  const marked = new Set(state.diagnostics.filter((d) => d.file === path).map((d) => d.line));
  const lines = source.split(/\r?\n/).map((line, i) => `<li class="${marked.has(i + 1) ? 'marked' : ''}"><span>${esc(line) || ' '}</span></li>`);
  return `<h2>${esc(path)}</h2><ol class="source">${lines.join('')}</ol>`;
}

/** Where a card's picture is: its art path, from the folder of the file the card is written in. */
function artUrl(card: Card): string | null {
  const art = text(card.card, 'art');
  if (!art) return null;
  const file = state.documents.find((d) => d.name === card.document)?.file ?? '';
  const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  return `api/file?path=${encodeURIComponent(folder + art)}`;
}

/** Card text with the card's own `{constants}` and the game's `{@constants}` filled in. */
function filled(textValue: string, card: Record_): string {
  const own = isRecord(card.constants) ? card.constants : {};
  const game = isRecord(state.game?.constants) ? state.game!.constants as Record_ : {};
  return textValue.replace(/\{(@?)([a-z][\w-]*)\}/g, (all, at: string, name: string) => {
    const value = (at ? game : own)[name];
    return typeof value === 'number' || typeof value === 'string' ? String(value) : all;
  });
}

function cardsView(): string {
  if (state.faces.length) {
    const sets = new Map<string, Face[]>();
    for (const f of state.faces) sets.set(f.set, [...(sets.get(f.set) ?? []), f]);
    return [...sets].map(([set, faces]) => `<h2>${esc(set)}</h2><div class="drawn">${faces
      .map((f) => `<figure data-face="${esc(faceWords(f))}">${drawnView(f)}</figure>`).join('')}</div>`).join('');
  }
  const note = state.cannotDraw ? `<p class="quiet">The cards are shown as data: ${esc(state.cannotDraw)}</p>` : '';
  return note + dataCardsView();
}

function dataCardsView(): string {
  if (!state.cards.length) return '<h2>Cards</h2><p class="quiet">No cards yet. Add some to a cards file and save it.</p>';
  const groups = new Map<string, Card[]>();
  for (const c of state.cards) groups.set(c.document, [...(groups.get(c.document) ?? []), c]);
  return [...groups].map(([document, cards]) => `<h2>${esc(document)}</h2><div class="cards">${cards.map(cardView).join('')}</div>`).join('');
}

function cardView(entry: Card): string {
  const c = entry.card;
  const art = artUrl(entry);
  const name = text(c, 'name') ?? entry.key;
  const epithet = text(c, 'epithet');
  const type = String(c.$type ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const stat = (field: string, label: string) => (typeof c[field] === 'number' ? `<span title="${label}">${label[0]} ${c[field]}</span>` : '');
  const body = text(c, 'text');
  const flavor = text(c, 'flavor');
  return `<article class="card">
    <div class="art" ${art ? `style="background-image:url('${art}')"` : ''}>${art ? '' : '<span>No picture</span>'}</div>
    <div class="name"><b>${esc(name)}</b>${epithet ? `<small>${esc(epithet)}</small>` : ''}</div>
    <div class="type">${esc(type)}<span class="stats">${stat('cost', 'Cost')}${stat('power', 'Power')}${stat('health', 'Health')}</span></div>
    ${body ? `<p class="text">${esc(filled(body, c)).replace(/\n/g, '<br>')}</p>` : ''}
    ${flavor ? `<p class="flavor">${esc(flavor)}</p>` : ''}
  </article>`;
}

function rulebookView(): string {
  const book = state.rulebook;
  if (!book) return '<h2>Rulebook</h2><p class="quiet">No rulebook yet.</p>';
  const sections = isRecord(book.sections) ? Object.entries(book.sections).filter(([k]) => !k.startsWith('$')) : [];
  return `<h2>${esc(text(book, 'title') ?? 'Rulebook')}</h2>
    ${text(book, 'preface') ? `<p>${esc(filled(text(book, 'preface')!, {}))}</p>` : ''}
    ${sections.map(([key, s]) => {
      const section = isRecord(s) ? s : {};
      const number = section.number ?? '';
      const body = text(section, 'text') ?? '';
      return `<section><h3>${esc(String(number))} ${esc(text(section, 'title') ?? key)}</h3>${body.split(/\n{2,}/).map((p) => `<p>${esc(filled(p, {}))}</p>`).join('')}</section>`;
    }).join('')}`;
}

function diagnosticsView(): string {
  if (!state.diagnostics.length) return '';
  const rows = state.diagnostics.map((d) => `<li class="${d.severity}"><button data-file="${esc(d.file)}">${esc(d.file || state.root)}${d.line ? `:${d.line}` : ''}</button> ${esc(d.message)}</li>`);
  return `<h2 class="problems">Problems</h2><ul class="diagnostics">${rows.join('')}</ul>`;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────────

app.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-file]');
  if (!target) return;
  state.selected = target.dataset.file || null;
  render();
});

// The server says when a file changed; the page reads the project again.
new EventSource('api/events').onmessage = () => void load();

void load();
