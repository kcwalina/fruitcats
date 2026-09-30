// The game as text, for players that read: LLM playtesters and the command-line game.
//
// `describe` shows one player exactly what they may know. It is built on `viewFor`, the same hidden-
// information view an online server would send, so a text player can't see the opponent's hand, the Lives
// or the deck order. `listChoices` numbers the decisions in front of that player, and `parseChoice` turns a
// reply ("3", "I'll take 3 because…", "1 4" for a multi-card choice) back into an engine action.
//
// Units are named by where they stand: Y1…Y6 in your Yard, T1…T6 in theirs; cards in hand are H1…Hn.

import { behaviour, CARDS, keywords, MECHANICS } from './cards';
import { HAND_LIMIT, MULLIGAN_MAX, apply, cardName, findUnit, heroSide, isGuardian, isSneaky, legalActions, other, readyTreats, unitHealth, unitKeywords, unitPower } from './engine';
import type { Action, GameState, PlayerId, Target, Unit } from './types';
import { viewFor, type PlayerView } from './view';
import TERMS from './terms.json';

/** The core rules, before the keyword list: the same whatever sets are loaded. */
const CORE_RULES = `FOLKBORN: RULES IN BRIEF
Two players, 50-card decks, each led by a Hero. Win by blowing out the opponent's ninth and last Candle.
- Candles: each player starts with 9 face-down Candle cards. When you lose a Candle, that card goes into your hand. If it is Lucky you may play it for free right away (whenever the Candle is lost, even in your opponent's turn). Playing it is not an action: it doesn't use your turn, works after you took the Lantern, and can't be Ambushed. If you keep it, it stays in your hand as a normal card that costs its full price later. Playing or keeping it never changes how many Candles you have. Heroes have no Health: a hit on a Hero blows out Candles.
- Offerings pay for cards. Each Offering is a card you offered face-down; a card costing N exhausts N ready Offerings. Offerings ready again each round. Offer at most one card per round (at the start of the round); an Offering is permanent, so offer what you need least.
- Round: Start (all your Offerings, units and Hero ready again, draw 2, may offer 1; skipped in round 1), then Actions, then End (if you hold more than ${HAND_LIMIT} cards, discard down to ${HAND_LIMIT}; "this round" effects end).
- Actions: starting with the Lantern holder, players alternate ONE action at a time until both pass in a row. An action is: play a card, attack, use your Hero's ability, take the Lantern, or pass. Passing is not final: if the opponent acts again, you may act again.
- Holding the Lantern only means you act first this round; it never limits what you may do. Only TAKING it does.
- Take the Lantern: you act first next round, but for the rest of this round you may only pass. You may still Ambush in your opponent's windows and play a Lucky Candle you lose, and your opponent keeps acting until they pass. Only one player may take it in a round, but you may take it every round (and while you already hold it, to keep it); if nobody takes it, the Lantern goes to the other player at the end of the round.
- Units (Creatures and Fabled cards) enter the Yard exhausted, so they can't attack the round they arrive (unless Swift). A Yard holds at most 6 units. Talismans attach to a unit you control. Charms do their effect and go to the Mist.
- Attack: exhaust a ready unit (or your Awakened Hero) and pick a target: an enemy unit, or the enemy Hero. If the enemy has a Guardian you must attack a Guardian, unless your attacker is Sneaky.
  Unit vs unit: both deal their Power to each other at once; damage stays between rounds; a unit with damage >= Health is defeated.
  Unit vs Hero: a hit. The defender loses 1 Candle (2 if the attacker is Fierce) and the attacker takes no damage.
- Ambush: when your opponent plays a card or declares an attack, you may answer with ONE Ambush card, paying its cost from your own ready Offerings. Every card they play and every attack is a new window, so you may Ambush several times in a round. It resolves first, before their card or attack. No Ambush on an Ambush. An Ambush isn't an action: it doesn't use your turn. If an Ambush cancels an attack, nobody deals damage and the attacker stays exhausted. Ready Offerings you keep are a threat the opponent must respect.
- Hero: starts on its first side, which cannot attack. Its "Exhaust:" ability can be used once a round (exhausting the Hero). When its Awaken condition becomes true it flips to its Awakened side for good: stronger ability, and it can attack (it takes no damage attacking). It stays ready or exhausted as it was: if still ready, it may use its new ability or attack this round (either one exhausts it).
- If you must draw from an empty deck, you lose a Candle instead.`;

/** Keywords of the core rules; the mechanics each set brings (Company, Rain-Fed, Heat, …) are listed after them. */
const CORE_KEYWORDS = `Swift: enters ready. Guardian: enemies must attack Guardians first. Sneaky: ignores Guardians. Fierce: a hit on a Hero blows out 2 Candles. Tough X: takes X less from each time it is dealt damage. Lucky: playable for free when it turns up as a lost Candle. Ambush: playable in the opponent's Ambush window (also as a normal action). Hello: happens when the unit arrives. Goodbye: happens when it is defeated.`;

/**
 * The rules a text player needs, in about a thousand tokens: the core rules, then every mechanic the loaded
 * sets define, with the reminder text each set gives it. So an LLM player learns a new set's mechanic (Heat)
 * the moment the set is loaded. The same text for every request of a run, so providers can cache it.
 */
export function rulesPrimer(): string {
  const mechanics = Object.entries(MECHANICS)
    .sort(([, a], [, b]) => (a.family ?? '').localeCompare(b.family ?? ''))
    .map(([name, m]) => `${name}${m.family ? ` (${m.family})` : ''}: ${m.reminder}`)
    .join(' ');
  return `${CORE_RULES}\nKEYWORDS\n${CORE_KEYWORDS}${mechanics ? `\nFAMILY MECHANICS\n${mechanics}` : ''}`;
}

/**
 * Basic strategy, for text players that don't find it on their own: an LLM that knew only the rules gave its
 * turns away (taking the Yarn as its first action), planted its best cheap cards and expected units to attack
 * the round they arrived. It lost 47 of 50 games against the bot in seats where the bot wins half.
 */
export const STRATEGY_PRIMER = `BASIC STRATEGY
- Spend your Offerings every round. An Offering you don't use this round is wasted, unless you keep it ready on purpose for an Ambush.
- Offer the card you're least likely to want soon: something too expensive to afford for a while, or a spare copy. Don't offer a cheap unit you could play next round.
- Units arrive exhausted (Swift excepted), so play them early: a unit played now can attack next round.
- Take the Lantern only as your LAST action of a round, when there is nothing useful left to do. Taking it means you may only pass for the rest of the round.
- Before attacking, read the predicted result next to each attack: trade when you come out ahead (their unit dies, or yours survives), and hit the Hero when there's no good trade. Each hit blows out one of their Candles, but the Candle card goes to their hand.
- Guardians must be attacked first unless your attacker is Sneaky. A Guardian with high Health can absorb a whole turn: remove it with damage Charms, or go around it with Sneaky units.
- Pass only when you have nothing worth doing. If your opponent then acts, you get to act again.
- Attack every round. A ready unit that doesn't attack wastes its turn: if no trade is good, hit the Hero.
- Respect their ready Offerings: every deck has cheap Ambushes, most often one that gives a unit +2 Power this round. Before attacking a unit while they have an Offering ready, check the trade still works if it is 2 stronger. A hit on their Hero is safe from that Ambush.
- A +2 Power Ambush only helps a unit in the fight: your unit being attacked, or your attacker. On any other unit it does nothing, and it can't save your Hero.
- Keep your own Ambush cards: don't offer them. While you hold one, keep one ready Offering for it (most cost 1) and spend the rest. Offerings don't carry over: ready ones left at the end of a round are wasted.
- Damage is for enemy units and healing for your damaged ones: never aim damage at your own units, or heal a unit with no damage.`;

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
  if (t.kind === 'hero') return t.player === seat ? 'your Hero' : 'the enemy Hero';
  return unitName(s, seat, t.uid);
}

/** A counter as a player knows it: by its mechanic's name (Rain-Fed +1, Heat +2). */
function counterTags(u: Unit): string[] {
  return Object.entries(u.counters ?? {}).filter(([, n]) => n).map(([name, n]) =>
    `${Object.entries(MECHANICS).find(([, m]) => m.counter?.name === name)?.[0] ?? name} +${n}`);
}

function unitLine(u: Unit, label: string, s?: GameState): string {
  const k = unitKeywords(u, s);
  const tags = [
    isGuardian(u, s) && 'Guardian', isSneaky(u, s) && 'Sneaky', k.fierce && 'Fierce', k.zoomies && 'Swift', k.tough && `Tough ${k.tough}`,
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
  return `  ${label} ${cardName(id)} (cost ${c.cost ?? 0}, ${TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type}${stats})${c.text ? ` — ${c.text}` : ''}`;
}

function heroLine(s: GameState, p: PlayerId): string {
  const hero = s.players[p].hero;
  const side = heroSide(s, p);
  const state = [hero.grown ? `${TERMS.sides.bigCat}, Power ${side.power ?? 0}` : 'not yet Awakened', hero.exhausted ? 'exhausted' : 'ready'].join(', ');
  return `${cardName(hero.id)} (${state}): ${side.text.replace(/\n/g, ' | ')}`;
}

// The engine logs in the third person ("Ana makes an Offering"); a reader is told "You make an Offering".
const YOU_VERBS: Record<string, string> = {
  keeps: 'keep', makes: 'make', plays: 'play', takes: 'take', passes: 'pass', mulligans: 'mulligan', discards: 'discard',
  AMBUSHES: 'AMBUSH', loses: 'lose', starts: 'start', wins: 'win', has: 'have', uses: 'use', attacks: 'attack', draws: 'draw',
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
  lines.push(`ROUND ${v.round}. ${v.yarn === seat ? 'You hold' : 'Your opponent holds'} the Lantern${v.yarnTaken !== null ? ` (${v.yarnTaken === seat ? 'you' : 'they'} took it for next round)` : ''}.`);
  const side = (p: PlayerId, who: string) => {
    const pl = v.players[p];
    lines.push('', `${who} — ${pl.deckName}`);
    lines.push(`  Hero: ${heroLine(v, p)}`);
    lines.push(`  Candles ${pl.lives.length} · Offerings ${pl.pantry.length} (${readyTreats(v, p)} ready) · Hand ${pl.hand.length} · Deck ${pl.deck.length} · Mist ${pl.compost.length}${(pl.playedThisRound ?? 0) ? ` · played ${pl.playedThisRound} card(s) this round` : ''}`);
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
      : `YOUR OPPONENT IS ATTACKING ${targetName(v, seat, w.target)} with ${w.attacker.kind === 'hero' ? 'their Awakened Hero' : targetName(v, seat, w.attacker)}.`);
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
  if (a.target.kind === 'hero') return `they lose ${fierce ? `2 ${TERMS.candles} (Fierce)` : `1 ${TERMS.candle}`}; your attacker takes no damage`;
  const target = findUnit(s, a.target.uid)!.unit;
  const dealt = Math.max(0, power - unitKeywords(target, s).tough);
  const left = unitHealth(target, s) - target.damage - dealt;
  const theirs = left <= 0 ? `their ${cardName(target.id)} is defeated` : `their ${cardName(target.id)} survives with ${left} Health`;
  if (a.attacker.kind === 'hero') return `${theirs}; your Hero takes no damage`;
  const mine = findUnit(s, a.attacker.uid)!.unit;
  const back = Math.max(0, unitPower(target, s) - unitKeywords(mine, s).tough);
  const myLeft = unitHealth(mine, s) - mine.damage - back;
  return `${theirs}; your ${cardName(mine.id)} ${myLeft <= 0 ? 'is defeated' : `survives with ${myLeft} Health`}`;
}

/** Whether a unit played by this action is ready once it's in the Yard: its own Hello may ready it (Pari at the Pool's
 * "Company: enters ready"), which only playing it on a copy of the game shows. The opponent lets it happen. */
function arrivesReady(s: GameState, seat: PlayerId, a: Extract<Action, { t: 'play' | 'pounce' }>): boolean {
  try {
    const w = structuredClone(s);
    apply(w, a);
    for (let i = 0; i < 5 && w.prompt?.kind === 'pounce' && w.prompt.player !== seat; i++) apply(w, { t: 'decline' });
    return w.players[seat].yard.some((u) => u.uid === a.uid && !u.exhausted);
  } catch { return false; }
}

function detailed(s: GameState, seat: PlayerId, a: Action, base: string): string {
  const me = s.players[seat];
  const card = (uid: number) => me.hand.find((c) => c.uid === uid);
  const ready = readyTreats(s, seat);
  switch (a.t) {
    case 'play': case 'pounce': {
      const c = CARDS[card(a.uid)!.id];
      const unit = c.type === 'Critter' || c.type === 'Cat';
      const arrives = !unit ? '' : keywords(c.id).zoomies ? 'arrives ready (Swift): can attack this round'
        : arrivesReady(s, seat, a) ? 'arrives ready: can attack this round' : 'arrives exhausted: can attack next round';
      const target = a.target?.kind === 'unit' && findUnit(s, a.target.uid) ? ` (${stats(findUnit(s, a.target.uid)!.unit)})` : '';
      return `${base}${target} — ${[unit ? `${c.power}/${c.health}` : TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type, c.text?.replace(/\.$/, ''), arrives].filter(Boolean).join('. ')}. Leaves ${ready - (c.cost ?? 0)} ready Offering(s).`;
    }
    case 'attack': return `${base} — ${attackPreview(s, seat, a)}`;
    case 'takeYarn': {
      const other = legalActions(s).filter((x) => x.t === 'play' || x.t === 'attack' || x.t === 'ability').length;
      return other ? `${base}. WARNING: you still have ${ready} ready Offering(s) and ${other} other possible move(s) this round` : base;
    }
    case 'pass': return ready ? `${base} (${ready} ready Offering(s) unspent; you may act again if your opponent acts)` : `${base} (you may act again if your opponent acts)`;
    case 'plant': { const c = CARDS[card(a.uid)!.id]; return `${base} (it costs ${c.cost ?? 0}; once offered it's an Offering for good)`; }
    case 'lucky': {
      const c = s.prompt?.kind === 'lucky' ? CARDS[card(s.prompt.uid)!.id] : undefined;
      return c ? `${base} — ${[TERMS.types[c.type as keyof typeof TERMS.types] ?? c.type, c.text?.replace(/\.$/, '')].filter(Boolean).join('. ')}.` : base;
    }
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
    case 'pounce': { const c = card(a.uid)!; return `AMBUSH with ${cardName(c.id)} (cost ${CARDS[c.id].cost ?? 0})${on(a.target)}${a.target2 ? ` and ${targetName(s, seat, a.target2)}` : ''}`; }
    case 'attack': return `Attack with ${a.attacker.kind === 'hero' ? 'your Awakened Hero' : targetName(s, seat, a.attacker)}${on(a.target)}`;
    case 'ability': {
      const ability = me.hero.grown ? behaviour(me.hero.id).bigCat : behaviour(me.hero.id).kitten;
      const text = heroSide(s, seat).text.split('\n').find((l) => /Exhaust/.test(l)) ?? ability?.effect ?? '';
      return `Use your Hero's ability (${text.trim()})${on(a.target)}`;
    }
    case 'takeYarn': return 'Take the Lantern (act first next round; for the rest of this round you may only pass, Ambush, or play a Lucky Candle)';
    case 'pass': return 'Pass';
    case 'plant': { const c = card(a.uid)!; return `Offer ${cardName(c.id)} as an Offering`; }
    case 'skipPlant': return "Don't offer a card this round";
    case 'decline': return 'Let it happen (no Ambush)';
    case 'lucky': { const c = s.prompt?.kind === 'lucky' ? card(s.prompt.uid) : undefined; return `Play ${c ? cardName(c.id) : 'it'} for free (Lucky)${on(a.target)}`; }
    case 'keepLucky': { const c = s.prompt?.kind === 'lucky' ? card(s.prompt.uid) : undefined; return `Keep it in your hand (later it costs ${c ? CARDS[c.id].cost ?? 0 : 'its price'}, like any card)`; }
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
      return { question: `Mulligan: list up to ${MULLIGAN_MAX} hand cards (H numbers) to swap for new ones, or "none" to keep all six.`, options: [], multi: { kind: 'mulligan' } };
    case 'setupPlant':
      return { question: `Offer ${prompt.count} cards from your hand as your first Offerings: list exactly ${prompt.count} H numbers. Offer the cards you want least.`, options: [], multi: { kind: 'setupPlant', count: prompt.count } };
    case 'discard':
      return { question: `Your hand is over ${HAND_LIMIT}: discard exactly ${prompt.count} (list H numbers).`, options: [], multi: { kind: 'discard', count: prompt.count } };
    default: break;
  }
  const question = {
    plant: 'Start of round: offer one card from your hand as an Offering, or not.',
    action: 'Your action.',
    pounce: 'Your opponent just acted: Ambush, or let it happen?',
    lucky: luckyQuestion(s, seat),
    choose: `Choose a target for ${cardName(prompt.kind === 'choose' ? prompt.sourceId : '')}.`,
  }[prompt.kind];
  const options = legalActions(s).map((action, i) => ({ n: i + 1, label: label(s, seat, action, o), action }));
  return { question, options };
}

// A Fierce hit asks about the first Lucky Candle before the second goes out, which read as "playing it costs my last Candle".
function luckyQuestion(s: GameState, seat: PlayerId): string {
  const left = s.players[seat].lives.length;
  const next = s.queue[0];
  const more = next?.t === 'loseLife' && next.p === seat ? next.n : 0;
  const candles = (n: number) => `${n} ${n === 1 ? TERMS.candle : TERMS.candles}`;
  return `The ${TERMS.candle} you just lost is Lucky: play it for free? You have ${candles(left)} left${more ? `, and ${more} more will go out right after this` : ''}; playing or keeping it doesn't change that.`;
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
    if (c.multi.kind === 'mulligan' && nums.length > MULLIGAN_MAX) return { error: `Swap at most ${MULLIGAN_MAX} cards; you chose ${nums.length}.` };
    return { action: { t: c.multi.kind, uids: nums.map((n) => hand[n - 1].uid) } as Action };
  }
  const m = /\d+/.exec(text);
  if (!m) return { error: `Answer with a number from 1 to ${c.options.length}.` };
  const choice = c.options.find((o) => o.n === Number(m[0]));
  return choice ? { action: choice.action } : { error: `There is no choice ${m[0]}; answer with a number from 1 to ${c.options.length}.` };
}
