// What a player actually did, kept in this browser only.
//
// Playtesters said the tutorial "isn't good enough" and nobody could say where it lost them. These
// counters answer that: which step they reached, whether they skipped, whether they finished a game.
// Nothing leaves the device — no network, no identifiers, no card or deck data — and the numbers are
// shown to the player in the Rules panel, so there is nothing hidden about it.

const KEY = 'fruitcats-progress';

export interface Progress {
  /** Tutorials started, and the last step id each one reached. */
  tutorials: number;
  lastStep: string;
  /** Tutorials the player walked out of. */
  skipped: number;
  /** Games played to a result, and games won. */
  finished: number;
  won: number;
  /** Balloons dismissed under 1.5s — a proxy for "not read". */
  rushed: number;
}

const EMPTY: Progress = { tutorials: 0, lastStep: '', skipped: 0, finished: 0, won: 0, rushed: 0 };

export function progress(): Progress {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Progress> };
  } catch {
    return { ...EMPTY };
  }
}

function save(next: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: not remembered */ }
}

export const note = (change: Partial<Progress>) => save({ ...progress(), ...change });

export const count = (field: 'tutorials' | 'skipped' | 'finished' | 'won' | 'rushed') =>
  note({ [field]: progress()[field] + 1 });

/** A one-line summary for the Rules panel, so the player can read it back to you. */
export function summary(): string {
  const p = progress();
  if (!p.tutorials && !p.finished) return '';
  const bits = [`${p.finished} game${p.finished === 1 ? '' : 's'} finished`];
  if (p.won) bits.push(`${p.won} won`);
  if (p.tutorials) bits.push(`walkthrough started ${p.tutorials}×${p.lastStep ? `, last step “${p.lastStep}”` : ''}`);
  if (p.skipped) bits.push(`skipped ${p.skipped}×`);
  if (p.rushed) bits.push(`${p.rushed} balloons closed in under 1.5s`);
  return bits.join(' · ');
}
