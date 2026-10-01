// The Folkborn rules engine: a deterministic state machine that implements docs/rulebook.md §13.
//
//   registerSet(domowiki);                       // cards come from outside: see content/index.ts
//   const s = createGame({ decks: ['domowiki', 'pari'], seed: 42 });
//   for (let seat = nextSeat(s); seat !== null; seat = nextSeat(s)) apply(s, pickOneOf(legalActions(s, seat)), seat);
//
// A round has three parts. In the Start, players ready their units, get their income and a new shop: cards dealt face
// up from their own deck. In the Muster both players build at once and in secret: they buy units into their six lanes
// (a copy of a unit they have merges into it), move and sell them, roll the shop, set Ambushes, aim Charms at the
// enemy's lanes and level up their Hero, each until they are Ready. Then the Clash plays itself: the units fight
// in bouts until one side has none standing, the loser blows out Candles for the winner's survivors, and the board
// stands up again for the next round. Nothing fielded is lost in a Clash.
//
// `apply` mutates the state in place (clone first with `structuredClone` to keep history). All randomness comes from
// the seed stored in the state, so a seed plus the list of (seat, action) replays a game.
//
// The engine knows the rules and a fixed vocabulary of card abilities (triggers, conditions, targets, actions:
// src/types.ts), never a particular card. Cards are data; what data can't express, a set's plugin adds as named
// conditions and actions (src/cards.ts, Plugin).

import TERMS from './terms.json';
import {
  AURA_HEROES, AURA_SOURCES, CARDS, MECHANICS, PLUGINS, abilitiesOf, abilityAt, deckCardIds, findAbility, isUnitCard, keywords, keywordsFrom,
  resolveDeck, setConditionEvaluator, type DeckList, type Keywords, type PluginContext,
} from './cards';
import { rulesWith } from './rules';
import type {
  Ability, AbilityRef, Act, Action, CardInst, Condition, GameEvent, GameState, Pending, PlayerId, PlayerState, Rules, Step,
  Target, TargetSel, Unit, UnitFilter,
} from './types';

/**
 * Bump when a change to the rules, the card data or the shape of GameState means a game saved by an
 * older build can no longer be continued (the web client throws such saves away).
 * 2: cards as data (unit counters and buffKeywords instead of ripe / buffSneaky / buffGuardian).
 * 3: the Muster and the Clash (Folkborn 0.4): Offerings are money, units fight on their own.
 * 4: the shop instead of a hand (Folkborn 0.5): no mulligan, no draws, Candles are a count.
 * 5: lanes open with the Level, from the left: a unit, a move or an Ambush only in an open lane.
 */
export const RULES_VERSION = 5;

export const LIVES = 9;
export const DECK_SIZE = 50;
/** Lanes on each side of the board: the most units a player can field. */
export const LANES = 6;
export const YARD_LIMIT = LANES;
/** Triggered abilities allowed in a row before the engine stops the chain (two cards triggering each other). */
export const TRIGGER_CHAIN_LIMIT = 200;
/** What a card nobody may see is called in a view (view.ts) and in the opponent's snapshot. */
export const HIDDEN = '?';

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
  /** A registered deck's key ('domowiki') or a whole deck list (a player's own deck). */
  decks: [string | DeckList, string | DeckList];
  names?: [string, string];
  seed?: number;
  /** Force the starting Lantern holder (random otherwise). */
  firstPlayer?: PlayerId;
  /**
   * Candles each player starts with (1 to 9; 9 when left out). A player may give some up as a handicap, so a friend
   * who is new to the game has a fairer match.
   */
  lives?: [number, number];
  /** Other numbers for the rules (a playtest trying them). */
  rules?: Partial<Rules>;
}

export function createGame(options: GameOptions): GameState {
  const rules = rulesWith(options.rules);
  const s: GameState = {
    seed: (options.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    round: 1,
    yarn: 0,
    players: [] as unknown as [PlayerState, PlayerState],
    prompt: null,
    queue: [],
    winner: null,
    nextUid: 1,
    log: [],
    events: [],
    actions: 0,
    startingYarn: 0,
    phase: 'setup',
    clock: [0, 0],
    rules,
  };
  for (const p of [0, 1] as PlayerId[]) {
    const list = resolveDeck(options.decks[p]);
    // A deck kept from before a set was taken out of the game (the Starter Box) can't be played: refuse it now, not
    // with a crash in the middle of the game.
    const unknown = [list.hero, ...Object.keys(list.cards).filter((id) => list.cards[id] > 0)].filter((id) => !CARDS[id]);
    if (unknown.length) throw new Error(`Unknown card ${unknown[0]} in the deck '${list.name}': its set isn't loaded`);
    // Shuffle first, then number the cards: numbering the sorted deck list would let anyone who sees
    // a uid (an opponent's card in hand, say) work out which card it is.
    const ids = deckCardIds(list);
    shuffle(s, ids);
    const deck = ids.map((id) => ({ uid: s.nextUid++, id }));
    const lives = Math.max(1, Math.min(LIVES, Math.floor(options.lives?.[p] ?? LIVES)));
    s.players[p] = {
      name: options.names?.[p] ?? `Player ${p + 1}`,
      deckName: list.name,
      hero: { id: list.hero, grown: false, exhausted: false, level: rules.levelStart },
      deck, shop: [], lives, offerings: rules.startOfferings, yard: [], compost: [], playedThisRound: 0,
    };
    if (lives < LIVES) s.players[p].handicap = LIVES - lives;
  }
  s.yarn = options.firstPlayer ?? (random(s) < 0.5 ? 0 : 1);
  s.startingYarn = s.yarn;
  log(s, `${s.players[s.yarn].name} starts with the ${TERMS.lantern}.`);
  s.queue.push({ t: 'restock', p: s.yarn }, { t: 'restock', p: other(s.yarn) }, { t: 'beginMuster' });
  run(s);
  return s;
}

function log(s: GameState, text: string, player?: PlayerId): void {
  s.log.push(s.acting === undefined ? { round: s.round, player, text } : { round: s.round, player, text, secret: s.acting });
}

/** Record what happened for the screen. During the Muster it is the acting player's secret until the Clash. */
function emit(s: GameState, event: GameEvent): void {
  (s.events ??= []).push(s.acting === undefined ? event : { ...event, secret: s.acting });
}

// ── Queries: units ───────────────────────────────────────────────────────────────────────────────

export function findUnit(s: GameState, uid: number): { unit: Unit; owner: PlayerId } | null {
  for (const owner of [0, 1] as PlayerId[]) {
    const unit = s.players[owner].yard.find((u) => u.uid === uid);
    if (unit) return { unit, owner };
  }
  return null;
}

/** The unit standing in a player's lane, if any. */
export function laneUnit(s: GameState, p: PlayerId, lane: number): Unit | undefined {
  return s.players[p].yard.find((u) => u.slot === lane);
}

/** Lanes nobody of the player's stands in, nor lies in (a unit that went down keeps its lane until the Clash ends). */
export function freeLanes(s: GameState, p: PlayerId): number[] {
  const pl = s.players[p];
  const taken = new Set([...pl.yard, ...(pl.fallen ?? [])].map((u) => u.slot));
  return Array.from({ length: LANES }, (_, i) => i).filter((i) => !taken.has(i));
}

/**
 * The lanes a player may use: as many as their Hero's Level, from the left (Level 3: lanes 1 to 3). The others are
 * locked: nothing is bought, moved or set face-down there. Only a summoned token may stand in one, for a Clash.
 */
export const isOpenLane = (s: GameState, p: PlayerId, lane: number): boolean => lane < s.players[p].hero.level;

/** Lanes the player may put a new unit in: open and empty. */
export const openFreeLanes = (s: GameState, p: PlayerId): number[] => freeLanes(s, p).filter((lane) => isOpenLane(s, p, lane));

/** Units the player has on the board, standing or down: what the Hero's Level limits. */
export const unitCount = (s: GameState, p: PlayerId): number => s.players[p].yard.length + (s.players[p].fallen?.length ?? 0);

interface Grant { power: number; health: number; keywords: string[] }
const NO_GRANT: Readonly<Grant> = { power: 0, health: 0, keywords: [] };

/** What a Talisman gives the unit it's attached to. */
function toyGrant(u: Unit): Grant {
  if (!u.toy) return NO_GRANT;
  const g: Grant = { power: 0, health: 0, keywords: [] };
  for (const a of abilitiesOf(u.toy.id)) {
    if (a.static?.to !== 'attached' || !a.static.grant) continue;
    g.power += a.static.grant.power ?? 0;
    g.health += a.static.grant.health ?? 0;
    g.keywords.push(...(a.static.grant.keywords ?? []));
  }
  return g;
}

/** A unit's keywords before any aura: printed, from its Talisman, and granted this round. */
function baseKeywordList(u: Unit): string[] {
  return [...keywords(u.id).all, ...toyGrant(u).keywords, ...(u.buffKeywords ?? [])];
}

/** Whether any card in play grants auras (most games: none, and then nobody needs to look for them). */
function aurasInPlay(s: GameState): boolean {
  if (!AURA_SOURCES.size) return false;
  for (const pl of s.players) {
    const hero = AURA_HEROES.get(pl.hero.id);
    if (hero && (pl.hero.grown ? hero.bigCat : hero.kitten)) return true;
    for (const x of pl.yard) if (AURA_SOURCES.has(x.id)) return true;
  }
  return false;
}

/** The lasting effects in play that reach this unit: its own "while…" grants and other cards' auras. */
function auraGrant(s: GameState, u: Unit): Grant {
  if (!aurasInPlay(s)) return NO_GRANT;
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
        } else if (!matchesUnit(q, u, found.owner, { each: st.to.each, other: st.to.other, filter: st.to.filter }, src.uid)) {
          continue;
        }
        if (st.while !== undefined && !evaluateCondition(s, q, st.while)) continue;
        add(st.grant);
      }
    }
  }
  return g;
}

/** Power from a unit's counters (Rain-Fed's rain), as each mechanic prices a point of it. */
function counterBonus(u: Unit): { power: number; health: number } {
  const bonus = { power: 0, health: 0 };
  if (!u.counters) return bonus;
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
 * A unit's Power: its card's (once per star), plus its Talisman, counters and this round's buffs, plus auras in play.
 * Pass the game state to include auras; without it they're left out.
 */
export function unitPower(u: Unit, s?: GameState): number {
  const aura = s ? auraGrant(s, u).power : 0;
  return Math.max(0, (CARDS[u.id]?.power ?? 0) * (u.stars ?? 1) + toyGrant(u).power + counterBonus(u).power + u.buffPower + aura);
}

export function unitHealth(u: Unit, s?: GameState): number {
  const aura = s ? auraGrant(s, u).health : 0;
  return (CARDS[u.id]?.health ?? 0) * (u.stars ?? 1) + toyGrant(u).health + counterBonus(u).health + (u.buffHealth ?? 0) + aura;
}

/**
 * Everything a unit is right now: printed keywords, its Talisman's, this round's, and auras (with a state).
 * `thisRound: false` leaves out this round's buffs (the bot values a unit by what lasts).
 */
export function unitKeywords(u: Unit, s?: GameState, thisRound = true): Keywords {
  // Most units: printed keywords only (no Talisman, no buff this round, no aura in play), already cached.
  if (!u.toy && !(thisRound && u.buffKeywords?.length) && !(s && aurasInPlay(s))) return keywords(u.id);
  const lasting = [...keywords(u.id).all, ...toyGrant(u).keywords];
  const list = [...lasting, ...(thisRound ? u.buffKeywords ?? [] : []), ...(s ? auraGrant(s, u).keywords : [])];
  return keywordsFrom([...new Set(list)]);
}

export const isGuardian = (u: Unit, s?: GameState): boolean => unitKeywords(u, s).guardian;
export const isSneaky = (u: Unit, s?: GameState): boolean => unitKeywords(u, s).sneaky;

/**
 * Where a unit stands in the enemy's order of attack: Guardians (3) are hit first, then plain units (2), then
 * Elusive ones (1), then Lures (0). Sneaky attackers go the other way round.
 */
export function targetRank(u: Unit, s?: GameState): number {
  const k = unitKeywords(u, s);
  if (k.guardian) return 3;
  if (k.lure) return 0;
  if (k.elusive) return 1;
  return 2;
}

export const heroSide = (s: GameState, p: PlayerId) => {
  const hero = s.players[p].hero;
  return hero.grown ? CARDS[hero.id].bigCat! : CARDS[hero.id].kitten!;
};

/** What the next Level costs this player, or null at the top. */
export function levelCost(s: GameState, p: PlayerId): number | null {
  const level = s.players[p].hero.level;
  return level >= s.rules.levelMax ? null : s.rules.levelCost[level] ?? null;
}

/** The interest a pool of Offerings earns at the Start. */
export const interestOn = (s: GameState, offerings: number): number =>
  Math.min(s.rules.interestMax, Math.floor(offerings / s.rules.interestPer));

/** Offerings for a losing streak of this many Clashes in a row. */
export function streakBonus(s: GameState, streak: number): number {
  const table = s.rules.streak;
  return table.length ? table[Math.min(streak, table.length - 1)] ?? 0 : 0;
}

/** What selling a unit gives back: what was paid for it, less sellLoss for each copy merged into it (a merge is a commitment). */
export const sellValue = (s: GameState, u: Unit): number => Math.max(0, (u.paid ?? 0) - s.rules.sellLoss * (u.stars ?? 1));

/** What the player's next roll costs: nothing with a free roll to use. */
export const rollCost = (s: GameState, p: PlayerId): number => ((s.players[p].freeRolls ?? 0) > 0 ? 0 : s.rules.rollCost);

/** This round's base income (round 1 has none: the starting Offerings stand for it). */
export function baseIncome(s: GameState, round = s.round): number {
  const table = s.rules.income;
  return round <= 1 ? 0 : table[Math.min(round - 2, table.length - 1)] ?? 0;
}

// ── Conditions ───────────────────────────────────────────────────────────────────────────────────

interface AbilityContext {
  target?: Target;
  target2?: Target;
  self?: Unit;
}

/** Whether a condition holds for player p. Names are set mechanics (Company), plugins' conditions, or built in. */
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
  if ('treats' in c) return me.offerings >= c.treats.atLeast;
  if ('lives' in c) return me.lives <= c.lives.atMost;
  if ('opponentLives' in c) return s.players[other(p)].lives <= c.opponentLives.atMost;
  if ('yardHas' in c) return me.yard.some((u) => unitKeywords(u, s).all.includes(c.yardHas.keyword));
  if ('unitsInComposts' in c) return s.players.reduce((n, pl) => n + pl.compost.filter((x) => isUnitCard(x.id)).length, 0) >= c.unitsInComposts.atLeast;
  if ('unitsDown' in c) return s.players.reduce((n, pl) => n + (pl.downed ?? 0), 0) >= c.unitsDown.atLeast;
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
  p: PlayerId, u: Unit, owner: PlayerId, sel: { unit?: string; each?: string; other?: boolean; filter?: UnitFilter }, selfUid?: number,
): boolean {
  const who = sel.unit ?? sel.each;
  const own = owner === p;
  if ((who === 'own' && !own) || (who === 'enemy' && own)) return false;
  if ((who === 'allOther' || sel.other) && u.uid === selfUid) return false;
  return passesFilter(u, sel.filter);
}

/** The units on the board a "choose a unit" selector may pick, from player p's side (`excludeUid`: its own unit). */
export function targetsFor(s: GameState, p: PlayerId, sel: TargetSel, excludeUid?: number): Target[] {
  if (!isUnitSel(sel)) return [];
  const result: Target[] = [];
  for (const owner of [0, 1] as PlayerId[])
    for (const u of s.players[owner].yard)
      if (matchesUnit(p, u, owner, sel, excludeUid)) result.push({ kind: 'unit', uid: u.uid });
  return result;
}

/**
 * The targets a player may choose during the Muster: units of their own as they stand, and the enemy's lanes, all
 * six (the enemy's board is still being built, so what stands there is only known at the Clash). A harmful effect
 * that may hit "a unit" is aimed at the enemy only: a unit of your own never goes down outside a Clash.
 */
export function musterTargets(s: GameState, p: PlayerId, sel: TargetSel, excludeUid?: number, harmful = false): Target[] {
  if (!isUnitSel(sel)) return [];
  const result: Target[] = sel.unit === 'enemy' || (harmful && sel.unit === 'any') ? [] : targetsFor(s, p, { ...sel, unit: 'own' }, excludeUid);
  if (sel.unit !== 'own') for (let lane = 0; lane < LANES; lane++) result.push({ kind: 'lane', player: other(p), lane });
  return result;
}

/** Every unit an "each…" selector reaches. */
function eachUnit(s: GameState, p: PlayerId, sel: EachSel, selfUid?: number): Unit[] {
  const units: Unit[] = [];
  for (const owner of [0, 1] as PlayerId[])
    for (const u of s.players[owner].yard) if (matchesUnit(p, u, owner, sel, selfUid)) units.push(u);
  return units;
}

const sameTarget = (a?: Target, b?: Target): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

function isLegalTarget(s: GameState, p: PlayerId, sel: TargetSel, target: Target | undefined, excludeUid?: number): boolean {
  return !!target && targetsFor(s, p, sel, excludeUid).some((t) => sameTarget(t, target));
}

/** Whether an ability reaches the enemy's units, so it waits for the Clash when made in the Muster. */
function reachesEnemy(ability: Ability, target?: Target, target2?: Target): boolean {
  if (target?.kind === 'lane' || target2?.kind === 'lane') return true;
  const sel = ability.target;
  return isEachSel(sel) && sel.each !== 'own';
}

/** The ability that playing a card starts: a Charm's "play", a unit's Hello. */
function mainAbility(id: string): { ability: Ability; ref: AbilityRef } | null {
  const type = CARDS[id]?.type;
  if (type === 'Trick') return findAbility(id, 'play');
  if (isUnitCard(id)) return findAbility(id, 'hello');
  return null;
}

/** A unit of the player's that a copy of this card would merge into (never a Fabled: they are one of a kind). */
export function mergeTwin(s: GameState, p: PlayerId, id: string): Unit | undefined {
  if (CARDS[id]?.type !== 'Critter') return undefined;
  return s.players[p].yard.find((u) => u.id === id && (u.stars ?? 1) < s.rules.maxStars);
}

/** One way to play a card: the lane a new unit goes to, and its chosen target(s), if any. */
export interface PlayChoice { slot?: number; target?: Target; target2?: Target }

/** The ways a card in the shop can be bought right now. Empty means it can't be. */
export function playChoices(s: GameState, p: PlayerId, card: CardInst): PlayChoice[] {
  const def = CARDS[card.id];
  const me = s.players[p];
  const main = mainAbility(card.id)?.ability;
  if (main?.pounceOnly) return [];
  if ((def.cost ?? 0) > me.offerings) return [];

  if (isUnitCard(card.id)) {
    if (mergeTwin(s, p, card.id)) return [{}];
    if (unitCount(s, p) >= me.hero.level) return [];
    if (def.type === 'Cat' && me.yard.some((u) => u.id === card.id)) return [];
    let hellos: PlayChoice[] = [{}];
    if (isUnitSel(main?.target)) {
      const targets = musterTargets(s, p, main!.target!, undefined, !helpful(main!)).map((target) => ({ target }));
      hellos = main!.optional ? [{}, ...targets] : targets.length ? targets : [{}];
    }
    return openFreeLanes(s, p).flatMap((slot) => hellos.map((h) => ({ slot, ...h })));
  }
  if (def.type === 'Toy') return targetsFor(s, p, { unit: 'own', filter: { noToy: true } }).map((target) => ({ target }));
  // Charm
  if (!isUnitSel(main?.target)) return [{}];
  const harmful = !helpful(main!);
  const firsts = musterTargets(s, p, main!.target!, undefined, harmful);
  let choices: PlayChoice[] = firsts.map((target) => ({ target }));
  if (isUnitSel(main!.target2)) {
    const seconds = musterTargets(s, p, main!.target2, undefined, harmful);
    choices = firsts.flatMap((target) => seconds.filter((t2) => !sameTarget(t2, target)).map((target2) => ({ target, target2 })));
  }
  if (choices.length) return choices;
  return main!.optionalTarget ? [{}] : [];
}

/** The targets a card can be played on (the first target of each way to play it). */
export function playOptions(s: GameState, p: PlayerId, card: CardInst): (Target | undefined)[] {
  return playChoices(s, p, card).map((c) => c.target);
}

/** The ways to set a card with Ambush face-down: one of your lanes without an Ambush (and, for a card aimed at "a unit", whose lane it watches). */
export function ambushChoices(s: GameState, p: PlayerId, card: CardInst): { lane: number; target?: Target }[] {
  if (!keywords(card.id).pounce) return [];
  const me = s.players[p];
  if ((CARDS[card.id].cost ?? 0) > me.offerings) return [];
  const sel = mainAbility(card.id)?.ability.target;
  const used = new Set((me.ambushes ?? []).map((a) => a.lane));
  const out: { lane: number; target?: Target }[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    if (used.has(lane) || !isOpenLane(s, p, lane)) continue;
    if (isUnitSel(sel) && sel.unit === 'any') {
      out.push({ lane, target: { kind: 'lane', player: p, lane } }, { lane, target: { kind: 'lane', player: other(p), lane } });
    } else out.push({ lane });
  }
  return out;
}

/** An action with its parts in a fixed order: legality is checked by comparing actions as JSON. */
function withChoice(action: { t: 'play'; uid: number }, c: PlayChoice): Action {
  return {
    ...action,
    ...(c.slot !== undefined ? { slot: c.slot } : {}),
    ...(c.target ? { target: c.target } : {}),
    ...(c.target2 ? { target2: c.target2 } : {}),
  };
}

/** Whether a unit is barred from attacking right now (Ovinnik unless you're Well-Fed). */
export function cantAttack(s: GameState, owner: PlayerId, u: Unit): boolean {
  return abilitiesOf(u.id).some((a) => a.static?.cantAttack && (a.static.while === undefined || evaluateCondition(s, owner, a.static.while)));
}

/** The Hero's "exhaust" ability on the face it shows now. */
export function heroAbility(s: GameState, p: PlayerId): { ability: Ability; ref: AbilityRef } | null {
  const hero = s.players[p].hero;
  return findAbility(hero.id, 'exhaust', hero.grown ? 'bigCat' : 'kitten');
}

/** Whether `seat` is one of the players the game is waiting on. */
export function mayAct(s: GameState, seat: PlayerId): boolean {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) return false;
  if (prompt.kind === 'muster') return !!s.muster?.open[seat];
  return prompt.player === seat;
}

/** A player the game is waiting on (the Lantern holder first when both are), or null when it is over. */
export function nextSeat(s: GameState): PlayerId | null {
  if (!s.prompt || s.winner !== null) return null;
  if (s.prompt.kind !== 'muster') return s.prompt.player;
  if (s.muster?.open[s.yarn]) return s.yarn;
  return s.muster?.open[other(s.yarn)] ? other(s.yarn) : null;
}

/** The count a move online must quote for this seat: it moves with every one of their decisions and every public turn. */
export const clockFor = (s: GameState, seat: PlayerId): number => s.clock[seat];

/** Every legal action for a player (the one the prompt names when no seat is given). */
export function legalActions(s: GameState, seat?: PlayerId): Action[] {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) return [];
  const p = seat ?? prompt.player;
  if (!mayAct(s, p)) return [];
  const me = s.players[p];
  const actions: Action[] = [];
  for (const card of me.shop) {
    for (const c of playChoices(s, p, card)) actions.push(withChoice({ t: 'play', uid: card.uid }, c));
    for (const a of ambushChoices(s, p, card)) actions.push({ t: 'ambush', uid: card.uid, lane: a.lane, ...(a.target ? { target: a.target } : {}) });
  }
  for (const u of me.yard) {
    for (let slot = 0; slot < LANES; slot++) {
      if (slot === u.slot || !isOpenLane(s, p, slot)) continue;
      const there = laneUnit(s, p, slot);
      if (there && there.uid < u.uid) continue; // a swap, listed once
      actions.push({ t: 'move', uid: u.uid, slot });
    }
  }
  if (!me.hero.exhausted) {
    const ability = heroAbility(s, p)?.ability;
    if (ability && isUnitSel(ability.target)) for (const target of musterTargets(s, p, ability.target, undefined, !helpful(ability))) actions.push({ t: 'ability', target });
    else if (ability) actions.push({ t: 'ability' });
  }
  const cost = levelCost(s, p);
  if (cost !== null && me.offerings >= cost) actions.push({ t: 'levelUp' });
  if (me.offerings >= rollCost(s, p) && me.deck.length + me.shop.length > 0) actions.push({ t: 'roll' });
  for (const u of me.yard) actions.push({ t: 'sell', uid: u.uid });
  actions.push({ t: 'ready' });
  return actions;
}

// ── Applying actions ─────────────────────────────────────────────────────────────────────────────

export class IllegalAction extends Error {}

function takeFromShop(s: GameState, p: PlayerId, uid: number): CardInst {
  const shop = s.players[p].shop;
  const i = shop.findIndex((c) => c.uid === uid);
  if (i < 0) throw new IllegalAction(`card ${uid} is not in the shop`);
  return shop.splice(i, 1)[0];
}

/** Cards go back into a player's deck, which is shuffled: the shop is random every time, like TFT's pool. */
function returnToDeck(s: GameState, p: PlayerId, cards: CardInst[]): void {
  const pl = s.players[p];
  pl.deck.push(...cards);
  shuffle(s, pl.deck);
}

/** The shop goes back into the deck and a new one is dealt. */
function restock(s: GameState, p: PlayerId): void {
  const pl = s.players[p];
  returnToDeck(s, p, pl.shop.splice(0));
  pl.shop = pl.deck.splice(0, s.rules.shopSize);
}

const laneName = (lane: number): string => `lane ${lane + 1}`;

export function describeTarget(s: GameState, target?: Target): string {
  if (!target) return '';
  if (target.kind === 'hero') return `${s.players[target.player].name}'s Hero ${cardName(s.players[target.player].hero.id)}`;
  if (target.kind === 'lane') return `${s.players[target.player].name}'s ${laneName(target.lane)}`;
  const found = findUnit(s, target.uid);
  return found ? cardName(found.unit.id) : 'a unit';
}

const describeTargets = (s: GameState, a: { target?: Target; target2?: Target }) =>
  a.target2 ? `${describeTarget(s, a.target)} and ${describeTarget(s, a.target2)}` : describeTarget(s, a.target);

/**
 * Apply an action for a player the game is waiting on (`seat`; the one the prompt names when left out), then run the
 * game until the next decision. During the Muster either player may act until they are Ready.
 */
export function apply(s: GameState, action: Action, seat?: PlayerId): GameState {
  return perform(s, action, seat, true);
}

/** `apply` without checking the action against `legalActions`: for the bot's own searches, which only try legal ones. */
export function applyTrusted(s: GameState, action: Action, seat?: PlayerId): GameState {
  return perform(s, action, seat, false);
}

function perform(s: GameState, action: Action, seat: PlayerId | undefined, check: boolean): GameState {
  const prompt = s.prompt;
  if (!prompt || s.winner !== null) throw new IllegalAction('the game is not waiting for an action');
  const p = seat ?? prompt.player;
  if (!mayAct(s, p)) throw new IllegalAction(`the game is not waiting for ${s.players[p].name}`);
  const me = s.players[p];

  if (check) {
    const key = JSON.stringify(action);
    if (!legalActions(s, p).some((a) => JSON.stringify(a) === key)) throw new IllegalAction(`illegal action ${key}`);
  }

  s.prompt = null;
  s.actions++;
  s.clock[p]++;
  s.chain = 0;
  s.acting = p;

  switch (action.t) {
    case 'play': {
      const card = takeFromShop(s, p, action.uid);
      const paid = CARDS[card.id].cost ?? 0;
      me.offerings -= paid;
      me.playedThisRound = (me.playedThisRound ?? 0) + 1;
      const where = action.slot !== undefined ? ` in ${laneName(action.slot)}` : '';
      const on = action.target ? ` targeting ${describeTargets(s, action)}` : '';
      log(s, `${me.name} buys ${cardName(card.id)}${where}${on}.`, p);
      emit(s, { t: 'play', p, uid: card.uid, cardId: card.id, ...(action.target ? { target: action.target } : {}) });
      s.queue.unshift({ t: 'resolvePlay', p, card, paid, slot: action.slot, target: action.target, target2: action.target2 });
      break;
    }
    case 'ambush': {
      const card = takeFromShop(s, p, action.uid);
      me.offerings -= CARDS[card.id].cost ?? 0;
      (me.ambushes ??= []).push({ card, lane: action.lane, ...(action.target ? { target: action.target } : {}) });
      log(s, `${me.name} sets ${cardName(card.id)} face-down in ${laneName(action.lane)}.`, p);
      emit(s, { t: 'ambushSet', p, lane: action.lane });
      break;
    }
    case 'move': {
      const u = me.yard.find((x) => x.uid === action.uid)!;
      const there = laneUnit(s, p, action.slot);
      if (there) there.slot = u.slot;
      u.slot = action.slot;
      sortYard(me);
      log(s, `${me.name} moves ${cardName(u.id)} to ${laneName(action.slot)}${there ? ` (${cardName(there.id)} takes its place)` : ''}.`, p);
      emit(s, { t: 'move', p, uid: u.uid, slot: action.slot });
      break;
    }
    case 'sell': {
      const u = me.yard.find((x) => x.uid === action.uid)!;
      const back = sellValue(s, u);
      me.yard = me.yard.filter((x) => x !== u);
      // Its Talisman goes to the Mist; the unit's own card goes back into the deck, to be dealt again.
      if (u.toy) me.compost.push(u.toy);
      if (!CARDS[u.id]?.token) returnToDeck(s, p, [{ uid: u.uid, id: u.id }]);
      me.offerings += back;
      log(s, `${me.name} sells ${cardName(u.id)} for ${back}: ${me.offerings} ${TERMS.offerings}.`, p);
      emit(s, { t: 'sell', p, cardId: u.id, offerings: me.offerings });
      break;
    }
    case 'roll': {
      const free = (me.freeRolls ?? 0) > 0;
      if (free) me.freeRolls = me.freeRolls! - 1;
      else me.offerings -= s.rules.rollCost;
      restock(s, p);
      log(s, `${me.name} rolls${free ? ' for free' : ''}: a new shop.`, p);
      emit(s, { t: 'roll', p, free });
      break;
    }
    case 'ability': {
      me.hero.exhausted = true;
      const { ability, ref } = heroAbility(s, p)!;
      log(s, `${me.name}'s ${cardName(me.hero.id)} uses their ability${action.target ? ` on ${describeTarget(s, action.target)}` : ''}.`, p);
      emit(s, { t: 'ability', p, heroId: me.hero.id, ...(action.target ? { target: action.target } : {}) });
      if (reachesEnemy(ability, action.target)) (me.pending ??= []).push({ ref, sourceId: me.hero.id, ...(action.target ? { target: action.target } : {}) });
      else s.queue.unshift({ t: 'ability', p, ref, target: action.target, sourceId: me.hero.id });
      break;
    }
    case 'levelUp': {
      me.offerings -= levelCost(s, p)!;
      me.hero.level++;
      log(s, `${me.name}'s ${cardName(me.hero.id)} reaches Level ${me.hero.level}: room for ${me.hero.level} units.`, p);
      emit(s, { t: 'levelUp', p, level: me.hero.level });
      break;
    }
    case 'ready':
      s.muster!.open[p] = false;
      log(s, `${me.name} is ready.`, p);
      emit(s, { t: 'readyUp', p });
      break;
  }
  stateCheck(s);
  run(s);
  delete s.acting;
  if (s.winner === null) {
    if (s.muster!.open[0] || s.muster!.open[1]) s.prompt = { kind: 'muster', player: s.muster!.open[s.yarn] ? s.yarn : other(s.yarn) };
    else {
      s.queue.unshift({ t: 'clashStart' });
      run(s);
    }
  }
  return s;
}

function sortYard(pl: PlayerState): void {
  pl.yard.sort((a, b) => a.slot - b.slot);
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

/** Every ability a unit has with this trigger: its card's, and its keywords' mechanics' (Rain-Fed, Pearl Tears). */
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

/** What the opponent may see of a player during the Muster: the player as they stand now, their secrets hidden. */
function snapshot(pl: PlayerState): PlayerState {
  const c = structuredClone({ ...pl, shown: undefined });
  delete c.shown;
  c.shop = c.shop.map((x) => ({ uid: x.uid, id: HIDDEN }));
  c.deck = c.deck.map(() => ({ uid: 0, id: HIDDEN }));
  c.ambushes = (c.ambushes ?? []).map((a) => ({ card: { uid: a.card.uid, id: HIDDEN }, lane: a.lane }));
  c.pending = [];
  return c;
}

function exec(s: GameState, step: Step): void {
  switch (step.t) {
    case 'beginMuster': {
      s.phase = 'muster';
      s.muster = { open: [true, true] };
      s.clock = [s.clock[0] + 1, s.clock[1] + 1];
      s.musterStart = { nextUid: s.nextUid, actions: s.actions, clock: [s.clock[0], s.clock[1]] };
      for (const pl of s.players) pl.shown = snapshot(pl);
      s.prompt = { kind: 'muster', player: s.yarn };
      break;
    }
    case 'clashStart': {
      s.phase = 'clash';
      delete s.muster;
      for (const pl of s.players) delete pl.shown;
      s.clash = { bout: 0, dealt: 0, struck: [false, false] };
      log(s, `— Clash —`);
      emit(s, { t: 'clash', n: s.round });
      for (const [q, pl] of s.players.entries()) {
        const board = pl.yard.map((u) => `${cardName(u.id)}${u.stars ? ` ${'★'.repeat(u.stars)}` : ''} (${unitPower(u, s)}/${unitHealth(u, s) - u.damage}) in ${laneName(u.slot)}`);
        log(s, `${pl.name}: ${board.length ? board.join(', ') : 'no units'}.`, q as PlayerId);
      }
      const first = s.yarn, second = other(first);
      s.queue.unshift(
        { t: 'pending', p: first }, { t: 'pending', p: second },
        { t: 'ambushes', p: first }, { t: 'ambushes', p: second },
        { t: 'heroStrike', p: first }, { t: 'heroStrike', p: second },
        { t: 'bout', n: 1 },
      );
      break;
    }
    case 'pending': {
      const pl = s.players[step.p];
      const list: Pending[] = pl.pending ?? [];
      pl.pending = [];
      s.queue.unshift(...list.map((x): Step => ({
        t: 'ability', p: step.p, ref: x.ref, sourceId: x.sourceId, target: x.target, target2: x.target2, selfUid: x.selfUid, card: x.card,
      })));
      break;
    }
    case 'ambushes':
      fireAmbushes(s, step.p);
      break;
    case 'heroStrike':
      heroStrike(s, step.p);
      break;
    case 'bout': {
      const clash = s.clash!;
      const standing = s.players.map((pl) => pl.yard.length);
      const stalled = step.n > 1 && clash.dealt === 0;
      if (!standing[0] || !standing[1] || step.n > s.rules.boutCap || stalled) {
        if (stalled) log(s, `Nobody can hurt anybody any more.`);
        s.queue.unshift({ t: 'clashEnd' });
        break;
      }
      clash.bout = step.n;
      clash.dealt = 0;
      s.chain = 0;
      log(s, `Bout ${step.n}.`);
      emit(s, { t: 'bout', n: step.n });
      s.queue.unshift({ t: 'strike', n: step.n, swift: true }, { t: 'strike', n: step.n, swift: false }, { t: 'bout', n: step.n + 1 });
      break;
    }
    case 'strike':
      strike(s, step.swift);
      break;
    case 'clashEnd':
      clashEnd(s);
      break;
    case 'reset': {
      for (const pl of s.players) {
        const all = [...pl.yard, ...(pl.fallen ?? [])].filter((u) => !CARDS[u.id]?.token);
        for (const u of all) u.damage = 0;
        pl.yard = all;
        pl.fallen = [];
        sortYard(pl);
      }
      delete s.clash;
      break;
    }
    case 'endRound':
      for (const pl of s.players) for (const u of pl.yard) { u.buffPower = 0; delete u.buffHealth; delete u.buffKeywords; }
      s.yarn = other(s.yarn);
      s.queue.unshift({ t: 'startRound' });
      break;
    case 'startRound': {
      s.round++;
      if (s.round > s.rules.maxRounds) {
        const candles = s.players.map((pl) => pl.lives);
        const health = s.players.map((pl) => pl.yard.reduce((sum, u) => sum + unitHealth(u, s) - u.damage, 0));
        const [a, b] = candles[0] !== candles[1] ? candles : health;
        s.winner = a === b ? 'draw' : a > b ? 0 : 1;
        log(s, `Round limit reached.`);
        if (s.winner === 'draw') log(s, `Same ${TERMS.candles} (${candles[0]}) and same Health on the board (${health[0]}): the game is a draw.`);
        else if (candles[0] !== candles[1]) log(s, `${s.players[s.winner].name} wins with more ${TERMS.candles} (${candles[s.winner]} to ${candles[other(s.winner)]}).`);
        else log(s, `Same ${TERMS.candles} (${candles[0]}). ${s.players[s.winner].name} wins with more Health on the board (${health[s.winner]} to ${health[other(s.winner)]}).`);
        emit(s, { t: 'win', p: s.winner });
        return;
      }
      log(s, `— Round ${s.round} —`);
      log(s, `${s.players[s.yarn].name} holds the ${TERMS.lantern}.`);
      emit(s, { t: 'round', n: s.round });
      for (const [q, pl] of s.players.entries()) {
        pl.hero.exhausted = false;
        pl.playedThisRound = 0;
        for (const u of pl.yard) {
          u.exhausted = false;
          u.usedOnce = false;
          // Start-of-round abilities that happen as the unit readies (Rain-Fed).
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
        { t: 'income', p: first }, { t: 'income', p: second },
        { t: 'restock', p: first }, { t: 'restock', p: second },
        { t: 'beginMuster' },
      );
      s.queue.unshift(...steps);
      break;
    }
    case 'income': {
      const pl = s.players[step.p];
      const interest = interestOn(s, pl.offerings);
      const streak = streakBonus(s, pl.streak ?? 0);
      const gained = baseIncome(s) + interest + streak;
      pl.offerings += gained;
      const parts = [interest ? `${interest} interest` : '', streak ? `${streak} for ${pl.streak} Clashes lost in a row` : ''].filter(Boolean);
      log(s, `${pl.name} gets ${gained} ${TERMS.offerings}${parts.length ? ` (${parts.join(', ')})` : ''}: ${pl.offerings} in all.`, step.p);
      emit(s, { t: 'income', p: step.p, gained, offerings: pl.offerings });
      break;
    }
    case 'restock':
      restock(s, step.p);
      break;
    case 'loseLife': {
      const pl = s.players[step.p];
      pl.lives = Math.max(0, pl.lives - 1);
      log(s, `${pl.name} loses a ${TERMS.candle}: ${pl.lives} left.`, step.p);
      emit(s, { t: 'lifeLost', p: step.p, left: pl.lives });
      if (!pl.lives) {
        s.winner = other(step.p);
        log(s, `${s.players[s.winner].name} wins!`);
        emit(s, { t: 'win', p: s.winner });
        break;
      }
      if (step.n > 1) s.queue.unshift({ t: 'loseLife', p: step.p, n: step.n - 1 });
      break;
    }
    case 'resolvePlay':
      resolvePlay(s, step);
      break;
    case 'ability':
      runStep(s, step);
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

/** Run a queued ability: find a lane's unit for an effect that waited for the Clash, and pick targets for triggers. */
function runStep(s: GameState, step: Extract<Step, { t: 'ability' }>): void {
  const ability = abilityAt(step.ref);
  const done = () => { if (step.card) s.players[step.p].compost.push(step.card); };
  if (!ability) return done();
  if (step.trigger) {
    s.chain = (s.chain ?? 0) + 1;
    if (s.chain > TRIGGER_CHAIN_LIMIT) {
      if (s.chain === TRIGGER_CHAIN_LIMIT + 1) log(s, `The chain of effects stops here.`);
      return;
    }
  }
  let self: Unit | undefined;
  if (step.selfUid !== undefined) {
    self = findUnit(s, step.selfUid)?.unit;
    // "…and survives": a unit that went down has no trigger left to run.
    if (!self && ability.when === 'damagedAndSurvives') return;
  }
  if (step.trigger && ability.oncePerRound && self) {
    if (self.usedOnce) return;
    self.usedOnce = true;
  }
  // A trigger in the Muster that would touch the enemy's units waits for the Clash, like every effect aimed at them:
  // the enemy's board is theirs to build in secret until then.
  if (s.phase === 'muster' && step.trigger && touchesEnemy(ability)) {
    const { t: _t, p: _p, trigger: _trigger, ...rest } = step;
    void _t; void _p; void _trigger;
    (s.players[step.p].pending ??= []).push(rest);
    return;
  }
  const target = laneToUnit(s, step.target);
  const target2 = laneToUnit(s, step.target2);
  if ((step.target && !target) || (step.target2 && !target2)) {
    log(s, `${cardName(step.sourceId)} finds nobody in ${describeTarget(s, step.target)} and fizzles.`, step.p);
    emit(s, { t: 'fizzled', cardId: step.sourceId });
    return done();
  }
  // An effect aimed at a lane in the Muster says what it found there, so "Kikimora is exhausted" has a cause.
  if (step.target?.kind === 'lane' && target?.kind === 'unit') {
    const found = findUnit(s, target.uid)!;
    log(s, `${s.players[step.p].name}'s ${cardName(step.sourceId)} finds ${s.players[found.owner].name}'s ${cardName(found.unit.id)} in ${laneName(step.target.lane)}.`, step.p);
  }
  let ctx: AbilityContext = { target, target2, self };
  if (isUnitSel(ability.target)) {
    if (!target) {
      const picked = autoTarget(s, step.p, ability, self);
      if (!picked) return done();
      ctx = { ...ctx, target: picked };
    } else if (!isLegalTarget(s, step.p, ability.target, target, step.selfUid)) {
      log(s, `${cardName(step.sourceId)} has no legal target and fizzles.`, step.p);
      emit(s, { t: 'fizzled', cardId: step.sourceId });
      return done();
    }
  }
  runAbility(s, step.p, ability, ctx);
  done();
}

/** A lane target becomes the unit standing there now (undefined if nobody does); other targets stay as they are. */
function laneToUnit(s: GameState, t: Target | undefined): Target | undefined {
  if (t?.kind !== 'lane') return t;
  const u = laneUnit(s, t.player, t.lane);
  return u ? { kind: 'unit', uid: u.uid } : undefined;
}

/** Whether an ability can reach the enemy's units: "each enemy unit", or a harmful "a unit" that picks an enemy. */
function touchesEnemy(ability: Ability): boolean {
  const sel = ability.target;
  if (isEachSel(sel)) return sel.each !== 'own';
  return isUnitSel(sel) && sel.unit !== 'own' && !helpful(ability);
}

/** Whether an ability helps whatever it touches (a heal, a buff), or harms it (damage, exhaust). */
function helpful(ability: Ability): boolean {
  const acts = [...(ability.do ?? []), ...(ability.instead?.do ?? [])].map((a) => Object.keys(a)[0]);
  return !acts.some((a) => a === 'damage' || a === 'exhaust' || a === 'cancelAttack' || a === 'fight');
}

/**
 * The unit a triggered ability picks when it needs one (nobody chooses during the Clash): for a harmful effect the
 * enemy unit the player's units would attack first (across from the ability's own unit when it can), for a helpful
 * one the player's own unit in the lowest lane.
 */
function autoTarget(s: GameState, p: PlayerId, ability: Ability, self?: Unit): Target | undefined {
  const sel = ability.target as UnitSel;
  const options = targetsFor(s, p, sel, sel.other ? self?.uid : undefined)
    .map((t) => findUnit(s, (t as { uid: number }).uid)!).filter(Boolean);
  if (!options.length) return undefined;
  const enemies = options.filter((o) => o.owner !== p).map((o) => o.unit);
  const own = options.filter((o) => o.owner === p).map((o) => o.unit);
  const wantEnemy = !helpful(ability);
  const pool = wantEnemy ? (enemies.length ? enemies : []) : (own.length ? own : []);
  if (!pool.length) return undefined;
  const u = wantEnemy ? pickFrom(s, pool, self?.slot ?? 0, false) : pool[0];
  return { kind: 'unit', uid: u.uid };
}

/** The unit an attacker in `slot` hits among `enemies`: by rank first (Sneaky from the bottom), then across, then nearest. */
function pickFrom(s: GameState, enemies: Unit[], slot: number, sneaky: boolean): Unit {
  const ranks = enemies.map((u) => targetRank(u, s));
  const want = sneaky ? Math.min(...ranks) : Math.max(...ranks);
  const pool = enemies.filter((_, i) => ranks[i] === want);
  return pool.reduce((best, u) => {
    const d = Math.abs(u.slot - slot), bd = Math.abs(best.slot - slot);
    return d < bd || (d === bd && u.slot < best.slot) ? u : best;
  });
}

/** The enemy unit a unit of player p's attacks now, or undefined when none stands. */
export function attackTarget(s: GameState, p: PlayerId, attacker: Unit): Unit | undefined {
  const enemies = s.players[other(p)].yard;
  return enemies.length ? pickFrom(s, enemies, attacker.slot, isSneaky(attacker, s)) : undefined;
}

function resolvePlay(s: GameState, step: Extract<Step, { t: 'resolvePlay' }>): void {
  const { p, card, target, target2 } = step;
  const pl = s.players[p];
  const def = CARDS[card.id];
  const main = mainAbility(card.id);

  if (isUnitCard(card.id)) {
    const twin = mergeTwin(s, p, card.id);
    if (twin) {
      twin.stars = (twin.stars ?? 1) + 1;
      twin.paid = (twin.paid ?? 0) + step.paid;
      pl.compost.push(card);
      log(s, `${cardName(card.id)} joins its twin: ${'★'.repeat(twin.stars)} (${unitPower(twin, s)}/${unitHealth(twin, s)}).`, p);
      emit(s, { t: 'merge', p, uid: twin.uid, stars: twin.stars });
      return;
    }
    const slot = step.slot ?? openFreeLanes(s, p)[0];
    if (slot === undefined || unitCount(s, p) >= pl.hero.level || laneUnit(s, p, slot) || !isOpenLane(s, p, slot)) {
      pl.compost.push(card);
      log(s, `${cardName(card.id)} has no room on the board.`, p);
      return;
    }
    const unit: Unit = { uid: card.uid, id: card.id, slot, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, paid: step.paid };
    pl.yard.push(unit);
    sortYard(pl);
    if (main) {
      const { ability, ref } = main;
      if (reachesEnemy(ability, target)) (pl.pending ??= []).push({ ref, sourceId: card.id, selfUid: unit.uid, ...(target ? { target } : {}) });
      else if (!isUnitSel(ability.target)) runAbility(s, p, ability, { self: unit });
      else if (isLegalTarget(s, p, ability.target, target, card.uid)) runAbility(s, p, ability, { target, self: unit });
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
  // Charm
  if (!main) { pl.compost.push(card); return; }
  const { ability, ref } = main;
  if (reachesEnemy(ability, target, target2)) {
    (pl.pending ??= []).push({ ref, sourceId: card.id, card, ...(target ? { target } : {}), ...(target2 ? { target2 } : {}) });
    return;
  }
  const legal = !isUnitSel(ability.target) ||
    (isLegalTarget(s, p, ability.target, target) && (!isUnitSel(ability.target2) || isLegalTarget(s, p, ability.target2, target2)));
  if (legal) runAbility(s, p, ability, { target, target2 });
  else if (ability.optionalTarget && !target) runAbility(s, p, ability, {});
  else {
    log(s, `${cardName(card.id)} has no legal target and fizzles.`, p);
    emit(s, { t: 'fizzled', cardId: card.id });
  }
  pl.compost.push(card);
}

/** At the start of the Clash, each face-down Ambush whose lane holds what it needs is revealed and happens. */
function fireAmbushes(s: GameState, p: PlayerId): void {
  const pl = s.players[p];
  const kept = [];
  const fired: Step[] = [];
  for (const a of pl.ambushes ?? []) {
    const main = mainAbility(a.card.id);
    if (!main) { pl.compost.push(a.card); continue; }
    const sel = main.ability.target;
    let watch: Target | undefined;
    if (sel === 'attack' || (isUnitSel(sel) && sel.unit === 'enemy')) watch = { kind: 'lane', player: other(p), lane: a.lane };
    else if (isUnitSel(sel) && sel.unit === 'own') watch = { kind: 'lane', player: p, lane: a.lane };
    else if (isUnitSel(sel)) watch = a.target ?? { kind: 'lane', player: other(p), lane: a.lane };
    const target = laneToUnit(s, watch);
    if (watch && !target) { kept.push(a); continue; }
    log(s, `${pl.name}'s Ambush in ${laneName(a.lane)}: ${cardName(a.card.id)}!`, p);
    emit(s, { t: 'ambush', p, lane: a.lane, cardId: a.card.id });
    pl.playedThisRound = (pl.playedThisRound ?? 0) + 1;
    fired.push({ t: 'ability', p, ref: main.ref, sourceId: a.card.id, card: a.card, ...(target ? { target } : {}) });
  }
  pl.ambushes = kept;
  s.queue.unshift(...fired);
}

/** An Awakened Hero that wasn't exhausted for its ability strikes once as the Clash begins, and takes nothing back. */
function heroStrike(s: GameState, p: PlayerId): void {
  const pl = s.players[p];
  const side = heroSide(s, p);
  if (!pl.hero.grown || pl.hero.exhausted || !side.power) return;
  const enemies = s.players[other(p)].yard;
  s.clash!.struck[p] = true;
  if (!enemies.length) return;
  const u = pickFrom(s, enemies, 0, !!side.keywords?.includes('Sneaky'));
  const dealt = dealDamage(s, u, side.power);
  log(s, `${pl.name}'s Hero ${cardName(pl.hero.id)} strikes ${cardName(u.id)} for ${dealt}${toughNote(s, u, side.power, dealt)}.`, p);
  emit(s, { t: 'hit', from: { kind: 'hero', player: p }, uid: u.uid, dealt });
  if (dealt) queueDamaged(s, u);
}

/** One strike of a bout: every standing, ready unit (only Swift ones first) hits its target, all at once. */
function strike(s: GameState, swift: boolean): void {
  const hits: { from: Unit; owner: PlayerId; to: Unit; power: number }[] = [];
  for (const owner of [s.yarn, other(s.yarn)]) {
    for (const u of s.players[owner].yard) {
      if (u.exhausted || cantAttack(s, owner, u) || unitKeywords(u, s).zoomies !== swift) continue;
      const to = attackTarget(s, owner, u);
      if (to) hits.push({ from: u, owner, to, power: unitPower(u, s) });
    }
  }
  const hurtUnits = new Set<Unit>();
  for (const h of hits) {
    const dealt = dealDamage(s, h.to, h.power);
    s.clash!.dealt += dealt;
    log(s, `${cardName(h.from.id)} hits ${cardName(h.to.id)} for ${dealt}${toughNote(s, h.to, h.power, dealt)}.`, h.owner);
    emit(s, { t: 'hit', from: { kind: 'unit', uid: h.from.uid }, uid: h.to.uid, dealt });
    if (dealt) hurtUnits.add(h.to);
    if (unitAbilities(s, h.from, 'defeatsInCombat').length) s.queue.unshift({ t: 'combatWin', uid: h.from.uid, foeUid: h.to.uid });
  }
  for (const u of hurtUnits) queueDamaged(s, u);
}

/** The Clash is over: the side with units standing wins, and the loser blows out a Candle for each of them. */
function clashEnd(s: GameState): void {
  const standing = s.players.map((pl) => pl.yard.length) as [number, number];
  const worth = (p: PlayerId): number => {
    let n = s.players[p].yard.reduce((sum, u) => sum + (unitKeywords(u, s).fierce ? 2 : 1), 0);
    if (s.clash?.struck[p]) n += heroSide(s, p).keywords?.includes('Fierce') ? 2 : 1;
    return n;
  };
  const cap = s.rules.clashCandleCap;
  const lost: [number, number] = [0, 0];
  if (standing[0] && !standing[1]) lost[1] = Math.min(cap, worth(0));
  else if (standing[1] && !standing[0]) lost[0] = Math.min(cap, worth(1));
  else if (standing[0] && standing[1] && s.rules.overtimeBothLose) {
    lost[0] = Math.min(cap, worth(1));
    lost[1] = Math.min(cap, worth(0));
  }
  if (lost[0] && lost[1]) log(s, `Both sides still stand: each loses ${TERMS.candles} for the other's units.`);
  else if (lost[0] || lost[1]) {
    const w = lost[0] ? 1 : 0;
    log(s, `${s.players[w].name} wins the Clash with ${standing[w]} unit(s) standing.`);
  } else log(s, `Nobody wins the Clash.`);
  emit(s, { t: 'clashEnd', standing, lost });
  for (const q of [0, 1] as PlayerId[]) s.players[q].streak = lost[q] ? (s.players[q].streak ?? 0) + 1 : 0;
  const steps: Step[] = [];
  for (const q of [s.yarn, other(s.yarn)]) if (lost[q]) steps.push({ t: 'loseLife', p: q, n: lost[q] });
  steps.push({ t: 'reset' }, { t: 'endRound' });
  s.queue.unshift(...steps);
}

/** Deal damage to a unit (Tough reduces it); returns what it took. */
function dealDamage(s: GameState, u: Unit, amount: number): number {
  const dealt = Math.max(0, amount - unitKeywords(u, s).tough);
  u.damage += dealt;
  return dealt;
}

/** Why a hit dealt less than its Power, for the log: "for 0 (Tough 2)". */
const toughNote = (s: GameState, u: Unit, amount: number, dealt: number): string =>
  dealt < amount ? ` (Tough ${unitKeywords(u, s).tough})` : '';

/** After a unit is dealt damage: its "damaged and survives" abilities, which run once the state is checked. */
function queueDamaged(s: GameState, u: Unit): void {
  const owner = findUnit(s, u.uid)?.owner;
  if (owner === undefined) return;
  const steps: Step[] = unitAbilities(s, u, 'damagedAndSurvives')
    .map(({ ref }) => ({ t: 'ability', p: owner, ref, sourceId: u.id, selfUid: u.uid, trigger: true }));
  if (steps.length) s.queue.unshift(...steps);
}

/** "When you heal": the healer's units that care (The Roadside Alux). Giving a unit Health counts. */
function healed(s: GameState, p: PlayerId): void {
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

function heal(s: GameState, p: PlayerId, u: Unit | undefined, amount: number): void {
  if (!u) return;
  const amountHealed = Math.min(u.damage, amount);
  u.damage -= amountHealed;
  if (amountHealed <= 0) return;
  log(s, `${cardName(u.id)} heals ${amountHealed}.`, p);
  emit(s, { t: 'heal', uid: u.uid, amount: amountHealed });
  healed(s, p);
}

// ── Running abilities ────────────────────────────────────────────────────────────────────────────

function pluginContext(s: GameState, p: PlayerId, unit: Unit | undefined, self: Unit | undefined): PluginContext {
  return {
    s, p, unit, self,
    log: (text) => log(s, text, p),
    damage: (u, amount) => hurt(s, p, u, amount),
    heal: (u, amount) => heal(s, p, u, amount),
    freeRoll: (n) => freeRoll(s, p, n),
  };
}

/** Log a mechanic condition's name when it pays off, ("Company!"). */
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
  else if (isUnitSel(sel) || sel === 'attack') {
    const found = ctx.target?.kind === 'unit' ? findUnit(s, ctx.target.uid) : null;
    units = found ? [found.unit] : [];
  } else if (isEachSel(sel)) units = eachUnit(s, p, sel, ctx.self?.uid);

  for (const act of acts) doAct(s, p, act, units, ctx);
}

/** "Get a free roll": the player's next rolls cost nothing. */
function freeRoll(s: GameState, p: PlayerId, n: number): void {
  const pl = s.players[p];
  pl.freeRolls = (pl.freeRolls ?? 0) + n;
  log(s, `${pl.name} gets ${n === 1 ? 'a free roll' : `${n} free rolls`}.`, p);
  emit(s, { t: 'freeRoll', p, n });
}

function gain(s: GameState, p: PlayerId, n: number): void {
  const pl = s.players[p];
  pl.offerings += n;
  log(s, `${pl.name} gains ${n} ${n === 1 ? TERMS.offering : TERMS.offerings}: ${pl.offerings} in all.`, p);
}

function doAct(s: GameState, p: PlayerId, act: Act, units: Unit[], ctx: AbilityContext): void {
  const [name, value] = Object.entries(act)[0] ?? [];
  switch (name) {
    case 'damage': for (const u of units) hurt(s, p, u, value as number); return;
    case 'heal': for (const u of units) heal(s, p, u, value as number); return;
    case 'buff': {
      const b = value as { power?: number; health?: number; keywords?: string[] };
      for (const u of units) {
        if (b.power) u.buffPower += b.power;
        if (b.health) u.buffHealth = (u.buffHealth ?? 0) + b.health;
        if (b.keywords?.length) u.buffKeywords = [...(u.buffKeywords ?? []), ...b.keywords];
        const e: GameEvent = { t: 'buff', uid: u.uid };
        if (b.power) e.power = b.power;
        if (b.health) e.health = b.health;
        if (b.keywords?.includes('Sneaky')) e.sneaky = true;
        if (b.keywords?.includes('Guardian')) e.guardian = true;
        emit(s, e);
      }
      if (b.health && units.length) healed(s, p);
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
    case 'freeRoll': freeRoll(s, p, value as number); return;
    case 'exhaust':
    case 'cancelAttack':
      // An exhausted unit deals no damage in this Clash.
      for (const u of units) { u.exhausted = true; log(s, `${cardName(u.id)} is exhausted: it deals no damage this Clash.`, p); emit(s, { t: 'exhaust', uid: u.uid }); }
      return;
    case 'ready': for (const u of units) { u.exhausted = false; emit(s, { t: 'ready', uid: u.uid }); } return;
    case 'readyTreats':
    case 'sprout':
      gain(s, p, value as number);
      return;
    case 'summon': summon(s, p, value as string); return;
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

/** Damage from a card or ability (not the Clash's hits, which `strike` reports). */
function hurt(s: GameState, p: PlayerId, u: Unit, amount: number): void {
  const dealt = dealDamage(s, u, amount);
  log(s, `${cardName(u.id)} takes ${dealt}${toughNote(s, u, amount, dealt)}.`, p);
  emit(s, { t: 'damage', uid: u.uid, amount: dealt, p });
  if (dealt) queueDamaged(s, u);
}

/** Put a token into the player's lowest free lane (nothing happens when every lane is taken). */
function summon(s: GameState, p: PlayerId, id: string): void {
  const pl = s.players[p];
  const slot = freeLanes(s, p)[0];
  if (!CARDS[id] || slot === undefined) return;
  const uid = s.nextUid++;
  pl.yard.push({ uid, id, slot, damage: 0, exhausted: false, buffPower: 0, usedOnce: false });
  sortYard(pl);
  log(s, `${pl.name} summons ${cardName(id)} in ${laneName(slot)}.`, p);
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

/** Rule 800.1: units with damage at or over their Health go down (they stand up when the Clash ends); Heroes Awaken. */
function stateCheck(s: GameState): void {
  if (s.winner !== null) return;
  const triggers: Step[] = [];
  for (const owner of [s.yarn, other(s.yarn)]) {
    const pl = s.players[owner];
    const down = pl.yard.filter((u) => u.damage >= unitHealth(u, s));
    if (!down.length) continue;
    pl.yard = pl.yard.filter((u) => !down.includes(u));
    for (const u of down) {
      (pl.fallen ??= []).push(u);
      // "Units that have gone down in Clashes": only the Clash counts.
      if (s.phase === 'clash') pl.downed = (pl.downed ?? 0) + 1;
      log(s, `${cardName(u.id)} goes down.`, owner);
      emit(s, { t: 'down', uid: u.uid, cardId: u.id, owner });
      for (const { ref } of unitAbilities(s, u, 'goodbye')) triggers.push({ t: 'ability', p: owner, ref, sourceId: u.id, trigger: true });
    }
  }
  if (triggers.length) s.queue.unshift(...triggers);
  // During the Muster only the acting player's Hero may Awaken: the other's waits for the Clash (or their own move),
  // so nobody's Hero flips because of a move they can't see yet.
  for (const owner of s.acting !== undefined ? [s.acting] : [0, 1] as PlayerId[]) {
    const hero = s.players[owner].hero;
    const grow = CARDS[hero.id]?.kitten?.growUp;
    if (!hero.grown && grow && evaluateCondition(s, owner, grow.if)) {
      hero.grown = true;
      log(s, `${s.players[owner].name}'s ${cardName(hero.id)} Awakens as ${CARDS[hero.id].bigCat!.name}!`, owner);
      emit(s, { t: 'growUp', p: owner });
    }
  }
}
