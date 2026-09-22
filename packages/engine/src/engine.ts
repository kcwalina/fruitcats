// The Fruitcats rules engine: a deterministic state machine that implements docs/rulebook.md §13.
//
//   const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 42 });
//   while (!s.winner) apply(s, pickOneOf(legalActions(s)));
//
// `apply` mutates the state in place (clone first with `structuredClone` to keep history). All
// randomness comes from the seed stored in the state, so a seed plus the action list replays a game.

import {
  CARDS, GRANNY_SMITH, SAKURA, SANGUINE, behaviour, deckCardIds, DECKS, isUnitCard, keywords,
} from './cards';
import type {
  Action, CardInst, EffectKey, GameState, PlayerId, PlayerState, Prompt, Step, Target, TargetSpec, Unit, Window,
} from './types';

export const LIVES = 9;
export const DECK_SIZE = 50;
export const STARTING_HAND = 6;
export const SETUP_TREATS = 2;
export const DRAW_PER_ROUND = 2;
export const YARD_LIMIT = 6;
export const HAND_LIMIT = 10;
export const MAX_ROUNDS = 40;

export const other = (p: PlayerId): PlayerId => (1 - p) as PlayerId;
export const cardName = (id: string): string => CARDS[id]?.name.split(',')[0] ?? id;

// ── Randomness (mulberry32, state in s.seed) ─────────────────────────────────────────────────────

export function random(s: GameState): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(s: GameState, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────────────────────────

export interface GameOptions {
  decks: [string, string];
  names?: [string, string];
  seed?: number;
  /** Force the starting Yarn Ball holder (random otherwise). */
  firstPlayer?: PlayerId;
}

export function createGame(options: GameOptions): GameState {
  const s: GameState = {
    seed: (options.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    round: 1,
    yarn: 0,
    yarnTaken: null,
    active: 0,
    passes: 0,
    players: [] as unknown as [PlayerState, PlayerState],
    prompt: null,
    queue: [],
    window: null,
    winner: null,
    nextUid: 1,
    log: [],
    actions: 0,
    startingYarn: 0,
  };
  for (const p of [0, 1] as PlayerId[]) {
    const deckKey = options.decks[p];
    const deck = deckCardIds(deckKey).map((id) => ({ uid: s.nextUid++, id }));
    shuffle(s, deck);
    const lives = deck.splice(0, LIVES);
    const hand = deck.splice(0, STARTING_HAND);
    s.players[p] = {
      name: options.names?.[p] ?? `Player ${p + 1}`,
      deckName: DECKS[deckKey].name,
      hero: { id: DECKS[deckKey].hero, grown: false, exhausted: false },
      deck, hand, lives, pantry: [], yard: [], compost: [],
    };
  }
  s.yarn = options.firstPlayer ?? (random(s) < 0.5 ? 0 : 1);
  s.startingYarn = s.yarn;
  s.active = s.yarn;
  log(s, `${s.players[s.yarn].name} starts with the Yarn Ball.`);
  s.queue.push(
    { t: 'mulliganPrompt', p: 0 }, { t: 'mulliganPrompt', p: 1 },
    { t: 'setupPlantPrompt', p: 0 }, { t: 'setupPlantPrompt', p: 1 },
    { t: 'beginActions' },
  );
  run(s);
  return s;
}

function log(s: GameState, text: string, player?: PlayerId): void {
  s.log.push({ round: s.round, player, text });
}

// ── Queries ──────────────────────────────────────────────────────────────────────────────────────

export function findUnit(s: GameState, uid: number): { unit: Unit; owner: PlayerId } | null {
  for (const owner of [0, 1] as PlayerId[]) {
    const unit = s.players[owner].yard.find((u) => u.uid === uid);
    if (unit) return { unit, owner };
  }
  return null;
}

export function unitPower(u: Unit): number {
  const toy = u.toy ? behaviour(u.toy.id).toy?.power ?? 0 : 0;
  return Math.max(0, (CARDS[u.id].power ?? 0) + toy + u.buffPower);
}

export function unitHealth(u: Unit): number {
  const toy = u.toy ? behaviour(u.toy.id).toy?.health ?? 0 : 0;
  return (CARDS[u.id].health ?? 0) + toy;
}

export const isGuardian = (u: Unit): boolean =>
  keywords(u.id).guardian || u.buffGuardian || !!(u.toy && behaviour(u.toy.id).toy?.guardian);
export const isSneaky = (u: Unit): boolean => keywords(u.id).sneaky || u.buffSneaky;

export const heroSide = (s: GameState, p: PlayerId) => {
  const hero = s.players[p].hero;
  return hero.grown ? CARDS[hero.id].bigCat! : CARDS[hero.id].kitten!;
};

export const readyTreats = (s: GameState, p: PlayerId): number =>
  s.players[p].pantry.filter((t) => !t.exhausted).length;

function attackerPower(s: GameState, attacker: Target): number {
  if (attacker.kind === 'hero') return heroSide(s, attacker.player).power ?? 0;
  const found = findUnit(s, attacker.uid);
  return found ? unitPower(found.unit) : 0;
}

function attackerFierce(s: GameState, attacker: Target): boolean {
  if (attacker.kind === 'hero') return /\bFierce\b/.test(heroSide(s, attacker.player).text);
  const found = findUnit(s, attacker.uid);
  return !!found && keywords(found.unit.id).fierce;
}

export function targetsFor(s: GameState, p: PlayerId, spec: TargetSpec, excludeUid?: number): Target[] {
  const result: Target[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    for (const u of s.players[owner].yard) {
      const own = owner === p;
      const ok =
        spec === 'anyUnit' ? true :
        spec === 'ownUnit' ? own :
        spec === 'enemyUnit' ? !own :
        spec === 'ownOtherUnit' ? own && u.uid !== excludeUid :
        spec === 'exhaustedUnit' ? u.exhausted :
        spec === 'ownUnitNoToy' ? own && !u.toy : false;
      if (ok) result.push({ kind: 'unit', uid: u.uid });
    }
  }
  return result;
}

const sameTarget = (a?: Target, b?: Target): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'unit' ? a.uid === (b as typeof a).uid : a.player === (b as typeof a).player);

function isLegalTarget(s: GameState, p: PlayerId, spec: TargetSpec, target: Target | undefined, excludeUid?: number): boolean {
  return !!target && targetsFor(s, p, spec, excludeUid).some((t) => sameTarget(t, target));
}

/**
 * The ways a card in hand can be played right now: a list of targets (`undefined` = no target).
 * Empty means it can't be played. `mode` is how: a normal action, in a Pounce window, or free via Lucky.
 */
export function playOptions(s: GameState, p: PlayerId, card: CardInst, mode: 'action' | 'pounce' | 'lucky'): (Target | undefined)[] {
  const def = CARDS[card.id];
  const b = behaviour(card.id);
  const k = keywords(card.id);
  if (mode === 'pounce' && !k.pounce) return [];
  if (mode === 'action' && b.pounceOnly) return [];
  if (mode === 'pounce' && b.pounceOnly === 'attack' && s.window?.kind !== 'attack') return [];
  if (mode !== 'lucky' && (def.cost ?? 0) > readyTreats(s, p)) return [];
  const yard = s.players[p].yard;

  if (isUnitCard(card.id)) {
    if (yard.length >= YARD_LIMIT) return [];
    if (def.type === 'Cat' && yard.some((u) => u.id === card.id)) return [];
    const spec = b.hello?.target;
    if (!spec) return [undefined];
    const targets = targetsFor(s, p, spec);
    return targets.length ? targets : [undefined];
  }
  if (def.type === 'Toy') return targetsFor(s, p, 'ownUnitNoToy');
  // Trick
  const spec = b.play?.target;
  if (!spec) return [undefined];
  const targets = targetsFor(s, p, spec);
  if (targets.length) return targets;
  return b.play?.optionalTarget ? [undefined] : [];
}

function withTarget<T extends object>(action: T, target: Target | undefined): T {
  return target ? { ...action, target } : action;
}

function attackOptions(s: GameState, p: PlayerId): Action[] {
  const me = s.players[p];
  const foe = s.players[other(p)];
  const attackers: { ref: Target; sneaky: boolean }[] = me.yard
    .filter((u) => !u.exhausted && me.pantry.length >= (behaviour(u.id).attackNeedsTreats ?? 0))
    .map((u) => ({ ref: { kind: 'unit', uid: u.uid }, sneaky: isSneaky(u) }));
  if (me.hero.grown && !me.hero.exhausted) attackers.push({ ref: { kind: 'hero', player: p }, sneaky: false });

  const guardians = foe.yard.filter(isGuardian);
  const actions: Action[] = [];
  for (const a of attackers) {
    const pool = guardians.length && !a.sneaky ? guardians : foe.yard;
    for (const u of pool) actions.push({ t: 'attack', attacker: a.ref, target: { kind: 'unit', uid: u.uid } });
    if (!guardians.length || a.sneaky) actions.push({ t: 'attack', attacker: a.ref, target: { kind: 'hero', player: other(p) } });
  }
  return actions;
}

/**
 * Every legal action for the player the game is waiting on. Multi-select prompts (mulligan, setup
 * plant, discard) return [] — any valid subset is legal; see `apply` for their rules.
 */
export function legalActions(s: GameState): Action[] {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) return [];
  const p = prompt.player;
  const me = s.players[p];

  switch (prompt.kind) {
    case 'mulligan':
    case 'setupPlant':
    case 'discard':
      return [];
    case 'plant':
      return [...me.hand.map((c): Action => ({ t: 'plant', uid: c.uid })), { t: 'skipPlant' }];
    case 'action': {
      const actions: Action[] = [];
      for (const card of me.hand)
        for (const target of playOptions(s, p, card, 'action')) actions.push(withTarget({ t: 'play', uid: card.uid }, target));
      actions.push(...attackOptions(s, p));
      if (!me.hero.exhausted) {
        const ability = me.hero.grown ? behaviour(me.hero.id).bigCat : behaviour(me.hero.id).kitten;
        // Don't offer an ability that would do nothing (readying Treats when none are spent).
        const pointless = ability?.effect.startsWith('readyTreat') && !me.pantry.some((t) => t.exhausted);
        if (ability?.target) for (const target of targetsFor(s, p, ability.target)) actions.push({ t: 'ability', target });
        else if (ability && !pointless) actions.push({ t: 'ability' });
      }
      if (s.yarnTaken === null) actions.push({ t: 'takeYarn' });
      actions.push({ t: 'pass' });
      return actions;
    }
    case 'pounce': {
      const actions: Action[] = [];
      for (const card of me.hand)
        for (const target of playOptions(s, p, card, 'pounce')) actions.push(withTarget({ t: 'pounce', uid: card.uid }, target));
      actions.push({ t: 'decline' });
      return actions;
    }
    case 'lucky': {
      const card = me.hand.find((c) => c.uid === prompt.uid)!;
      return [...playOptions(s, p, card, 'lucky').map((target) => withTarget({ t: 'lucky' } as Action, target)), { t: 'keepLucky' }];
    }
    case 'choose':
      return targetsFor(s, p, prompt.spec).map((target): Action => ({ t: 'choose', target }));
  }
}

// ── Applying actions ─────────────────────────────────────────────────────────────────────────────

export class IllegalAction extends Error {}

function takeFromHand(s: GameState, p: PlayerId, uid: number): CardInst {
  const hand = s.players[p].hand;
  const i = hand.findIndex((c) => c.uid === uid);
  if (i < 0) throw new IllegalAction(`card ${uid} is not in hand`);
  return hand.splice(i, 1)[0];
}

function pay(s: GameState, p: PlayerId, cost: number): void {
  let left = cost;
  for (const t of s.players[p].pantry) if (left > 0 && !t.exhausted) { t.exhausted = true; left--; }
}

function validateSubset(s: GameState, p: PlayerId, uids: number[], size?: number): void {
  const hand = new Set(s.players[p].hand.map((c) => c.uid));
  if (new Set(uids).size !== uids.length || uids.some((u) => !hand.has(u))) throw new IllegalAction('cards must be distinct cards in hand');
  if (size !== undefined && uids.length !== size) throw new IllegalAction(`choose exactly ${size} card(s)`);
}

function describeTarget(s: GameState, target?: Target): string {
  if (!target) return '';
  if (target.kind === 'hero') return `${s.players[target.player].name}'s ${cardName(s.players[target.player].hero.id)}`;
  const found = findUnit(s, target.uid);
  return found ? cardName(found.unit.id) : 'a unit';
}

/** Apply an action for the player the game is waiting on, then run the game until the next decision. */
export function apply(s: GameState, action: Action): GameState {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) throw new IllegalAction('the game is not waiting for an action');
  const p = prompt.player;
  const me = s.players[p];

  const multi = prompt.kind === 'mulligan' || prompt.kind === 'setupPlant' || prompt.kind === 'discard';
  if (!multi) {
    const key = JSON.stringify(action);
    if (!legalActions(s).some((a) => JSON.stringify(a) === key)) throw new IllegalAction(`illegal action ${key}`);
  } else if (action.t !== prompt.kind) {
    throw new IllegalAction(`expected ${prompt.kind}`);
  }

  s.prompt = null;
  s.actions++;

  switch (action.t) {
    case 'mulligan': {
      validateSubset(s, p, action.uids);
      const aside = action.uids.map((uid) => takeFromHand(s, p, uid));
      me.hand.push(...me.deck.splice(0, aside.length));
      me.deck.push(...aside);
      shuffle(s, me.deck);
      log(s, aside.length ? `${me.name} mulligans ${aside.length} card(s).` : `${me.name} keeps their hand.`, p);
      break;
    }
    case 'setupPlant': {
      validateSubset(s, p, action.uids, (prompt as { count: number }).count);
      for (const uid of action.uids) me.pantry.push({ card: takeFromHand(s, p, uid), exhausted: false });
      log(s, `${me.name} plants ${action.uids.length} Treats.`, p);
      break;
    }
    case 'discard': {
      validateSubset(s, p, action.uids, (prompt as { count: number }).count);
      for (const uid of action.uids) me.compost.push(takeFromHand(s, p, uid));
      log(s, `${me.name} discards ${action.uids.length} card(s) down to ${HAND_LIMIT}.`, p);
      break;
    }
    case 'plant':
      me.pantry.push({ card: takeFromHand(s, p, action.uid), exhausted: false });
      log(s, `${me.name} plants a Treat (${me.pantry.length} total).`, p);
      break;
    case 'skipPlant':
      break;
    case 'play': {
      const card = takeFromHand(s, p, action.uid);
      pay(s, p, CARDS[card.id].cost ?? 0);
      s.passes = 0;
      log(s, `${me.name} plays ${cardName(card.id)}${action.target ? ` targeting ${describeTarget(s, action.target)}` : ''}.`, p);
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, closesWindow: true }, { t: 'afterAction' });
      openWindow(s, { kind: 'play', by: p, card, target: action.target });
      break;
    }
    case 'attack': {
      if (action.attacker.kind === 'hero') me.hero.exhausted = true;
      else findUnit(s, action.attacker.uid)!.unit.exhausted = true;
      s.passes = 0;
      log(s, `${me.name}'s ${describeTarget(s, action.attacker).replace(`${me.name}'s `, '')} attacks ${describeTarget(s, action.target)}.`, p);
      s.queue.unshift({ t: 'resolveAttack' }, { t: 'afterAction' });
      openWindow(s, { kind: 'attack', by: p, attacker: action.attacker, target: action.target, cancelled: false });
      break;
    }
    case 'ability': {
      me.hero.exhausted = true;
      s.passes = 0;
      const ability = (me.hero.grown ? behaviour(me.hero.id).bigCat : behaviour(me.hero.id).kitten)!;
      log(s, `${me.name}'s ${cardName(me.hero.id)} uses their ability${action.target ? ` on ${describeTarget(s, action.target)}` : ''}.`, p);
      s.queue.unshift({ t: 'effect', p, effect: ability.effect, target: action.target, sourceId: me.hero.id }, { t: 'afterAction' });
      break;
    }
    case 'takeYarn':
      s.yarnTaken = p;
      s.passes = 0;
      log(s, `${me.name} takes the Yarn Ball and will act first next round.`, p);
      s.queue.unshift({ t: 'afterAction' });
      break;
    case 'pass':
      s.passes++;
      log(s, `${me.name} passes.`, p);
      s.queue.unshift({ t: 'afterAction' });
      break;
    case 'pounce': {
      const card = takeFromHand(s, p, action.uid);
      pay(s, p, CARDS[card.id].cost ?? 0);
      log(s, `${me.name} POUNCES with ${cardName(card.id)}${action.target ? ` on ${describeTarget(s, action.target)}` : ''}!`, p);
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, closesWindow: false });
      break;
    }
    case 'decline':
      break;
    case 'lucky': {
      const card = takeFromHand(s, p, (prompt as { uid: number }).uid);
      log(s, `Lucky! ${me.name} plays ${cardName(card.id)} for free.`, p);
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, closesWindow: false });
      break;
    }
    case 'keepLucky':
      break;
    case 'choose': {
      const pr = prompt as Extract<Prompt, { kind: 'choose' }>;
      s.queue.unshift({ t: 'effect', p, effect: pr.effect, target: action.target, sourceId: pr.sourceId });
      break;
    }
  }
  stateCheck(s);
  run(s);
  return s;
}

function openWindow(s: GameState, window: Window): void {
  s.window = window;
  const defender = other(window.by);
  const canPounce = s.players[defender].hand.some((c) => playOptions(s, defender, c, 'pounce').length > 0);
  if (canPounce) s.prompt = { kind: 'pounce', player: defender };
}

// ── The step machine ─────────────────────────────────────────────────────────────────────────────

function run(s: GameState): void {
  let guard = 0;
  while (!s.prompt && s.winner === null && s.queue.length) {
    if (++guard > 100000) throw new Error('engine did not settle');
    exec(s, s.queue.shift()!);
    stateCheck(s);
  }
}

function continueTurn(s: GameState): void {
  for (;;) {
    if (s.passes >= 2) { s.queue.unshift({ t: 'endRound' }); return; }
    if (s.yarnTaken === s.active) { s.passes++; s.active = other(s.active); continue; }
    s.prompt = { kind: 'action', player: s.active };
    return;
  }
}

function exec(s: GameState, step: Step): void {
  switch (step.t) {
    case 'mulliganPrompt':
      s.prompt = { kind: 'mulligan', player: step.p };
      break;
    case 'setupPlantPrompt': {
      const count = Math.min(SETUP_TREATS, s.players[step.p].hand.length);
      if (count) s.prompt = { kind: 'setupPlant', player: step.p, count };
      break;
    }
    case 'plantPrompt':
      if (s.players[step.p].hand.length) s.prompt = { kind: 'plant', player: step.p };
      break;
    case 'discardCheck': {
      const over = s.players[step.p].hand.length - HAND_LIMIT;
      if (over > 0) s.prompt = { kind: 'discard', player: step.p, count: over };
      break;
    }
    case 'beginActions':
      s.passes = 0;
      s.active = s.yarn;
      continueTurn(s);
      break;
    case 'afterAction':
      s.active = other(s.active);
      continueTurn(s);
      break;
    case 'endRound':
      for (const pl of s.players) for (const u of pl.yard) { u.buffPower = 0; u.buffSneaky = false; u.buffGuardian = false; }
      s.queue.unshift(
        { t: 'discardCheck', p: s.yarn }, { t: 'discardCheck', p: other(s.yarn) }, { t: 'rollYarn' }, { t: 'startRound' },
      );
      break;
    case 'rollYarn':
      s.yarn = s.yarnTaken ?? other(s.yarn);
      s.yarnTaken = null;
      break;
    case 'startRound': {
      s.round++;
      if (s.round > MAX_ROUNDS) {
        const [a, b] = s.players.map((pl) => pl.lives.length);
        s.winner = a === b ? 'draw' : a > b ? 0 : 1;
        log(s, `Round limit reached.`);
        return;
      }
      log(s, `— Round ${s.round} —`);
      for (const pl of s.players) {
        pl.hero.exhausted = false;
        for (const t of pl.pantry) t.exhausted = false;
        for (const u of pl.yard) { u.exhausted = false; u.usedOnce = false; }
      }
      const first = s.yarn;
      const second = other(first);
      const steps: Step[] = [];
      for (const q of [first, second])
        if (s.players[q].yard.some((u) => u.id === GRANNY_SMITH))
          steps.push({ t: 'effect', p: q, effect: 'grannyHeal', sourceId: GRANNY_SMITH });
      steps.push(
        { t: 'draw', p: first, n: DRAW_PER_ROUND }, { t: 'draw', p: second, n: DRAW_PER_ROUND },
        { t: 'plantPrompt', p: first }, { t: 'plantPrompt', p: second }, { t: 'beginActions' },
      );
      s.queue.unshift(...steps);
      break;
    }
    case 'draw': {
      const pl = s.players[step.p];
      let missing = 0;
      for (let i = 0; i < step.n; i++) {
        const card = pl.deck.shift();
        if (card) pl.hand.push(card);
        else missing++;
      }
      if (missing) {
        log(s, `${pl.name}'s deck is empty!`, step.p);
        s.queue.unshift({ t: 'loseLife', p: step.p, n: missing });
      }
      break;
    }
    case 'loseLife': {
      const pl = s.players[step.p];
      const card = pl.lives.shift();
      if (!card) { s.winner = other(step.p); break; }
      pl.hand.push(card);
      log(s, `${pl.name} loses a Life — ${pl.lives.length} left.`, step.p);
      if (!pl.lives.length) {
        s.winner = other(step.p);
        log(s, `${s.players[s.winner].name} wins!`);
        break;
      }
      if (step.n > 1) s.queue.unshift({ t: 'loseLife', p: step.p, n: step.n - 1 });
      if (keywords(card.id).lucky && playOptions(s, step.p, card, 'lucky').length)
        s.prompt = { kind: 'lucky', player: step.p, uid: card.uid };
      break;
    }
    case 'resolvePlay':
      resolvePlay(s, step);
      break;
    case 'resolveAttack':
      resolveAttack(s);
      break;
    case 'effect':
      applyEffect(s, step.p, step.effect, step.target);
      break;
    case 'choosePrompt':
      if (targetsFor(s, step.p, step.spec).length)
        s.prompt = { kind: 'choose', player: step.p, effect: step.effect, spec: step.spec, sourceId: step.sourceId };
      break;
    case 'sanguine': {
      const found = findUnit(s, step.uid);
      if (found && !found.unit.usedOnce && !findUnit(s, step.foeUid)) {
        found.unit.usedOnce = true;
        found.unit.exhausted = false;
        log(s, `Sanguine readies after her victory.`, found.owner);
      }
      break;
    }
  }
}

function resolvePlay(s: GameState, step: Extract<Step, { t: 'resolvePlay' }>): void {
  if (step.closesWindow) s.window = null;
  const { p, card, target } = step;
  const pl = s.players[p];
  const def = CARDS[card.id];
  const b = behaviour(card.id);

  if (isUnitCard(card.id)) {
    if (pl.yard.length >= YARD_LIMIT || (def.type === 'Cat' && pl.yard.some((u) => u.id === card.id))) {
      pl.compost.push(card);
      log(s, `${cardName(card.id)} has no room in the Yard.`, p);
      return;
    }
    pl.yard.push({
      uid: card.uid, id: card.id, damage: 0, exhausted: !keywords(card.id).zoomies,
      buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false,
    });
    if (b.hello) {
      if (!b.hello.target) applyEffect(s, p, b.hello.effect, undefined);
      else if (isLegalTarget(s, p, b.hello.target, target, card.uid)) applyEffect(s, p, b.hello.effect, target);
    }
    return;
  }
  if (def.type === 'Toy') {
    const found = target?.kind === 'unit' ? findUnit(s, target.uid) : null;
    if (found && found.owner === p && !found.unit.toy) {
      found.unit.toy = card;
      log(s, `${cardName(card.id)} is attached to ${cardName(found.unit.id)}.`, p);
    } else {
      pl.compost.push(card);
    }
    return;
  }
  // Trick
  if (b.play) {
    if (!b.play.target) applyEffect(s, p, b.play.effect, undefined);
    else if (isLegalTarget(s, p, b.play.target, target)) applyEffect(s, p, b.play.effect, target);
    else if (b.play.optionalTarget && !target) applyEffect(s, p, b.play.effect, undefined);
    else log(s, `${cardName(card.id)} has no legal target and fizzles.`, p);
  }
  pl.compost.push(card);
}

function resolveAttack(s: GameState): void {
  const w = s.window;
  s.window = null;
  if (!w || w.kind !== 'attack') return;
  if (w.cancelled) { log(s, `The attack is cancelled!`); return; }
  const defender = other(w.by);

  const attackerUnit = w.attacker.kind === 'unit' ? findUnit(s, w.attacker.uid) : null;
  if (w.attacker.kind === 'unit' && !attackerUnit) { log(s, `The attacker is gone; the attack fizzles.`); return; }

  if (w.target.kind === 'hero') {
    const n = attackerFierce(s, w.attacker) ? 2 : 1;
    log(s, `Hit! ${s.players[defender].name} loses ${n} Li${n > 1 ? 'ves' : 'fe'}.`, w.by);
    s.queue.unshift({ t: 'loseLife', p: defender, n });
    return;
  }
  const targetUnit = findUnit(s, w.target.uid);
  if (!targetUnit) { log(s, `The target is gone; the attack fizzles.`); return; }

  const dealt = dealDamage(targetUnit.unit, attackerPower(s, w.attacker));
  let taken = 0;
  if (attackerUnit) taken = dealDamage(attackerUnit.unit, unitPower(targetUnit.unit));
  log(s, `${cardName(targetUnit.unit.id)} takes ${dealt}${attackerUnit ? `, ${cardName(attackerUnit.unit.id)} takes ${taken}` : ''}.`);

  if (attackerUnit?.unit.id === SANGUINE) s.queue.unshift({ t: 'sanguine', uid: attackerUnit.unit.uid, foeUid: targetUnit.unit.uid });
  if (targetUnit.unit.id === SANGUINE && attackerUnit) s.queue.unshift({ t: 'sanguine', uid: targetUnit.unit.uid, foeUid: attackerUnit.unit.uid });
}

function dealDamage(u: Unit, amount: number): number {
  const dealt = Math.max(0, amount - keywords(u.id).tough);
  u.damage += dealt;
  return dealt;
}

function heal(s: GameState, p: PlayerId, u: Unit | undefined, amount: number): void {
  if (!u) return;
  const healed = Math.min(u.damage, amount);
  u.damage -= healed;
  if (healed > 0) {
    const sakura = s.players[p].yard.find((x) => x.id === SAKURA && !x.usedOnce);
    if (sakura) {
      sakura.usedOnce = true;
      log(s, `Sakura draws a card.`, p);
      s.queue.unshift({ t: 'draw', p, n: 1 });
    }
  }
}

function applyEffect(s: GameState, p: PlayerId, effect: EffectKey, target: Target | undefined): void {
  const u = target?.kind === 'unit' ? findUnit(s, target.uid)?.unit : undefined;
  switch (effect) {
    case 'damage1': if (u) dealDamage(u, 1); break;
    case 'damage2': if (u) dealDamage(u, 2); break;
    case 'damage4': if (u) dealDamage(u, 4); break;
    case 'damageEachEnemy1': for (const e of s.players[other(p)].yard) dealDamage(e, 1); break;
    case 'heal2': heal(s, p, u, 2); break;
    case 'heal3': heal(s, p, u, 3); break;
    case 'heal3guard': heal(s, p, u, 3); if (u) u.buffGuardian = true; break;
    case 'heal3draw': heal(s, p, u, 3); s.queue.unshift({ t: 'draw', p, n: 1 }); break;
    case 'grannyHeal': for (const x of s.players[p].yard) heal(s, p, x, 1); break;
    case 'exhaustEnemy': if (u) u.exhausted = true; break;
    case 'readyOwn':
    case 'readyOther': if (u) u.exhausted = false; break;
    case 'buff1': if (u) u.buffPower += 1; break;
    case 'buff2': if (u) u.buffPower += 2; break;
    case 'buff2sneaky': if (u) { u.buffPower += 2; u.buffSneaky = true; } break;
    case 'draw1': s.queue.unshift({ t: 'draw', p, n: 1 }); break;
    case 'drawIfGuardian': if (s.players[p].yard.some(isGuardian)) s.queue.unshift({ t: 'draw', p, n: 1 }); break;
    case 'cancelAttack': if (s.window?.kind === 'attack') s.window.cancelled = true; break;
    case 'damage5': if (u) dealDamage(u, 5); break;
    case 'healEach2': for (const x of s.players[p].yard) heal(s, p, x, 2); break;
    case 'readyTreat1': readyTreats_(s, p, 1); break;
    case 'readyTreat2': readyTreats_(s, p, 2); break;
    case 'sprout1': sprout(s, p, 1); break;
    case 'sprout2': sprout(s, p, 2); break;
    case 'drawIfTreats7': if (s.players[p].pantry.length >= 7) s.queue.unshift({ t: 'draw', p, n: 2 }); break;
    case 'buff2readyTreat': if (u) u.buffPower += 2; readyTreats_(s, p, 1); break;
  }
}

function readyTreats_(s: GameState, p: PlayerId, n: number): void {
  let left = n;
  for (const t of s.players[p].pantry) if (left > 0 && t.exhausted) { t.exhausted = false; left--; }
}

/** Put the top cards of the deck into the Pantry as exhausted Treats (running out of deck just stops). */
function sprout(s: GameState, p: PlayerId, n: number): void {
  const pl = s.players[p];
  for (let i = 0; i < n && pl.deck.length; i++) pl.pantry.push({ card: pl.deck.shift()!, exhausted: true });
  log(s, `${pl.name} now has ${pl.pantry.length} Treats.`, p);
}

/** Rule 800.1: defeat units, flip Kittens whose Grow Up condition holds. */
function stateCheck(s: GameState): void {
  if (s.winner !== null) return;
  const triggers: Step[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const pl = s.players[owner];
    const dead = pl.yard.filter((u) => u.damage >= unitHealth(u));
    if (!dead.length) continue;
    pl.yard = pl.yard.filter((u) => !dead.includes(u));
    for (const u of dead) {
      if (u.toy) pl.compost.push(u.toy);
      pl.compost.push({ uid: u.uid, id: u.id });
      log(s, `${cardName(u.id)} is defeated.`, owner);
      const goodbye = behaviour(u.id).goodbye;
      if (goodbye) triggers.push({ t: 'choosePrompt', p: owner, effect: goodbye.effect, spec: goodbye.target, sourceId: u.id });
    }
  }
  if (triggers.length) s.queue.unshift(...triggers);
  for (const owner of [0, 1] as PlayerId[]) {
    const hero = s.players[owner].hero;
    if (!hero.grown && behaviour(hero.id).growUp?.(s, owner)) {
      hero.grown = true;
      log(s, `${s.players[owner].name}'s ${cardName(hero.id)} Grows Up into ${CARDS[hero.id].bigCat!.name}!`, owner);
    }
  }
}
