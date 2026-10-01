// Kardix Studio, read-only (Stage 3 of docs/tcg/tcg-developer-platform.md). It opens on the cards, one set at a time;
// a card opens its own page: the card as it prints, beside its code behind (where the card is written, and every rule
// that gives it behaviour). The project's files and the rulebook have tabs of their own. `kardix studio` serves this
// page and the project's files; the page loads the core itself and reads the project in the browser, and reads it again
// each time the server says a file changed. The core draws the cards (Stage 4), fetching the fonts and pictures each
// one uses as it draws it; a project whose cards can't be drawn shows their data instead.

import { Core, drawnFiles, type Diagnostic, type Json, type Project, type ProjectFile } from '../engine/host/core';

interface WorkspaceFile { path: string; size: number; modified: string }
type Record_ = { [key: string]: Json };
interface Card { document: string; key: string; card: Record_ }
interface Document { file: string; name: string | null; type: string | null }
interface Face { set: string; card: string; face: 'front' | 'back'; finish: string; file: string }
/** Lines of a file, first and last counted from 1. */
interface Lines { file: string; first: number; last: number }

/** What the page shows, as the address after `#` says it, so the browser's Back works. */
type View =
  | { kind: 'cards'; set: string | null }
  | { kind: 'card'; set: string; key: string }
  | { kind: 'files'; path: string | null; line: number | null }
  | { kind: 'rulebook' }
  | { kind: 'problems' };

const state = {
  root: '',
  files: [] as WorkspaceFile[],
  sources: new Map<string, string>(),
  documents: [] as Document[],
  cards: [] as Card[],
  /** Each set's name as printed, by its document. */
  setNames: new Map<string, string>(),
  game: null as Record_ | null,
  rulebook: null as Record_ | null,
  diagnostics: [] as Diagnostic[],
  faces: [] as Face[],
  /** Why the cards can't be drawn, when they can't. */
  cannotDraw: '',
  search: '',
  loadedAt: '',
  failure: '',
};

const isRecord = (v: Json | undefined): v is Record_ => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
const text = (o: Record_ | null | undefined, field: string) => (o && typeof o[field] === 'string' ? (o[field] as string) : undefined);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
/** Every face's draw list, from the core, by the face's words. */
let lists = new Map<string, string>();
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
    state.setNames = new Map();
    for (const set of new Set(state.cards.map((c) => c.document))) {
      state.setNames.set(set, text(asRecord(project.value(set)), 'name') ?? set);
    }
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
  lists = new Map();
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
  // Every face laid out at once: one layout, not one per face.
  const all = loaded.query('draw-lists finish=standard');
  if (all.startsWith('{')) {
    state.cannotDraw = (JSON.parse(all) as { error: string }).error;
    return;
  }
  for (const part of all.split(/^=== /m).slice(1)) {
    const end = part.indexOf('\n');
    lists.set(part.slice(0, end).split(' ').slice(0, 4).join(' '), part.slice(end + 1));
  }
  state.faces = faces.filter((f) => f.finish === 'standard');
}

/** Draws each face in turn, those on screen first, fetching what each uses, and puts it on the page as it is done.
 * Called again when the view changes, it starts over with the new view's faces; faces already drawn are kept. */
async function drawAll() {
  const mine = ++generation;
  if (!project || !state.faces.length) return;
  const onScreen = new Set([...app.querySelectorAll<HTMLElement>('[data-face]')].map((e) => e.dataset.face!));
  const order = [...state.faces].sort((a, b) => Number(onScreen.has(faceWords(b))) - Number(onScreen.has(faceWords(a))));
  for (const face of order) {
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
  for (const slot of app.querySelectorAll<HTMLElement>(`[data-face="${CSS.escape(faceWords(face))}"]`)) slot.innerHTML = drawnView(face);
}

function drawnView(face: Face): string {
  const entry = drawn.get(faceWords(face));
  if (!entry) return '<span class="quiet">Drawing…</span>';
  if (entry.error) return `<span class="bad-note">${esc(entry.error)}</span>`;
  return `<img src="${entry.url}" alt="${esc(face.card)}${face.face === 'back' ? ' (back)' : ''}">`;
}

// ── where a card is written ────────────────────────────────────────────────────────────────────

/** Where a statement or entry that starts on `start` (an index) ends: the line where its brackets close, outside text
 * in quotes. */
function endOf(lines: string[], start: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (quoted) {
        if (c === "'" && line[j + 1] === "'") j++;
        else if (c === "'") quoted = false;
      } else if (c === "'") quoted = true;
      else if (c === '/' && line[j + 1] === '/') break;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
    }
    if (depth <= 0 && !quoted) return i;
  }
  return lines.length - 1;
}

const fileOf = (document: string) => state.documents.find((d) => d.name === document)?.file ?? '';
const linesOf = (file: string) => (state.sources.get(file) ?? '').split(/\r?\n/);

/** The card's entry in its set's file. */
function cardSource(card: Card): Lines | null {
  const file = fileOf(card.document);
  const lines = linesOf(file);
  const pattern = new RegExp(`^\\s*${card.key.replace(/[-]/g, '\\-')}\\s*=`);
  const first = lines.findIndex((l) => pattern.test(l));
  if (first < 0) return null;
  return { file, first: first + 1, last: endOf(lines, first) + 1 };
}

/** Every rule a rules file gives the card (`@klobuk.on-enter = Draw()`, `@pebble.back.static = ...`), with the
 * comment lines just above it. */
function cardRules(card: Card): Lines[] {
  const found: Lines[] = [];
  const pattern = new RegExp(`^@${card.key.replace(/[-]/g, '\\-')}[.\\s=]`);
  for (const document of state.documents) {
    if (document.type !== 'Rules') continue;
    const lines = linesOf(document.file);
    for (let i = 0; i < lines.length; i++) {
      if (!pattern.test(lines[i])) continue;
      let first = i;
      while (first > 0 && lines[first - 1].trimStart().startsWith('//')) first--;
      const last = endOf(lines, i);
      found.push({ file: document.file, first: first + 1, last: last + 1 });
      i = last;
    }
  }
  return found;
}

/** What the card and its rules refer to by name (`@is-well-fed`, `@pebble-text`), where it is defined. */
function usedValues(rules: Lines[]): Lines[] {
  const names = new Set<string>();
  const collect = (at: Lines) => {
    for (const line of linesOf(at.file).slice(at.first - 1, at.last)) {
      for (const m of line.matchAll(/(?<!@)@([A-Za-z][\w-]*)(?![\w.-])/g)) names.add(m[1]);
    }
  };
  rules.forEach(collect);
  const found: Lines[] = [];
  // A definition may refer to others in turn (`@is-well-fed` to `@well-fed-at`): the set grows as it is walked.
  for (const name of names) {
    const pattern = new RegExp(`^\\s+${name.replace(/[-]/g, '\\-')}\\s*=`);
    for (const document of state.documents) {
      const lines = linesOf(document.file);
      const at = lines.findIndex((l) => pattern.test(l));
      if (at >= 0) {
        found.push({ file: document.file, first: at + 1, last: endOf(lines, at) + 1 });
        collect(found[found.length - 1]);
        break;
      }
      // Long text is written at the end of its file, after `@@@ name`, up to the next `@@@` or the end.
      const block = lines.findIndex((l) => l.trimEnd() === `@@@ ${name}`);
      if (block >= 0) {
        let last = block + 1;
        while (last + 1 < lines.length && !lines[last + 1].startsWith('@@@')) last++;
        while (last > block && !lines[last].trim()) last--;
        found.push({ file: document.file, first: block + 1, last: last + 1 });
        break;
      }
    }
  }
  return found;
}

const problemsIn = (at: Lines) => state.diagnostics.filter((d) => d.file === at.file && d.line >= at.first && d.line <= at.last);

// ── drawing the page ───────────────────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

function currentView(): View {
  const [kind, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (kind === 'card' && rest.length >= 2) return { kind: 'card', set: rest[0], key: rest[1] };
  if (kind === 'files') {
    const path = rest.join('/');
    const at = path.match(/^(.*):(\d+)$/);
    return { kind: 'files', path: (at ? at[1] : path) || null, line: at ? Number(at[2]) : null };
  }
  if (kind === 'rulebook') return { kind: 'rulebook' };
  if (kind === 'problems') return { kind: 'problems' };
  return { kind: 'cards', set: kind === 'set' && rest[0] ? rest[0] : null };
}

/** The sets, those the core draws first; a prototype the game doesn't list yet is shown as data, after them. */
const sets = () => {
  const all = [...new Set(state.cards.map((c) => c.document))];
  const isDrawn = (s: string) => state.faces.some((f) => f.set === s);
  return [...all.filter(isDrawn), ...all.filter((s) => !isDrawn(s))];
};
const cardLink = (c: Card) => `#card/${encodeURIComponent(c.document)}/${encodeURIComponent(c.key)}`;
const fileLink = (file: string, line?: number) => `#files/${file.split('/').map(encodeURIComponent).join('/')}${line ? `:${line}` : ''}`;
const nameOf = (c: Card) => text(c.card, 'name') ?? c.key;

function render() {
  const view = currentView();
  const errors = state.diagnostics.filter((d) => d.severity === 'error').length;
  const title = text(state.game, 'name') ?? state.root;
  const tab = (href: string, label: string, on: boolean) => `<a class="tab ${on ? 'on' : ''}" href="${href}">${label}</a>`;
  app.innerHTML = `
    <header>
      <b>${esc(title)}</b>
      <nav class="tabs">
        ${tab('#', 'Cards', view.kind === 'cards' || view.kind === 'card')}
        ${state.rulebook ? tab('#rulebook', 'Rulebook', view.kind === 'rulebook') : ''}
        ${tab('#files', 'Files', view.kind === 'files')}
        ${tab('#problems', errors ? `<span class="bad">${plural(errors, 'error')}</span>` : '<span class="good">No errors</span>', view.kind === 'problems')}
      </nav>
      <small>read at ${esc(state.loadedAt)}</small>
    </header>
    ${state.failure ? `<p class="failure">${esc(state.failure)}</p>` : ''}
    ${body(view)}`;
  if (view.kind === 'files' && view.line) app.querySelector(`#line-${view.line}`)?.scrollIntoView({ block: 'center' });
  if (view.kind === 'cards') {
    const search = app.querySelector<HTMLInputElement>('#search');
    if (search && state.search) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }
}

function body(view: View): string {
  switch (view.kind) {
    case 'cards': return cardsPage(view.set);
    case 'card': return cardPage(view.set, view.key);
    case 'files': return filesPage(view.path, view.line);
    case 'rulebook': return `<main class="reading">${rulebookView()}</main>`;
    case 'problems': return `<main class="reading">${problemsView()}</main>`;
  }
}

// ── the cards ──────────────────────────────────────────────────────────────────────────────────

function cardsPage(chosen: string | null): string {
  const all = sets();
  const set = chosen && all.includes(chosen) ? chosen : all[0] ?? null;
  const search = state.search.trim().toLowerCase();
  const shown = search
    ? state.cards.filter((c) => `${nameOf(c)} ${c.key} ${text(c.card, 'epithet') ?? ''}`.toLowerCase().includes(search))
    : state.cards.filter((c) => c.document === set);
  const setButton = (s: string) => {
    const count = state.cards.filter((c) => c.document === s).length;
    const errors = state.diagnostics.filter((d) => d.file === fileOf(s) && d.severity === 'error').length;
    return `<a class="set ${!search && s === set ? 'on' : ''}" href="#set/${encodeURIComponent(s)}">
      <span>${esc(state.setNames.get(s) ?? s)}</span><small>${errors ? `<i>${errors}</i>` : ''}${count}</small></a>`;
  };
  const heading = search
    ? `${plural(shown.length, 'card')} matching “${esc(state.search.trim())}”`
    : esc(state.setNames.get(set ?? '') ?? set ?? 'Cards');
  const note = state.cannotDraw ? `<p class="quiet">The cards are shown as data: ${esc(state.cannotDraw)}</p>` : '';
  return `<main class="browse">
    <nav class="sets">
      <input id="search" type="search" placeholder="Find a card" value="${esc(state.search)}" autocomplete="off">
      <h3>Sets</h3>
      ${all.map(setButton).join('') || '<p class="quiet">No sets yet.</p>'}
    </nav>
    <section class="grid-page">
      <h2>${heading}</h2>${note}
      ${shown.length ? `<div class="grid">${shown.map(tile).join('')}</div>` : '<p class="quiet">No cards here yet.</p>'}
    </section>
  </main>`;
}

function frontOf(card: Card): Face | undefined {
  return state.faces.find((f) => f.set === card.document && f.card === card.key && f.face === 'front');
}

function tile(card: Card): string {
  const face = frontOf(card);
  const rules = cardRules(card).length;
  const source = cardSource(card);
  const problems = source ? problemsIn(source).length + cardRules(card).reduce((n, r) => n + problemsIn(r).length, 0) : 0;
  return `<a class="tile" href="${cardLink(card)}" title="Open ${esc(nameOf(card))}">
    ${face ? `<figure data-face="${esc(faceWords(face))}">${drawnView(face)}</figure>` : cardView(card)}
    <span class="caption"><b>${esc(nameOf(card))}</b><small>${problems ? `<i>${plural(problems, 'problem')}</i>` : rules ? plural(rules, 'rule') : 'no rules'}</small></span>
  </a>`;
}

function cardPage(set: string, key: string): string {
  const card = state.cards.find((c) => c.document === set && c.key === key);
  if (!card) return `<main class="reading"><p><a href="#">← All cards</a></p><p class="quiet">There is no card ${esc(key)} in ${esc(set)}.</p></main>`;
  const siblings = state.cards.filter((c) => c.document === set);
  const at = siblings.indexOf(card);
  const previous = siblings[at - 1];
  const next = siblings[at + 1];
  const faces = state.faces.filter((f) => f.set === set && f.card === key);
  const switcher = faces.length > 1
    ? `<div class="faces">${faces.map((f, i) => `<button data-show="${i}" class="${i ? '' : 'on'}">${f.face === 'front' ? 'Front' : 'Back'}</button>`).join('')}</div>`
    : '';
  const pictures = faces.length
    ? switcher + faces.map((f, i) => `<figure class="big" data-face="${esc(faceWords(f))}" ${i ? 'hidden' : ''}>${drawnView(f)}</figure>`).join('')
    : cardView(card);
  const source = cardSource(card);
  const rules = cardRules(card);
  const used = usedValues(source ? [source, ...rules] : rules);
  return `<main class="card-page">
    <div class="card-bar">
      <a href="#set/${encodeURIComponent(set)}">← ${esc(state.setNames.get(set) ?? set)}</a>
      <h2>${esc(nameOf(card))}</h2>
      <span class="steps">
        ${previous ? `<a href="${cardLink(previous)}" title="Previous card (←)">‹ ${esc(nameOf(previous))}</a>` : ''}
        ${next ? `<a href="${cardLink(next)}" title="Next card (→)">${esc(nameOf(next))} ›</a>` : ''}
      </span>
    </div>
    <div class="card-body">
      <div class="pictures">${pictures}</div>
      <div class="behind">
        <h3>The card</h3>
        ${source ? snippet(source) : `<p class="quiet">Not found in ${esc(fileOf(set))}.</p>`}
        <h3>Its rules</h3>
        ${rules.length ? rules.map(snippet).join('') : `<p class="quiet">${noRulesNote(card)}</p>`}
        ${used.length ? `<h3>What it refers to</h3>${used.map(snippet).join('')}` : ''}
      </div>
    </div>
  </main>`;
}

function noRulesNote(card: Card): string {
  return text(card.card, 'text')
    ? 'No rules file gives this card behaviour. If its text is only abilities (Guardian, Swift…), it needs none.'
    : 'None: the card has no text.';
}

/** Lines of a file, numbered, with the file's name as a link that opens the whole file there, and their problems. */
function snippet(at: Lines): string {
  const lines = linesOf(at.file).slice(at.first - 1, at.last);
  const problems = problemsIn(at);
  const marked = new Set(problems.map((d) => d.line));
  const rows = lines.map((line, i) => {
    const n = at.first + i;
    return `<li value="${n}" class="${marked.has(n) ? 'marked' : ''}"><span>${esc(line) || ' '}</span></li>`;
  });
  return `<div class="snippet">
    <a class="where" href="${fileLink(at.file, at.first)}">${esc(at.file)}, line ${at.first}${at.last > at.first ? `–${at.last}` : ''}</a>
    <ol class="source">${rows.join('')}</ol>
    ${problems.map((d) => `<p class="problem ${d.severity}">Line ${d.line}: ${esc(d.message)}</p>`).join('')}
  </div>`;
}

/** Where a card's picture is: its art path, from the folder of the file the card is written in. */
function artUrl(card: Card): string | null {
  const art = text(card.card, 'art');
  if (!art) return null;
  const file = fileOf(card.document);
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

/** A card shown as its data, when the cards can't be drawn. */
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

// ── files, rulebook, problems ──────────────────────────────────────────────────────────────────

function filesPage(path: string | null, line: number | null): string {
  const counts = new Map<string, number>();
  for (const d of state.diagnostics) counts.set(d.file, (counts.get(d.file) ?? 0) + 1);
  const item = (f: WorkspaceFile) => {
    const n = counts.get(f.path);
    return `<a class="file ${path === f.path ? 'on' : ''}" href="${fileLink(f.path)}">${esc(f.path)}${n ? `<i>${n}</i>` : ''}</a>`;
  };
  const alex = state.files.filter((f) => f.path.endsWith('.alex'));
  const other = state.files.filter((f) => !f.path.endsWith('.alex'));
  return `<main class="browse">
    <nav class="sets files">
      <h3>Alex files</h3>${alex.map(item).join('')}
      <h3>Other files</h3>${other.map(item).join('')}
    </nav>
    <section class="grid-page">${path ? fileView(path, line) : '<p class="quiet">Choose a file.</p>'}</section>
  </main>`;
}

function fileView(path: string, line: number | null): string {
  const source = state.sources.get(path);
  if (source === undefined) {
    return /\.(webp|png|jpe?g|svg)$/i.test(path)
      ? `<h2>${esc(path)}</h2><img class="picture" src="api/file?path=${encodeURIComponent(path)}" alt="">`
      : `<h2>${esc(path)}</h2><p class="quiet">Not a text file.</p>`;
  }
  const marked = new Set(state.diagnostics.filter((d) => d.file === path).map((d) => d.line));
  const lines = source.split(/\r?\n/).map((l, i) =>
    `<li id="line-${i + 1}" class="${marked.has(i + 1) ? 'marked' : ''} ${line === i + 1 ? 'here' : ''}"><span>${esc(l) || ' '}</span></li>`);
  return `<h2>${esc(path)}</h2><ol class="source">${lines.join('')}</ol>`;
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

function problemsView(): string {
  if (!state.diagnostics.length) return '<h2>Problems</h2><p class="quiet">None. Every file reads, and every card has what it needs.</p>';
  const rows = state.diagnostics.map((d) => `<li class="${d.severity}"><a href="${fileLink(d.file, d.line)}">${esc(d.file || state.root)}${d.line ? `, line ${d.line}` : ''}</a> ${esc(d.message)}</li>`);
  return `<h2>Problems</h2><ul class="diagnostics">${rows.join('')}</ul>`;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
  void drawAll();
});

app.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== 'search') return;
  state.search = input.value;
  render();
  void drawAll();
});

// A card with a back: the switch above the picture shows one face at a time.
app.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-show]');
  if (!button) return;
  const index = Number(button.dataset.show);
  app.querySelectorAll<HTMLElement>('.pictures .big').forEach((f, i) => { f.hidden = i !== index; });
  app.querySelectorAll<HTMLElement>('.faces button').forEach((b, i) => b.classList.toggle('on', i === index));
});

// On a card's page, ← and → step through the set, and Escape goes back to it.
document.addEventListener('keydown', (e) => {
  const view = currentView();
  if (view.kind !== 'card' || (e.target as HTMLElement).tagName === 'INPUT') return;
  const siblings = state.cards.filter((c) => c.document === view.set);
  const at = siblings.findIndex((c) => c.key === view.key);
  const go = e.key === 'ArrowLeft' ? siblings[at - 1] : e.key === 'ArrowRight' ? siblings[at + 1] : undefined;
  if (go) location.hash = cardLink(go);
  else if (e.key === 'Escape') location.hash = `#set/${encodeURIComponent(view.set)}`;
});

// The server says when a file changed; the page reads the project again.
new EventSource('api/events').onmessage = () => void load();

void load();
