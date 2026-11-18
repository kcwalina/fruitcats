// The game as text, for players that read: LLM playtesters and the command-line game.
//
// `describe` shows one player exactly what they may know. It is built on `viewFor`, the same hidden-
// information view an online server would send, so a text player can't see the opponent's shop, the deck order, or
// what the opponent does during the Muster. `listChoices` numbers the decisions in front of that player, and
// `parseChoice` turns a reply ("3", "I'll take 3 because…") back into an action.
//
// Units are named by their lane: Y1…Y6 in your lanes, T1…T6 in theirs; cards in the shop are S1…Sn.

import { CARDS, MECHANICS, isUnitCard, keywords } from './cards';
import {
  LANES, cardName, heroSide, interestOn, laneUnit, legalActions, levelCost, nextSeat, other, rollCost, sellValue, streakBonus, isTaunt, unitClass,
  unitHealth, unitKeywords, unitPower,
} from './engine';
import type { Ability, Action, GameState, PlayerId, Target, Unit } from './types';
import { RULES } from './rules';
import { viewFor, type PlayerView } from './view';
import TERMS from './terms.json';

/** The core rules, before the keyword list: the same whatever sets are loaded. */
const CORE_RULES = `FOLKBORN: RULES IN BRIEF
Two players, 50-card decks, each led by a Hero. Win by blowing out the opponent's ninth and last Candle.
- A round: Start (units and Hero ready again, income; round 1 has no income), a new shop, then the Muster, then the Clash.
- The shop: ${'{shop}'} cards dealt face up from your own deck at every Start. Buy what you want at its cost; what you don't buy goes back into your deck, which is shuffled. Roll (${'{roll}'} Offering) to put the shop back and get ${'{shop}'} new cards. Every card has a tier, 1 to 5, which is its cost; your Hero's Level decides which tiers the shop deals (Level 2: mostly tier 1, some tier 2; Level 6: all tiers, tier 4 and 5 included).
- Offerings are money. You start with ${'{start}'}. At each Start you get income (it grows with the rounds), plus interest: +1 for every 5 Offerings you have saved (at most +3), plus a losing streak: +1 after 2 or 3 Clashes lost in a row, +2 after 4, +3 after 5 or more. What you don't spend is kept.
- The Muster: both players build at the same time, in secret, each until they choose Ready. You may: buy a unit into one of your open lanes (your Hero's Level opens that many of your 6 lanes, from the left: lanes 1-2 at first); buy a Talisman for a unit of yours; buy a Charm; buy a card with Ambush and set it face-down in one of your lanes; move your units between lanes (free); sell a unit (you get back what you paid, less 1 for each star it has; its card goes back into your deck); roll the shop; use your Hero's ability once; level up your Hero by paying Offerings (each Level is room for one more unit; there are always 6 lanes). You see the opponent's board as it was when the Muster began.
- Buying a copy of a Creature you already have merges it into that unit, even when your lanes are full. 3 copies in one unit make it 2 stars (twice its printed Power and Health), 5 copies make 3 stars (three times). Fabled never merge. A deck may hold 5 copies of a tier 1 card, 4 of tier 2, 3 of tier 3, 2 of tier 4, 1 of tier 5, of any families.
- Classes: every unit has one, the first word of its text. Tank and Bruiser fight at the front; Marksman, Mage and Support at the back; a Support never attacks (its ability helps); an Assassin strikes first in every bout and goes for the enemy's back.
- Traits: each family is a trait. With 2, 4 or 6 different units of a family on your board, its team bonus turns on; the highest tier reached is the one that counts. Copies merged into one unit count once.
- Units act in the fight: "Clash start:" happens once before the first bout, "Each bout:" at the start of every bout, "Every second bout:" at bouts 2, 4, 6 and 8.
- Effects aimed at the enemy (damage, exhaust) are aimed at one of their lanes and happen when the Clash begins, to whoever stands there then. With nobody there, they fizzle.
- The Clash plays itself. Ambushes are revealed when their lane holds what they need (otherwise they stay face-down for later). Order: first the effects aimed at lanes, then Ambushes, then an Awakened Hero that didn't use its ability strikes once (before any unit hits), then the units' "Clash start:" abilities, then the bouts: in each bout every unit hits one enemy unit, Assassins and Swift units first, all at the same time; a unit whose damage reaches its Health goes down. Who a unit hits: a unit with Taunt first; then Tanks; then Bruisers and Assassins; then the back (Marksmen, Mages, Supports). An Assassin goes for the back first, unless a unit taunts. Among equals, the enemy across from it, otherwise the nearest (leftmost on a tie). An exhausted unit deals no damage in this Clash, but can still be hit; it is ready again next round.
- The Clash ends when one side has no units standing (or after ${'{bouts}'} bouts, or when nobody can deal damage). The loser blows out 1 Candle per enemy unit still standing (2 for Fierce ones, +1 for a Hero that struck), at most ${'{cap}'}. If both sides still stand at the end, each loses Candles for the other's units.
- After the Clash every unit stands up again with no damage: nothing on the board is lost in a Clash. Damage never carries over to the next round.
- Hero: its "Exhaust:" ability can be used once a round. When its Awaken condition is true it flips to its Awakened side for good; an Awakened Hero that isn't exhausted strikes in the Clash.`;

/** Keywords of the core rules; the mechanics each set brings are listed after them. */
const CORE_KEYWORDS = `Swift: hits first in every bout. Taunt: every enemy hits it first while it stands, Assassins included. Fierce: worth 2 Candles if it is standing when its side wins a Clash. Tough X: takes X less each time it is dealt damage. Ambush: may be set face-down in a lane, to happen in the Clash; it can also be played normally. Hello: happens when the unit is played. Goodbye: happens each time it goes down.`;

/**
 * The rules a text player needs: the core rules, then every mechanic the loaded sets define, with the reminder text
 * each set gives it. The same text for every request of a run, so providers can cache it.
 */
export function rulesPrimer(s?: GameState): string {
  const rules = s?.rules ?? RULES;
  const core = CORE_RULES.replace('{start}', String(rules.startOfferings)).replace('{bouts}', String(rules.boutCap))
    .replaceAll('{cap}', String(rules.clashCandleCap)).replaceAll('{shop}', String(rules.shopSize))
    .replace('{roll}', String(rules.rollCost));
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
- Tanks soak the first hits: field one or two. Your damage dealers at the back (Marksmen, Mages) are hit last.
- Assassins go for the back: against them, a unit with Taunt protects your back. Supports help the units next to them: put them beside your best units.
- Merge copies of the same Creature: 3 copies make a 2-star unit, twice as strong. A copy merges even when your lanes are full.
- Build toward traits: different units of one family (2, 4, 6) or role (2, 4) turn on team bonuses. A higher Level deals more high-tier cards.
- Moving is free, but only where your units stand when you are Ready matters. Decide where each unit goes, move it once, and get on with buying cards.
- Aim damage Charms at the lane where the enemy's key unit stood last round; they hit whoever stands there when the Clash begins.
- Roll when the shop has nothing for you and you can spare the Offering; with lanes full, sell your weakest unit to make room for a better one.`;

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
  /** Numbered options. */
  options: Choice[];
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

function unitLine(u: Unit, label: string, s?: GameState): string {
  const k = unitKeywords(u, s);
  const tags = [
    unitClass(u), isTaunt(u, s) && 'Taunt', k.fierce && 'Fierce', k.zoomies && 'Swift', k.tough && `Tough ${k.tough}`,
    u.stars && `${u.stars} stars`, ...counterTags(u), u.buffPower ? `+${u.buffPower} Power this round` : '',
    u.toy && `with ${cardName(u.toy.id)}`, u.exhausted && 'exhausted: deals no damage this Clash',
  ].filter(Boolean);
  const hp = unitHealth(u, s) - u.damage;
  const text = CARDS[u.id].text ? ` — ${CARDS[u.id].text}` : '';
  return `  ${label} ${cardName(u.id)} ${unitPower(u, s)}/${hp}${tags.length ? ` [${tags.join(', ')}]` : ''}${text}`;
}

function cardLine(id: string, label: string): string {
  const c = CARDS[id];
  const stats = c.power !== undefined ? ` ${c.power}/${c.health}` : '';
  return `  ${label} ${cardName(id)} (cost ${c.cost ?? 0}, ${TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type}${stats})${c.text ? ` — ${c.text}` : ''}`;
}

/** Why a shop card isn't among the choices: the LLM kept trying to buy such cards by their S number. */
function whyNot(s: GameState, seat: PlayerId, id: string): string {
  const me = s.players[seat];
  const c = CARDS[id];
  if ((c.cost ?? 0) > me.offerings) return `costs ${c.cost}, you have ${me.offerings}`;
  if (isUnitCard(id)) return 'no free lane and no copy to merge into: level up or sell first';
  return 'nothing it can be played on';
}

function heroLine(s: GameState, p: PlayerId): string {
  const hero = s.players[p].hero;
  const side = heroSide(s, p);
  const state = [hero.grown ? `${TERMS.sides.bigCat}, Power ${side.power ?? 0}` : 'not yet Awakened', hero.exhausted ? 'exhausted' : 'ready', `Level ${hero.level}`].join(', ');
  return `${cardName(hero.id)} (${state}): ${side.text.replace(/\n/g, ' | ')}`;
}

// The engine logs in the third person ("Ana plays…"); a reader is told "You play…".
const YOU_VERBS: Record<string, string> = {
  keeps: 'keep', makes: 'make', plays: 'play', buys: 'buy', sells: 'sell', rolls: 'roll', takes: 'take', moves: 'move', sets: 'set',
  loses: 'lose', starts: 'start', wins: 'win', has: 'have', holds: 'hold', reaches: 'reach', uses: 'use', gets: 'get', gains: 'gain', is: 'are', summons: 'summon',
};
function secondPerson(text: string, me: string, foe: string): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`\\b${esc(me)}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${esc(me)} (now )?(\\w+)`, 'g'), (_m, now: string | undefined, verb: string) => `you ${now ?? ''}${YOU_VERBS[verb] ?? verb}`)
    .replace(new RegExp(`\\b${esc(foe)}\\b`, 'g'), 'Opponent')
    .replace(/(^|[.!:] |— )(you|your)\b/g, (_m, lead: string, w: string) => lead + w[0].toUpperCase() + w.slice(1));
}

/** What `seat` sees: both sides of the table, their own shop, and what is happening right now. */
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
    const streak = pl.streak ? ` · Clashes lost in a row ${pl.streak} (+${streakBonus(v, pl.streak)} next Start)` : '';
    lines.push(`  Candles ${pl.lives} · Offerings ${pl.offerings} (interest next Start: +${interestOn(v, pl.offerings)})${streak} · Units ${pl.yard.length}/${pl.hero.level}${next !== null ? ` (next Level costs ${next})` : ''} · Deck ${pl.deck.length}`);
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
  lines.push(`  Your shop${me.freeRolls ? ` (free rolls: ${me.freeRolls})` : ''}:`);
  const buyable = new Set(legalActions(s, seat).flatMap((a) => (a.t === 'play' || a.t === 'ambush' ? [a.uid] : [])));
  me.shop.forEach((c, i) => lines.push(cardLine(c.id, `S${i + 1}`) + (buyable.has(c.uid) ? '' : ` [can't buy now: ${whyNot(s, seat, c.id)}]`)));
  const log = v.log.slice(-recent).map((e) => `  ${secondPerson(e.text, me.name, foe.name)}`);
  if (log.length) lines.push('', 'RECENTLY:', ...log);
  return lines.join('\n');
}

function detailed(s: GameState, seat: PlayerId, a: Action, base: string): string {
  const me = s.players[seat];
  const card = (uid: number) => me.shop.find((c) => c.uid === uid);
  switch (a.t) {
    case 'play': case 'ambush': {
      const c = CARDS[card(a.uid)!.id];
      const unit = c.type === 'Critter' || c.type === 'Cat';
      const left = me.offerings - (c.cost ?? 0);
      return `${base} — ${[unit ? `${c.power}/${c.health}` : TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type, c.text?.replace(/\.$/, '')].filter(Boolean).join('. ')}. Leaves ${left} Offering(s).`;
    }
    case 'levelUp': return `${base}: room for ${me.hero.level + 1} units, leaves ${me.offerings - (levelCost(s, seat) ?? 0)} Offering(s)`;
    case 'ready': return me.offerings ? `${base} (${me.offerings} Offering(s) saved: +${interestOn(s, me.offerings)} interest next Start)` : base;
    default: return base;
  }
}

function label(s: GameState, seat: PlayerId, a: Action, o: ChoiceOptions = {}): string {
  const text = plainLabel(s, seat, a);
  return o.detail ? detailed(s, seat, a, text) : text;
}

/** A note when the target already has as many counters as the effect gives at most: the gain would be lost. */
function atMost(s: GameState, abilities: Ability[] | undefined, t: Target | undefined): string {
  if (t?.kind !== 'unit') return '';
  const u = s.players.flatMap((p) => p.yard).find((x) => x.uid === t.uid);
  for (const act of (abilities ?? []).flatMap((ab) => ab.do ?? [])) {
    const c = (act as { counter?: { name: string; max?: number } }).counter;
    if (u && c?.max !== undefined && (u.counters?.[c.name] ?? 0) >= c.max) {
      const name = Object.entries(MECHANICS).find(([, m]) => m.counter?.name === c.name)?.[0] ?? c.name;
      return ` (already at ${name} +${c.max}, the most: it gains nothing)`;
    }
  }
  return '';
}

function plainLabel(s: GameState, seat: PlayerId, a: Action): string {
  const me = s.players[seat];
  const card = (uid: number) => me.shop.find((c) => c.uid === uid);
  const on = (t?: Target) => (t ? ` → ${targetName(s, seat, t)}` : '');
  const lane = (slot?: number) => (slot !== undefined ? ` into lane Y${slot + 1}` : '');
  switch (a.t) {
    case 'play': {
      const c = card(a.uid)!;
      const twin = a.slot === undefined && (CARDS[c.id].type === 'Critter') && me.yard.some((u) => u.id === c.id);
      const now = keywords(c.id).pounce ? ' and play it now, not as an Ambush,' : '';
      return `Buy ${cardName(c.id)}${now} (cost ${CARDS[c.id].cost ?? 0})${twin ? ' — merges into your copy' : lane(a.slot)}${on(a.target)}${a.target2 ? ` and ${targetName(s, seat, a.target2)}` : ''}${atMost(s, CARDS[c.id].abilities, a.target)}`;
    }
    case 'ambush': { const c = card(a.uid)!; return `Buy ${cardName(c.id)} and set it face-down as an Ambush in lane Y${a.lane + 1} (cost ${CARDS[c.id].cost ?? 0})${on(a.target)}`; }
    case 'move': {
      const u = me.yard.find((x) => x.uid === a.uid)!;
      const there = laneUnit(s, seat, a.slot);
      return there ? `Swap ${unitName(s, seat, u.uid)} and ${unitName(s, seat, there.uid)}` : `Move ${unitName(s, seat, u.uid)} to lane Y${a.slot + 1}`;
    }
    case 'sell': {
      const u = me.yard.find((x) => x.uid === a.uid)!;
      return `Sell your unit ${unitName(s, seat, a.uid)} (+${sellValue(s, u)} Offering(s); it leaves the board)`;
    }
    case 'roll': {
      const cost = rollCost(s, seat);
      return `Roll: a new shop (${cost ? `cost ${cost}` : 'free'})`;
    }
    case 'ability': {
      const text = heroSide(s, seat).text.split('\n').find((l) => /Exhaust/.test(l)) ?? '';
      return `Use your Hero's ability (${text.trim()})${on(a.target)}${atMost(s, heroSide(s, seat).abilities, a.target)}`;
    }
    case 'levelUp': return `Level up your Hero (cost ${levelCost(s, seat)})`;
    case 'ready': return 'Ready: done for this Muster';
    default: return (a as Action).t;
  }
}

/** The decision in front of a player (the one the game names when no seat is given). */
export function listChoices(s: GameState, o: ChoiceOptions = {}, seat?: PlayerId): Choices {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) return { question: 'The game is over.', options: [] };
  const p = seat ?? nextSeat(s) ?? prompt.player;
  const me = s.players[p];
  const options = legalActions(s, p).map((action, i) => ({ n: i + 1, label: label(s, p, action, o), action }));
  return { question: `The Muster: your move (${me.offerings} Offerings, ${me.yard.length}/${me.hero.level} units).`, options };
}

/** The choices as the text a player reads under the table. */
export function choicesText(s: GameState, o: ChoiceOptions = {}, seat?: PlayerId): string {
  const c = listChoices(s, o, seat);
  return [c.question, ...c.options.map((x) => `  ${x.n}. ${x.label}`), 'Answer with the number of your choice.'].join('\n');
}

/**
 * The action a reply names, or an error message to send back. The first number in a reply is taken as the
 * choice, so "7 — put the Guardian across from their Fierce unit" works.
 */
export function parseChoice(s: GameState, reply: string, seat?: PlayerId): { action: Action } | { error: string } {
  const prompt = s.prompt;
  if (!prompt) return { error: 'The game is over.' };
  const p = seat ?? nextSeat(s) ?? prompt.player;
  const c = listChoices(s, {}, p);
  // Prefer an explicit "answer: …" or "choice: …" line when a reply reasons out loud first.
  const tagged = /(?:answer|choice|final)\s*[:=]\s*([^\n]*)/i.exec(reply)?.[1];
  const text = tagged ?? reply;
  // A number glued to a letter is a lane or a shop card (Y1, S3), not a choice.
  const m = /(?<![A-Za-z])\d+/.exec(text);
  if (!m) return { error: `Answer with a number from 1 to ${c.options.length}.` };
  const choice = c.options.find((o) => o.n === Number(m[0]));
  return choice ? { action: choice.action } : { error: `There is no choice ${m[0]}; answer with a number from 1 to ${c.options.length}.` };
}
