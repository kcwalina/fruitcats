// The Clash, replayed on the board: the engine reports the fight as events (the board at the start, at each bout and
// at the end, every hit and every effect with where it came from), and this turns them into what the screen shows,
// one beat at a time, then a summary of who did what. Cards move and numbers fly; nothing else is drawn.

import { CARDS, TERMS, cardName, other, type BoardUnit, type EffectSource, type GameEvent, type PlayerId } from '@fruitcats/engine';

/** One change a beat makes to the board. */
export type Change =
  | { t: 'hit'; from: { uid: number } | { hero: PlayerId }; to: number; dealt: number }
  | { t: 'damage'; to: number; amount: number }
  | { t: 'heal'; to: number; amount: number }
  | { t: 'buff'; to: number; power?: number; health?: number }
  | { t: 'exhaust'; to: number }
  | { t: 'summon'; unit: BoardUnit }
  | { t: 'down'; to: number }
  | { t: 'ambush'; p: PlayerId; lane: number; cardId: string }
  | { t: 'fizzle'; cardId?: string }
  | { t: 'awaken'; p: PlayerId };

/** Things that happen together, shown at once: a strike, one card's effect, the units that go down. */
export interface Beat {
  kind: 'strike' | 'heroes' | 'effect' | 'down' | 'ambush' | 'other';
  /** Whose and which card or trait made it happen (effects). */
  src?: EffectSource;
  swift?: boolean;
  changes: Change[];
}

/** Before the fight, then each bout: the board as it stood when it began, and its beats. */
export interface Section {
  bout: number;
  board: BoardUnit[];
  beats: Beat[];
}

export interface Replay {
  round: number;
  sections: Section[];
  /** The board when the fight ended: who still stands. */
  end: BoardUnit[];
  standing: [number, number];
  lost: [number, number];
  winner?: PlayerId | 'draw';
}

/** The last Clash in these events (those a player may see, oldest first), or null if there is none. */
export function buildReplay(events: GameEvent[]): Replay | null {
  let start = events.length - 1;
  while (start >= 0 && events[start].t !== 'clash') start--;
  if (start < 0) return null;
  const clash = events[start] as Extract<GameEvent, { t: 'clash' }>;
  const sections: Section[] = [];
  let end: BoardUnit[] | null = null;
  let result: Extract<GameEvent, { t: 'clashEnd' }> | null = null;
  let winner: PlayerId | 'draw' | undefined;
  let pending: { bout: number } | null = { bout: 0 };
  const beats = () => sections.at(-1)!.beats;
  const sameSource = (a?: EffectSource, b?: EffectSource) => !!a && !!b && a.p === b.p && a.id === b.id && a.uid === b.uid;
  /** Add a change to the last beat if it is of the same kind and source, or start a beat. */
  const add = (kind: Beat['kind'], change: Change, extra: { src?: EffectSource; swift?: boolean } = {}) => {
    const last = beats().at(-1);
    if (last && last.kind === kind && last.swift === extra.swift && (kind !== 'effect' || sameSource(last.src, extra.src))) last.changes.push(change);
    else beats().push({ kind, ...extra, changes: [change] });
  };
  for (const e of events.slice(start + 1)) {
    if (e.t === 'board') {
      if (pending) { sections.push({ bout: pending.bout, board: e.units, beats: [] }); pending = null; }
      else end = e.units;
      continue;
    }
    if (e.t === 'bout') { pending = { bout: e.n }; continue; }
    if (e.t === 'clashEnd') { result = e; continue; }
    if (e.t === 'win') { winner = e.p; continue; }
    if (result || !sections.length) continue;
    if (e.t === 'round') break;
    switch (e.t) {
      case 'hit':
        if (e.from.kind === 'hero') add('heroes', { t: 'hit', from: { hero: e.from.player }, to: e.uid, dealt: e.dealt });
        else if (e.from.kind === 'unit') add('strike', { t: 'hit', from: { uid: e.from.uid }, to: e.uid, dealt: e.dealt }, { swift: !!e.swift });
        break;
      case 'damage': add('effect', { t: 'damage', to: e.uid, amount: e.amount }, { src: e.src }); break;
      case 'heal': add('effect', { t: 'heal', to: e.uid, amount: e.amount }, { src: e.src }); break;
      case 'buff':
        if (e.power || e.health) add('effect', { t: 'buff', to: e.uid, ...(e.power ? { power: e.power } : {}), ...(e.health ? { health: e.health } : {}) }, { src: e.src });
        break;
      case 'exhaust': add('effect', { t: 'exhaust', to: e.uid }, { src: e.src }); break;
      case 'summon': {
        const card = CARDS[e.cardId];
        add('effect', { t: 'summon', unit: { uid: e.uid, id: e.cardId, p: e.p, slot: e.slot, power: card?.power ?? 0, health: card?.health ?? 0, damage: 0 } }, { src: e.src });
        break;
      }
      case 'down': add('down', { t: 'down', to: e.uid }); break;
      case 'ambush': beats().push({ kind: 'ambush', changes: [{ t: 'ambush', p: e.p, lane: e.lane, cardId: e.cardId }] }); break;
      case 'fizzled': beats().push({ kind: 'other', src: e.src, changes: [{ t: 'fizzle', cardId: e.cardId }] }); break;
      case 'growUp': beats().push({ kind: 'other', changes: [{ t: 'awaken', p: e.p }] }); break;
    }
  }
  if (!sections.length || !result) return null;
  return { round: clash.n, sections, end: end ?? sections.at(-1)!.board, standing: result.standing, lost: result.lost, ...(winner !== undefined ? { winner } : {}) };
}

/** A beat applied to the board as the replay holds it (units by uid). The next section's board corrects any drift. */
export function applyBeat(units: Map<number, BoardUnit>, beat: Beat): void {
  for (const c of beat.changes) {
    const u = 'to' in c ? units.get(c.to) : undefined;
    switch (c.t) {
      case 'hit': if (u) u.damage += c.dealt; break;
      case 'damage': if (u) u.damage += c.amount; break;
      case 'heal': if (u) u.damage = Math.max(0, u.damage - c.amount); break;
      case 'buff': if (u) { u.power = Math.max(0, u.power + (c.power ?? 0)); u.health += c.health ?? 0; } break;
      case 'exhaust': if (u) u.exhausted = true; break;
      case 'down': if (u) u.down = true; break;
      case 'summon': units.set(c.unit.uid, { ...c.unit }); break;
    }
  }
}

export const boardMap = (board: BoardUnit[]): Map<number, BoardUnit> => new Map(board.map((u) => [u.uid, { ...u }]));

/** What a beat was, in words, for the line under the board ("Kikimora: the enemy across gets −3 Power"). */
export function beatCaption(beat: Beat, units: Map<number, BoardUnit>, heroName: (p: PlayerId) => string): string {
  const name = (uid: number) => cardName(units.get(uid)?.id ?? '');
  const first = beat.changes[0];
  switch (beat.kind) {
    case 'strike': return beat.swift ? 'The Swift units strike first.' : 'Every unit strikes.';
    case 'heroes': return `${beat.changes.map((c) => c.t === 'hit' && 'hero' in c.from ? heroName(c.from.hero) : '').filter(Boolean).join(' and ')} strike${beat.changes.length > 1 ? '' : 's'}.`;
    case 'down': return `${beat.changes.map((c) => c.t === 'down' ? name(c.to) : '').join(', ')} ${beat.changes.length > 1 ? 'go' : 'goes'} down.`;
    case 'ambush': return first.t === 'ambush' ? `Ambush! ${cardName(first.cardId)}.` : '';
    case 'other':
      if (first.t === 'fizzle') return `${cardName(first.cardId ?? beat.src?.id ?? '')} finds nobody, and fizzles.`;
      if (first.t === 'awaken') return `${heroName(first.p)} Awakens!`;
      return '';
    case 'effect': {
      const who = beat.src ? cardName(beat.src.id) : 'An effect';
      const parts = beat.changes.map((c) => {
        switch (c.t) {
          case 'damage': return `${name(c.to)} takes ${c.amount}`;
          case 'heal': return `${name(c.to)} heals ${c.amount}`;
          case 'buff': return `${name(c.to)} gets ${[c.power ? `${signed(c.power)} Power` : '', c.health ? `${signed(c.health)} Health` : ''].filter(Boolean).join(' and ')}`;
          case 'exhaust': return `${name(c.to)} is exhausted`;
          case 'summon': return `a ${cardName(c.unit.id)} comes in`;
          default: return '';
        }
      }).filter(Boolean);
      return `${who}: ${parts.join(', ')}.`;
    }
  }
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : `−${-n}`);

// ── The summary ──────────────────────────────────────────────────────────────────────────────────

export interface UnitLine {
  uid: number;
  id: string;
  p: PlayerId;
  dealt: number;
  taken: number;
  /** The bout it went down in (0: before the first bout), or null if it stood to the end. */
  fell: number | null;
  exhausted: boolean;
}

export interface Summary {
  units: UnitLine[];
  /** Damage each Hero dealt with its strike. */
  heroes: [number, number];
  /** A few plain sentences on what decided the fight, for this player. */
  hints: string[];
}

/** Who dealt and took what, who fell when, and what decided it, as seen by `me`. */
export function summarize(r: Replay, me: PlayerId): Summary {
  const lines = new Map<number, UnitLine>();
  const line = (u: BoardUnit) => {
    if (!lines.has(u.uid)) lines.set(u.uid, { uid: u.uid, id: u.id, p: u.p, dealt: 0, taken: 0, fell: null, exhausted: !!u.exhausted });
    return lines.get(u.uid)!;
  };
  for (const u of r.sections[0].board) line(u);
  const heroes: [number, number] = [0, 0];
  const targets = new Map<number, Set<number>>();   // attacker → whom it hit
  for (const section of r.sections) {
    for (const u of section.board) line(u);
    for (const beat of section.beats) {
      for (const c of beat.changes) {
        if (c.t === 'summon') line(c.unit);
        if (c.t === 'hit') {
          const to = lines.get(c.to);
          if (to) to.taken += c.dealt;
          if ('uid' in c.from) {
            const from = lines.get(c.from.uid);
            if (from) from.dealt += c.dealt;
            if (!targets.has(c.from.uid)) targets.set(c.from.uid, new Set());
            targets.get(c.from.uid)!.add(c.to);
          } else heroes[c.from.hero] += c.dealt;
        }
        if (c.t === 'damage') {
          const to = lines.get(c.to);
          if (to) to.taken += c.amount;
          const from = beat.src?.uid !== undefined ? lines.get(beat.src.uid) : undefined;
          if (from) from.dealt += c.amount;
        }
        if (c.t === 'down') {
          const u = lines.get(c.to);
          if (u && u.fell === null) u.fell = section.bout;
        }
      }
    }
  }
  const units = [...lines.values()].filter((u) => !CARDS[u.id]?.token || u.dealt || u.taken);
  return { units, heroes, hints: hints(r, me, units, targets) };
}

const role = (id: string): string => {
  const k = CARDS[id]?.keywords ?? [];
  return k.includes('Guardian') ? 'Guardian' : k.includes('Lure') ? 'Lure' : k.includes('Elusive') ? 'Elusive' : '';
};

/** Two or three sentences a player can act on: what broke, and who did the most. */
function hints(r: Replay, me: PlayerId, units: UnitLine[], targets: Map<number, Set<number>>): string[] {
  const foe = other(me);
  const mine = units.filter((u) => u.p === me), theirs = units.filter((u) => u.p === foe);
  const out: string[] = [];
  const won = r.lost[foe] > 0 && r.lost[me] === 0;
  const best = (list: UnitLine[]) => [...list].sort((a, b) => b.dealt - a.dealt)[0];
  const theirBest = best(theirs), myBest = best(mine);
  if (!mine.length) out.push('You had no units on the board: an empty side loses the Clash at once.');
  // The front line: Guardians are hit first; when they fall early, the rest of the side follows.
  const guards = mine.filter((u) => role(u.id) === 'Guardian');
  if (mine.length && !guards.length && theirs.length) out.push('You had no Guardian to take their first hits: Guardians are hit before everyone else.');
  else if (guards.length && guards.every((u) => u.fell !== null && u.fell <= 1) && !won)
    out.push(`Your ${guards.length > 1 ? 'Guardians' : 'Guardian'} went down in the first bout: a sturdier one, or more of them, would hold longer.`);
  // Sneaky units go for the back first (with no Guardian, everything is the back: said above).
  for (const u of guards.length ? theirs : []) {
    if (!(CARDS[u.id]?.keywords ?? []).includes('Sneaky')) continue;
    const hit = [...(targets.get(u.uid) ?? [])].map((uid) => units.find((x) => x.uid === uid)).find((x) => x && x.p === me && role(x.id) !== 'Guardian');
    if (hit) { out.push(`Their Sneaky ${cardName(u.id)} went straight past your front for your ${cardName(hit.id)}. A Lure draws Sneaky units first.`); break; }
  }
  const idle = mine.filter((u) => u.exhausted && !u.dealt);
  if (idle.length) out.push(`${idle.map((u) => cardName(u.id)).join(', ')} ${idle.length > 1 ? 'were' : 'was'} exhausted and dealt no damage.`);
  if (theirBest?.dealt && !won) out.push(`Their ${cardName(theirBest.id)} did the most damage: ${theirBest.dealt}.`);
  else if (myBest?.dealt && won) out.push(`Your ${cardName(myBest.id)} did the most damage: ${myBest.dealt}.`);
  return out.slice(0, 3);
}

/** The Clash's result in one sentence, for this player: who won, and the Candles it cost. */
export function resultLine(r: Replay, me: PlayerId): string {
  const foe = other(me);
  const candles = (n: number) => `${n} ${n === 1 ? TERMS.candle : TERMS.candles}`;
  // A Fierce survivor (or an Awakened Hero that struck) is worth 2; the loss is capped.
  const fierce = (p: PlayerId) => (r.lost[other(p)] > r.standing[p] ? ' (Fierce ones count 2)' : '');
  if (r.lost[me] && r.lost[foe]) return `Both sides still stand: you lose ${candles(r.lost[me])}, they lose ${candles(r.lost[foe])}.`;
  if (r.lost[foe]) return `You win the Clash: ${r.standing[me]} of your units still stand${fierce(me)}, so they lose ${candles(r.lost[foe])}.`;
  if (r.lost[me]) return `You lose the Clash: ${r.standing[foe]} of their units still stand${fierce(foe)}, so you lose ${candles(r.lost[me])}.`;
  return 'Nobody wins the Clash.';
}
