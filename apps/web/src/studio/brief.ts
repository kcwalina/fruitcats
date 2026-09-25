// A set's art brief (content/<year>/<month>/<set>/art/brief.json, published at studio/<set>/brief.json) and what
// the Studio works out from it: which step the artist is on, and what to do next for each picture.

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

/** A picture's key: its file name without the extension (BP1-X03-kitten, legend-jam, key-art). */
export const keyOf = (p: BriefPicture) => p.file.replace(/\.[a-z]+$/i, '');

export const TIER_NAMES: Record<Tier, string> = {
  deck: 'Deck card', token: 'Token', foil: 'Foil single', gold: 'Gold single', signature: 'Signature card',
  legend: 'Pawtrait', announcement: 'Announcement',
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
