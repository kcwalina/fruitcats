import type { Action } from '@fruitcats/engine';

/**
 * What you could do on your action besides Pass and Take the Yarn, in words. The action bar hint and the
 * Take the Yarn confirmation both read this, so the bar never says "nothing left to do" while the
 * confirmation warns you would give something up (the Hero Cat ability once made them disagree).
 */
export function otherMoves(legal: Action[]): string[] {
  const moves: string[] = [];
  if (legal.some((a) => a.t === 'play')) moves.push('play a glowing card');
  if (legal.some((a) => a.t === 'attack')) moves.push('attack with a glowing unit');
  if (legal.some((a) => a.t === 'ability')) moves.push('use your Hero Cat’s ability');
  return moves;
}

/** "a", "a or b", "a, b or c". */
export function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * Whether Take the Yarn asks first. Taking it costs the rest of this round, which only matters when there
 * is something besides Pass you could still do; with nothing else, taking it has no downside.
 */
export function yarnNeedsConfirm(legal: Action[]): boolean {
  return otherMoves(legal).length > 0;
}

/** The confirmation: says exactly what you would give up this round. */
export function yarnConfirmText(legal: Action[]): string {
  const moves = otherMoves(legal).map((m) => m.replace(' glowing', ''));
  return `Take the <b>Yarn Ball</b>? You’ll act first next round, but for the rest of this one you can’t `
    + `${orList(moves)}.`;
}
