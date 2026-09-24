// The game as text, for players that read: LLM playtesters and the command-line game.
//
// `describe` shows one player exactly what they may know. It is built on `viewFor`, the same hidden-
// information view an online server would send, so a text player can't see the opponent's hand, the Lives
// or the deck order. `listChoices` numbers the decisions in front of that player, and `parseChoice` turns a
// reply ("3", "I'll take 3 because…", "1 4" for a multi-card choice) back into an engine action.
//
// Units are named by where they stand: Y1…Y6 in your Yard, T1…T6 in theirs; cards in hand are H1…Hn.

import { CARDS, MECHANICS, behaviour, keywords } from './cards';
import { HAND_LIMIT, cardName, findUnit, heroSide, isGuardian, isSneaky, legalActions, other, readyTreats, unitHealth, unitKeywords, unitPower } from './engine';
import type { Action, GameState, PlayerId, Target, Unit } from './types';
import { viewFor, type PlayerView } from './view';

/** The rules a text player needs, in about a thousand tokens. Constant, so providers can cache it. */
export const RULES_PRIMER = `FRUITCATS: RULES IN BRIEF
Two players, 50-card decks, each led by a Hero Cat. Win by taking the opponent's ninth and last Life.
- Lives: each player starts with 9 face-down Life cards. When you lose a Life, that card goes into your hand. If it is Lucky you may play it for free right away.
- Treats pay for cards. Each Treat is a card you planted face-down; a card costing N exhausts N ready Treats. Treats ready again each round. Plant at most one card per round (at the start of the round); planting is permanent, so plant what you need least.
- Round: Start (everything readies, draw 2, may plant 1; skipped in round 1), then Actions, then End (hand limit ${HAND_LIMIT}; "this round" effects end).
- Actions: starting with the Yarn Ball holder, players alternate ONE action at a time until both pass in a row. An action is: play a card, attack, use your Hero Cat's ability, take the Yarn, or pass. Passing is not final: if the opponent acts again, you may act again.
- Take the Yarn: you act first next round, but for the rest of this round you may only pass. Only one player may take it per round; if nobody does, the Yarn Ball goes to the other player.
- Units (Critters and Cats) enter the Yard exhausted, so they can't attack the round they arrive (unless Zoomies). A Yard holds at most 6 units. Toys attach to a unit you control. Tricks do their effect and go to the Compost.
- Attack: exhaust a ready unit (or your Big Cat) and pick a target: an enemy unit, or the enemy Hero Cat. If the enemy has a Guardian you must attack a Guardian, unless your attacker is Sneaky.
  Unit vs unit: both deal their Power to each other at once; damage stays between rounds; a unit with damage >= Health is defeated.
  Unit vs Hero Cat: a hit. The defender loses 1 Life (2 if the attacker is Fierce) and the attacker takes no damage.
- Pounce: when your opponent plays a card or declares an attack, you may answer with ONE Pounce card (paying its cost). It resolves first. No Pouncing on a Pounce. Ready Treats you keep are a threat the opponent must respect.
- Hero Cat: starts as a Kitten, which cannot attack. Its "Exhaust:" ability can be used once a round (exhausting the Hero Cat). When its Grow Up condition becomes true it flips to its Big Cat side for good: stronger ability, and it can attack (it takes no damage attacking).
- If you must draw from an empty deck, you lose a Life instead.
KEYWORDS
Zoomies: enters ready. Guardian: enemies must attack Guardians first. Sneaky: ignores Guardians. Fierce: a hit on a Hero Cat takes 2 Lives. Tough X: takes X less damage from each hit. Lucky: playable for free when it turns up as a lost Life. Pounce: playable in the opponent's Pounce window (also as a normal action). Hello: happens when the unit arrives. Goodbye: happens when it is defeated. Ripen (Orchard): +1/+1 at the start of each round, up to +2/+2. Zest (Citrus): a bonus if you already played another card this round. Sprout N (Tropical): put the top N cards of your deck into your Treats. Lush (Tropical): a bonus while you have 7 or more Treats.`;

/**
 * Basic strategy, for text players that don't find it on their own: an LLM that knew only the rules gave its
 * turns away (taking the Yarn as its first action), planted its best cheap cards and expected units to attack
 * the round they arrived. It lost 47 of 50 games against the bot in seats where the bot wins half.
 */
export const STRATEGY_PRIMER = `BASIC STRATEGY
- Spend your Treats every round. A Treat you don't use this round is wasted, unless you keep it ready on purpose for a Pounce.
- Plant the card you're least likely to want soon: something too expensive to afford for a while, or a spare copy. Don't plant a cheap unit you could play next round.
- Units arrive exhausted (Zoomies excepted), so play them early: a unit played now can attack next round.
- Take the Yarn Ball only as your LAST action of a round, when there is nothing useful left to do. Taking it means you may only pass for the rest of the round.
- Before attacking, read the predicted result next to each attack: trade when you come out ahead (their unit dies, or yours survives), and hit the Hero Cat when there's no good trade. Each hit costs them a Life, but the Life card goes to their hand.
- Guardians must be attacked first unless your attacker is Sneaky. A Guardian with high Health can absorb a whole turn: remove it with damage Tricks, or go around it with Sneaky units.
- Pass only when you have nothing worth doing. If your opponent then acts, you get to act again.`;

/** How much a choice's label tells: `detail` adds stats, what a play does, and each attack's predicted result. */
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
  /** A pick-several choice (mulligan, setup plant, discard): answer with hand numbers. */
  multi?: { count?: number; kind: 'mulligan' | 'setupPlant' | 'discard' };
}

const unitName = (view: GameState, seat: PlayerId, uid: number): string => {
  for (const owner of [0, 1] as PlayerId[]) {
    const i = view.players[owner].yard.findIndex((u) => u.uid === uid);
    if (i >= 0) return `${owner === seat ? 'Y' : 'T'}${i + 1} ${cardName(view.players[owner].yard[i].id)}`;
  }
  return 'a unit';
};

function targetName(s: GameState, seat: PlayerId, t: Target | undefined): string {
  if (!t) return '';
  if (t.kind === 'hero') return t.player === seat ? 'your Hero Cat' : 'the enemy Hero Cat';
  return unitName(s, seat, t.uid);
}

/** A counter as a player knows it: by its mechanic's name (Ripen +1, Heat +2). */
function counterTags(u: Unit): string[] {
  return Object.entries(u.counters ?? {}).filter(([, n]) => n).map(([name, n]) =>
    `${Object.entries(MECHANICS).find(([, m]) => m.counter?.name === name)?.[0] ?? name} +${n}`);
}

function unitLine(u: Unit, label: string, s?: GameState): string {
  const k = unitKeywords(u, s);
  const tags = [
    isGuardian(u, s) && 'Guardian', isSneaky(u, s) && 'Sneaky', k.fierce && 'Fierce', k.zoomies && 'Zoomies', k.tough && `Tough ${k.tough}`,
    ...counterTags(u), u.buffPower ? `+${u.buffPower} Power this round` : '',
    u.toy && `with ${cardName(u.toy.id)}`, u.exhausted ? 'exhausted' : 'ready',
  ].filter(Boolean);
  const hp = unitHealth(u, s) - u.damage;
  const text = CARDS[u.id].text ? ` — ${CARDS[u.id].text}` : '';
  return `  ${label} ${cardName(u.id)} ${unitPower(u, s)}/${hp}${u.damage ? ` (of ${unitHealth(u, s)})` : ''} [${tags.join(', ')}]${text}`;
}

function cardLine(id: string, label: string): string {
  const c = CARDS[id];
  const stats = c.power !== undefined ? ` ${c.power}/${c.health}` : '';
  return `  ${label} ${cardName(id)} (cost ${c.cost ?? 0}, ${c.type}${stats})${c.text ? ` — ${c.text}` : ''}`;
}

function heroLine(s: GameState, p: PlayerId): string {
  const hero = s.players[p].hero;
  const side = heroSide(s, p);
  const state = [hero.grown ? `Big Cat, Power ${side.power ?? 0}` : 'Kitten', hero.exhausted ? 'exhausted' : 'ready'].join(', ');
  return `${cardName(hero.id)} (${state}): ${side.text.replace(/\n/g, ' | ')}`;
}

// The engine logs in the third person ("Ana plants a Treat"); a reader is told "You plant a Treat".
const YOU_VERBS: Record<string, string> = {
  keeps: 'keep', plants: 'plant', plays: 'play', takes: 'take', passes: 'pass', mulligans: 'mulligan', discards: 'discard',
  POUNCES: 'POUNCE', loses: 'lose', starts: 'start', wins: 'win', has: 'have', uses: 'use', attacks: 'attack', draws: 'draw',
};
function secondPerson(text: string, me: string, foe: string): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`\\b${esc(me)}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${esc(me)} (now )?(\\w+)`, 'g'), (_m, now: string | undefined, verb: string) => `you ${now ?? ''}${YOU_VERBS[verb] ?? verb}`)
    .replace(new RegExp(`\\b${esc(foe)}\\b`, 'g'), 'Opponent')
    .replace(/(^|[.!] |— )(you|your)\b/g, (_m, lead: string, w: string) => lead + w[0].toUpperCase() + w.slice(1));
}

/** What `seat` sees: both sides of the table, their own hand, and what is happening right now. */
export function describe(s: GameState, seat: PlayerId, recent = 8): string {
  const v: PlayerView = viewFor(s, seat);
  const me = v.players[seat], foe = v.players[other(seat)];
  const lines: string[] = [];
  lines.push(`ROUND ${v.round}. ${v.yarn === seat ? 'You hold' : 'Your opponent holds'} the Yarn Ball${v.yarnTaken !== null ? ` (${v.yarnTaken === seat ? 'you' : 'they'} took it for next round)` : ''}.`);
  const side = (p: PlayerId, who: string) => {
    const pl = v.players[p];
    lines.push('', `${who} — ${pl.deckName}`);
    lines.push(`  Hero: ${heroLine(v, p)}`);
    lines.push(`  Lives ${pl.lives.length} · Treats ${pl.pantry.length} (${readyTreats(v, p)} ready) · Hand ${pl.hand.length} · Deck ${pl.deck.length} · Compost ${pl.compost.length}${(pl.playedThisRound ?? 0) ? ` · played ${pl.playedThisRound} card(s) this round` : ''}`);
    if (pl.yard.length) { lines.push('  Yard:'); pl.yard.forEach((u, i) => lines.push(unitLine(u, `${p === seat ? 'Y' : 'T'}${i + 1}`, v))); }
    else lines.push('  Yard: empty');
  };
  side(other(seat), 'OPPONENT');
  side(seat, 'YOU');
  lines.push('  Hand:');
  me.hand.forEach((c, i) => lines.push(cardLine(c.id, `H${i + 1}`)));
  if (v.window && v.window.by !== seat && s.prompt?.player === seat) {
    const w = v.window;
    lines.push('', w.kind === 'play'
      ? `YOUR OPPONENT IS PLAYING ${cardName(w.card.id)}${w.target ? ` on ${targetName(v, seat, w.target)}` : ''} — ${CARDS[w.card.id].text ?? ''}`
      : `YOUR OPPONENT IS ATTACKING ${targetName(v, seat, w.target)} with ${w.attacker.kind === 'hero' ? 'their Big Cat' : targetName(v, seat, w.attacker)}.`);
  }
  const log = v.log.slice(-recent).map((e) => `  ${secondPerson(e.text, me.name, foe.name)}`);
  if (log.length) lines.push('', 'RECENTLY:', ...log);
  return lines.join('\n');
}

const stats = (u: Unit) => `${unitPower(u)}/${unitHealth(u) - u.damage}`;

/** What an attack would do if nothing interferes (no Pounce): damage each way, and who is defeated. */
function attackPreview(s: GameState, seat: PlayerId, a: Extract<Action, { t: 'attack' }>): string {
  const fierce = a.attacker.kind === 'hero' ? !!heroSide(s, seat).keywords?.includes('Fierce') : !!findUnit(s, a.attacker.uid) && unitKeywords(findUnit(s, a.attacker.uid)!.unit, s).fierce;
  const power = a.attacker.kind === 'hero' ? heroSide(s, seat).power ?? 0 : unitPower(findUnit(s, a.attacker.uid)!.unit, s);
  if (a.target.kind === 'hero') return `they lose ${fierce ? 2 : 1} Life${fierce ? 's (Fierce)' : ''}; your attacker takes no damage`;
  const target = findUnit(s, a.target.uid)!.unit;
  const dealt = Math.max(0, power - unitKeywords(target, s).tough);
  const left = unitHealth(target, s) - target.damage - dealt;
  const theirs = left <= 0 ? `their ${cardName(target.id)} is defeated` : `their ${cardName(target.id)} survives with ${left} Health`;
  if (a.attacker.kind === 'hero') return `${theirs}; your Big Cat takes no damage`;
  const mine = findUnit(s, a.attacker.uid)!.unit;
  const back = Math.max(0, unitPower(target, s) - unitKeywords(mine, s).tough);
  const myLeft = unitHealth(mine, s) - mine.damage - back;
  return `${theirs}; your ${cardName(mine.id)} ${myLeft <= 0 ? 'is defeated' : `survives with ${myLeft} Health`}`;
}

function detailed(s: GameState, seat: PlayerId, a: Action, base: string): string {
  const me = s.players[seat];
  const card = (uid: number) => me.hand.find((c) => c.uid === uid);
  const ready = readyTreats(s, seat);
  switch (a.t) {
    case 'play': case 'pounce': {
      const c = CARDS[card(a.uid)!.id];
      const unit = c.type === 'Critter' || c.type === 'Cat';
      const arrives = unit ? (keywords(c.id).zoomies ? 'arrives ready (Zoomies): can attack this round' : 'arrives exhausted: can attack next round') : '';
      const target = a.target?.kind === 'unit' && findUnit(s, a.target.uid) ? ` (${stats(findUnit(s, a.target.uid)!.unit)})` : '';
      return `${base}${target} — ${[unit ? `${c.power}/${c.health}` : c.type, c.text?.replace(/\.$/, ''), arrives].filter(Boolean).join('. ')}. Leaves ${ready - (c.cost ?? 0)} ready Treat(s).`;
    }
    case 'attack': return `${base} — ${attackPreview(s, seat, a)}`;
    case 'takeYarn': {
      const other = legalActions(s).filter((x) => x.t === 'play' || x.t === 'attack' || x.t === 'ability').length;
      return other ? `${base}. WARNING: you still have ${ready} ready Treat(s) and ${other} other possible move(s) this round` : base;
    }
    case 'pass': return ready ? `${base} (${ready} ready Treat(s) unspent; you may act again if your opponent acts)` : `${base} (you may act again if your opponent acts)`;
    case 'plant': { const c = CARDS[card(a.uid)!.id]; return `${base} (it costs ${c.cost ?? 0}; once planted it's a Treat for good)`; }
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
  switch (a.t) {
    case 'play': { const c = card(a.uid)!; return `Play ${cardName(c.id)} (cost ${CARDS[c.id].cost ?? 0})${on(a.target)}${a.target2 ? ` and ${targetName(s, seat, a.target2)}` : ''}`; }
    case 'pounce': { const c = card(a.uid)!; return `POUNCE with ${cardName(c.id)} (cost ${CARDS[c.id].cost ?? 0})${on(a.target)}${a.target2 ? ` and ${targetName(s, seat, a.target2)}` : ''}`; }
    case 'attack': return `Attack with ${a.attacker.kind === 'hero' ? 'your Big Cat' : targetName(s, seat, a.attacker)}${on(a.target)}`;
    case 'ability': {
      const ability = me.hero.grown ? behaviour(me.hero.id).bigCat : behaviour(me.hero.id).kitten;
      const text = heroSide(s, seat).text.split('\n').find((l) => /Exhaust/.test(l)) ?? ability?.effect ?? '';
      return `Use your Hero Cat's ability (${text.trim()})${on(a.target)}`;
    }
    case 'takeYarn': return 'Take the Yarn Ball (act first next round; you may only pass for the rest of this round)';
    case 'pass': return 'Pass';
    case 'plant': { const c = card(a.uid)!; return `Plant ${cardName(c.id)} as a Treat`; }
    case 'skipPlant': return "Don't plant this round";
    case 'decline': return 'Let it happen (no Pounce)';
    case 'lucky': { const c = s.prompt?.kind === 'lucky' ? card(s.prompt.uid) : undefined; return `Play ${c ? cardName(c.id) : 'it'} for free (Lucky)${on(a.target)}`; }
    case 'keepLucky': return 'Keep it in your hand instead';
    case 'choose': return `Target ${targetName(s, seat, a.target)}`;
    default: return a.t;
  }
}

export function listChoices(s: GameState, o: ChoiceOptions = {}): Choices {
  const prompt = s.prompt;
  if (!prompt) return { question: 'The game is over.', options: [] };
  const seat = prompt.player;
  switch (prompt.kind) {
    case 'mulligan':
      return { question: 'Mulligan: list the hand cards (H numbers) to swap for new ones, or "none" to keep all six.', options: [], multi: { kind: 'mulligan' } };
    case 'setupPlant':
      return { question: `Plant ${prompt.count} cards from your hand as your first Treats: list exactly ${prompt.count} H numbers. Plant the cards you want least.`, options: [], multi: { kind: 'setupPlant', count: prompt.count } };
    case 'discard':
      return { question: `Your hand is over ${HAND_LIMIT}: discard exactly ${prompt.count} (list H numbers).`, options: [], multi: { kind: 'discard', count: prompt.count } };
    default: break;
  }
  const question = {
    plant: 'Start of round: plant one card from your hand as a Treat, or not.',
    action: 'Your action.',
    pounce: 'Your opponent just acted: Pounce, or let it happen?',
    lucky: 'The Life you just lost is Lucky: play it for free?',
    choose: `Choose a target for ${cardName(prompt.kind === 'choose' ? prompt.sourceId : '')}.`,
  }[prompt.kind];
  const options = legalActions(s).map((action, i) => ({ n: i + 1, label: label(s, seat, action, o), action }));
  return { question, options };
}

/** The choices as the text a player reads under the table. */
export function choicesText(s: GameState, o: ChoiceOptions = {}): string {
  const c = listChoices(s, o);
  if (c.multi) return c.question;
  return [c.question, ...c.options.map((o) => `  ${o.n}. ${o.label}`), 'Answer with the number of your choice.'].join('\n');
}

/**
 * The action a reply names, or an error message to send back. The first number in a reply is taken as the
 * choice, so "7 — attack while they're open" works; a pick-several reply is every number, or "none".
 */
export function parseChoice(s: GameState, reply: string): { action: Action } | { error: string } {
  const c = listChoices(s);
  const prompt = s.prompt;
  if (!prompt) return { error: 'The game is over.' };
  // Prefer an explicit "answer: …" or "choice: …" line when a reply reasons out loud first.
  const tagged = /(?:answer|choice|final)\s*[:=]\s*([^\n]*)/i.exec(reply)?.[1];
  const text = tagged ?? reply;
  if (c.multi) {
    const hand = s.players[prompt.player].hand;
    const nums = /\bnone\b/i.test(text) && !/\d/.test(text) ? [] : [...text.matchAll(/H?(\d+)/gi)].map((m) => Number(m[1]));
    if (nums.some((n) => n < 1 || n > hand.length)) return { error: `Hand numbers go from 1 to ${hand.length}.` };
    if (new Set(nums).size !== nums.length) return { error: 'List each card once.' };
    if (c.multi.count !== undefined && nums.length !== c.multi.count) return { error: `Choose exactly ${c.multi.count} card(s); you chose ${nums.length}.` };
    return { action: { t: c.multi.kind, uids: nums.map((n) => hand[n - 1].uid) } as Action };
  }
  const m = /\d+/.exec(text);
  if (!m) return { error: `Answer with a number from 1 to ${c.options.length}.` };
  const choice = c.options.find((o) => o.n === Number(m[0]));
  return choice ? { action: choice.action } : { error: `There is no choice ${m[0]}; answer with a number from 1 to ${c.options.length}.` };
}
