// A heuristic AI opponent for the Muster: one-step lookahead over a pruned set of moves, scored by a board
// evaluation that includes a quick forecast of the coming Clash.
//
// It never sees hidden information. Before searching it "determinizes" the game: the opponent's hand is replaced by
// blank cards, their board by what they showed when the Muster began, and every player's deck and Candles are
// reshuffled together, so the lookahead can't peek at draws, Lucky cards, Ambushes or the opponent's new units.

import { BLANK_CARD, CARDS, PLUGINS, abilitiesOf, isUnitCard, keywords, usesCondition } from './cards';
import {
  HAND_LIMIT, MULLIGAN_MAX, applyTrusted, heroSide, interestOn, isGuardian, legalActions, nextSeat, other, playOptions,
  targetRank, unitCount, unitHealth, unitKeywords, unitPower, cantAttack,
} from './engine';
import type { Action, CardInst, GameState, PlayerId, Target, Unit } from './types';

export interface AiOptions {
  /** 0 = plays randomly, 1 = full strength. Values in between mix in random moves. */
  skill?: number;
  random?: () => number;
  /** The player to decide for (during the Muster both decide); the one the prompt names when left out. */
  seat?: PlayerId;
}

const BLANK = BLANK_CARD; // a vanilla card: no Ambush, no Lucky
const W = {
  life: 12, hand: 0.9, offering: 0.75, interest: 1.2, level: 1.6, power: 1.5, health: 1.0,
  guardian: 0.8, fierce: 1.2, sneaky: 0.8, grown: 6, star: 1.5, clash: 8,
};

// ── The Clash, foretold ──────────────────────────────────────────────────────────────────────────
// A quick run of the coming Clash on the units as they stand: the same order of attack, Swift first, Tough,
// pending damage and exhaustion, the Awakened Heroes' strikes. It leaves out triggers, so it is a forecast.

interface Fighter { owner: PlayerId; slot: number; power: number; hp: number; tough: number; rank: number; sneaky: boolean; swift: boolean; active: boolean; fierce: boolean }

function fighters(s: GameState): Fighter[] {
  const out: Fighter[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    for (const u of s.players[owner].yard) {
      const k = unitKeywords(u, s);
      out.push({
        owner, slot: u.slot, power: unitPower(u, s), hp: unitHealth(u, s) - u.damage, tough: k.tough, rank: targetRank(u, s),
        sneaky: k.sneaky, swift: k.zoomies, active: !u.exhausted && !cantAttack(s, owner, u), fierce: k.fierce,
      });
    }
  }
  return out;
}

function pick(enemies: Fighter[], slot: number, sneaky: boolean): Fighter | undefined {
  if (!enemies.length) return undefined;
  const want = sneaky ? Math.min(...enemies.map((e) => e.rank)) : Math.max(...enemies.map((e) => e.rank));
  return enemies.filter((e) => e.rank === want).reduce((best, e) => {
    const d = Math.abs(e.slot - slot), bd = Math.abs(best.slot - slot);
    return d < bd || (d === bd && e.slot < best.slot) ? e : best;
  });
}

/** Candles each player would lose in the coming Clash, as far as a quick run can tell. */
export function forecastClash(s: GameState): [number, number] {
  const fs = fighters(s);
  const byLane = (p: PlayerId, lane: number) => fs.find((f) => f.owner === p && f.slot === lane && f.hp > 0);
  // Effects waiting for the Clash: damage and exhaustion on the lanes they aim at.
  for (const owner of [0, 1] as PlayerId[]) {
    for (const x of s.players[owner].pending ?? []) {
      const ability = 'mechanic' in x.ref ? undefined : abilitiesOf(x.ref.card, x.ref.side)[x.ref.index];
      if (!ability) continue;
      let targets = x.target?.kind === 'lane' ? [byLane(x.target.player, x.target.lane)].filter(Boolean) as Fighter[]
        : typeof ability.target === 'object' && 'each' in ability.target ? fs.filter((f) => f.owner !== owner) : [];
      // An effect for exhausted units only fizzles on a ready one.
      if (typeof ability.target === 'object' && ability.target.filter?.exhausted) targets = targets.filter((f) => !f.active);
      for (const act of ability.do ?? []) {
        for (const f of targets) {
          if ('damage' in act) f.hp -= Math.max(0, (act.damage as number) - f.tough);
          if ('exhaust' in act || 'cancelAttack' in act) f.active = false;
        }
      }
    }
  }
  const struck: [boolean, boolean] = [false, false];
  for (const owner of [0, 1] as PlayerId[]) {
    const hero = s.players[owner].hero;
    const power = heroSide(s, owner).power ?? 0;
    if (!hero.grown || hero.exhausted || !power) continue;
    struck[owner] = true;
    const t = pick(fs.filter((f) => f.owner !== owner && f.hp > 0), 0, false);
    if (t) t.hp -= Math.max(0, power - t.tough);
  }
  for (let bout = 1; bout <= s.rules.boutCap; bout++) {
    let dealt = 0;
    for (const swift of [true, false]) {
      const alive = fs.filter((f) => f.hp > 0);
      if (!alive.some((f) => f.owner === 0) || !alive.some((f) => f.owner === 1)) break;
      const hits: [Fighter, number][] = [];
      for (const f of alive) {
        if (!f.active || f.swift !== swift) continue;
        const t = pick(alive.filter((e) => e.owner !== f.owner), f.slot, f.sneaky);
        if (t) hits.push([t, Math.max(0, f.power - t.tough)]);
      }
      for (const [t, n] of hits) { t.hp -= n; dealt += n; }
    }
    const alive = fs.filter((f) => f.hp > 0);
    if (!alive.some((f) => f.owner === 0) || !alive.some((f) => f.owner === 1) || !dealt) break;
  }
  const standing = [0, 1].map((p) => fs.filter((f) => f.owner === p && f.hp > 0));
  const worth = (p: PlayerId) => standing[p].reduce((n, f) => n + (f.fierce ? 2 : 1), 0) +
    (struck[p] ? (heroSide(s, p).keywords?.includes('Fierce') ? 2 : 1) : 0);
  const cap = s.rules.clashCandleCap;
  const lost: [number, number] = [0, 0];
  if (standing[0].length && !standing[1].length) lost[1] = Math.min(cap, worth(0));
  else if (standing[1].length && !standing[0].length) lost[0] = Math.min(cap, worth(1));
  else if (standing[0].length && standing[1].length && s.rules.overtimeBothLose) {
    lost[0] = Math.min(cap, worth(1));
    lost[1] = Math.min(cap, worth(0));
  }
  return lost;
}

// ── Evaluation ───────────────────────────────────────────────────────────────────────────────────

/** What a unit on the board is worth for the rounds to come. */
function unitValue(s: GameState, u: Unit): number {
  const k = unitKeywords(u, s, false);
  const temp = u.buffPower;
  let v = (unitPower(u, s) - temp) * W.power + (unitHealth(u, s) - (u.buffHealth ?? 0)) * W.health;
  if (isGuardian(u, s)) v += W.guardian;
  if (k.fierce) v += W.fierce;
  if (k.sneaky) v += W.sneaky;
  if (u.stars) v += (u.stars - 1) * W.star;
  return v;
}

export function evaluate(s: GameState, p: PlayerId): number {
  if (s.winner === p) return 1e6;
  if (s.winner === other(p)) return -1e6;
  const forecast = s.phase === 'muster' ? forecastClash(s) : [0, 0];
  let score = 0;
  for (const q of [p, other(p)] as PlayerId[]) {
    const pl = s.players[q];
    const sign = q === p ? 1 : -1;
    let v = pl.lives.length * W.life + Math.min(pl.hand.length, HAND_LIMIT) * W.hand;
    v += pl.offerings * W.offering + interestOn(s, pl.offerings) * W.interest;
    v += pl.hero.level * W.level;
    for (const u of [...pl.yard, ...(pl.fallen ?? [])]) v += unitValue(s, u);
    if (pl.hero.grown) v += W.grown;
    v -= forecast[q] * W.clash;
    score += sign * v;
  }
  return score;
}

// ── The search ───────────────────────────────────────────────────────────────────────────────────

/** How much a card is worth keeping in hand; the lowest-value cards are offered first. */
function keepValue(card: CardInst, offerings: number): number {
  const def = CARDS[card.id];
  if (!def) return 0;
  const cost = def.cost ?? 0;
  let v = isUnitCard(card.id) ? (def.power ?? 0) + (def.health ?? 0) : def.type === 'Toy' ? 3 : 4;
  if (keywords(card.id).pounce) v += 1;
  if (def.type === 'Cat') v += 3;
  if (cost > offerings + 8) v -= 3; // too expensive to save up for soon
  return v;
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The game as player p may know it: the opponent's hand blank, their board as they showed it, decks reshuffled. */
export function determinize(s: GameState, p: PlayerId, rnd: () => number): GameState {
  // The story so far doesn't change the evaluation; leaving it out keeps every clone in the search cheap.
  const c = structuredClone({ ...s, log: [], events: [] });
  const q = other(p);
  const foe = c.players[q];
  if (c.phase === 'muster' && foe.shown) {
    c.players[q] = { ...foe.shown, name: foe.name, deckName: foe.deckName };
    // A player still deciding may well add units: the bot can't know which, so it takes the board as shown.
    c.muster = { open: [c.muster!.open[0], c.muster!.open[1]] };
  }
  const opp = c.players[q];
  opp.hand = opp.hand.map((h) => ({ uid: h.uid, id: BLANK }));
  opp.ambushes = [];
  opp.pending = [];
  delete opp.shown;
  for (const pl of c.players) {
    const deck = pl.deck.every((x) => x.id !== '?') ? pl.deck : [];
    const pool = shuffled([...deck, ...pl.lives.filter((x) => x.id !== '?')], rnd);
    if (pool.length >= pl.lives.length) {
      pl.lives = pool.slice(0, pl.lives.length);
      pl.deck = pool.slice(pl.lives.length);
    }
  }
  return c;
}

function simulate(base: GameState, p: PlayerId, action: Action): number {
  const s = structuredClone(base);
  try {
    applyTrusted(s, action, p);
  } catch {
    return -Infinity;
  }
  return evaluate(s, p);
}

function best(world: GameState, p: PlayerId, actions: Action[], rnd: () => number): { action: Action; score: number } {
  let top = { action: actions[0], score: -Infinity };
  for (const action of actions) {
    const score = simulate(world, p, action) + rnd() * 0.01;
    if (score > top.score) top = { action, score };
  }
  return top;
}

/** A lane a target aims at that is worth trying: one where the opponent (as the bot sees them) has a unit. */
function usefulTarget(world: GameState, t: Target | undefined): boolean {
  if (t?.kind !== 'lane') return true;
  return world.players[t.player].yard.some((u) => u.slot === t.lane);
}

/**
 * The moves worth a look: plays and Ambushes on lanes that hold something, a few placements for a new unit, Levels,
 * the Hero's ability. Moving units and offering cards are tried separately (arrange, below), so the search stays small.
 */
function candidates(world: GameState, actions: Action[]): Action[] {
  const out: Action[] = [];
  const seenSlotFor = new Map<string, number>();
  for (const a of actions) {
    if (a.t === 'ready' || a.t === 'move' || a.t === 'offer') continue;
    if ((a.t === 'play' || a.t === 'lucky' || a.t === 'ability') && (!usefulTarget(world, a.target) || !usefulTarget(world, (a as { target2?: Target }).target2))) continue;
    if (a.t === 'ambush' && a.target && !usefulTarget(world, a.target)) continue;
    if ((a.t === 'play' || a.t === 'lucky') && a.slot !== undefined) {
      // Try at most two lanes per card and target: arrange() moves units afterwards if another lane is better.
      const key = `${a.t}:${a.uid}:${JSON.stringify(a.target ?? null)}`;
      const n = seenSlotFor.get(key) ?? 0;
      if (n >= 2) continue;
      seenSlotFor.set(key, n + 1);
    }
    out.push(a);
  }
  return out;
}

/** Moving units around: the swap or move that most improves the forecast, if any. */
function arrange(world: GameState, p: PlayerId, actions: Action[], base: number): Action | null {
  let top: { action: Action; score: number } | null = null;
  for (const a of actions) {
    if (a.t !== 'move') continue;
    const score = simulate(world, p, a);
    if (score > base + 0.5 && (!top || score > top.score)) top = { action: a, score };
  }
  return top?.action ?? null;
}

/**
 * Let the sets' plugins improve on the bot's favourite move: a hook sees the decision and the bot's own
 * judge, and knows what its set's cards need.
 */
function refine(s: GameState, world: GameState, p: PlayerId, chosen: Action, all: Action[], passScore: number, rnd: () => number): Action | null {
  for (const plugin of PLUGINS) {
    const hook = plugin.ai?.refineAction;
    if (!hook) continue;
    const better = hook({
      s, p, chosen, candidates: all, passScore,
      best: (actions) => best(world, p, actions, rnd),
      usesCondition,
      cardCost: (id) => CARDS[id]?.cost ?? 0,
    });
    if (better) return better;
  }
  return null;
}

/**
 * The bot's one-step score for every legal action of a player (higher is better), from one determinized world so the
 * scores compare. Used to judge other players' choices, such as an LLM's.
 */
export function scoreActions(s: GameState, rnd: () => number = Math.random, seat?: PlayerId): { action: Action; score: number }[] {
  const p = seat ?? nextSeat(s) ?? 0;
  const world = determinize(s, p, rnd);
  return legalActions(s, p).map((action) => ({ action, score: action.t === 'ready' ? evaluate(world, p) : simulate(world, p, action) }));
}

/** Moves already made by this player in this Muster. */
const musterMoves = (s: GameState, p: PlayerId): number => s.clock[p] - (s.musterStart?.clock[p] ?? s.clock[p]);

export function chooseAction(s: GameState, options: AiOptions = {}): Action {
  const prompt = s.prompt;
  if (!prompt) throw new Error('no decision pending');
  const p = options.seat ?? nextSeat(s) ?? prompt.player;
  const me = s.players[p];
  const rnd = options.random ?? Math.random;
  const skill = options.skill ?? 1;

  if (prompt.kind === 'mulligan') {
    const cheap = me.hand.some((c) => (CARDS[c.id].cost ?? 0) <= 2);
    const aside = me.hand.filter((c) => (CARDS[c.id].cost ?? 0) >= (cheap ? 5 : 4))
      .sort((a, b) => (CARDS[b.id].cost ?? 0) - (CARDS[a.id].cost ?? 0)).slice(0, MULLIGAN_MAX);
    return { t: 'mulligan', uids: aside.map((c) => c.uid) };
  }

  const actions = legalActions(s, p);
  const ready: Action = { t: 'ready' };
  // Too many cards: offer the one worth least.
  if (me.hand.length > HAND_LIMIT) {
    const worst = [...me.hand].sort((a, b) => keepValue(a, me.offerings) - keepValue(b, me.offerings))[0];
    return { t: 'offer', uid: worst.uid };
  }
  if (musterMoves(s, p) > 30) return ready;
  if (rnd() > skill) {
    // A random move now and then; Ready as often as anything else, so the Muster ends.
    const kinds = ['ready', ...new Set(actions.map((a) => a.t))];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const pool = actions.filter((a) => a.t === kind);
    return pool.length ? pool[Math.floor(rnd() * pool.length)] : ready;
  }

  const world = determinize(s, p, rnd);
  const readyScore = evaluate(world, p);
  const list = candidates(world, actions);
  if (list.length) {
    let top = best(world, p, list, rnd);
    // A Level pays off with the unit it makes room for: judge it by the best play after it.
    const level = list.find((a) => a.t === 'levelUp');
    if (level && unitCount(s, p) >= me.hero.level) {
      const after = structuredClone(world);
      applyTrusted(after, level, p);
      const plays = candidates(after, legalActions(after, p)).filter((a) => a.t === 'play' && isUnitCard(cardOf(after, p, a.uid)));
      if (plays.length) {
        const follow = best(after, p, plays, rnd);
        if (follow.score > top.score) top = { action: level, score: follow.score };
      }
    }
    if (top.score > readyScore + 0.2) return refine(s, world, p, top.action, list, readyScore, rnd) ?? top.action;
  }
  const move = arrange(world, p, actions, readyScore);
  if (move) return move;
  return ready;
}

const cardOf = (s: GameState, p: PlayerId, uid: number): string => s.players[p].hand.find((c) => c.uid === uid)?.id ?? '';

/** A tiny random agent, handy as a baseline in simulations. */
export function randomAction(s: GameState, rnd: () => number = Math.random, seat?: PlayerId): Action {
  const prompt = s.prompt!;
  const p = seat ?? nextSeat(s) ?? prompt.player;
  if (prompt.kind === 'mulligan') return { t: 'mulligan', uids: [] };
  const me = s.players[p];
  if (me.hand.length > HAND_LIMIT) return { t: 'offer', uid: me.hand[0].uid };
  const actions = legalActions(s, p).filter((a) => a.t !== 'move' && a.t !== 'offer');
  // Ready one time in four, so a random Muster ends.
  if (rnd() < 0.25 || !actions.length || musterMoves(s, p) > 30) return { t: 'ready' };
  return actions[Math.floor(rnd() * actions.length)];
}

export { playOptions };
