// A heuristic AI opponent: one-step lookahead over every legal action, scored by a board evaluation.
//
// It never sees hidden information. Before searching it "determinizes" the game: the opponent's
// hand is replaced by blank cards, and every player's deck and Lives are reshuffled together, so the
// lookahead can't peek at draws, Lucky cards or the opponent's Pounces.

import { BLANK_CARD, CARDS, PLUGINS, behaviour, isUnitCard, keywords, usesCondition } from './cards';
import { apply, isGuardian, legalActions, other, playOptions, unitHealth, unitKeywords, unitPower } from './engine';
import type { Action, CardInst, GameState, PlayerId } from './types';

export interface AiOptions {
  /** 0 = plays randomly, 1 = full strength. Values in between mix in random moves. */
  skill?: number;
  random?: () => number;
}

const BLANK = BLANK_CARD; // a vanilla card: no Pounce, no Lucky
// `exhausted` discounts a unit's power while it can't attack or block this round — it is what makes
// "exhaust an enemy unit" effects worth anything to the AI.
// `readyTreat` values Treats still unspent this round — what makes "ready a Treat" effects (Tango) worth
// using. It is kept below the value of any card those Treats could buy, so the AI still spends them.
const W = { life: 12, hand: 1.2, treat: 1.0, power: 1.6, health: 1.1, guardian: 1, fierce: 1.5, sneaky: 1, grown: 6, exhausted: 0.35, readyTreat: 0.4 };

export function evaluate(s: GameState, p: PlayerId): number {
  if (s.winner === p) return 1e6;
  if (s.winner === other(p)) return -1e6;
  let score = 0;
  for (const q of [p, other(p)] as PlayerId[]) {
    const pl = s.players[q];
    const sign = q === p ? 1 : -1;
    let v = pl.lives.length * W.life + pl.hand.length * W.hand + Math.min(pl.pantry.length, 8) * W.treat;
    if (s.prompt?.kind === 'action' || s.prompt?.kind === 'pounce') v += pl.pantry.filter((t) => !t.exhausted).length * W.readyTreat;
    for (const u of pl.yard) {
      // What lasts: printed keywords, Toys and auras (a buff for this round is valued through Power only).
      const k = unitKeywords(u, s, false);
      // "This round" Power buffs are worth little once the unit can't attack any more this round.
      const tempPower = u.buffPower * (u.exhausted ? 0.9 : 0.4);
      v += (unitPower(u, s) - tempPower) * W.power + (unitHealth(u, s) - u.damage) * W.health;
      if (u.exhausted && s.prompt?.kind !== 'plant') v -= unitPower(u, s) * W.exhausted;
      if (isGuardian(u, s)) v += W.guardian;
      if (k.fierce) v += W.fierce;
      if (k.sneaky) v += W.sneaky;
    }
    if (pl.hero.grown) v += W.grown;
    score += sign * v;
  }
  return score;
}

/** How much a card is worth keeping in hand; the lowest-value cards get planted or discarded. */
function keepValue(card: CardInst, treats: number): number {
  const def = CARDS[card.id];
  const cost = def.cost ?? 0;
  let v = isUnitCard(card.id) ? (def.power ?? 0) + (def.health ?? 0) : def.type === 'Toy' ? 3 : 4;
  if (keywords(card.id).pounce) v += 1;
  if (def.type === 'Cat') v += 3;
  if (cost > treats + 2) v -= 3; // too expensive to use soon
  return v;
}

/**
 * How many Treats to plant up to: enough for the priciest card left in hand or deck, one spare when that
 * card costs 6 or more (so a big turn can still leave a Pounce up), and whatever the Hero Cat's Grow Up
 * counts in Treats. Measured against the old fixed rule (plant to 5, or 8 for Tango) in bot duels: the
 * spare Treat is worth +8 points to Orchard Guard and nothing to the others.
 */
function treatTarget(s: GameState, p: PlayerId): number {
  const me = s.players[p];
  const treats = me.pantry.length;
  const maxCost = Math.max(...[...me.hand, ...me.deck].map((c) => CARDS[c.id].cost ?? 0), 0);
  let target = Math.max(5, maxCost) + (maxCost >= 6 ? 1 : 0);
  // A Grow Up that a few more Treats would satisfy (Tango's "8 or more Treats"), found by asking the
  // hero's own condition rather than naming the hero.
  const grow = behaviour(me.hero.id).growUp;
  if (grow && !me.hero.grown && !grow(s, p)) {
    for (let k = 1; k <= 4; k++) {
      const pantry = [...me.pantry, ...Array.from({ length: k }, () => me.pantry[0])];
      const probe = { ...s, players: s.players.map((pl, i) => (i === p ? { ...pl, pantry } : pl)) } as GameState;
      if (grow(probe, p)) { target = Math.max(target, treats + k); break; }
    }
  }
  return target;
}

function byKeepValue(hand: CardInst[], treats: number): CardInst[] {
  return [...hand].sort((a, b) => keepValue(a, treats) - keepValue(b, treats));
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function determinize(s: GameState, p: PlayerId, rnd: () => number): GameState {
  // The story so far doesn't change the evaluation; leaving it out keeps every clone in the search cheap.
  const c = structuredClone({ ...s, log: [], events: [] });
  const foe = c.players[other(p)];
  foe.hand = foe.hand.map((h) => ({ uid: h.uid, id: BLANK }));
  for (const pl of c.players) {
    const pool = shuffled([...pl.deck, ...pl.lives], rnd);
    pl.lives = pool.slice(0, pl.lives.length);
    pl.deck = pool.slice(pl.lives.length);
  }
  return c;
}

/** Play out the AI's own follow-up choices (Lucky, Goodbye targets) greedily inside a simulation. */
function settle(s: GameState, p: PlayerId): void {
  for (let i = 0; i < 6 && s.prompt?.player === p && (s.prompt.kind === 'lucky' || s.prompt.kind === 'choose'); i++) {
    const options = legalActions(s);
    if (!options.length) return;
    apply(s, options[0]);
  }
}

function simulate(base: GameState, p: PlayerId, action: Action): number {
  const s = structuredClone(base);
  try {
    apply(s, action);
    settle(s, p);
  } catch {
    return -Infinity;
  }
  return evaluate(s, p);
}

function best(s: GameState, p: PlayerId, actions: Action[], rnd: () => number): { action: Action; score: number } {
  const world = determinize(s, p, rnd);
  let top = { action: actions[0], score: -Infinity };
  for (const action of actions) {
    const score = simulate(world, p, action) + rnd() * 0.01;
    if (score > top.score) top = { action, score };
  }
  return top;
}

/**
 * Let the sets' plugins improve on the bot's favourite move: a hook sees the decision and the bot's own
 * judge, and knows what its set's cards need (the Starter Box plays a cheap card before a Zest card).
 */
function refine(s: GameState, p: PlayerId, chosen: Action, candidates: Action[], passScore: number, rnd: () => number): Action | null {
  for (const plugin of PLUGINS) {
    const hook = plugin.ai?.refineAction;
    if (!hook) continue;
    const better = hook({
      s, p, chosen, candidates, passScore,
      best: (actions) => best(s, p, actions, rnd),
      usesCondition,
      cardCost: (id) => CARDS[id]?.cost ?? 0,
    });
    if (better) return better;
  }
  return null;
}

/**
 * The bot's one-step score for every legal action of a one-of decision (higher is better), from one
 * determinized world so the scores compare. Used to judge other players' choices, such as an LLM's.
 */
export function scoreActions(s: GameState, rnd: () => number = Math.random): { action: Action; score: number }[] {
  const p = s.prompt!.player;
  const world = determinize(s, p, rnd);
  return legalActions(s).map((action) => ({ action, score: simulate(world, p, action) }));
}

export function chooseAction(s: GameState, options: AiOptions = {}): Action {
  const prompt = s.prompt;
  if (!prompt) throw new Error('no decision pending');
  const p = prompt.player;
  const me = s.players[p];
  const rnd = options.random ?? Math.random;
  const skill = options.skill ?? 1;

  switch (prompt.kind) {
    case 'mulligan': {
      const cheap = me.hand.some((c) => (CARDS[c.id].cost ?? 0) <= 2);
      const aside = me.hand.filter((c) => (CARDS[c.id].cost ?? 0) >= (cheap ? 5 : 4));
      return { t: 'mulligan', uids: aside.map((c) => c.uid) };
    }
    case 'setupPlant':
      return { t: 'setupPlant', uids: byKeepValue(me.hand, 0).slice(0, prompt.count).map((c) => c.uid) };
    case 'discard':
      return { t: 'discard', uids: byKeepValue(me.hand, me.pantry.length).slice(0, prompt.count).map((c) => c.uid) };
    case 'plant': {
      const treats = me.pantry.length;
      if (treats >= treatTarget(s, p) || me.hand.length <= 1) return { t: 'skipPlant' };
      return { t: 'plant', uid: byKeepValue(me.hand, treats + 1)[0].uid };
    }
    default:
      break;
  }

  const actions = legalActions(s);
  if (rnd() > skill) return actions[Math.floor(rnd() * actions.length)];

  if (prompt.kind === 'pounce') {
    const decline = { t: 'decline' } as Action;
    const pounces = actions.filter((a) => a.t === 'pounce');
    if (!pounces.length) return decline;
    // Compare against letting the play/attack resolve; only Pounce for a clear gain.
    const world = determinize(s, p, rnd);
    const baseline = simulate(world, p, decline);
    let top = { action: decline, score: baseline + 1.5 };
    for (const a of pounces) {
      const score = simulate(world, p, a);
      if (score > top.score) top = { action: a, score };
    }
    return top.action;
  }

  if (prompt.kind === 'lucky') {
    const plays = actions.filter((a) => a.t === 'lucky');
    return plays.length ? best(s, p, plays, rnd).action : { t: 'keepLucky' };
  }

  if (prompt.kind === 'choose') return best(s, p, actions, rnd).action;

  // Action phase: the best non-pass action if it beats passing, otherwise pass (or keep the Yarn).
  const pass: Action = { t: 'pass' };
  const candidates = actions.filter((a) => a.t !== 'pass' && a.t !== 'takeYarn');
  const passScore = simulate(determinize(s, p, rnd), p, pass);
  if (candidates.length) {
    const top = best(s, p, candidates, rnd);
    if (top.score > passScore + 0.3) return refine(s, p, top.action, candidates, passScore, rnd) ?? top.action;
  }
  // Taking the Yarn locks us into passing for the rest of the round, so only do it as the very last
  // move: the opponent has already passed, and passing now would end the round and hand them the
  // Yarn Ball. A plain pass keeps us free to answer whatever the opponent does next.
  const canTake = actions.some((a) => a.t === 'takeYarn');
  if (canTake && s.yarn === p && s.passes >= 1) return { t: 'takeYarn' };
  return pass;
}

/** A tiny random agent, handy as a baseline in simulations. */
export function randomAction(s: GameState, rnd: () => number = Math.random): Action {
  const prompt = s.prompt!;
  const me = s.players[prompt.player];
  if (prompt.kind === 'mulligan') return { t: 'mulligan', uids: [] };
  if (prompt.kind === 'setupPlant' || prompt.kind === 'discard')
    return { t: prompt.kind, uids: shuffled(me.hand, rnd).slice(0, prompt.count).map((c) => c.uid) };
  const actions = legalActions(s);
  return actions[Math.floor(rnd() * actions.length)];
}

export { playOptions };
