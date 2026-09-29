// Folkborn's cards as the core lays them out: every face's draw list (cardengine/engine/src/render/draw-list.md), one
// file per set in content/draw-lists/. They are the goldens of docs/tcg/tcg-developer-platform.md, Stage 4: the core,
// in any language, must draw these cards exactly so, and a test (draw-lists.test.ts) says when it doesn't.
//
//   npm run draw-lists      writes them again, after a change to a card, the layout or the renderer that is meant
//
// Folkborn's fonts are Segoe UI, which Windows has and the game's folder doesn't: a font the layout names that isn't in
// the folder is read from the system's fonts, as kardix reads it.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectFile } from '../cardengine/engine/host/core';
import { core } from './core';
import { GAME } from './kardix';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DRAW_LISTS = join(HERE, 'draw-lists');

function alexFiles(root: string, dir = root): ProjectFile[] {
  const files: ProjectFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['bin', 'obj', 'node_modules', '.git'].includes(name)) files.push(...alexFiles(root, path));
    } else if (name.endsWith('.alex')) {
      files.push({ path: relative(root, path).replace(/\\/g, '/'), bytes: readFileSync(path) });
    }
  }
  return files;
}

function answer(files: ProjectFile[], question: string): string {
  const project = core().loadProject(files);
  try {
    return project.query(question);
  } finally {
    project.free();
  }
}

/** The game's files with the fonts its card layout names, from its folder or the system's. */
export function withFonts(game = GAME): ProjectFile[] {
  const files = alexFiles(game);
  const fonts = JSON.parse(answer(files, 'fonts')) as string[] | { error: string };
  if (!Array.isArray(fonts)) throw new Error(fonts.error);
  const system = join(process.env.WINDIR ?? 'C:/Windows', 'Fonts');
  for (const font of fonts) {
    const found = [join(game, font), join(system, basename(font))].find(existsSync);
    if (!found) throw new Error(`The font ${font} is neither in ${game} nor installed; the draw lists need it.`);
    files.push({ path: font, bytes: readFileSync(found) });
  }
  return files;
}

/** Each set's draw lists, by the set's name: the sets the game lists, its Cards files, and its prototype sets. */
export function drawLists(game = GAME): Map<string, string> {
  const files = withFonts(game);
  const project = core().loadProject(files);
  try {
    const lists = new Map<string, string>();
    const documents = JSON.parse(project.query('documents')) as { name: string | null }[];
    for (const { name } of documents) {
      if (!name) continue;
      const faces = JSON.parse(project.query(`faces ${name}`)) as unknown[] | { error: string };
      if (!Array.isArray(faces)) throw new Error(faces.error);
      if (!faces.length) continue;
      const text = project.query(`draw-lists ${name}`);
      if (text.startsWith('{"error"')) throw new Error(`${name}: ${(JSON.parse(text) as { error: string }).error}`);
      lists.set(name, text);
    }
    return lists;
  } finally {
    project.free();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(DRAW_LISTS, { recursive: true });
  const lists = drawLists();
  for (const [set, text] of lists) writeFileSync(join(DRAW_LISTS, `${set}.txt`), text);
  const faces = [...lists.values()].reduce((n, text) => n + text.split('\n=== ').length, 0);
  console.log(`Wrote the draw lists of ${faces} face(s) in ${lists.size} set(s) to ${relative(process.cwd(), DRAW_LISTS)}.`);
}
