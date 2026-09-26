import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { defineConfig, type Plugin } from 'vite';

// Interface art lives in the repo's art/ folder and is served as-is. Each card set's art lives in its own
// folder, content/<year>/<month>/<set>/, and is published at stable addresses (contentAssets below):
// /<set>/<id>.webp (illustrations), /cards/<set>/<id>.webp (finished cards, finishes in subfolders) and
// /announcements/<set-folder>/ (its announcement page).
// Pages: the game (index.html), plus the documentation rendered from docs/: its home (docs.html), the
// getting-started guides (how to play, your account, friends, the Collection, wallpapers), then the rulebook
// (rules.html), the card list (cards.html) and what's on a card (anatomy.html). And the Artist Studio (studio.html, docs/artist-studio-plan.md), where artists
// upload their pictures and see them on cards. And the owner's playtest dashboard (playtests.html, docs/playtests.md).

/** The documentation's pages, in tab order. `tab` is the section's name in the header; the home has none. */
const DOC_PAGES: { md: string; html: string; tab?: string }[] = [
  { md: 'documentation.md', html: 'docs.html' },
  // Getting started first, then the reference: the rulebook, the card list and what's on a card.
  { md: 'how-to-play.md', html: 'how-to-play.html', tab: 'How to play' },
  { md: 'account.md', html: 'account.html', tab: 'Account' },
  { md: 'friends.md', html: 'friends.html', tab: 'Friends' },
  { md: 'collection.md', html: 'collection.html', tab: 'Collection' },
  { md: 'wallpapers.md', html: 'wallpapers.html', tab: 'Wallpapers' },
  { md: 'rulebook.md', html: 'rules.html', tab: 'Rulebook' },
  { md: 'starter-box-cards.md', html: 'cards.html', tab: 'Card list' },
  { md: 'card-anatomy.md', html: 'anatomy.html', tab: 'Card anatomy' },
  // Linked from the sign-up screen; no tabs of their own.
  { md: 'legal/terms-of-use.md', html: 'terms.html' },
  { md: 'legal/privacy-policy.md', html: 'privacy.html' },
  { md: 'legal/refund-policy.md', html: 'refunds.html' },
];

// Accounts (src/flags.ts) are on in every build since 2026-09-24: while sign-up needs a playtest invite code, the
// public site has them too. `vite build --mode playtest` (npm run build:playtest) builds into dist-playtest/ for the
// playtest site; any feature still hidden from the public goes in its `define` only.
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    'import.meta.env.VITE_ACCOUNTS': JSON.stringify('on'),
    // When this build was made, shown at the bottom of the Artist Studio: which version a device has, at a glance.
    'import.meta.env.VITE_BUILT': JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
    // The Store is in every build, but the Fruitcats API opens it only to its testers: everyone else's Store tile still
    // says "Coming soon" (store-plan.md, Hidden until launch).
    'import.meta.env.VITE_STORE': JSON.stringify('on'),
    // Online play with friends (docs/pvp-plan.md), in every build: it needs an account, and accounts are for invited
    // playtesters only, so only they can play. The API's fixed ceiling and waiting line limit what it can cost.
    'import.meta.env.VITE_ONLINE': JSON.stringify('on'),
  },
  publicDir: fileURLToPath(new URL('../../art', import.meta.url)),
  // This checkout's own packages, always: from a worktree without node_modules, @fruitcats/store would otherwise come
  // from the main checkout and bring a second engine with none of the cards.
  resolve: {
    alias: {
      '@fruitcats/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
      '@fruitcats/store': fileURLToPath(new URL('../../packages/store/src/index.ts', import.meta.url)),
      '@fruitcats/match': fileURLToPath(new URL('../../packages/match/src/index.ts', import.meta.url)),
    },
  },
  plugins: [docsPages(), contentAssets(), idPassThrough()],
  build: {
    outDir: mode === 'playtest' ? 'dist-playtest' : 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        studio: fileURLToPath(new URL('studio.html', import.meta.url)),
        playtests: fileURLToPath(new URL('playtests.html', import.meta.url)),
        ...Object.fromEntries(DOC_PAGES.map((d) => [d.html.replace('.html', ''), fileURLToPath(new URL(d.html, import.meta.url))])),
      },
    },
  },
  // PORT lets two checkouts (e.g. git worktrees) run dev servers side by side.
  server: {
    port: Number(process.env.PORT) || 5173, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
}));

// ── Docs pages ─────────────────────────────────────────────────────────────────────────────────
//
// The documentation: each page is rendered from its Markdown in docs/ at build time (and on each request
// in dev), so the docs stay the one source of truth and the published pages are plain HTML. Every page
// gets the same header: "Documentation" (its home) and a tab for each section. Links between docs point
// at their pages; a link to a doc without a page fails the build rather than falling back to GitHub.
// Every heading is an anchor, so any section can be sent as a link (wallpapers.html#with-a-shortcut).

const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url));
// Keyed by file name, so docs/legal/ pages link to each other as "terms-of-use.md".
const PAGES: Record<string, string> = Object.fromEntries(DOC_PAGES.map((d) => [d.md.split('/').pop()!, d.html]));

/** The header every docs page shares: Home, "Documentation", and the sections as tabs. */
function docHeader(current: string): string {
  const tabs = DOC_PAGES.filter((d) => d.tab).map((d) =>
    `<a class="doc-tab" href="./${d.html}"${d.html === current ? ' aria-current="page"' : ''}>${d.tab}</a>`).join('');
  return `<div class="doc-head">
      <header class="topbar">
        <a class="home-button" href="./" title="Play Fruitcats" aria-label="Play Fruitcats"><img src="./ui/icon-home.webp" alt="" width="30" height="30" /></a>
        <a class="page-title" href="./docs.html"${current === 'docs.html' ? ' aria-current="page"' : ''}>Documentation</a>
        <span class="topbar-balance" aria-hidden="true"></span>
      </header>
      <nav class="doc-tabs" aria-label="Sections">${tabs}</nav>
    </div>`;
}

/** A chain link: the button beside every heading that copies a link to that section. */
const LINK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">'
  + '<path d="M10.5 13.5a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1.1 1.1"/><path d="M13.5 10.5a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1.1-1.1"/></g></svg>';

const slug = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function renderDoc(doc: string): { toc: string; body: string } {
  const toc: string[] = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slug(html);
        if (depth === 2 || depth === 3) toc.push(`<li${depth === 3 ? ' class="sub"' : ''}><a href="#${id}">${html}</a></li>`);
        // The link button is a real link you can tap on a phone; docs.ts also copies it to the clipboard.
        return `<h${depth} id="${id}">${html}`
          + `<a class="anchor" href="#${id}" aria-label="Copy a link to this section" title="Copy a link to this section">${LINK_ICON}</a>`
          + `</h${depth}>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const md = /^([\w-]+\.md)(#.*)?$/.exec(href);
        if (!md) return `<a href="${href}">${text}</a>`;
        if (!PAGES[md[1]]) throw new Error(`docs/${doc} links to ${md[1]}, which has no page: add it to PAGES in vite.config.ts`);
        return `<a href="./${PAGES[md[1]]}${md[2] ?? ''}">${text}</a>`;
      },
    },
  });
  // Wide tables scroll sideways on phones instead of widening the page.
  let body = marked.parse(readFileSync(DOCS + doc, 'utf8'), { async: false })
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  body = foldAway(body, 'comprehensive rules');
  return { toc: `<ol>${toc.join('')}</ol>`, body };
}

/**
 * Fold a heavy reference section away behind a summary: the comprehensive rules in full read as "this game is
 * enormous", even on the rulebook.
 */
function foldAway(html: string, needle: string): string {
  const start = html.search(new RegExp(`<h2[^>]*>[^<]*${needle}`, 'i'));
  if (start < 0) return html;
  const after = html.indexOf('<h2', start + 4);
  const end = after < 0 ? html.length : after;
  const section = html.slice(start, end);
  const title = /<h2[^>]*>(.*?)<a class="anchor"/s.exec(section)?.[1]?.trim() ?? 'Comprehensive rules';
  return html.slice(0, start)
    + `<details class="fold"><summary>${title} — the exact wording, for judges and rules lawyers</summary>`
    + section + '</details>' + html.slice(end);
}

function docsPages(): Plugin {
  return {
    name: 'fruitcats-docs',
    configureServer(server) {
      server.watcher.add(DOCS);
      server.watcher.on('change', (file) => {
        if (resolve(file).startsWith(resolve(DOCS))) server.ws.send({ type: 'full-reload' });
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const page = DOC_PAGES.find((d) => ctx.filename.replace(/\\/g, '/').endsWith(`/${d.html}`));
        if (!page) return html;
        const { toc, body } = renderDoc(page.md);
        return html.replace('<!-- doc:header -->', docHeader(page.html)).replace('<!-- doc:toc -->', toc).replace('<!-- doc:body -->', body);
      },
    },
  };
}

// ── Card sets' art ─────────────────────────────────────────────────────────────────────────────────
//
// Every set folder in content/ publishes its art at the addresses the game, wallpapers and announcement
// pages use: served straight from the folder in dev, and copied into the build. A set's folder is the one
// place its art lives; nothing is duplicated in the repo.

const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url));

/** Every set folder in content/: its root, its code and its data. */
function contentSets(): { root: string; folder: string; code: string; data: Record<string, unknown> }[] {
  const sets: { root: string; folder: string; code: string; data: Record<string, unknown> }[] = [];
  const dirs = (d: string) => (existsSync(d) ? readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()) : []);
  for (const year of dirs(CONTENT))
    for (const month of dirs(join(CONTENT, year)))
      for (const folder of dirs(join(CONTENT, year, month))) {
        const root = join(CONTENT, year, month, folder);
        if (!existsSync(join(root, 'set.json'))) continue;
        const data = JSON.parse(readFileSync(join(root, 'set.json'), 'utf8'));
        sets.push({ root, folder, code: String(data.set).toLowerCase(), data });
      }
  // A set that builds on another (Heat Wave uses the Starter Box's Garden cards) comes after it.
  const needs = (s: { data: Record<string, unknown> }) => (s.data.requires as string[] | undefined) ?? [];
  return sets.sort((a, b) => (needs(a).includes(String(b.data.set)) ? 1 : needs(b).includes(String(a.data.set)) ? -1 : 0));
}

/**
 * The card packs: an index of every set, and each set's data, so a running game can take a set it wasn't
 * built with (apps/web/src/content.ts, loadPacks). Its art is published beside it (contentMounts).
 */
function packFiles(): Record<string, string> {
  const sets = contentSets();
  const files: Record<string, string> = {
    'packs/index.json': JSON.stringify({
      packs: sets.map((s) => ({
        set: s.data.set, name: s.data.name, version: s.data.version, status: s.data.status,
        data: `packs/${s.code}/set.json`, art: `${s.code}/`, cards: `cards/${s.code}/`,
      })),
    }, null, 1),
  };
  for (const s of sets) files[`packs/${s.code}/set.json`] = JSON.stringify(s.data);
  // The Artist Studio (studio.html): each set's art brief, and the list of sets that have one.
  const briefs = sets.filter((s) => existsSync(join(s.root, 'art', 'brief.json')));
  files['studio/index.json'] = JSON.stringify({
    sets: briefs.map((s) => ({ set: s.data.set, code: s.code, name: s.data.name, status: s.data.status, folder: s.folder })),
  }, null, 1);
  for (const s of briefs) files[`studio/${s.code}/brief.json`] = readFileSync(join(s.root, 'art', 'brief.json'), 'utf8');
  return files;
}

/** Each set's folders and the address each is published at. */
function contentMounts(): { url: string; dir: string }[] {
  const mounts: { url: string; dir: string }[] = [];
  for (const { root, folder, code } of contentSets())
    mounts.push(
      { url: `/${code}/`, dir: join(root, 'art', 'illustrations') },
      { url: `/cards/${code}/`, dir: join(root, 'art', 'cards') },
      { url: `/announcements/${folder}/`, dir: join(root, 'announcement') },
      // Legend Pawtraits come with a card of the set; everyday ones (art/avatars/, the public folder) share /avatars/.
      { url: '/avatars/', dir: join(root, 'avatars') },
    );
  return mounts.filter((m) => existsSync(m.dir));
}

const TYPES: Record<string, string> = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.css': 'text/css',
  '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml',
};

function contentAssets(): Plugin {
  let outDir = '';
  return {
    name: 'fruitcats-content-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const pack = packFiles()[path.replace(/^\//, '')];
        if (pack) {
          res.setHeader('Content-Type', 'application/json');
          res.end(pack);
          return;
        }
        for (const m of contentMounts()) {
          if (!path.startsWith(m.url) && path !== m.url.slice(0, -1)) continue;
          let file = join(m.dir, path.slice(m.url.length));
          if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
          if (!existsSync(file)) break;
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
    writeBundle() {
      for (const m of contentMounts()) cpSync(m.dir, join(outDir, m.url), { recursive: true });
      for (const [file, text] of Object.entries(packFiles())) {
        mkdirSync(dirname(join(outDir, file)), { recursive: true });
        writeFileSync(join(outDir, file), text);
      }
    },
  };
}

// ── Sign-in on any dev port ──────────────────────────────────────────────────────────────────────
//
// viamochi-id accepts browser calls only from the game's sites and from a dev server on port 5173. A dev server on
// another port (a second checkout running side by side) sends them to /__id here instead (src/auth.ts), and this
// passes them on as if from 5173, to the service's Azure address (its own domain can hang over IPv6 from here). Dev only.

function idPassThrough(): Plugin {
  return {
    name: 'fruitcats-id-pass-through',
    configureServer(server) {
      server.middlewares.use('/__id', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers: Record<string, string> = {};
        for (const name of ['content-type', 'authorization', 'accept']) {
          const value = req.headers[name];
          if (typeof value === 'string') headers[name] = value;
        }
        headers.origin = 'http://localhost:5173';
        try {
          const r = await fetch(`https://viamochi-id.azurewebsites.net${req.url ?? '/'}`, {
            method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          res.statusCode = r.status;
          const type = r.headers.get('content-type');
          if (type) res.setHeader('Content-Type', type);
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
    },
  };
}
