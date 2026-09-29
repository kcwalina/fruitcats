// A set's art brief (games/folkborn/sets/<set>/<set>-brief.alex, #type ArtBrief) and what the Studio works out from
// it: which step the artist is on, and what to do next for each picture.

import { follow, referenceOf, type Json } from '../../../../cardengine/engine/host/core';
import type { SetView, Version } from './api';

export interface Brief {
  set: string;
  name: string;
  artist?: string;
  about?: string;
  audience?: string;
  style?: string;
  families?: Record<string, { world: string; note?: string }>;
  milestones: Milestone[];
  pictures: BriefPicture[];
}

export interface Milestone { id: number | string; title: string; note?: string }

export type Tier = 'deck' | 'token' | 'foil' | 'gold' | 'signature' | 'legend' | 'announcement';

export interface BriefPicture {
  file: string;
  card: string | null;
  kind: 'card' | 'token' | 'pawtrait' | 'announcement';
  size: [number, number];
  tier: Tier;
  style?: 'painted' | 'sticker';
  milestone: number | string;
  draw: string;
  mustKeep?: string[];
  open?: string[];
  side?: 'kitten' | 'bigcat';
  showcase?: boolean;
  main?: boolean;
  signature?: 'requested' | 'welcome';
  pawtrait?: string;
  family?: string;
  workingName?: string;
  /** The artist chooses this card's frame colour (a card that isn't tied to a deck's look). */
  frameChoice?: boolean;
  /** With frameChoice: a colour to start in instead of the family's own (optional). */
  framePalette?: string;
}

type Record_ = { [key: string]: Json };

/**
 * The brief in the document `name` of a project the core loaded, for the Studio: `documents` holds each document's
 * value by its name (the set's, for the picture's card). Steps are numbered in order from 1, as the Studio's saved state
 * knows them; a picture's card is the card's number, and its portrait the portrait's file.
 */
export function briefFrom(documents: Record<string, Json>, name: string): Brief {
  const root = documents[name];
  if (!isRecord(root) || root.$type !== 'ArtBrief') throw new Error(`${name}.alex isn't an art brief (#type ArtBrief).`);
  const at = (v: Json | undefined): Json | undefined => {
    const reference = referenceOf(v);
    if (reference && (reference as unknown as Record_).$unresolved) throw new Error(`${name}.alex: nothing is named @${reference.$ref}.`);
    return follow(v, documents);
  };
  const record = (v: Json | undefined): Record_ | undefined => { const r = at(v); return isRecord(r) ? r : undefined; };
  const text = (o: Record_ | undefined, field: string) => { const v = at(o?.[field]); return typeof v === 'string' ? v : undefined; };
  const flag = (o: Record_, field: string) => { const v = o[field]; return typeof v === 'boolean' ? v : undefined; };
  const word = (o: Record_, field: string) => { const v = o[field]; return typeof v === 'string' ? v : undefined; };
  const list = (v: Json | undefined): Json[] => { const l = at(v); return Array.isArray(l) ? l : []; };
  const entries = (v: Json | undefined): [string, Record_][] =>
    Object.entries(record(v) ?? {}).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, record(x) ?? {}]);

  const set = record(root.set);
  const brief: Brief = {
    set: text(set, 'code') ?? name.replace(/-brief$/, ''),
    name: text(set, 'name') ?? name,
    about: text(root, 'about'),
    audience: text(root, 'audience'),
    style: text(root, 'style'),
    families: Object.fromEntries(entries(root.families).map(([family, f]) => [family, { world: text(f, 'world') ?? '', note: text(f, 'note') }])),
    milestones: [],
    pictures: [],
  };
  entries(root.steps).forEach(([, step], i) => {
    const id = i + 1;
    brief.milestones.push({ id, title: text(step, 'title') ?? '', note: text(step, 'note') });
    for (const [, p] of entries(step.pictures)) {
      const size = list(p.size).map((x) => (typeof x === 'number' ? x : 0));
      const card = record(p.card);
      const kind = word(p, 'kind') ?? 'card';
      const face = word(p, 'face');
      const portrait = record(p.portrait);
      brief.pictures.push({
        file: text(p, 'file') ?? '',
        card: card ? text(card, 'number') ?? null : null,
        kind: (kind === 'portrait' ? 'pawtrait' : kind) as BriefPicture['kind'],
        size: [size[0], size[1]],
        tier: word(p, 'tier') as Tier,
        style: word(p, 'style') as BriefPicture['style'],
        milestone: id,
        draw: text(p, 'draw') ?? '',
        mustKeep: list(p['must-keep']).map((x) => (typeof at(x) === 'string' ? at(x) as string : '')),
        open: list(p.open).map((x) => (typeof x === 'string' ? x : '')),
        side: face === 'front' ? 'kitten' : face === 'back' ? 'bigcat' : undefined,
        showcase: flag(p, 'showcase'),
        main: flag(p, 'main'),
        signature: word(p, 'signature') as BriefPicture['signature'],
        pawtrait: portrait ? text(portrait, 'file') : undefined,
        family: text(p, 'family'),
        workingName: text(p, 'working-name'),
        frameChoice: flag(p, 'frame-choice'),
        framePalette: text(p, 'frame-palette'),
      });
    }
  });
  return brief;
}

function isRecord(value: Json | undefined): value is Record_ {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

/** A picture's key: its file name without the extension (JR1-H01-kitten, legend-mochi, key-art). */
export const keyOf = (p: BriefPicture) => p.file.replace(/\.[a-z]+$/i, '');

export const TIER_NAMES: Record<Tier, string> = {
  deck: 'Deck card', token: 'Token', foil: 'Foil single', gold: 'Gold single', signature: 'Signature card',
  legend: 'Portrait', announcement: 'Announcement',
};

export const FIELD_NAMES: Record<string, string> = {
  name: 'The card’s name', flavor: 'The flavour text', animal: 'Animal', berry: 'Berry', breed: 'Breed', scene: 'The scene',
  object: 'Object', look: 'The character', characters: 'Characters', rules: 'What the card does', other: 'Something else',
};

export type State = 'none' | 'waiting' | 'changes' | 'sketch-ok' | 'approved';

export const STATE_NAMES: Record<State, string> = {
  none: 'Not started', waiting: 'Sent', changes: 'Sent, with comments', 'sketch-ok': 'Sketch approved', approved: 'Approved',
};

export function stateOf(view: SetView | null, key: string): State {
  return (view?.pictures[key]?.state as State | undefined) ?? 'none';
}

export function versionsOf(view: SetView | null, key: string): Version[] {
  return view?.pictures[key]?.versions ?? [];
}

/** Showcase and main pictures are sketched first; the rest may be sent sketched or finished. */
export const sketchFirst = (p: BriefPicture) => !!(p.showcase || p.main || p.kind === 'announcement');

export interface Step {
  milestone: Milestone;
  pictures: BriefPicture[];
  done: boolean;
  open: boolean;
  /** 0 to 1: how far along the step's pictures are. */
  progress: number;
}

const WEIGHT: Record<State, number> = { none: 0, waiting: 0.4, changes: 0.4, 'sketch-ok': 0.6, approved: 1 };

/**
 * The steps in order. A step opens once every picture of the step before it has been sent: our comments and
 * approvals never hold the artist back. (A reviewer can also open a step early.)
 */
export function steps(brief: Brief, view: SetView | null): Step[] {
  let previousSent = true;
  return brief.milestones.map((m) => {
    const pictures = brief.pictures.filter((p) => String(p.milestone) === String(m.id));
    const states = pictures.map((p) => stateOf(view, keyOf(p)));
    const done = pictures.length > 0 && states.every((s) => s === 'approved');
    const open = previousSent || view?.milestones[String(m.id)] === true || states.some((s) => s !== 'none');
    previousSent = open && states.every((s) => s !== 'none');
    const progress = pictures.length ? states.reduce((sum, s) => sum + WEIGHT[s], 0) / pictures.length : 0;
    return { milestone: m, pictures, done, open, progress };
  });
}

/** The set's progress: approved pictures of all pictures. */
export function overall(brief: Brief, view: SetView | null): { approved: number; total: number } {
  return {
    approved: brief.pictures.filter((p) => stateOf(view, keyOf(p)) === 'approved').length,
    total: brief.pictures.length,
  };
}

/**
 * The next thing to make: a sketch we liked, to finish, or the first picture not sent yet. A picture with our
 * comments isn't a task: the artist reads them when they like (the comment walkthrough).
 */
export function nextPicture(brief: Brief, view: SetView | null): BriefPicture | null {
  for (const step of steps(brief, view)) {
    if (!step.open || step.done) continue;
    const order: State[] = ['sketch-ok', 'none'];
    for (const want of order) {
      const p = step.pictures.find((x) => stateOf(view, keyOf(x)) === want);
      if (p) return p;
    }
  }
  return null;
}

/** What to do next on one picture, in the artist's words. */
export function nextAction(_p: BriefPicture, state: State, versions: Version[]): { title: string; text: string } {
  if (state === 'approved') return { title: 'Approved', text: 'This image is done. Thank you!' };
  if (state === 'changes') return { title: 'Our thoughts are in', text: 'Read the comments below. Take what helps, then upload a new version. Your earlier versions are kept.' };
  if (state === 'sketch-ok') return { title: 'Sketch approved: finish it', text: 'Finish the image in your own tools, then upload it here as a WebP file.' };
  if (state === 'waiting') {
    const last = versions[versions.length - 1];
    return {
      title: 'With us',
      text: last?.kind === 'sketch'
        ? 'We’re looking at your sketch. Our comments will appear below. You can start the next image meanwhile.'
        : 'We’re looking at your image. Our comments will appear below.',
    };
  }
  return { title: 'Upload it', text: 'A sketch or the finished image, whichever you like. A sketch gets you early feedback; a finished image is great too.' };
}
