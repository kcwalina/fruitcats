import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { defineConfig, type Plugin } from 'vite';

// Card art lives in the repo's art/ folder and is served as-is: /sb1/<id>.webp (illustrations)
// and /cards/sb1/<id>.webp (finished cards).
// Pages: the game (index.html), plus the documentation rendered from docs/: its home (docs.html), the
// rulebook (rules.html), the card list (cards.html), and guides to the Collection and to wallpapers.

/** The documentation's pages, in tab order. `tab` is the section's name in the header; the home has none. */
const DOC_PAGES: { md: string; html: string; tab?: string }[] = [
  { md: 'documentation.md', html: 'docs.html' },
  { md: 'rulebook.md', html: 'rules.html', tab: 'Rulebook' },
  { md: 'starter-box-cards.md', html: 'cards.html', tab: 'Card list' },
  { md: 'collection.md', html: 'collection.html', tab: 'Collection' },
  { md: 'wallpapers.md', html: 'wallpapers.html', tab: 'Wallpapers' },
];

export default defineConfig({
  base: './',
  publicDir: fileURLToPath(new URL('../../art', import.meta.url)),
  plugins: [docsPages()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        ...Object.fromEntries(DOC_PAGES.map((d) => [d.html.replace('.html', ''), fileURLToPath(new URL(d.html, import.meta.url))])),
      },
    },
  },
  // PORT lets two checkouts (e.g. git worktrees) run dev servers side by side.
  server: { port: Number(process.env.PORT) || 5173, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});

// ── Docs pages ─────────────────────────────────────────────────────────────────────────────────
//
// The documentation: each page is rendered from its Markdown in docs/ at build time (and on each request
// in dev), so the docs stay the one source of truth and the published pages are plain HTML. Every page
// gets the same header: "Documentation" (its home) and a tab for each section. Links between docs point
// at their pages; a link to a doc without a page fails the build rather than falling back to GitHub.
// Every heading is an anchor, so any section can be sent as a link (wallpapers.html#with-a-shortcut).

const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url));
const PAGES: Record<string, string> = Object.fromEntries(DOC_PAGES.map((d) => [d.md, d.html]));

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
        // The "#" is a real link you can tap on a phone; docs.ts also copies it to the clipboard.
        return `<h${depth} id="${id}">${html}`
          + `<a class="anchor" href="#${id}" aria-label="Copy a link to this section" title="Copy a link to this section">#</a>`
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
 * Fold a heavy reference section away behind a summary. The rules page is a beginner's first stop and
 * it used to open with the comprehensive rules in full, which reads as "this game is enormous".
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
