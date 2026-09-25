// The Artist Studio from the command line (docs/artist-studio-plan.md): for an AI agent (or us) following an
// artist's work. Agents read everything and comment; their comments are labelled AI in the Studio. Only the owner
// approves pictures, in the Studio itself.
//
//   npm run studio -- status <set> [--since <iso>]     what's new: uploads, comments, reviews, suggestions
//   npm run studio -- pictures <set>                   every picture: its state and versions
//   npm run studio -- get <set> <picture> [version]    download a version (default: the newest) to look at it
//   npm run studio -- comment <set> <picture> "<text>" [--at x,y] [--reply <id>]
//                                                      comment on the newest version; --at pins it (0–1 across, down)
//   npm run studio -- pull <set>                       copy the approved pictures into the set's folder, then compose the cards
//   npm run studio -- key <name>                       make an agent key (prints what the API's STUDIO_AGENTS needs)
//
// The agent key is read from ~/.fruitcats-studio/agent.key (or STUDIO_AGENT_KEY). Add --dev to use the local
// development API (npm run studio:dev -w @fruitcats/api), whose agent key is "dev-agent".

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = ['--since', '--at', '--reply'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const [command, set, picture, extra] = positional;

const API = dev ? 'http://localhost:8787' : process.env.STUDIO_API ?? 'https://api.fruitcats.viamochi.com';
const KEY_FILE = join(homedir(), '.fruitcats-studio', 'agent.key');

function agentKey(): string {
  if (dev) return 'dev-agent';
  if (process.env.STUDIO_AGENT_KEY) return process.env.STUDIO_AGENT_KEY;
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim();
  throw new Error(`No agent key. Make one with "npm run studio -- key Claude" and give its line to the API (STUDIO_AGENTS).`);
}

async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
  const res = await fetch(`${API}/v1/studio/${path}`, {
    method: init.method ?? (init.json ? 'POST' : 'GET'),
    headers: { Authorization: `Studio-Agent ${agentKey()}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}
const json = async <T>(path: string, init?: { method?: string; json?: unknown }) => (await call(path, init)).json() as Promise<T>;

interface Version { id: string; kind: string; format: string; width: number; height: number; at: string; byName: string; note?: string }
interface View { pictures: Record<string, { state: string; frame?: string; versions: Version[] }>; comments: { id: string; picture: string; author: string; authorName: string; text: string; at: string; done: boolean }[] }

/** A set's folder in content/, by its code. */
function setFolder(code: string): string {
  const content = join(ROOT, 'content');
  for (const y of readdirSync(content)) for (const m of existsSync(join(content, y)) && statSync(join(content, y)).isDirectory() ? readdirSync(join(content, y)) : [])
    for (const s of statSync(join(content, y, m)).isDirectory() ? readdirSync(join(content, y, m)) : []) {
      const f = join(content, y, m, s, 'set.json');
      if (existsSync(f) && String(JSON.parse(readFileSync(f, 'utf8')).set).toLowerCase() === code) return dirname(f);
    }
  throw new Error(`No set "${code}" in content/`);
}

async function main() {
  if (command === 'key') {
    const name = set ?? 'Claude';
    const key = randomBytes(24).toString('base64url');
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    if (existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists already. Delete it first to make a new key.`);
    writeFileSync(KEY_FILE, key, { mode: 0o600 });
    console.log(`Saved the key to ${KEY_FILE}.`);
    console.log(`Add this to the API's STUDIO_AGENTS setting (comma-separated if there are several):`);
    console.log(`  ${name}:${createHash('sha256').update(key).digest('hex')}`);
    return;
  }
  if (!set) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n')); return; }

  if (command === 'status') {
    const since = flag('--since') ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { items, now } = await json<{ now: string; items: Record<string, string>[] }>(`${set}/changes?since=${encodeURIComponent(since)}`);
    if (!items.length) console.log(`Nothing new since ${since}.`);
    for (const i of items.reverse()) {
      const what = i.type === 'upload' ? `uploaded a ${i.kind === 'sketch' ? 'sketch' : 'finished picture'} (version ${i.version})`
        : i.type === 'review' ? `marked it ${i.state}`
          : i.type === 'comment' ? `[${i.author}] commented: ${i.text}`
            : `suggested ${i.field} → "${i.value}" (${i.state})`;
      console.log(`${i.at.slice(0, 16).replace('T', ' ')}  ${i.picture}  ${i.by}: ${what}`);
    }
    console.log(`\nNext time: --since ${now}`);
    return;
  }

  if (command === 'pictures') {
    const view = await json<View>(set);
    const brief = JSON.parse(readFileSync(join(setFolder(set), 'art', 'brief.json'), 'utf8')) as { pictures: { file: string; milestone: unknown }[] };
    for (const p of brief.pictures) {
      const key = p.file.replace(/\.[a-z]+$/, '');
      const pic = view.pictures[key];
      const open = view.comments.filter((c) => c.picture === key && !c.done).length;
      console.log(`${key.padEnd(22)} step ${String(p.milestone).padEnd(3)} ${(pic?.state ?? 'none').padEnd(10)} ${pic?.versions.length ?? 0} version(s)${open ? `, ${open} open comment(s)` : ''}`);
    }
    return;
  }

  if (command === 'get') {
    if (!picture) throw new Error('Which picture? e.g. npm run studio -- get bp1 BP1-X01');
    const view = await json<View>(set);
    const versions = view.pictures[picture]?.versions ?? [];
    const v = extra ? versions.find((x) => x.id === extra) : versions.at(-1);
    if (!v) throw new Error(`${picture} has no ${extra ? `version ${extra}` : 'versions'} yet.`);
    const bytes = Buffer.from(await (await call(`${set}/pictures/${picture}/${v.id}`)).arrayBuffer());
    const out = join(ROOT, '.studio-downloads', set, `${picture}-${v.id}.${v.format}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    console.log(`${relative(process.cwd(), out)}  (${v.kind}, ${v.width} × ${v.height}, by ${v.byName}, ${v.at}${v.note ? `, note: ${v.note}` : ''})`);
    return;
  }

  if (command === 'comment') {
    const text = extra;
    if (!picture || !text) throw new Error('npm run studio -- comment <set> <picture> "<text>" [--at x,y]');
    const view = await json<View>(set);
    const version = view.pictures[picture]?.versions.at(-1)?.id;
    const at = flag('--at')?.split(',').map(Number);
    const c = await json<{ id: string }>(`${set}/pictures/${picture}/comments`, {
      json: { text, version, pin: at && at.length === 2 ? { x: at[0], y: at[1] } : undefined, replyTo: flag('--reply') },
    });
    console.log(`Posted (labelled AI): ${c.id}`);
    return;
  }

  if (command === 'pull') {
    const folder = setFolder(set);
    const brief = JSON.parse(readFileSync(join(folder, 'art', 'brief.json'), 'utf8')) as { pictures: { file: string; kind: string }[] };
    const view = await json<View>(set);
    let count = 0;
    const setFile = join(folder, 'set.json');
    const setData = JSON.parse(readFileSync(setFile, 'utf8')) as { cards: { id: string; frame?: string }[] };
    let framesChanged = false;
    for (const p of brief.pictures) {
      const key = p.file.replace(/\.[a-z]+$/, '');
      const pic = view.pictures[key];
      if (pic?.state !== 'approved') continue;
      const v = [...pic.versions].reverse().find((x) => x.kind === 'final') ?? pic.versions.at(-1)!;
      const bytes = Buffer.from(await (await call(`${set}/pictures/${key}/${v.id}`)).arrayBuffer());
      // Where each kind of picture lives, all in the set's folder: card pictures, Pawtraits, the announcement.
      const out = p.kind === 'pawtrait' ? join(folder, 'avatars', p.file)
        : p.kind === 'announcement' ? join(folder, 'announcement', p.file)
          : join(folder, 'art', 'illustrations', `${key}.webp`);
      mkdirSync(dirname(out), { recursive: true });
      if (v.format === 'webp') writeFileSync(out, bytes);
      else {
        const tmp = `${out}.${v.format}`;
        writeFileSync(tmp, bytes);
        execFileSync('python', ['-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], quality=92, method=6); import os; os.remove(sys.argv[1])', tmp, out]);
      }
      console.log(`${key}: version ${v.id} → ${relative(ROOT, out)}`);
      count++;
      // A frame colour the artist chose goes into the card's data, so the finished card is drawn in it.
      const card = setData.cards.find((c) => `${c.id}` === key || key.startsWith(`${c.id}-`));
      const frame = pic.frame && pic.frame !== 'own' ? pic.frame : undefined;
      if (card && card.frame !== frame) {
        if (frame) card.frame = frame; else delete card.frame;
        framesChanged = true;
        console.log(`${card.id}: frame colour ${frame ?? 'its family’s own'}`);
      }
    }
    if (framesChanged) writeFileSync(setFile, `${JSON.stringify(setData, null, 2)}\n`);
    if (!count) { console.log('No approved pictures yet.'); return; }
    execFileSync('python', [join(ROOT, 'tools', 'compose_cards.py'), '--set', set], { stdio: 'inherit' });
    console.log(`\n${count} picture(s) pulled. Review with git diff, then npm run check-set -- ${set}.`);
    return;
  }

  throw new Error(`Unknown command "${command}".`);
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
