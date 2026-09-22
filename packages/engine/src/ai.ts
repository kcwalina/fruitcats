// A heuristic AI opponent: one-step lookahead over every legal action, scored by a board evaluation.
//
// It never sees hidden information. Before searching it "determinizes" the game: the opponent's
// hand is replaced by blank cards, and every player's deck and Lives are reshuffled together, so the
// lookahead can't peek at draws, Lucky cards or the opponent's Pounces.

import { CARDS, isUnitCard, keywords } from './cards';
import { apply, isGuardian, legalActions, other, playOptions, unitHealth, unitPower } from './engine';
import type { Action, CardInst, GameState, PlayerId } from './types';

export interface AiOptions {
  /** 0 = plays randomly, 1 = full strength. Values in between mix in random moves. */
  skill?: number;
  random?: () => number;
}

const BLANK = 'SB1-C04'; // a vanilla card: no Pounce, no Lucky
// `exhausted` discounts a unit's power while it can't attack or block this round — it is what makes
// "exhaust an enemy unit" effects worth anything to the AI.
// `readyTreat` values Treats still unspent this round — what makes "ready a Treat" effects (Mochi) worth
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
      const k = keywords(u.id);
      v += unitPower(u) * W.power + (unitHealth(u) - u.damage) * W.health;
      if (u.exhausted && s.prompt?.kind !== 'plant') v -= unitPower(u) * W.exhausted;
      if (isGuardian(u)) v += W.guardian;
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
  const c = structuredClone(s);
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
      const maxCost = Math.max(...[...me.hand, ...me.deck].map((c) => CARDS[c.id].cost ?? 0), 0);
      // Ramp decks (and Mochi's Grow Up at 8 Treats) want to keep planting.
      const growUpAt = me.hero.id === 'SB1-H03' && !me.hero.grown ? 8 : 0;
      if (treats >= Math.max(5, maxCost, growUpAt) || me.hand.length <= 1) return { t: 'skipPlant' };
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
    if (top.score > passScore + 0.3) return top.action;
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
