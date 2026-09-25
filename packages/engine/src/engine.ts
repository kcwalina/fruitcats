// The Fruitcats rules engine: a deterministic state machine that implements docs/rulebook.md §13.
//
//   registerSet(starterBox);                     // cards come from outside: see content/index.ts
//   const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 42 });
//   while (!s.winner) apply(s, pickOneOf(legalActions(s)));
//
// `apply` mutates the state in place (clone first with `structuredClone` to keep history). All
// randomness comes from the seed stored in the state, so a seed plus the action list replays a game.
//
// The engine knows the rules and a fixed vocabulary of card abilities (triggers, conditions, targets,
// actions: src/types.ts), never a particular card. Cards are data; what data can't express, a set's
// plugin adds as named conditions and actions (src/cards.ts, Plugin).

import {
  CARDS, MECHANICS, PLUGINS, abilitiesOf, abilityAt, deckCardIds, findAbility, isUnitCard, keywords, keywordsFrom,
  resolveDeck, setConditionEvaluator, type DeckList, type Keywords, type PluginContext,
} from './cards';
import type {
  Ability, AbilityRef, Act, Action, CardInst, Condition, GameEvent, GameState, PlayerId, PlayerState, Prompt, Step,
  Target, TargetSel, Unit, UnitFilter, Window,
} from './types';

/**
 * Bump when a change to the rules, the card data or the shape of GameState means a game saved by an
 * older build can no longer be continued (the web client throws such saves away).
 * 2: cards as data (unit counters and buffKeywords instead of ripe / buffSneaky / buffGuardian).
 */
export const RULES_VERSION = 2;

export const LIVES = 9;
export const DECK_SIZE = 50;
export const STARTING_HAND = 6;
export const SETUP_TREATS = 2;
export const DRAW_PER_ROUND = 2;
export const YARD_LIMIT = 6;
export const HAND_LIMIT = 10;
export const MAX_ROUNDS = 40;
/** Triggered abilities allowed in a row before the engine stops the chain (two cards triggering each other). */
export const TRIGGER_CHAIN_LIMIT = 200;
/** Kept for older callers: Orchard's Ripen cap and Tropical's Lush threshold now live in the Starter Box's data. */
export const RIPEN_MAX = 2;
export const LUSH_TREATS = 7;

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
  /** A registered deck's key ('zest-rush') or a whole deck list (a player's own deck). */
  decks: [string | DeckList, string | DeckList];
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
    events: [],
    actions: 0,
    startingYarn: 0,
  };
  for (const p of [0, 1] as PlayerId[]) {
    const list = resolveDeck(options.decks[p]);
    // Shuffle first, then number the cards: numbering the sorted deck list would let anyone who sees
    // a uid (an opponent's card in hand, say) work out which card it is.
    const ids = deckCardIds(list);
    shuffle(s, ids);
    const deck = ids.map((id) => ({ uid: s.nextUid++, id }));
    const lives = deck.splice(0, LIVES);
    const hand = deck.splice(0, STARTING_HAND);
    s.players[p] = {
      name: options.names?.[p] ?? `Player ${p + 1}`,
      deckName: list.name,
      hero: { id: list.hero, grown: false, exhausted: false },
      deck, hand, lives, pantry: [], yard: [], compost: [], playedThisRound: 0,
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

/** Record what happened for the screen to animate (`??=`: games saved before events existed). */
function emit(s: GameState, event: GameEvent): void {
  (s.events ??= []).push(event);
}

// ── Queries: units ───────────────────────────────────────────────────────────────────────────────

export function findUnit(s: GameState, uid: number): { unit: Unit; owner: PlayerId } | null {
  for (const owner of [0, 1] as PlayerId[]) {
    const unit = s.players[owner].yard.find((u) => u.uid === uid);
    if (unit) return { unit, owner };
  }
  return null;
}

interface Grant { power: number; health: number; keywords: string[] }

/** What a Toy gives the unit it's attached to. */
function toyGrant(u: Unit): Grant {
  const g: Grant = { power: 0, health: 0, keywords: [] };
  if (!u.toy) return g;
  for (const a of abilitiesOf(u.toy.id)) {
    if (a.static?.to !== 'attached' || !a.static.grant) continue;
    g.power += a.static.grant.power ?? 0;
    g.health += a.static.grant.health ?? 0;
    g.keywords.push(...(a.static.grant.keywords ?? []));
  }
  return g;
}

/** A unit's keywords before any aura: printed, from its Toy, and granted this round. */
function baseKeywordList(u: Unit): string[] {
  return [...keywords(u.id).all, ...toyGrant(u).keywords, ...(u.buffKeywords ?? [])];
}

/** The lasting effects in play that reach this unit: its own "while…" grants and other cards' auras. */
function auraGrant(s: GameState, u: Unit): Grant {
  const g: Grant = { power: 0, health: 0, keywords: [] };
  const found = findUnit(s, u.uid);
  if (!found) return g;
  const add = (grant: NonNullable<NonNullable<Ability['static']>['grant']>) => {
    g.power += grant.power ?? 0;
    g.health += grant.health ?? 0;
    g.keywords.push(...(grant.keywords ?? []));
  };
  for (const q of [0, 1] as PlayerId[]) {
    const sources: { abilities: Ability[]; uid?: number }[] = s.players[q].yard.map((x) => ({ abilities: abilitiesOf(x.id), uid: x.uid }));
    const hero = s.players[q].hero;
    sources.push({ abilities: abilitiesOf(hero.id, hero.grown ? 'bigCat' : 'kitten') });
    for (const src of sources) {
      for (const a of src.abilities) {
        const st = a.static;
        if (!st?.grant || st.to === 'attached') continue;
        if (st.to === 'self' || st.to === undefined) {
          if (src.uid !== u.uid) continue;
        } else if (!matchesUnit(s, q, u, found.owner, { each: st.to.each, other: st.to.other, filter: st.to.filter }, src.uid, true)) {
          continue;
        }
        if (st.while !== undefined && !evaluateCondition(s, q, st.while)) continue;
        add(st.grant);
      }
    }
  }
  return g;
}

/** Power from a unit's counters (Ripen's ripeness, Heat), as each mechanic prices a point of it. */
function counterBonus(u: Unit): { power: number; health: number } {
  const bonus = { power: 0, health: 0 };
  for (const [name, n] of Object.entries(u.counters ?? {})) {
    for (const m of Object.values(MECHANICS)) {
      if (m.counter?.name !== name) continue;
      bonus.power += n * (m.counter.power ?? 0);
      bonus.health += n * (m.counter.health ?? 0);
    }
  }
  return bonus;
}

/**
 * A unit's Power: its card's, plus its Toy, counters and this round's buffs, plus auras in play.
 * Pass the game state to include auras (Ancho's +1 for Heat units); without it they're left out.
 */
export function unitPower(u: Unit, s?: GameState): number {
  const aura = s ? auraGrant(s, u).power : 0;
  return Math.max(0, (CARDS[u.id]?.power ?? 0) + toyGrant(u).power + counterBonus(u).power + u.buffPower + aura);
}

export function unitHealth(u: Unit, s?: GameState): number {
  const aura = s ? auraGrant(s, u).health : 0;
  return (CARDS[u.id]?.health ?? 0) + toyGrant(u).health + counterBonus(u).health + aura;
}

/**
 * Everything a unit is right now: printed keywords, its Toy's, this round's, and auras (with a state).
 * `thisRound: false` leaves out this round's buffs (the bot values a unit by what lasts).
 */
export function unitKeywords(u: Unit, s?: GameState, thisRound = true): Keywords {
  const lasting = [...keywords(u.id).all, ...toyGrant(u).keywords];
  const list = [...lasting, ...(thisRound ? u.buffKeywords ?? [] : []), ...(s ? auraGrant(s, u).keywords : [])];
  return keywordsFrom([...new Set(list)]);
}

export const isGuardian = (u: Unit, s?: GameState): boolean => unitKeywords(u, s).guardian;
export const isSneaky = (u: Unit, s?: GameState): boolean => unitKeywords(u, s).sneaky;

export const heroSide = (s: GameState, p: PlayerId) => {
  const hero = s.players[p].hero;
  return hero.grown ? CARDS[hero.id].bigCat! : CARDS[hero.id].kitten!;
};

export const readyTreats = (s: GameState, p: PlayerId): number =>
  s.players[p].pantry.filter((t) => !t.exhausted).length;

/** Kept for older callers: the Starter Box's Zest and Lush conditions, false while that set isn't loaded. */
export const hasZest = (s: GameState, p: PlayerId): boolean => evaluateCondition(s, p, 'Zest');
export const isLush = (s: GameState, p: PlayerId): boolean => evaluateCondition(s, p, 'Lush');

function attackerPower(s: GameState, attacker: Target): number {
  if (attacker.kind === 'hero') return heroSide(s, attacker.player).power ?? 0;
  const found = findUnit(s, attacker.uid);
  return found ? unitPower(found.unit, s) : 0;
}

function attackerFierce(s: GameState, attacker: Target): boolean {
  if (attacker.kind === 'hero') return !!heroSide(s, attacker.player).keywords?.includes('Fierce');
  const found = findUnit(s, attacker.uid);
  return !!found && unitKeywords(found.unit, s).fierce;
}

// ── Conditions ───────────────────────────────────────────────────────────────────────────────────

interface AbilityContext {
  target?: Target;
  target2?: Target;
  self?: Unit;
}

/** Whether a condition holds for player p. Names are set mechanics (Zest), plugins' conditions, or built in. */
export function evaluateCondition(s: GameState, p: PlayerId, c: Condition, ctx: AbilityContext = {}): boolean {
  if (typeof c === 'string') {
    if (c === 'targetIsYours') return ctx.target?.kind === 'unit' && findUnit(s, ctx.target.uid)?.owner === p;
    const mechanic = MECHANICS[c];
    if (mechanic?.if !== undefined) return evaluateCondition(s, p, mechanic.if, ctx);
    for (const plugin of PLUGINS) {
      const f = plugin.conditions?.[c];
      if (f) return f(pluginContext(s, p, ctx.self, ctx.self), undefined);
    }
    return false;
  }
  const me = s.players[p];
  if ('not' in c) return !evaluateCondition(s, p, c.not, ctx);
  if ('playedThisRound' in c) return (me.playedThisRound ?? 0) >= c.playedThisRound.atLeast;
  if ('treats' in c) return me.pantry.length >= c.treats.atLeast;
  if ('lives' in c) return me.lives.length <= c.lives.atMost;
  if ('opponentLives' in c) return s.players[other(p)].lives.length <= c.opponentLives.atMost;
  if ('yardHas' in c) return me.yard.some((u) => unitKeywords(u, s).all.includes(c.yardHas.keyword));
  if ('unitsInComposts' in c) return s.players.reduce((n, pl) => n + pl.compost.filter((x) => isUnitCard(x.id)).length, 0) >= c.unitsInComposts.atLeast;
  if ('compost' in c) return me.compost.length >= c.compost.atLeast;
  if ('controlUnits' in c) return me.yard.length >= c.controlUnits.atLeast;
  if ('unitHasCounter' in c) {
    const { whose, name, atLeast } = c.unitHasCounter;
    const players = whose === 'own' ? [p] : whose === 'enemy' ? [other(p)] : [p, other(p)];
    return players.some((q) => s.players[q].yard.some((u) => (u.counters?.[name] ?? 0) >= atLeast));
  }
  return false;
}
setConditionEvaluator((s, p, c) => evaluateCondition(s, p, c));

// ── Targets ──────────────────────────────────────────────────────────────────────────────────────

type UnitSel = Extract<TargetSel, { unit: unknown }>;
type EachSel = Extract<TargetSel, { each: unknown }>;
const isUnitSel = (sel: TargetSel | undefined): sel is UnitSel => typeof sel === 'object' && 'unit' in sel;
const isEachSel = (sel: TargetSel | undefined): sel is EachSel => typeof sel === 'object' && 'each' in sel;

function passesFilter(u: Unit, f: UnitFilter | undefined): boolean {
  if (!f) return true;
  if (f.exhausted !== undefined && u.exhausted !== f.exhausted) return false;
  if (f.damaged !== undefined && (u.damage > 0) !== f.damaged) return false;
  if (f.noToy && u.toy) return false;
  // Auras aren't counted here, so an aura that picks units by keyword can't depend on itself.
  if (f.keyword && !baseKeywordList(u).includes(f.keyword)) return false;
  if (f.counter && (u.counters?.[f.counter.name] ?? 0) < f.counter.atLeast) return false;
  return true;
}

/** Whether unit u (owned by `owner`) is one that a selector means, from player p's side. */
function matchesUnit(
  s: GameState, p: PlayerId, u: Unit, owner: PlayerId,
  sel: { unit?: string; each?: string; other?: boolean; filter?: UnitFilter }, selfUid?: number, noState = false,
): boolean {
  void s; void noState;
  const who = sel.unit ?? sel.each;
  const own = owner === p;
  if ((who === 'own' && !own) || (who === 'enemy' && own)) return false;
  if ((who === 'allOther' || sel.other) && u.uid === selfUid) return false;
  return passesFilter(u, sel.filter);
}

/** The units a player may choose for a "choose a unit" selector (`excludeUid`: the ability's own unit). */
export function targetsFor(s: GameState, p: PlayerId, sel: TargetSel, excludeUid?: number): Target[] {
  if (!isUnitSel(sel)) return [];
  const result: Target[] = [];
  for (const owner of [0, 1] as PlayerId[])
    for (const u of s.players[owner].yard)
      if (matchesUnit(s, p, u, owner, sel, excludeUid)) result.push({ kind: 'unit', uid: u.uid });
  return result;
}

/** Every unit an "each…" selector reaches. */
function eachUnit(s: GameState, p: PlayerId, sel: EachSel, selfUid?: number): Unit[] {
  const units: Unit[] = [];
  for (const owner of [0, 1] as PlayerId[])
    for (const u of s.players[owner].yard) if (matchesUnit(s, p, u, owner, sel, selfUid)) units.push(u);
  return units;
}

const sameTarget = (a?: Target, b?: Target): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'unit' ? a.uid === (b as typeof a).uid : a.player === (b as typeof a).player);

function isLegalTarget(s: GameState, p: PlayerId, sel: TargetSel, target: Target | undefined, excludeUid?: number): boolean {
  return !!target && targetsFor(s, p, sel, excludeUid).some((t) => sameTarget(t, target));
}

/** The ability that playing a card starts: a Trick's "play", a unit's Hello. */
function mainAbility(id: string): { ability: Ability; ref: AbilityRef } | null {
  const type = CARDS[id]?.type;
  if (type === 'Trick') return findAbility(id, 'play');
  if (isUnitCard(id)) return findAbility(id, 'hello');
  return null;
}

/** One way to play a card: its chosen target(s), if any. */
export interface PlayChoice { target?: Target; target2?: Target }

/**
 * The ways a card in hand can be played right now. Empty means it can't be played. `mode` is how:
 * a normal action, in a Pounce window, or free via Lucky.
 */
export function playChoices(s: GameState, p: PlayerId, card: CardInst, mode: 'action' | 'pounce' | 'lucky'): PlayChoice[] {
  const def = CARDS[card.id];
  const k = keywords(card.id);
  const main = mainAbility(card.id)?.ability;
  if (mode === 'pounce' && !k.pounce) return [];
  if (mode === 'action' && main?.pounceOnly) return [];
  if (mode === 'pounce' && main?.pounceOnly === 'attack' && s.window?.kind !== 'attack') return [];
  if (mode !== 'lucky' && (def.cost ?? 0) > readyTreats(s, p)) return [];
  const yard = s.players[p].yard;

  if (isUnitCard(card.id)) {
    if (yard.length >= YARD_LIMIT) return [];
    if (def.type === 'Cat' && yard.some((u) => u.id === card.id)) return [];
    if (!isUnitSel(main?.target)) return [{}];
    const targets = targetsFor(s, p, main!.target!).map((target) => ({ target }));
    if (main!.optional) return [{}, ...targets];
    return targets.length ? targets : [{}];
  }
  if (def.type === 'Toy') return targetsFor(s, p, { unit: 'own', filter: { noToy: true } }).map((target) => ({ target }));
  // Trick
  if (!isUnitSel(main?.target)) return [{}];
  const firsts = targetsFor(s, p, main!.target!);
  let choices: PlayChoice[] = firsts.map((target) => ({ target }));
  if (isUnitSel(main!.target2)) {
    const seconds = targetsFor(s, p, main!.target2);
    choices = firsts.flatMap((target) => seconds.filter((t2) => !sameTarget(t2, target)).map((target2) => ({ target, target2 })));
  }
  if (choices.length) return choices;
  return main!.optionalTarget ? [{}] : [];
}

/** The targets a card can be played on (the first target of each way to play it). */
export function playOptions(s: GameState, p: PlayerId, card: CardInst, mode: 'action' | 'pounce' | 'lucky'): (Target | undefined)[] {
  return playChoices(s, p, card, mode).map((c) => c.target);
}

function withChoice<T extends object>(action: T, c: PlayChoice): T {
  return { ...action, ...(c.target ? { target: c.target } : {}), ...(c.target2 ? { target2: c.target2 } : {}) };
}

/** Whether a unit is barred from attacking right now (Lychee Sloth unless you're Lush). */
function cantAttack(s: GameState, owner: PlayerId, u: Unit): boolean {
  return abilitiesOf(u.id).some((a) => a.static?.cantAttack && (a.static.while === undefined || evaluateCondition(s, owner, a.static.while)));
}

function attackOptions(s: GameState, p: PlayerId): Action[] {
  const me = s.players[p];
  const foe = s.players[other(p)];
  const attackers: { ref: Target; sneaky: boolean }[] = me.yard
    .filter((u) => !u.exhausted && !cantAttack(s, p, u))
    .map((u) => ({ ref: { kind: 'unit', uid: u.uid }, sneaky: isSneaky(u, s) }));
  if (me.hero.grown && !me.hero.exhausted) attackers.push({ ref: { kind: 'hero', player: p }, sneaky: false });

  const guardians = foe.yard.filter((u) => isGuardian(u, s));
  const actions: Action[] = [];
  for (const a of attackers) {
    const pool = guardians.length && !a.sneaky ? guardians : foe.yard;
    for (const u of pool) actions.push({ t: 'attack', attacker: a.ref, target: { kind: 'unit', uid: u.uid } });
    if (!guardians.length || a.sneaky) actions.push({ t: 'attack', attacker: a.ref, target: { kind: 'hero', player: other(p) } });
  }
  return actions;
}

/** The Hero Cat's "exhaust" ability on the face it shows now. */
function heroAbility(s: GameState, p: PlayerId): { ability: Ability; ref: AbilityRef } | null {
  const hero = s.players[p].hero;
  return findAbility(hero.id, 'exhaust', hero.grown ? 'bigCat' : 'kitten');
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
        for (const c of playChoices(s, p, card, 'action')) actions.push(withChoice({ t: 'play', uid: card.uid }, c));
      actions.push(...attackOptions(s, p));
      if (!me.hero.exhausted) {
        const found = heroAbility(s, p);
        const ability = found?.ability;
        // Don't offer an ability that would do nothing (readying Treats when none are spent).
        const pointless = !!ability?.do?.length && ability.do.every((a) => 'readyTreats' in a) && !me.pantry.some((t) => t.exhausted);
        if (ability && isUnitSel(ability.target)) for (const target of targetsFor(s, p, ability.target)) actions.push({ t: 'ability', target });
        else if (ability && !pointless) actions.push({ t: 'ability' });
      }
      if (s.yarnTaken === null) actions.push({ t: 'takeYarn' });
      actions.push({ t: 'pass' });
      return actions;
    }
    case 'pounce': {
      const actions: Action[] = [];
      for (const card of me.hand)
        for (const c of playChoices(s, p, card, 'pounce')) actions.push(withChoice({ t: 'pounce', uid: card.uid }, c));
      actions.push({ t: 'decline' });
      return actions;
    }
    case 'lucky': {
      const card = me.hand.find((c) => c.uid === prompt.uid)!;
      return [...playChoices(s, p, card, 'lucky').map((c) => withChoice({ t: 'lucky' } as Action, c)), { t: 'keepLucky' }];
    }
    case 'choose':
      return targetsFor(s, p, prompt.spec, prompt.selfUid).map((target): Action => ({ t: 'choose', target }));
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

const describeTargets = (s: GameState, a: { target?: Target; target2?: Target }) =>
  a.target2 ? `${describeTarget(s, a.target)} and ${describeTarget(s, a.target2)}` : describeTarget(s, a.target);

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
  s.chain = 0;

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
      me.playedThisRound = (me.playedThisRound ?? 0) + 1;
      s.passes = 0;
      log(s, `${me.name} plays ${cardName(card.id)}${action.target ? ` targeting ${describeTargets(s, action)}` : ''}.`, p);
      emit(s, { t: 'play', p, uid: card.uid, cardId: card.id, target: action.target });
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, target2: action.target2, closesWindow: true }, { t: 'afterAction' });
      openWindow(s, { kind: 'play', by: p, card, target: action.target, target2: action.target2 });
      break;
    }
    case 'attack': {
      if (action.attacker.kind === 'hero') me.hero.exhausted = true;
      else findUnit(s, action.attacker.uid)!.unit.exhausted = true;
      s.passes = 0;
      log(s, `${me.name}'s ${describeTarget(s, action.attacker).replace(`${me.name}'s `, '')} attacks ${describeTarget(s, action.target)}.`, p);
      emit(s, { t: 'attack', p, attacker: action.attacker, target: action.target });
      s.queue.unshift({ t: 'resolveAttack' }, { t: 'afterAction' });
      openWindow(s, { kind: 'attack', by: p, attacker: action.attacker, target: action.target, cancelled: false });
      break;
    }
    case 'ability': {
      me.hero.exhausted = true;
      s.passes = 0;
      const { ref } = heroAbility(s, p)!;
      log(s, `${me.name}'s ${cardName(me.hero.id)} uses their ability${action.target ? ` on ${describeTarget(s, action.target)}` : ''}.`, p);
      emit(s, { t: 'ability', p, heroId: me.hero.id, target: action.target });
      s.queue.unshift({ t: 'ability', p, ref, target: action.target, sourceId: me.hero.id }, { t: 'afterAction' });
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
      me.playedThisRound = (me.playedThisRound ?? 0) + 1;
      log(s, `${me.name} POUNCES with ${cardName(card.id)}${action.target ? ` on ${describeTargets(s, action)}` : ''}!`, p);
      emit(s, { t: 'play', p, uid: card.uid, cardId: card.id, how: 'pounce', target: action.target });
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, target2: action.target2, closesWindow: false });
      break;
    }
    case 'decline':
      break;
    case 'lucky': {
      const card = takeFromHand(s, p, (prompt as { uid: number }).uid);
      me.playedThisRound = (me.playedThisRound ?? 0) + 1;
      log(s, `Lucky! ${me.name} plays ${cardName(card.id)} for free.`, p);
      emit(s, { t: 'play', p, uid: card.uid, cardId: card.id, how: 'lucky', target: action.target });
      s.queue.unshift({ t: 'resolvePlay', p, card, target: action.target, target2: action.target2, closesWindow: false });
      break;
    }
    case 'keepLucky':
      break;
    case 'choose': {
      const pr = prompt as Extract<Prompt, { kind: 'choose' }>;
      s.queue.unshift({ t: 'ability', p, ref: pr.ref, target: action.target, sourceId: pr.sourceId, selfUid: pr.selfUid, trigger: true });
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
  const canPounce = s.players[defender].hand.some((c) => playChoices(s, defender, c, 'pounce').length > 0);
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

/** Every ability a unit has with this trigger: its card's, and its keywords' mechanics' (Ripen, Heat). */
function unitAbilities(s: GameState, u: Unit, when: string, inline?: boolean): { ability: Ability; ref: AbilityRef }[] {
  const out: { ability: Ability; ref: AbilityRef }[] = [];
  abilitiesOf(u.id).forEach((ability, index) => {
    if (ability.when === when && !!ability.inline === !!inline) out.push({ ability, ref: { card: u.id, index } });
  });
  for (const kw of unitKeywords(u, s).all) {
    (MECHANICS[kw]?.abilities ?? []).forEach((ability, index) => {
      if (ability.when === when && !!ability.inline === !!inline) out.push({ ability, ref: { mechanic: kw, index } });
    });
  }
  return out;
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
      for (const pl of s.players) for (const u of pl.yard) { u.buffPower = 0; delete u.buffKeywords; }
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
        emit(s, { t: 'win', p: s.winner });
        return;
      }
      log(s, `— Round ${s.round} —`);
      emit(s, { t: 'round', n: s.round });
      for (const [q, pl] of s.players.entries()) {
        pl.hero.exhausted = false;
        pl.playedThisRound = 0;
        for (const t of pl.pantry) t.exhausted = false;
        for (const u of pl.yard) {
          u.exhausted = false;
          u.usedOnce = false;
          // Start-of-round abilities that happen as the unit readies (Ripen).
          for (const { ability } of unitAbilities(s, u, 'roundStart', true)) runAbility(s, q as PlayerId, ability, { self: u });
        }
      }
      const first = s.yarn;
      const second = other(first);
      const steps: Step[] = [];
      for (const q of [first, second])
        for (const u of s.players[q].yard)
          for (const { ref } of unitAbilities(s, u, 'roundStart')) steps.push({ t: 'ability', p: q, ref, sourceId: u.id, selfUid: u.uid, trigger: true });
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
      if (step.n > missing) emit(s, { t: 'draw', p: step.p, n: step.n - missing });
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
      emit(s, { t: 'lifeLost', p: step.p, left: pl.lives.length });
      if (!pl.lives.length) {
        s.winner = other(step.p);
        log(s, `${s.players[s.winner].name} wins!`);
        emit(s, { t: 'win', p: s.winner });
        break;
      }
      if (step.n > 1) s.queue.unshift({ t: 'loseLife', p: step.p, n: step.n - 1 });
      if (keywords(card.id).lucky && playChoices(s, step.p, card, 'lucky').length)
        s.prompt = { kind: 'lucky', player: step.p, uid: card.uid };
      break;
    }
    case 'resolvePlay':
      resolvePlay(s, step);
      break;
    case 'resolveAttack':
      resolveAttack(s);
      break;
    case 'ability': {
      const ability = abilityAt(step.ref);
      if (!ability) break;
      if (step.trigger) {
        s.chain = (s.chain ?? 0) + 1;
        if (s.chain > TRIGGER_CHAIN_LIMIT) {
          if (s.chain === TRIGGER_CHAIN_LIMIT + 1) log(s, `The chain of effects stops here.`);
          break;
        }
      }
      let self: Unit | undefined;
      if (step.selfUid !== undefined) {
        self = findUnit(s, step.selfUid)?.unit;
        // "…and survives": a unit defeated by the damage has no trigger left to run.
        if (!self && ability.when === 'damagedAndSurvives') break;
      }
      runAbility(s, step.p, ability, { target: step.target, target2: step.target2, self });
      break;
    }
    case 'choosePrompt':
      if (targetsFor(s, step.p, step.spec, step.selfUid).length)
        s.prompt = { kind: 'choose', player: step.p, ref: step.ref, spec: step.spec, sourceId: step.sourceId, selfUid: step.selfUid };
      break;
    case 'combatWin': {
      const found = findUnit(s, step.uid);
      if (!found || findUnit(s, step.foeUid)) break;
      for (const { ability } of unitAbilities(s, found.unit, 'defeatsInCombat')) {
        if (ability.oncePerRound) {
          if (found.unit.usedOnce) continue;
          found.unit.usedOnce = true;
        }
        runAbility(s, found.owner, ability, { self: found.unit });
      }
      break;
    }
  }
}

function resolvePlay(s: GameState, step: Extract<Step, { t: 'resolvePlay' }>): void {
  if (step.closesWindow) s.window = null;
  const { p, card, target, target2 } = step;
  const pl = s.players[p];
  const def = CARDS[card.id];
  const main = mainAbility(card.id)?.ability;

  if (isUnitCard(card.id)) {
    if (pl.yard.length >= YARD_LIMIT || (def.type === 'Cat' && pl.yard.some((u) => u.id === card.id))) {
      pl.compost.push(card);
      log(s, `${cardName(card.id)} has no room in the Yard.`, p);
      return;
    }
    const unit: Unit = { uid: card.uid, id: card.id, damage: 0, exhausted: !keywords(card.id).zoomies, buffPower: 0, usedOnce: false };
    pl.yard.push(unit);
    if (main) {
      if (!isUnitSel(main.target)) runAbility(s, p, main, { self: unit });
      else if (isLegalTarget(s, p, main.target, target, card.uid)) runAbility(s, p, main, { target, self: unit });
    }
    return;
  }
  if (def.type === 'Toy') {
    const found = target?.kind === 'unit' ? findUnit(s, target.uid) : null;
    if (found && found.owner === p && !found.unit.toy) {
      found.unit.toy = card;
      log(s, `${cardName(card.id)} is attached to ${cardName(found.unit.id)}.`, p);
      emit(s, { t: 'toy', uid: found.unit.uid, cardId: card.id });
    } else {
      pl.compost.push(card);
    }
    return;
  }
  // Trick
  if (main) {
    const legal = !isUnitSel(main.target) ||
      (isLegalTarget(s, p, main.target, target) && (!isUnitSel(main.target2) || isLegalTarget(s, p, main.target2, target2)));
    if (legal) runAbility(s, p, main, { target, target2 });
    else if (main.optionalTarget && !target) runAbility(s, p, main, {});
    else {
      log(s, `${cardName(card.id)} has no legal target and fizzles.`, p);
      emit(s, { t: 'fizzled', cardId: card.id });
    }
  }
  pl.compost.push(card);
}

function resolveAttack(s: GameState): void {
  const w = s.window;
  s.window = null;
  if (!w || w.kind !== 'attack') return;
  if (w.cancelled) { log(s, `The attack is cancelled!`); emit(s, { t: 'cancelled', attacker: w.attacker }); return; }
  const defender = other(w.by);

  const attackerUnit = w.attacker.kind === 'unit' ? findUnit(s, w.attacker.uid) : null;
  if (w.attacker.kind === 'unit' && !attackerUnit) {
    log(s, `The attacker is gone; the attack fizzles.`);
    emit(s, { t: 'fizzled', attacker: w.attacker });
    return;
  }

  if (w.target.kind === 'hero') {
    const n = attackerFierce(s, w.attacker) ? 2 : 1;
    log(s, `Hit! ${s.players[defender].name} loses ${n} Li${n > 1 ? 'ves' : 'fe'}.`, w.by);
    emit(s, { t: 'heroHit', attacker: w.attacker, p: defender, lives: n });
    s.queue.unshift({ t: 'loseLife', p: defender, n });
    return;
  }
  const targetUnit = findUnit(s, w.target.uid);
  if (!targetUnit) {
    log(s, `The target is gone; the attack fizzles.`);
    emit(s, { t: 'fizzled', attacker: w.attacker });
    return;
  }

  // Both strike at once: each deals the Power it has before either is hurt.
  const attackPower = attackerPower(s, w.attacker);
  const backPower = unitPower(targetUnit.unit, s);
  const dealt = dealDamage(s, targetUnit.unit, attackPower);
  let taken = 0;
  if (attackerUnit) taken = dealDamage(s, attackerUnit.unit, backPower);
  log(s, `${cardName(targetUnit.unit.id)} takes ${dealt}${attackerUnit ? `, ${cardName(attackerUnit.unit.id)} takes ${taken}` : ''}.`);
  emit(s, { t: 'clash', attacker: w.attacker, target: targetUnit.unit.uid, dealt, taken });

  if (attackerUnit && unitAbilities(s, attackerUnit.unit, 'defeatsInCombat').length)
    s.queue.unshift({ t: 'combatWin', uid: attackerUnit.unit.uid, foeUid: targetUnit.unit.uid });
  if (attackerUnit && unitAbilities(s, targetUnit.unit, 'defeatsInCombat').length)
    s.queue.unshift({ t: 'combatWin', uid: targetUnit.unit.uid, foeUid: attackerUnit.unit.uid });
  if (taken && attackerUnit) queueDamaged(s, attackerUnit.unit);
  if (dealt) queueDamaged(s, targetUnit.unit);
}

/** Deal damage to a unit (Tough reduces it); returns what it took. */
function dealDamage(s: GameState, u: Unit, amount: number): number {
  const dealt = Math.max(0, amount - unitKeywords(u, s).tough);
  u.damage += dealt;
  return dealt;
}

/** After a unit is dealt damage: its "damaged and survives" abilities, which run once the state is checked. */
function queueDamaged(s: GameState, u: Unit): void {
  const owner = findUnit(s, u.uid)?.owner;
  if (owner === undefined) return;
  const steps: Step[] = unitAbilities(s, u, 'damagedAndSurvives')
    .map(({ ref }) => ({ t: 'ability', p: owner, ref, sourceId: u.id, selfUid: u.uid, trigger: true }));
  if (steps.length) s.queue.unshift(...steps);
}

function heal(s: GameState, p: PlayerId, u: Unit | undefined, amount: number): void {
  if (!u) return;
  const healed = Math.min(u.damage, amount);
  u.damage -= healed;
  if (healed <= 0) return;
  emit(s, { t: 'heal', uid: u.uid, amount: healed });
  // "When you heal": the healer's units that care (Sakura).
  for (const x of s.players[p].yard) {
    for (const { ability } of unitAbilities(s, x, 'youHeal')) {
      if (ability.oncePerRound) {
        if (x.usedOnce) continue;
        x.usedOnce = true;
      }
      runAbility(s, p, ability, { self: x });
    }
  }
}

// ── Running abilities ────────────────────────────────────────────────────────────────────────────

function pluginContext(s: GameState, p: PlayerId, unit: Unit | undefined, self: Unit | undefined): PluginContext {
  return {
    s, p, unit, self,
    log: (text) => log(s, text, p),
    damage: (u, amount) => hurt(s, p, u, amount),
    heal: (u, amount) => heal(s, p, u, amount),
    draw: (n) => s.queue.unshift({ t: 'draw', p, n }),
  };
}

/** Log a mechanic condition's name when it pays off, as the Starter Box always has ("Zest!"). */
function shout(s: GameState, p: PlayerId, c: Condition | undefined): void {
  if (typeof c === 'string' && MECHANICS[c]?.kind === 'condition') log(s, `${c}!`, p);
}

/**
 * Run an ability: check its condition, pick its better version if one applies, find what it acts on,
 * then do each of its actions in order.
 */
function runAbility(s: GameState, p: PlayerId, ability: Ability, ctx: AbilityContext): void {
  if (ability.if !== undefined) {
    if (!evaluateCondition(s, p, ability.if, ctx)) return;
    shout(s, p, ability.if);
  }
  let acts: Act[] = ability.do ?? [];
  if (ability.instead && evaluateCondition(s, p, ability.instead.if, ctx)) {
    shout(s, p, ability.instead.if);
    acts = ability.instead.do;
  }
  if (ability.log) log(s, ability.log, p);

  const sel = ability.target;
  let units: Unit[] = [];
  if (sel === 'self') units = ctx.self ? [ctx.self] : [];
  else if (isUnitSel(sel)) {
    const found = ctx.target?.kind === 'unit' ? findUnit(s, ctx.target.uid) : null;
    units = found ? [found.unit] : [];
  } else if (isEachSel(sel)) units = eachUnit(s, p, sel, ctx.self?.uid);

  for (const act of acts) doAct(s, p, act, units, ctx);
}

function doAct(s: GameState, p: PlayerId, act: Act, units: Unit[], ctx: AbilityContext): void {
  const [name, value] = Object.entries(act)[0] ?? [];
  switch (name) {
    case 'damage': for (const u of units) hurt(s, p, u, value as number); return;
    case 'heal': for (const u of units) heal(s, p, u, value as number); return;
    case 'buff': {
      const b = value as { power?: number; keywords?: string[] };
      for (const u of units) {
        if (b.power) u.buffPower += b.power;
        if (b.keywords?.length) u.buffKeywords = [...(u.buffKeywords ?? []), ...b.keywords];
        const e: GameEvent = { t: 'buff', uid: u.uid };
        if (b.power) e.power = b.power;
        if (b.keywords?.includes('Sneaky')) e.sneaky = true;
        if (b.keywords?.includes('Guardian')) e.guardian = true;
        emit(s, e);
      }
      return;
    }
    case 'counter': {
      const c = value as { name: string; add: number; max?: number };
      for (const u of units) {
        const now = u.counters?.[c.name] ?? 0;
        const next = c.max === undefined ? now + c.add : Math.min(c.max, now + c.add);
        if (next === now) continue;
        u.counters = { ...u.counters, [c.name]: next };
        const template = Object.values(MECHANICS).find((m) => m.counter?.name === c.name)?.counter?.log;
        if (template) log(s, template.replace(/\{name\}/g, cardName(u.id)).replace(/\{n\}/g, String(next)), findUnit(s, u.uid)?.owner);
        emit(s, { t: 'counter', uid: u.uid, name: c.name, value: next });
      }
      return;
    }
    case 'draw': s.queue.unshift({ t: 'draw', p, n: value as number }); return;
    case 'exhaust': for (const u of units) { u.exhausted = true; emit(s, { t: 'exhaust', uid: u.uid }); } return;
    case 'ready': for (const u of units) { u.exhausted = false; emit(s, { t: 'ready', uid: u.uid }); } return;
    case 'readyTreats': {
      let left = value as number;
      for (const t of s.players[p].pantry) if (left > 0 && t.exhausted) { t.exhausted = false; left--; }
      return;
    }
    case 'sprout': {
      // The top cards of the deck become exhausted Treats (running out of deck just stops).
      const pl = s.players[p];
      for (let i = 0; i < (value as number) && pl.deck.length; i++) pl.pantry.push({ card: pl.deck.shift()!, exhausted: true });
      log(s, `${pl.name} now has ${pl.pantry.length} Treats.`, p);
      return;
    }
    case 'summon': summon(s, p, value as string); return;
    case 'cancelAttack': if (s.window?.kind === 'attack') s.window.cancelled = true; return;
    case 'fight': fight(s, p, ctx); return;
  }
  for (const plugin of PLUGINS) {
    const f = plugin.actions?.[name ?? ''];
    if (!f) continue;
    if (units.length) for (const u of units) f(pluginContext(s, p, u, ctx.self), value);
    else f(pluginContext(s, p, undefined, ctx.self), value);
    return;
  }
  throw new Error(`Unknown card action '${name}': is the plugin for its set registered?`);
}

/** Damage from a card or ability (not combat, which `resolveAttack` reports as one clash). */
function hurt(s: GameState, p: PlayerId, u: Unit, amount: number): void {
  const dealt = dealDamage(s, u, amount);
  emit(s, { t: 'damage', uid: u.uid, amount: dealt, p });
  if (dealt) queueDamaged(s, u);
}

/** Put a token into the player's Yard (nothing happens if the Yard is full). */
function summon(s: GameState, p: PlayerId, id: string): void {
  const pl = s.players[p];
  if (!CARDS[id] || pl.yard.length >= YARD_LIMIT) return;
  const uid = s.nextUid++;
  pl.yard.push({ uid, id, damage: 0, exhausted: !keywords(id).zoomies, buffPower: 0, usedOnce: false });
  log(s, `${pl.name} summons ${cardName(id)}.`, p);
  emit(s, { t: 'summon', p, uid, cardId: id });
}

/** Two chosen units deal damage equal to their Power to each other, at the same time (Showdown). */
function fight(s: GameState, p: PlayerId, ctx: AbilityContext): void {
  const a = ctx.target?.kind === 'unit' ? findUnit(s, ctx.target.uid)?.unit : undefined;
  const b = ctx.target2?.kind === 'unit' ? findUnit(s, ctx.target2.uid)?.unit : undefined;
  if (!a || !b) return;
  const pa = unitPower(a, s), pb = unitPower(b, s);
  const toB = dealDamage(s, b, pa), toA = dealDamage(s, a, pb);
  log(s, `${cardName(a.id)} and ${cardName(b.id)} fight: ${cardName(b.id)} takes ${toB}, ${cardName(a.id)} takes ${toA}.`, p);
  emit(s, { t: 'damage', uid: b.uid, amount: toB, p });
  emit(s, { t: 'damage', uid: a.uid, amount: toA, p });
  if (toA) queueDamaged(s, a);
  if (toB) queueDamaged(s, b);
}

/** Rule 800.1: defeat units, flip Kittens whose Grow Up condition holds. */
function stateCheck(s: GameState): void {
  if (s.winner !== null) return;
  const triggers: Step[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const pl = s.players[owner];
    const dead = pl.yard.filter((u) => u.damage >= unitHealth(u, s));
    if (!dead.length) continue;
    pl.yard = pl.yard.filter((u) => !dead.includes(u));
    for (const u of dead) {
      if (u.toy) pl.compost.push(u.toy);
      // A token stops existing when it leaves the Yard (rule 200.4); a card goes to the Compost.
      if (!CARDS[u.id]?.token) pl.compost.push({ uid: u.uid, id: u.id });
      log(s, `${cardName(u.id)} is defeated.`, owner);
      emit(s, { t: 'defeated', uid: u.uid, cardId: u.id, owner });
      for (const { ability, ref } of unitAbilities(s, u, 'goodbye')) {
        if (isUnitSel(ability.target)) triggers.push({ t: 'choosePrompt', p: owner, ref, spec: ability.target, sourceId: u.id });
        else triggers.push({ t: 'ability', p: owner, ref, sourceId: u.id, trigger: true });
      }
    }
  }
  if (triggers.length) s.queue.unshift(...triggers);
  for (const owner of [0, 1] as PlayerId[]) {
    const hero = s.players[owner].hero;
    const grow = CARDS[hero.id]?.kitten?.growUp;
    if (!hero.grown && grow && evaluateCondition(s, owner, grow.if)) {
      hero.grown = true;
      log(s, `${s.players[owner].name}'s ${cardName(hero.id)} Grows Up into ${CARDS[hero.id].bigCat!.name}!`, owner);
      emit(s, { t: 'growUp', p: owner });
    }
  }
}
