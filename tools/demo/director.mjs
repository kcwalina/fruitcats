// The demo's director: walks script.json beat by beat and decides every move the human player makes.
//
// It runs in two modes over the same code, so a seed that works in one works in the other:
//   • dry  (find-seed.mjs): the game lives here in Node; the AI's moves are applied directly.
//   • page (record.mjs):    the game lives in the browser; every human move is performed as real
//                           mouse clicks on the real UI, and the AI plays on its own timer there.
// Both use the same seed for the deal and the same seeded AI, so the game unfolds identically.

import { apply, chooseAction, createGame, evaluate, keywords, legalActions, CARDS } from '@fruitcats/engine';

export const HUMAN = 0;
export const AI = 1;
export const KITTEN_SKILL = 0.55;          // apps/web/src/main.ts DIFFICULTY.kitten

/** Same generator as mulberry() in apps/web/src/main.ts: the page's AI draws from this stream. */
export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ScriptError extends Error {}

const isUnit = (id) => ['Cat', 'Critter'].includes(CARDS[id]?.type);
const handCard = (s, uid) => s.players[HUMAN].hand.find((c) => c.uid === uid);
const targetKey = (t) => (!t ? '' : t.kind === 'unit' ? `unit:${t.uid}` : `hero:${t.player}`);
export const sel = (key) => `[data-click="${key}"]`;

/** Can this move be made by clicking? (A card whose options mix "no target" with targets can't.) */
function clickable(s, legal, a) {
  if (a.t === 'play' || a.t === 'pounce') {
    if (a.target) return true;
    return legal.filter((b) => b.t === a.t && b.uid === a.uid).length === 1;
  }
  if (a.t === 'ability') return !!a.target || legal.filter((b) => b.t === 'ability').length === 1;
  return true;
}

/** Best of `candidates` for the human, one move ahead: deterministic, no dice. */
function greedy(s, candidates) {
  let best = null, score = -Infinity;
  for (const a of candidates) {
    const next = structuredClone(s);
    try { apply(next, a); } catch { continue; }
    const v = evaluate(next, HUMAN);
    if (v > score) { best = a; score = v; }
  }
  return best;
}

const cost = (id) => CARDS[id]?.cost ?? 0;

/** Named checks a beat can `expect`, so narration never describes something that didn't happen. */
export const CHECKS = {
  humanHasYarn: (s) => s.yarn === HUMAN,
  foeHasYarn: (s) => s.yarn === AI,
  humanHasUnit: (s) => s.players[HUMAN].yard.length > 0,
  foeHasUnit: (s) => s.players[AI].yard.length > 0,
  canPlayUnit: (s) => legalActions(s).some((a) => a.t === 'play' && isUnit(handCard(s, a.uid)?.id)),
  canAttackUnit: (s) => legalActions(s).some((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.target.kind === 'unit'),
  canAttackHero: (s) => legalActions(s).some((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.target.kind === 'hero'),
  canTakeYarn: (s) => legalActions(s).some((a) => a.t === 'takeYarn'),
  canUseAbility: (s) => legalActions(s).some((a) => a.t === 'ability'),
  cantUseAbility: (s) => !legalActions(s).some((a) => a.t === 'ability'),
  foeLostLife: (s) => s.players[AI].lives.length < 9,
  foeLives8: (s) => s.players[AI].lives.length === 8,
  humanLostLife: (s) => s.players[HUMAN].lives.length < 9,
  humanFullLives: (s) => s.players[HUMAN].lives.length === 9,
  playedZoomies: (s, v) => v.played !== undefined && !!keywords(s.players[HUMAN].yard.find((u) => u.uid === v.played)?.id ?? '').zoomies,
  playedResting: (s, v) => v.played !== undefined && !!s.players[HUMAN].yard.find((u) => u.uid === v.played)?.exhausted,
  playedAwake: (s, v) => v.played !== undefined && !s.players[HUMAN].yard.find((u) => u.uid === v.played)?.exhausted,
  round1: (s) => s.round === 1,
  round2: (s) => s.round === 2,
  round3: (s) => s.round === 3,
  humanActionPrompt: (s) => s.prompt?.player === HUMAN && s.prompt.kind === 'action',
  humanPlantPrompt: (s) => s.prompt?.player === HUMAN && s.prompt.kind === 'plant',
  noPounceCards: (s) => !s.players[HUMAN].hand.some((c) => keywords(c.id).pounce),
};

/**
 * Pick the human's move for an `act` step, and the clicks that make it.
 * Returns { action, clicks: [{ key, label }] } where `key` is a data-click value; `action` is null
 * for clicks that don't make a move (opening and cancelling a target choice).
 */
export function plan(s, step, v, humanRng) {
  const p = s.prompt;
  if (!p || p.player !== HUMAN) throw new ScriptError(`act ${step.act}: not the human's turn (prompt ${p?.kind ?? 'none'})`);
  const legal = legalActions(s);
  const want = (kind) => { if (p.kind !== kind) throw new ScriptError(`act ${step.act}: expected a ${kind} prompt, got ${p.kind}`); };
  const hand = s.players[HUMAN].hand;
  const L = step.labels ?? {};

  switch (step.act) {
    case 'mulligan': {
      want('mulligan');
      // The most expensive cards go back: they're the ones you can't play early.
      const n = step.count ?? 2;
      const uids = [...hand].sort((a, b) => cost(b.id) - cost(a.id) || a.uid - b.uid).slice(0, n).map((c) => c.uid);
      return {
        action: { t: 'mulligan', uids },
        clicks: [...uids.map((uid) => ({ key: `hand:${uid}`, label: L.card ?? 'Click a card to swap it' })),
          { key: 'btn:confirm', label: L.confirm ?? 'button' }],
      };
    }
    case 'setupPlant': {
      want('setupPlant');
      const a = chooseAction(s, { skill: 1, random: humanRng });
      return {
        action: a,
        clicks: [...a.uids.map((uid) => ({ key: `hand:${uid}`, label: L.card ?? 'Click a card to plant it' })),
          { key: 'btn:confirm', label: L.confirm ?? 'button' }],
      };
    }
    case 'plant': case 'skipPlant': {
      want('plant');
      if (step.act === 'skipPlant') return { action: { t: 'skipPlant' }, clicks: [{ key: 'btn:skip', label: L.button ?? 'button' }] };
      const a = chooseAction(s, { skill: 1, random: humanRng });
      const uid = a.t === 'plant' ? a.uid : [...hand].sort((x, y) => cost(y.id) - cost(x.id))[0].uid;
      // Burying a card is for good, so the game asks before it does it.
      return { action: { t: 'plant', uid }, clicks: [{ key: `hand:${uid}`, label: L.card ?? 'Click a card to plant it' }, { key: 'btn:confirm', label: L.confirm ?? 'button' }] };
    }
    case 'play': {
      want('action');
      let cands = legal.filter((a) => a.t === 'play' && clickable(s, legal, a));
      if (step.unit) cands = cands.filter((a) => isUnit(handCard(s, a.uid)?.id));
      if (step.untargeted) cands = cands.filter((a) => !a.target);
      if (step.cost !== undefined) cands = cands.filter((a) => cost(handCard(s, a.uid)?.id) === step.cost);
      if (step.zoomies !== undefined) cands = cands.filter((a) => !!keywords(handCard(s, a.uid)?.id ?? '').zoomies === step.zoomies);
      const a = greedy(s, cands);
      if (!a) throw new ScriptError(`act play: nothing playable matches ${JSON.stringify(step)}`);
      const clicks = [{ key: `hand:${a.uid}`, label: L.card ?? 'Click a glowing card' }];
      if (a.target) clicks.push({ key: targetKey(a.target), label: L.target ?? 'Click its target' });
      return { action: a, clicks, played: isUnit(handCard(s, a.uid)?.id) ? a.uid : undefined };
    }
    case 'attack': {
      want('action');
      let cands = legal.filter((a) => a.t === 'attack' && a.attacker.kind === 'unit');
      if (step.target) cands = cands.filter((a) => a.target.kind === step.target);
      // A demo attack should look like one: the target goes down, and the attacker lives.
      const after = (a) => { const next = structuredClone(s); apply(next, a); return next; };
      const alive = (st, t) => st.players.some((pl) => pl.yard.some((u) => u.uid === t.uid));
      if (step.defeats) cands = cands.filter((a) => a.target.kind === 'unit' && !alive(after(a), a.target));
      if (step.survives) cands = cands.filter((a) => alive(after(a), a.attacker));
      const a = greedy(s, cands);
      if (!a) throw new ScriptError(`act attack: no attack on a ${step.target ?? 'target'}`);
      const attacker = { key: targetKey(a.attacker), label: L.attacker ?? 'Click your awake unit' };
      const target = { key: targetKey(a.target), label: L.target ?? (a.target.kind === 'hero' ? 'Click the enemy Hero Cat' : 'Click the enemy unit') };
      const cancel = { key: 'btn:cancel', label: L.cancel ?? 'Changed your mind? Click “Cancel”' };
      // Showing Cancel on its own is not a move: the game is left exactly as it was.
      if (step.onlyCancel) return { action: null, clicks: [attacker, cancel] };
      return { action: a, clicks: [attacker, target] };
    }
    case 'ability': {
      want('action');
      const cands = legal.filter((a) => a.t === 'ability' && clickable(s, legal, a));
      const a = greedy(s, cands);
      if (!a) throw new ScriptError('act ability: the ability cannot be used');
      const clicks = [{ key: 'btn:ability', label: L.button ?? 'button' }];
      if (a.target) clicks.push({ key: targetKey(a.target), label: L.target ?? 'Click its target' });
      return { action: a, clicks };
    }
    case 'pass': want('action'); return { action: { t: 'pass' }, clicks: [{ key: 'btn:pass', label: L.button ?? 'button' }] };
    case 'takeYarn': want('action'); return { action: { t: 'takeYarn' }, clicks: [{ key: 'btn:yarn', label: L.button ?? 'button' }, { key: 'btn:yarn', label: L.confirm ?? 'button' }] };
    case 'decline': want('pounce'); return { action: { t: 'decline' }, clicks: [{ key: 'btn:decline', label: L.button ?? 'button' }] };
    case 'keepLucky': want('lucky'); return { action: { t: 'keepLucky' }, clicks: [{ key: 'btn:keep', label: L.button ?? 'button' }] };
    case 'lucky': {
      want('lucky');
      const a = greedy(s, legal.filter((x) => x.t === 'lucky'));
      if (!a) throw new ScriptError('act lucky: cannot be played');
      return { action: a, clicks: [a.target ? { key: targetKey(a.target), label: L.target ?? 'Click its target' } : { key: 'btn:free', label: L.button ?? 'button' }] };
    }
    default: throw new ScriptError(`unknown act '${step.act}'`);
  }
}

/**
 * `$played` (the unit you played last) and `$handUnit` (a unit in hand you can play now) stand for
 * cards the script can't name in advance.
 */
async function resolveTokens(step, v, driver) {
  if (!JSON.stringify(step).includes('"$')) return step;
  const s = await driver.state();
  const legal = s ? legalActions(s) : [];
  // Prefer a card with rules text, so its enlarged view has keywords to explain.
  const playableUnits = (s?.players[HUMAN].hand ?? []).filter((c) => isUnit(c.id) && legal.some((a) => a.t === 'play' && a.uid === c.uid));
  const handUnit = playableUnits.find((c) => CARDS[c.id].text) ?? playableUnits[0];
  const tokens = {
    $played: v.played !== undefined ? sel(`unit:${v.played}`) : null,
    $handUnit: handUnit ? sel(`hand:${handUnit.uid}`) : null,
  };
  const swap = (x) => {
    if (typeof x === 'string' && x in tokens) {
      if (!tokens[x]) throw new ScriptError(`${x} does not refer to anything right now`);
      return tokens[x];
    }
    return Array.isArray(x) ? x.map(swap) : x;
  };
  return Object.fromEntries(Object.entries(step).map(([k, x]) => [k, swap(x)]));
}

/** Every beat, flattened from the scenes. */
export function beatsOf(script) {
  return script.scenes.flatMap((scene) => scene.beats.map((b) => ({ ...b, scene: scene.id })));
}

/**
 * Walk the script. `driver` does the work:
 *   startGame(), state(), waitHuman(), perform(plan), and — page only — ui(step), beginBeat/endBeat.
 */
export async function direct(script, driver) {
  const v = {};                                   // things beats refer to: $played, …
  const humanRng = mulberry(script.seed * 7 + 3);
  const beats = beatsOf(script);
  for (const beat of beats) {
    await driver.beginBeat?.(beat);
    for (const step of beat.do ?? []) {
      if (step.startGame) { await driver.startGame(step); continue; }
      if (step.foe) { await driver.waitHuman(); continue; }
      if (step.expect) {
        await driver.waitHuman();
        const s = await driver.state();
        for (const name of [].concat(step.expect)) {
          if (!CHECKS[name]) throw new ScriptError(`unknown check '${name}'`);
          if (!CHECKS[name](s, v)) throw new ScriptError(`beat ${beat.id}: expected ${name}`);
        }
        continue;
      }
      if (step.act) {
        await driver.waitHuman();
        const s = await driver.state();
        if (s.winner !== null) throw new ScriptError(`beat ${beat.id}: the game is already over`);
        const p = plan(s, step, v, humanRng);
        await driver.perform(p, step, beat);
        if (p.played !== undefined) v.played = p.played;
        continue;
      }
      if (driver.ui) await driver.ui(await resolveTokens(step, v, driver), beat);
    }
    await driver.endBeat?.(beat);
  }
}

/** The whole game in Node, AI and all: what the recording will play, without a browser. */
export function dryDriver(script, log = () => {}) {
  let s = null;
  const aiRng = mulberry(script.seed);
  return {
    get game() { return s; },
    startGame() {
      s = createGame({ decks: [script.deck, script.foe], names: ['You', 'Opponent'], seed: script.seed });
    },
    state() { return s; },
    waitHuman() {
      if (!s) throw new ScriptError('the game has not started');
      let guard = 0;
      while (s.winner === null && s.prompt?.player === AI) {
        const a = chooseAction(s, { skill: KITTEN_SKILL, random: aiRng });
        log(`  foe: ${JSON.stringify(a)}`);
        apply(s, a);
        if (++guard > 200) throw new ScriptError('the AI never handed the turn back');
      }
    },
    perform(p) {
      if (!p.action) return;
      log(`  you: ${JSON.stringify(p.action)}`);
      apply(s, p.action);
    },
  };
}
