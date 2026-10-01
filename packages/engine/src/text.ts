// The game as text, for players that read: LLM playtesters and the command-line game.
//
// `describe` shows one player exactly what they may know. It is built on `viewFor`, the same hidden-
// information view an online server would send, so a text player can't see the opponent's hand, the Candles,
// the deck order, or what the opponent does during the Muster. `listChoices` numbers the decisions in front of that
// player, and `parseChoice` turns a reply ("3", "I'll take 3 because…", "1 4" for a mulligan) back into an action.
//
// Units are named by their lane: Y1…Y6 in your lanes, T1…T6 in theirs; cards in hand are H1…Hn.

import { CARDS, keywords, MECHANICS } from './cards';
import {
  HAND_LIMIT, LANES, MULLIGAN_MAX, cardName, heroSide, interestOn, laneUnit, legalActions, levelCost, nextSeat, other, targetRank,
  unitHealth, unitKeywords, unitPower,
} from './engine';
import type { Action, GameState, PlayerId, Target, Unit } from './types';
import { viewFor, type PlayerView } from './view';
import TERMS from './terms.json';

/** The core rules, before the keyword list: the same whatever sets are loaded. */
const CORE_RULES = `FOLKBORN: RULES IN BRIEF
Two players, 50-card decks, each led by a Hero. Win by blowing out the opponent's ninth and last Candle.
- A round: Start (units and Hero ready again, income, draw 2; round 1 has no Start), then the Muster, then the Clash.
- Offerings are money. You start with ${'{start}'}. At each Start you get income (it grows with the rounds) plus interest: +1 for every 5 Offerings you have saved (at most +3). What you don't spend is kept. You can also offer any card from your hand, or a unit from your board, for 1 Offering.
- The Muster: both players build at the same time, in secret, each until they choose Ready. You may: play a unit into one of your 6 lanes (you may have as many units as your Hero's Level, 2 at first); play a Talisman on a unit of yours; play a Charm; set a card with Ambush face-down in one of your lanes; move your units between lanes (free); use your Hero's ability once; level up your Hero (more lanes) by paying Offerings; offer cards. You see the opponent's board as it was when the Muster began.
- Playing a second copy of a Creature you already have merges it into that unit: 2 stars, then 3, each star adding its printed Power and Health again. Fabled never merge.
- Effects aimed at the enemy (damage, exhaust) are aimed at one of their lanes and happen when the Clash begins, to whoever stands there then. With nobody there, they fizzle.
- The Clash plays itself. Ambushes are revealed when their lane holds what they need (otherwise they stay face-down for later). An Awakened Hero that didn't use its ability strikes once. Then come bouts: in each bout every unit hits one enemy unit, Swift units first, all at the same time; a unit whose damage reaches its Health goes down. Who a unit hits: a Guardian first; otherwise plain units; then Elusive units; Lures last. Sneaky units go the other way: Lures first, Guardians last. Among equals, the enemy across from it, otherwise the nearest (leftmost on a tie). An exhausted unit deals no damage.
- The Clash ends when one side has no units standing (or after ${'{bouts}'} bouts, or when nobody can deal damage). The loser blows out 1 Candle per enemy unit still standing (2 for Fierce ones, +1 for a Hero that struck), at most ${'{cap}'}. If both sides still stand at the end, each loses Candles for the other's units.
- After the Clash every unit stands up again with no damage: nothing on the board is lost in a Clash. Damage never carries over to the next round.
- Candles: when you lose one, its card goes into your hand. A Lucky one may be played for free in the next Muster.
- You can't be Ready with more than ${HAND_LIMIT} cards in hand: offer the extra ones.
- Hero: its "Exhaust:" ability can be used once a round. When its Awaken condition is true it flips to its Awakened side for good; an Awakened Hero that isn't exhausted strikes in the Clash.
- If you must draw from an empty deck, you lose a Candle instead.`;

/** Keywords of the core rules; the mechanics each set brings are listed after them. */
const CORE_KEYWORDS = `Swift: hits first in every bout. Guardian: enemies hit Guardians first (Sneaky ones last). Elusive: enemies hit it late (after plain units). Lure: enemies hit it last, but Sneaky enemies must hit it first. Sneaky: hits the enemy's Lures, then Elusive units, first. Fierce: worth 2 Candles if it is standing when its side wins a Clash. Tough X: takes X less each time it is dealt damage. Lucky: playable for free in the Muster after it turns up as a lost Candle. Ambush: may be set face-down in a lane, to happen in the Clash; it can also be played normally. Hello: happens when the unit is played. Goodbye: happens each time it goes down.`;

/**
 * The rules a text player needs: the core rules, then every mechanic the loaded sets define, with the reminder text
 * each set gives it. The same text for every request of a run, so providers can cache it.
 */
export function rulesPrimer(s?: GameState): string {
  const rules = s?.rules;
  const core = CORE_RULES.replace('{start}', String(rules?.startOfferings ?? 3)).replace('{bouts}', String(rules?.boutCap ?? 8))
    .replace('{cap}', String(rules?.clashCandleCap ?? 3));
  const mechanics = Object.entries(MECHANICS)
    .sort(([, a], [, b]) => (a.family ?? '').localeCompare(b.family ?? ''))
    .map(([name, m]) => `${name}${m.family ? ` (${m.family})` : ''}: ${m.reminder}`)
    .join(' ');
  return `${core}\nKEYWORDS\n${CORE_KEYWORDS}${mechanics ? `\nFAMILY MECHANICS\n${mechanics}` : ''}`;
}

/** Basic strategy, for text players that don't find it on their own. */
export const STRATEGY_PRIMER = `BASIC STRATEGY
- Your board is your army for the whole game: units are never lost in a Clash. Build it up every round.
- Spend, but save when it pays: every 5 Offerings saved earn 1 more at the next Start (up to 3). A Level costs Offerings but lets you field one more unit.
- Fill your lanes: an empty board loses the Clash. Then level up when your lanes are full and you have units to add.
- Put a Guardian where the enemy's strong units are; Guardians soak the first hits. Keep your best damage dealer Elusive or behind Guardians.
- Sneaky units hit Lures and Elusive units first: against Sneaky enemies, a Lure protects your carry.
- Merge copies of the same Creature: a 2-star unit is twice as strong.
- Aim damage Charms at the lane where the enemy's key unit stood last round; they hit whoever stands there when the Clash begins.
- Offer cards you can't use soon: each is 1 Offering. Keep your hand at ${HAND_LIMIT} or fewer.`;

/** How much a choice's label tells: `detail` adds stats and what a play does. */
export interface ChoiceOptions { detail?: boolean }

export interface Choice {
  /** 1-based number the player answers with. */
  n: number;
  label: string;
  action: Action;
}

export interface Choices {
  /** What is being decided, in a sentence. */
  question: string;
  /** Numbered options for a one-of choice; empty for a pick-several choice. */
  options: Choice[];
  /** A pick-several choice (the mulligan): answer with hand numbers. */
  multi?: { count?: number; kind: 'mulligan' };
}

const laneLabel = (owner: PlayerId, seat: PlayerId, lane: number) => `${owner === seat ? 'Y' : 'T'}${lane + 1}`;

const unitName = (view: GameState, seat: PlayerId, uid: number): string => {
  for (const owner of [0, 1] as PlayerId[]) {
    const u = view.players[owner].yard.find((x) => x.uid === uid);
    if (u) return `${laneLabel(owner, seat, u.slot)} ${cardName(u.id)}`;
  }
  return 'a unit';
};

function targetName(s: GameState, seat: PlayerId, t: Target | undefined): string {
  if (!t) return '';
  if (t.kind === 'hero') return t.player === seat ? 'your Hero' : 'the enemy Hero';
  if (t.kind === 'lane') {
    const u = laneUnit(s, t.player, t.lane);
    return `${t.player === seat ? 'your' : 'their'} lane ${laneLabel(t.player, seat, t.lane)}${u ? ` (${cardName(u.id)} stood there)` : ' (empty when the Muster began)'}`;
  }
  return unitName(s, seat, t.uid);
}

/** A counter as a player knows it: by its mechanic's name (Rain-Fed +1). */
function counterTags(u: Unit): string[] {
  return Object.entries(u.counters ?? {}).filter(([, n]) => n).map(([name, n]) =>
    `${Object.entries(MECHANICS).find(([, m]) => m.counter?.name === name)?.[0] ?? name} +${n}`);
}

const ROLE = ['Lure', 'Elusive', '', 'Guardian'];

function unitLine(u: Unit, label: string, s?: GameState): string {
  const k = unitKeywords(u, s);
  const tags = [
    ROLE[targetRank(u, s)], k.sneaky && 'Sneaky', k.fierce && 'Fierce', k.zoomies && 'Swift', k.tough && `Tough ${k.tough}`,
    u.stars && `${u.stars} stars`, ...counterTags(u), u.buffPower ? `+${u.buffPower} Power this round` : '',
    u.toy && `with ${cardName(u.toy.id)}`, u.exhausted && 'exhausted: deals no damage this Clash',
  ].filter(Boolean);
  const hp = unitHealth(u, s) - u.damage;
  const text = CARDS[u.id].text ? ` — ${CARDS[u.id].text}` : '';
  return `  ${label} ${cardName(u.id)} ${unitPower(u, s)}/${hp}${tags.length ? ` [${tags.join(', ')}]` : ''}${text}`;
}

function cardLine(id: string, label: string, free = false): string {
  const c = CARDS[id];
  const stats = c.power !== undefined ? ` ${c.power}/${c.health}` : '';
  return `  ${label} ${cardName(id)} (cost ${c.cost ?? 0}${free ? ', FREE this Muster (Lucky)' : ''}, ${TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type}${stats})${c.text ? ` — ${c.text}` : ''}`;
}

function heroLine(s: GameState, p: PlayerId): string {
  const hero = s.players[p].hero;
  const side = heroSide(s, p);
  const state = [hero.grown ? `${TERMS.sides.bigCat}, Power ${side.power ?? 0}` : 'not yet Awakened', hero.exhausted ? 'exhausted' : 'ready', `Level ${hero.level}`].join(', ');
  return `${cardName(hero.id)} (${state}): ${side.text.replace(/\n/g, ' | ')}`;
}

// The engine logs in the third person ("Ana plays…"); a reader is told "You play…".
const YOU_VERBS: Record<string, string> = {
  keeps: 'keep', makes: 'make', plays: 'play', takes: 'take', mulligans: 'mulligan', offers: 'offer', moves: 'move', sets: 'set',
  loses: 'lose', starts: 'start', wins: 'win', has: 'have', holds: 'hold', reaches: 'reach', uses: 'use', draws: 'draw', gets: 'get', gains: 'gain', is: 'are', summons: 'summon',
};
function secondPerson(text: string, me: string, foe: string): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`\\b${esc(me)}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${esc(me)} (now )?(\\w+)`, 'g'), (_m, now: string | undefined, verb: string) => `you ${now ?? ''}${YOU_VERBS[verb] ?? verb}`)
    .replace(new RegExp(`\\b${esc(foe)}\\b`, 'g'), 'Opponent')
    .replace(/(^|[.!:] |— )(you|your)\b/g, (_m, lead: string, w: string) => lead + w[0].toUpperCase() + w.slice(1));
}

/** What `seat` sees: both sides of the table, their own hand, and what is happening right now. */
export function describe(s: GameState, seat: PlayerId, recent = 12): string {
  const v: PlayerView = viewFor(s, seat);
  const me = v.players[seat], foe = v.players[other(seat)];
  const lines: string[] = [];
  lines.push(`ROUND ${v.round}. ${v.yarn === seat ? 'You hold' : 'Your opponent holds'} the Lantern (its holder's effects go first).`);
  if (v.phase === 'muster') lines.push(`THE MUSTER: you see the opponent as they stood when it began.`);
  const side = (p: PlayerId, who: string) => {
    const pl = v.players[p];
    lines.push('', `${who} — ${pl.deckName}`);
    lines.push(`  Hero: ${heroLine(v, p)}`);
    const next = levelCost(v, p);
    lines.push(`  Candles ${pl.lives.length} · Offerings ${pl.offerings} (interest next Start: +${interestOn(v, pl.offerings)}) · Units ${pl.yard.length}/${pl.hero.level}${next !== null ? ` (next Level costs ${next})` : ''} · Hand ${pl.hand.length} · Deck ${pl.deck.length}`);
    const ambushes = (pl.ambushes ?? []).map((a) => p === seat ? `${laneLabel(p, seat, a.lane)} ${cardName(a.card.id)}` : laneLabel(p, seat, a.lane));
    if (ambushes.length) lines.push(`  Face-down Ambushes: ${ambushes.join(', ')}`);
    for (let lane = 0; lane < LANES; lane++) {
      const u = laneUnit(v, p, lane);
      lines.push(u ? unitLine(u, laneLabel(p, seat, lane), v) : `  ${laneLabel(p, seat, lane)} —`);
    }
  };
  side(other(seat), 'OPPONENT');
  side(seat, 'YOU');
  if (me.pending?.length) lines.push(`  Waiting for the Clash: ${me.pending.map((x) => `${cardName(x.sourceId)}${x.target ? ` → ${targetName(v, seat, x.target)}` : ''}`).join('; ')}`);
  lines.push('  Hand:');
  const free = new Set(me.free ?? []);
  me.hand.forEach((c, i) => lines.push(cardLine(c.id, `H${i + 1}`, free.has(c.uid))));
  const log = v.log.slice(-recent).map((e) => `  ${secondPerson(e.text, me.name, foe.name)}`);
  if (log.length) lines.push('', 'RECENTLY:', ...log);
  return lines.join('\n');
}

function detailed(s: GameState, seat: PlayerId, a: Action, base: string): string {
  const me = s.players[seat];
  const card = (uid: number) => me.hand.find((c) => c.uid === uid);
  switch (a.t) {
    case 'play': case 'lucky': case 'ambush': {
      const c = CARDS[card(a.uid)!.id];
      const unit = c.type === 'Critter' || c.type === 'Cat';
      const left = a.t === 'lucky' ? me.offerings : me.offerings - (c.cost ?? 0);
      return `${base} — ${[unit ? `${c.power}/${c.health}` : TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type, c.text?.replace(/\.$/, '')].filter(Boolean).join('. ')}. Leaves ${left} Offering(s).`;
    }
    case 'levelUp': return `${base}: ${me.hero.level + 1} lanes, leaves ${me.offerings - (levelCost(s, seat) ?? 0)} Offering(s)`;
    case 'ready': return me.offerings ? `${base} (${me.offerings} Offering(s) saved: +${interestOn(s, me.offerings)} interest next Start)` : base;
    default: return base;
  }
}

function label(s: GameState, seat: PlayerId, a: Action, o: ChoiceOptions = {}): string {
  const text = plainLabel(s, seat, a);
  return o.detail ? detailed(s, seat, a, text) : text;
}

function plainLabel(s: GameState, seat: PlayerId, a: Action): string {
  const me = s.players[seat];
  const card = (uid: number) => me.hand.find((c) => c.uid === uid);
  const on = (t?: Target) => (t ? ` → ${targetName(s, seat, t)}` : '');
  const lane = (slot?: number) => (slot !== undefined ? ` into lane Y${slot + 1}` : '');
  switch (a.t) {
    case 'play': {
      const c = card(a.uid)!;
      const twin = a.slot === undefined && (CARDS[c.id].type === 'Critter') && me.yard.some((u) => u.id === c.id);
      return `Play ${cardName(c.id)} (cost ${CARDS[c.id].cost ?? 0})${twin ? ' — merges into your copy' : lane(a.slot)}${on(a.target)}${a.target2 ? ` and ${targetName(s, seat, a.target2)}` : ''}`;
    }
    case 'lucky': { const c = card(a.uid)!; return `Play ${cardName(c.id)} for free (Lucky)${lane(a.slot)}${on(a.target)}`; }
    case 'ambush': { const c = card(a.uid)!; return `Set ${cardName(c.id)} face-down as an Ambush in lane Y${a.lane + 1} (cost ${CARDS[c.id].cost ?? 0})${on(a.target)}`; }
    case 'move': {
      const u = me.yard.find((x) => x.uid === a.uid)!;
      const there = laneUnit(s, seat, a.slot);
      return there ? `Swap ${unitName(s, seat, u.uid)} and ${unitName(s, seat, there.uid)}` : `Move ${unitName(s, seat, u.uid)} to lane Y${a.slot + 1}`;
    }
    case 'offer': {
      const c = card(a.uid);
      return c ? `Offer ${cardName(c.id)} from your hand (+1 Offering)` : `Offer your unit ${unitName(s, seat, a.uid)} (+1 Offering; it leaves the board)`;
    }
    case 'ability': {
      const text = heroSide(s, seat).text.split('\n').find((l) => /Exhaust/.test(l)) ?? '';
      return `Use your Hero's ability (${text.trim()})${on(a.target)}`;
    }
    case 'levelUp': return `Level up your Hero (cost ${levelCost(s, seat)})`;
    case 'ready': return 'Ready: done for this Muster';
    default: return a.t;
  }
}

/** The decision in front of a player (the one the game names when no seat is given). */
export function listChoices(s: GameState, o: ChoiceOptions = {}, seat?: PlayerId): Choices {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) return { question: 'The game is over.', options: [] };
  const p = seat ?? nextSeat(s) ?? prompt.player;
  if (prompt.kind === 'mulligan')
    return { question: `Mulligan: list up to ${MULLIGAN_MAX} hand cards (H numbers) to swap for new ones, or "none" to keep all six.`, options: [], multi: { kind: 'mulligan' } };
  const me = s.players[p];
  const over = me.hand.length > HAND_LIMIT ? ` You hold ${me.hand.length} cards: offer ${me.hand.length - HAND_LIMIT} before you can be Ready.` : '';
  const options = legalActions(s, p).map((action, i) => ({ n: i + 1, label: label(s, p, action, o), action }));
  return { question: `The Muster: your move (${me.offerings} Offerings, ${me.yard.length}/${me.hero.level} units).${over}`, options };
}

/** The choices as the text a player reads under the table. */
export function choicesText(s: GameState, o: ChoiceOptions = {}, seat?: PlayerId): string {
  const c = listChoices(s, o, seat);
  if (c.multi) return c.question;
  return [c.question, ...c.options.map((x) => `  ${x.n}. ${x.label}`), 'Answer with the number of your choice.'].join('\n');
}

/**
 * The action a reply names, or an error message to send back. The first number in a reply is taken as the
 * choice, so "7 — put the Guardian across from their Fierce unit" works; a mulligan reply is every number, or "none".
 */
export function parseChoice(s: GameState, reply: string, seat?: PlayerId): { action: Action } | { error: string } {
  const prompt = s.prompt;
  if (!prompt) return { error: 'The game is over.' };
  const p = seat ?? nextSeat(s) ?? prompt.player;
  const c = listChoices(s, {}, p);
  // Prefer an explicit "answer: …" or "choice: …" line when a reply reasons out loud first.
  const tagged = /(?:answer|choice|final)\s*[:=]\s*([^\n]*)/i.exec(reply)?.[1];
  const text = tagged ?? reply;
  if (c.multi) {
    const hand = s.players[p].hand;
    const nums = /\bnone\b/i.test(text) && !/\d/.test(text) ? [] : [...text.matchAll(/H?(\d+)/gi)].map((m) => Number(m[1]));
    if (nums.some((n) => n < 1 || n > hand.length)) return { error: `Hand numbers go from 1 to ${hand.length}.` };
    if (new Set(nums).size !== nums.length) return { error: 'List each card once.' };
    if (nums.length > MULLIGAN_MAX) return { error: `Swap at most ${MULLIGAN_MAX} cards; you chose ${nums.length}.` };
    return { action: { t: 'mulligan', uids: nums.map((n) => hand[n - 1].uid) } };
  }
  const m = /\d+/.exec(text);
  if (!m) return { error: `Answer with a number from 1 to ${c.options.length}.` };
  const choice = c.options.find((o) => o.n === Number(m[0]));
  return choice ? { action: choice.action } : { error: `There is no choice ${m[0]}; answer with a number from 1 to ${c.options.length}.` };
}

/** Whether a card is a Lucky Candle the player may play for free now. */
export const isFree = (s: GameState, p: PlayerId, uid: number): boolean => !!s.players[p].free?.includes(uid) && keywords(s.players[p].hand.find((c) => c.uid === uid)?.id ?? '').lucky;
