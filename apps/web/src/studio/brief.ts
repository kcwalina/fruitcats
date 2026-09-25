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
}

/** A picture's key: its file name without the extension (BP1-X03-kitten, legend-jam, key-art). */
export const keyOf = (p: BriefPicture) => p.file.replace(/\.[a-z]+$/i, '');

export const TIER_NAMES: Record<Tier, string> = {
  deck: 'Deck card', token: 'Token', foil: 'Foil single', gold: 'Gold single', signature: 'Signature card',
  legend: 'Pawtrait', announcement: 'Announcement',
};

export const FIELD_NAMES: Record<string, string> = {
  name: 'Name', flavor: 'Flavour text', animal: 'Animal', berry: 'Berry', breed: 'Breed', scene: 'Scene',
  object: 'Object', look: 'Look', characters: 'Characters',
};

export type State = 'none' | 'waiting' | 'changes' | 'sketch-ok' | 'approved';

export const STATE_NAMES: Record<State, string> = {
  none: 'To do', waiting: 'With us', changes: 'Changes asked', 'sketch-ok': 'Sketch approved', approved: 'Approved',
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

/** The steps in order. A step opens when the one before it is approved, or when the owner opens it early. */
export function steps(brief: Brief, view: SetView | null): Step[] {
  let previousDone = true;
  return brief.milestones.map((m) => {
    const pictures = brief.pictures.filter((p) => String(p.milestone) === String(m.id));
    const states = pictures.map((p) => stateOf(view, keyOf(p)));
    const done = pictures.length > 0 && states.every((s) => s === 'approved');
    const open = previousDone || view?.milestones[String(m.id)] === true || states.some((s) => s !== 'none');
    previousDone = done;
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

/** The first picture the artist can work on now, if any. */
export function nextPicture(brief: Brief, view: SetView | null): BriefPicture | null {
  for (const step of steps(brief, view)) {
    if (!step.open || step.done) continue;
    const order: State[] = ['changes', 'sketch-ok', 'none'];
    for (const want of order) {
      const p = step.pictures.find((x) => stateOf(view, keyOf(x)) === want);
      if (p) return p;
    }
  }
  return null;
}

/** What to do next on one picture, in the artist's words. */
export function nextAction(p: BriefPicture, state: State, versions: Version[]): { title: string; text: string } {
  const sketch = sketchFirst(p);
  if (state === 'approved') return { title: 'Approved', text: 'This picture is done. Thank you!' };
  if (state === 'changes') return { title: 'Changes asked', text: 'Read the comments below, then upload a new version. Your earlier versions are kept.' };
  if (state === 'sketch-ok') return { title: 'Sketch approved: finish it', text: 'Paint the finished picture and upload it here, as a WebP file.' };
  if (state === 'waiting') {
    const last = versions[versions.length - 1];
    return {
      title: 'With us',
      text: last?.kind === 'sketch'
        ? 'We’re looking at your sketch. Our comments will appear below. You can start the next picture meanwhile.'
        : 'We’re looking at your picture. Our comments will appear below.',
    };
  }
  return sketch
    ? { title: 'Start with a sketch', text: 'A rough sketch is enough: the pose, the composition and the main colours. Upload it here and we’ll reply before you paint it.' }
    : { title: 'Draw it', text: 'Upload a sketch if you’d like an early opinion, or the finished picture.' };
}
