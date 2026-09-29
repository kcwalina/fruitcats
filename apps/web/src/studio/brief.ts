// A set's art brief (games/folkborn/sets/<set>/<set>-brief.alex, #type ArtBrief) and what the Studio works out from
// it: which step the artist is on, and what to do next for each picture.

import {
  boolOf, itemsOf, memberOf, objectOf, textOf, type AlexFolder, type AlexObject, type AlexValue,
} from '../../../../cardengine/alex/alex';
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

/**
 * The brief in `folder`'s document `name`, for the Studio. Steps are numbered in order from 1, as the Studio's saved
 * state knows them; a picture's card is the card's number, and its portrait the portrait's file.
 */
export function briefFromAlex(folder: AlexFolder, name: string): Brief {
  const doc = folder.documents.get(name);
  if (!doc || doc.type !== 'ArtBrief') throw new Error(`${name}.alex isn't an art brief (#type ArtBrief).`);
  const at = (v: AlexValue | undefined) => folder.resolve(v, name);
  const text = (o: AlexObject, field: string) => textOf(at(o.get(field)));
  const set = objectOf(at(doc.root.get('set')));
  const entries = (v: AlexValue | undefined) => [...(objectOf(at(v))?.entries ?? [])];
  const brief: Brief = {
    set: (set && text(set, 'code')) ?? name.replace(/-brief$/, ''),
    name: (set && text(set, 'name')) ?? name,
    about: text(doc.root, 'about'),
    audience: text(doc.root, 'audience'),
    style: text(doc.root, 'style'),
    families: Object.fromEntries(entries(doc.root.get('families')).map(([family, v]) => {
      const f = objectOf(at(v))!;
      return [family, { world: text(f, 'world') ?? '', note: text(f, 'note') }];
    })),
    milestones: [],
    pictures: [],
  };
  entries(doc.root.get('steps')).forEach(([, v], i) => {
    const step = objectOf(at(v))!;
    const id = i + 1;
    brief.milestones.push({ id, title: text(step, 'title') ?? '', note: text(step, 'note') });
    for (const [, pv] of entries(step.get('pictures'))) {
      const p = objectOf(at(pv))!;
      const size = itemsOf(at(p.get('size'))).map((x) => (x.kind === 'int' ? x.value : 0));
      const card = objectOf(at(p.get('card')));
      const kind = memberOf(p.get('kind')) ?? 'card';
      const face = memberOf(p.get('face'));
      const portrait = objectOf(at(p.get('portrait')));
      brief.pictures.push({
        file: text(p, 'file') ?? '',
        card: card ? text(card, 'number') ?? null : null,
        kind: (kind === 'portrait' ? 'pawtrait' : kind) as BriefPicture['kind'],
        size: [size[0], size[1]],
        tier: memberOf(p.get('tier')) as Tier,
        style: memberOf(p.get('style')) as BriefPicture['style'],
        milestone: id,
        draw: text(p, 'draw') ?? '',
        mustKeep: itemsOf(at(p.get('must-keep'))).map((x) => textOf(at(x)) ?? ''),
        open: itemsOf(at(p.get('open'))).map((x) => memberOf(x) ?? ''),
        side: face === 'front' ? 'kitten' : face === 'back' ? 'bigcat' : undefined,
        showcase: boolOf(p.get('showcase')),
        main: boolOf(p.get('main')),
        signature: memberOf(p.get('signature')) as BriefPicture['signature'],
        pawtrait: portrait ? text(portrait, 'file') : undefined,
        family: text(p, 'family'),
        workingName: text(p, 'working-name'),
        frameChoice: boolOf(p.get('frame-choice')),
        framePalette: text(p, 'frame-palette'),
      });
    }
  });
  return brief;
}

/** A picture's key: its file name without the extension (BP1-X03-kitten, legend-jam, key-art). */
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
