import './style.css';
import './skin.css';
import { clearSave, loadGame, saveGame } from './save';
import { playLogSounds, resetLogSounds, soundEnabled, toggleSound } from './sound';
import { count, summary } from './progress';
import { BASE, FAMILY_INFO, artUrl, backButton, cardUrl, esc, famClass, settingsButton } from './ui';
import { yourCardUrl } from './rarity';
import { deckClick, deckInput, openDeckBuilder, renderDeckBuilder } from './deckbuilder';
import { ACCOUNTS } from './flags';
import {
  accountClick, accountEnter, accountInput, accountOpen, accountPanelOpen, closeAccount, closeAccountPanel, openAccount, renderAccount,
  boardFace, renderAccountPanel, renderAccountRow, signedIn, warmPawtraits,
} from './account';
import { openShowcase, renderShowcase, showcaseArrow, showcaseClick, showcaseEscape, showcaseMounted } from './showcase';
import { deckForKey, isReady, listDecks, customKey, loadChosenDeck, saveChosenDeck } from './mydecks';
import {
  renderTutorial, startTutorial, stopTutorial, tutorialActive, tutorialAfterAction, tutorialBlocksAi, tutorialCardZoomed, tutorialZoomClosed,
} from './tutorial';
import {
  CARDS, DECKS, DECK_RULES, apply, cardName, chooseAction, createGame, deckSize, heroSide, isGuardian, isLush, isSneaky, keywords,
  legalActions, readyTreats, unitHealth, unitPower,
  type Action, type GameState, type PlayerId, type Target, type Unit,
} from '@fruitcats/engine';

// ── Assets ───────────────────────────────────────────────────────────────────────────────────────

/** The painted Yarn Ball (the 🧶 emoji looks like a small blue dot on some devices). */
const YARN_ICON = `<img class="yarn-ico" src="${BASE}ui/yarn.webp" alt="Yarn Ball">`;
// Absolute URLs: a relative url() inside a CSS variable resolves against the stylesheet that uses it
// (dist/assets/…) rather than the page, which broke the backgrounds in the published build.
for (const [name, file] of [['--img-menu-bg', 'menu-bg'], ['--img-playmat', 'playmat'], ['--img-cardback', 'cardback'],
  ['--img-paw', 'icon-paw'], ['--img-heart', 'icon-heart']])
  document.documentElement.style.setProperty(name, `url("${new URL(`${BASE}ui/${file}.webp`, location.href).href}")`);
// --vh = 1% of the height you can actually see. On iPhone Safari, 100vh is taller than the visible
// area (it ignores the toolbars), which made the page scroll; the layout uses this instead.
function updateViewportHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h / 100}px`);
}
updateViewportHeight();
window.addEventListener('resize', updateViewportHeight);
window.visualViewport?.addEventListener('resize', updateViewportHeight);
const heroKey = (s: GameState, p: PlayerId) => `${s.players[p].hero.id}-${s.players[p].hero.grown ? 'bigcat' : 'kitten'}`;

/** The engine logs in the third person; the human player is "You", so fix up the grammar. */
const VERBS: Record<string, string> = {
  plays: 'play', plants: 'plant', passes: 'pass', keeps: 'keep', mulligans: 'mulligan', takes: 'take', loses: 'lose',
  discards: 'discard', wins: 'win', starts: 'start', POUNCES: 'POUNCE', attacks: 'attack', uses: 'use',
};
const humanize = (text: string) =>
  text.replace(/\bYou's\b/g, 'Your')
    .replace(/\bYou (\w+)\b/g, (m, verb: string) => (VERBS[verb] ? `You ${VERBS[verb]}` : m))
    .replace(/\bYou (\w+) their\b/g, 'You $1 your')
    .replace(/(?<!^)(?<![.!] )\bYour\b/g, 'your');

// ── App state ────────────────────────────────────────────────────────────────────────────────────

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

/** Home: the game modes. Solo: deck and difficulty for a game against the AI. Decks: the deck builder.
 *  Collection: your Display Case and the Binder. */
type Screen = 'home' | 'solo' | 'decks' | 'collection' | 'game';
interface Selection {
  label: string;
  options: Action[];
}

/**
 * Whether this browser has played before. A first-timer pressing the big button gets the walkthrough:
 * it used to be a small button in the corner, so most people never saw it.
 */
const PLAYED_KEY = 'fruitcats-played';
const hasPlayed = () => { try { return localStorage.getItem(PLAYED_KEY) === 'yes'; } catch { return false; } };
const markPlayed = () => { try { localStorage.setItem(PLAYED_KEY, 'yes'); } catch { /* private mode: not remembered */ } };

const DIFFICULTY = {
  kitten: { label: 'Kitten', blurb: 'Gentle, for learning', skill: 0.55 },
  cat: { label: 'Cat', blurb: 'A fair match', skill: 0.85 },
  tiger: { label: 'Tiger', blurb: 'Plays its best', skill: 1 },
};
type Difficulty = keyof typeof DIFFICULTY;

let screen: Screen = 'home';
/** What a "Coming soon" mode will do, shown on the home screen after tapping it. */
let homeNote = '';
/** A starter deck's key, or `custom:<id>` for one of your own (see mydecks.ts). */
let myDeck = loadChosenDeck();
let difficulty: Difficulty = hasPlayed() ? 'cat' : 'kitten';   // meet the gentlest opponent first
let game: GameState | null = null;
/** The tutorial isn't saved: its balloons can't pick up halfway through. */
let tutorialGame = false;
let selection: Selection | null = null;
let picks = new Set<number>();
let aiTimer: number | undefined;
/**
 * An action that is about to happen and needs a second click. Planting buries a card for good and
 * Take the Yarn costs the rest of your round, and both used to fire on the first click — a playtester
 * kept planting cards they had only meant to look at.
 */
let confirming: 'yarn' | null = null;
let showRules = false;
let showSettings = false;
let flash = '';
/** Settings > Opponent speed: Fast shortens the AI's thinking pause. Remembered in this browser. */
const SPEED_KEY = 'fruitcats-speed';
type Speed = 'normal' | 'fast';
const SPEED_SCALE: Record<Speed, number> = { normal: 1, fast: 0.4 };
let speed: Speed = (() => { try { return localStorage.getItem(SPEED_KEY) === 'fast' ? 'fast' : 'normal'; } catch { return 'normal'; } })();
/** Multiplier on the AI's "thinking" pause; the dev hook sets it to 0 for automated UI tests. */
let aiDelayScale = SPEED_SCALE[speed];
/**
 * Dev only: `?seed=N&foe=<deck>` deals the same game and makes the AI play the same moves every time,
 * so the tutorial video (tools/demo) can script a whole game in advance.
 */
const devParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const devSeed = devParams?.has('seed') ? Number(devParams.get('seed')) : undefined;
const devFoe = devParams?.get('foe') ?? undefined;
let aiRandom: (() => number) | undefined;

/** The same small seeded generator the engine's simulator uses (tools/demo/director.mjs mirrors it). */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const app = document.getElementById('app')!;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const targetKey = (t?: Target) => (!t ? '' : t.kind === 'unit' ? `unit:${t.uid}` : `hero:${t.player}`);
const actionTarget = (a: Action): Target | undefined => ('target' in a ? a.target : undefined);

function humanPrompt() {
  return game && game.winner === null && game.prompt?.player === HUMAN ? game.prompt : null;
}

function describeWindow(s: GameState): string {
  const w = s.window;
  if (!w) return '';
  const tgt = (t?: Target) => {
    if (!t) return '';
    if (t.kind === 'hero') return t.player === HUMAN ? 'your Hero Cat' : 'their Hero Cat';
    const u = s.players.flatMap((pl) => pl.yard).find((x) => x.uid === t.uid);
    return u ? cardName(u.id) : 'a unit';
  };
  if (w.kind === 'play') return `Opponent plays <b>${esc(cardName(w.card.id))}</b>${w.target ? ` targeting <b>${tgt(w.target)}</b>` : ''}.`;
  const attacker = w.attacker.kind === 'hero' ? 'their Big Cat' : tgt(w.attacker);
  return `Opponent attacks <b>${tgt(w.target)}</b> with <b>${attacker}</b>.`;
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

/** Where the opponent's latest moves start in the log, and which of its units are new since then. */
let foeFrom = 0;
let foeUnitsBefore = new Set<number>();
/** The round each unit arrived in: a unit that arrived this round is resting, not spent. */
const unitArrivals = new Map<number, number>();

/** Opponent units already on screen, so the arrival animation plays once per unit, not per re-render. */
let renderedFoeUnits = new Set<number>();
/** Each Treat's state on screen last time (card uid → spent?), so planting, spending and readying animate once. */
let renderedTreats = new Map<number, boolean>();
/** A friendly confirmation of the player's own last move (e.g. what they just planted). */
let notice = '';

function markHumanTurnDone() {
  if (!game) return;
  foeFrom = game.log.length;
  foeUnitsBefore = new Set(game.players[AI].yard.map((u) => u.uid));
}

/** What the opponent has done since your last action, for the recap line in the prompt bar. */
function foeRecap(s: GameState): string[] {
  return s.log.slice(foeFrom)
    .filter((e) => e.player === AI && !/plants? |keeps their hand|mulligans/.test(e.text))
    .map((e) => humanize(e.text));
}

function act(action: Action) {
  if (!game) return;
  const me = game.players[HUMAN];
  const planted = action.t === 'plant' ? [action.uid] : action.t === 'setupPlant' ? action.uids : [];
  const plantedNames = planted.map((uid) => cardName(me.hand.find((c) => c.uid === uid)?.id ?? ''));
  try {
    apply(game, action);
    tutorialAfterAction(action);
    markHumanTurnDone();
    flash = '';
    notice = plantedNames.length
      ? `Planted ${plantedNames.join(' and ')} as ${plantedNames.length > 1 ? 'Treats' : 'a Treat'} — you have ${me.pantry.length}.`
      : '';
  } catch (error) {
    flash = (error as Error).message;
  }
  selection = null;
  confirming = null;
  picks = new Set();
  render();
  scheduleAi();
}

function scheduleAi() {
  window.clearTimeout(aiTimer);
  if (!game || game.winner !== null || game.prompt?.player !== AI) return;
  if (tutorialBlocksAi()) return; // resumed when the balloon is closed
  const delay = aiDelayScale * (game.prompt.kind === 'pounce' || game.prompt.kind === 'plant' ? 450 : 850);
  aiTimer = window.setTimeout(() => {
    if (!game || game.prompt?.player !== AI) return;
    apply(game, chooseAction(game, { skill: tutorialActive() ? 0.45 : DIFFICULTY[difficulty].skill, random: aiRandom }));
    render();
    scheduleAi();
  }, delay);
}

function startGame(tutorial = false) {
  // The opponent leads one of the other decks, at random. The tutorial is always Sunny vs Pippin,
  // with you going first, so its balloons can talk about specific cards.
  // Against your own deck, it leads a starter with a different Hero Cat.
  const mine = deckForKey(myDeck) ?? DECKS['zest-rush'];
  const others = Object.keys(DECKS).filter((d) => DECKS[d].hero !== mine.hero);
  const theirDeck = tutorial ? 'orchard-guard'
    : devFoe && others.includes(devFoe) ? devFoe : others[Math.floor(Math.random() * others.length)];
  game = tutorial
    ? createGame({ decks: ['zest-rush', 'orchard-guard'], names: ['You', 'Opponent'], firstPlayer: HUMAN })
    : createGame({ decks: [mine, theirDeck], names: ['You', 'Opponent'], seed: devSeed });
  aiRandom = devSeed === undefined || tutorial ? undefined : mulberry(devSeed);
  tutorialGame = tutorial;
  resetLogSounds(game);
  unitArrivals.clear();
  if (tutorial) startTutorial({
    game: () => game, rerender: render, resumeAi: scheduleAi,
    selection: () => selection && { label: selection.label, attack: selection.options.every((a) => a.t === 'attack') },
    skipped: markPlayed,
  });
  else stopTutorial();
  // Swapping cards before you know what a card costs is a decision made in the dark, so on a first
  // game the hand is kept for you and the bar says so. (The engine always asks; the app may answer.)
  if (tutorial && game.prompt?.kind === 'mulligan' && game.prompt.player === HUMAN) {
    const hand = game.players[HUMAN].hand;
    const cheap = hand.filter((c) => (CARDS[c.id].cost ?? 0) <= 2 && CARDS[c.id].type !== 'Trick');
    // A hand with nothing cheap cannot make a first move, so swap its priciest cards: an ordinary
    // legal mulligan, which cuts dead openings from about 6% to about 2%.
    const priciest = [...hand].sort((a, b) => (CARDS[b.id].cost ?? 0) - (CARDS[a.id].cost ?? 0)).slice(0, 3);
    const swap = cheap.length ? [] : priciest.map((c) => c.uid);
    apply(game, { t: 'mulligan', uids: swap });
    notice = swap.length
      ? 'Swapped your 3 priciest cards for fresh ones — that free redraw is called a mulligan.'
      : 'Kept your opening hand. Every game starts with one free redraw — a mulligan — and I took it for you.';
  }
  markHumanTurnDone();
  screen = 'game';
  selection = null;
  confirming = null;
  picks = new Set();
  render();
  scheduleAi();
}

/**
 * What each keyword means, in plain words. Shown under a card when you enlarge it (press and hold),
 * because a playtester kept forgetting what Zest did and iOS has no hover to put a tooltip on.
 * `test` finds the keyword in the card's rules text.
 */
const GLOSSARY: { name: string; test: RegExp; text: string }[] = [
  { name: 'Zest', test: /\bZest\b/, text: 'A bonus if this is not the first card you have played this round. (Citrus)' },
  { name: 'Ripen', test: /\bRipens?\b/, text: 'At the start of each round this unit gets +1 Power and +1 Health, up to +2/+2. (Orchard)' },
  { name: 'Sprout', test: /\bSprout\b/, text: 'Put that many cards from the top of your deck into your Treats. (Tropical)' },
  { name: 'Lush', test: /\bLush\b/, text: 'This bonus is on while you have 7 or more Treats. (Tropical)' },
  { name: 'Guardian', test: /\bGuardian\b/, text: 'Your opponent must attack this unit before your other units or your Hero Cat.' },
  { name: 'Sneaky', test: /\bSneaky\b/, text: 'Can attack straight past enemy Guardians.' },
  { name: 'Fierce', test: /\bFierce\b/, text: 'When this hits a Hero Cat, that player loses 2 Lives instead of 1.' },
  { name: 'Zoomies', test: /\bZoomies\b/, text: 'Can attack the round it arrives, instead of starting tired.' },
  { name: 'Tough', test: /\bTough\b/, text: 'Takes that much less damage from every hit.' },
  { name: 'Lucky', test: /\bLucky\b/, text: 'If this card turns up as a Life you lost, you may play it for free.' },
  { name: 'Pounce', test: /\bPounce\b/, text: 'Play this out of turn, right after your opponent plays a card or attacks.' },
  { name: 'Hello', test: /\bHello\b/, text: 'Happens as soon as this card arrives.' },
  { name: 'Goodbye', test: /\bGoodbye\b/, text: 'Happens when this unit is defeated.' },
  { name: 'Grow Up', test: /\bGrow Up\b/, text: 'Once this is true, your Kitten becomes a Big Cat: stronger, and able to attack.' },
  // "Exhaust:" is the cost of a Hero Cat's ability; "Exhaust an enemy unit" is an effect. One line covers both.
  { name: 'Exhaust', test: /\bExhaust\b/, text: 'Spend a card for the rest of the round: it tips sideways and cannot attack or be spent again until everything readies next round.' },
];

/** The rules text of whatever a long press enlarged: a card id, or a Hero Cat side like "SB1-H01-bigcat". */
function zoomText(key: string): string {
  const side = /^(.*)-(kitten|bigcat)$/.exec(key);
  const card = CARDS[side ? side[1] : key];
  if (!card) return '';
  if (!side) return card.text ?? '';
  return (side[2] === 'kitten' ? card.kitten?.text : card.bigCat?.text) ?? '';
}

/** A plain-language reason a card in hand can't be played right now. */
function whyUnplayable(s: GameState, id: string, promptKind: string): string {
  const def = CARDS[id];
  const name = cardName(id);
  const ready = readyTreats(s, HUMAN);
  const k = keywords(id);
  if (promptKind === 'pounce') return k.pounce ? `${name} has no useful target right now.` : `Only Pounce cards can be played while your opponent is acting — ${name} isn't one.`;
  if (promptKind !== 'action') return `You can't play cards right now.`;
  if (id === 'SB1-O09') return `${name} can only be played when your opponent attacks (it's a Pounce reaction).`;
  if ((def.cost ?? 0) > ready) return `${name} costs ${def.cost} Treats — you have ${ready} ready. Spent Treats come back at the start of next round.`;
  const yard = s.players[HUMAN].yard;
  if ((def.type === 'Cat' || def.type === 'Critter') && yard.length >= 6) return `Your Yard is full (6 units).`;
  if (def.type === 'Cat' && yard.some((u) => u.id === id)) return `${name} is already in your Yard, and Cats are one of a kind.`;
  if (def.type === 'Toy') return `${name} needs one of your units without a Toy to attach to.`;
  return `${name} has no legal target right now.`;
}

function select(label: string, options: Action[]) {
  if (!options.length) return;
  const untargeted = options.filter((a) => !actionTarget(a));
  if (options.length === 1 && untargeted.length === 1) return act(options[0]);
  selection = { label, options };
  render();
}

function onClick(key: string) {
  const [kind, raw] = key.split(':');
  const value = Number(raw);

  if (kind === 'home') {
    homeNote = '';
    // With accounts on, your cards live in your account: signed out, these tiles open "Sign in or create account",
    // then carry on to where you were going.
    const needs = ACCOUNTS && !signedIn() ? ACCOUNT_TILES[raw] : undefined;
    if (needs) { openAccount({ render }, needs, () => onClick(key)); return; }
    if (raw === 'solo') screen = 'solo';
    else if (raw === 'decks') { openDeckBuilder(); screen = 'decks'; }
    else if (raw === 'collection') { openShowcase({ render }); screen = 'collection'; }
    else if (raw === 'continue') { if (resumeSavedGame()) { render(); scheduleAi(); return; } }
    else if (raw === 'tutorial') { startGame(true); return; }
    else if (raw === 'soon') homeNote = MODES.find((m) => m.key === key.split(':')[2])?.soon ?? '';
    render();
    return;
  }
  if (kind === 'solo') {
    // Always a normal game: the guided one is the Tutorial, which Home puts first until you've played.
    if (raw === 'play') { startGame(); return; }
    if (raw in DIFFICULTY) difficulty = raw as Difficulty;
    else {
      const deckKey = key.slice('solo:'.length);   // your own decks' keys have a colon: custom:<id>
      const deck = deckForKey(deckKey);
      if (deck && isReady(deck)) { myDeck = deckKey; saveChosenDeck(deckKey); }
    }
    render();
    return;
  }
  if (kind === 'deck') {
    deckClick(raw, key.split(':')[2] ?? '', { render });
    return;
  }
  if (kind === 'col') {
    showcaseClick(raw, key.split(':').slice(2).join(':'), { render });
    return;
  }
  if (ACCOUNTS && kind === 'acct') {
    if (raw === 'open') showSettings = false;
    void accountClick({ render }, key.slice('acct:'.length));
    return;
  }
  if (kind === 'set') {
    const choice = key.split(':')[2];
    if (raw === 'sound' && (choice === 'on') !== soundEnabled()) toggleSound();
    if (raw === 'speed' && (choice === 'normal' || choice === 'fast')) {
      speed = choice;
      aiDelayScale = SPEED_SCALE[speed];
      try { localStorage.setItem(SPEED_KEY, speed); } catch { /* private mode: not remembered */ }
    }
    render();
    return;
  }
  if (kind === 'ui') {
    if (raw === 'rules') showRules = !showRules;
    // Closing Settings also leaves the Account panel, so Settings opens on its main page next time.
    if (raw === 'settings') { showSettings = !showSettings; if (ACCOUNTS) { closeAccountPanel(); if (showSettings) warmPawtraits(); } }
    if (raw === 'back') { screen = 'home'; homeNote = ''; }
    if (raw === 'quit') { window.clearTimeout(aiTimer); stopTutorial(); game = null; screen = 'home'; homeNote = ''; }
    if (raw === 'again') { startGame(); return; }
    render();
    return;
  }

  const prompt = humanPrompt();
  if (!game || !prompt) return;
  const legal = legalActions(game);

  // A pending selection (or a prompt that is itself a target choice) consumes clicks on its targets.
  const pending = selection?.options ?? (prompt.kind === 'choose' || prompt.kind === 'lucky' ? legal : null);
  if (pending && (kind === 'unit' || kind === 'hero')) {
    const match = pending.find((a) => targetKey(actionTarget(a)) === key);
    if (match) return act(match);
  }

  if (kind === 'btn') {
    switch (raw) {
      case 'pass': return act({ t: 'pass' });
      case 'yarn':
        if (confirming !== 'yarn') { confirming = 'yarn'; render(); return; }
        confirming = null;
        return act({ t: 'takeYarn' });
      case 'decline': return act({ t: 'decline' });
      case 'skip': return act({ t: 'skipPlant' });
      case 'keep': return act({ t: 'keepLucky' });
      case 'free': return act(legal.find((a) => a.t === 'lucky' && !a.target)!);
      case 'cancel': selection = null; confirming = null; picks = new Set(); render(); return;
      case 'confirm':
        if (prompt.kind === 'mulligan') return act({ t: 'mulligan', uids: [...picks] });
        if (prompt.kind === 'setupPlant') return act({ t: 'setupPlant', uids: [...picks] });
        if (prompt.kind === 'discard') return act({ t: 'discard', uids: [...picks] });
        if (prompt.kind === 'plant' && picks.size === 1) return act({ t: 'plant', uid: [...picks][0] });
        return;
      case 'ability': return select('your Hero Cat ability', legal.filter((a) => a.t === 'ability'));
      case 'heroattack':
        return select('your Big Cat’s attack', legal.filter((a) => a.t === 'attack' && a.attacker.kind === 'hero'));
    }
    return;
  }

  if (kind === 'hand') {
    if (prompt.kind === 'mulligan' || prompt.kind === 'setupPlant' || prompt.kind === 'discard') {
      if (picks.has(value)) picks.delete(value);
      else if (prompt.kind === 'mulligan' || picks.size < prompt.count) picks.add(value);
      render();
      return;
    }
    if (prompt.kind === 'plant') {           // pick it, then confirm: this buries the card for good
      if (picks.has(value)) picks.delete(value);
      else { picks.clear(); picks.add(value); }
      render();
      return;
    }
    const card = game.players[HUMAN].hand.find((c) => c.uid === value)!;
    const options = legal.filter((a) => (a.t === 'play' || a.t === 'pounce') && a.uid === value);
    if (!options.length) {
      flash = whyUnplayable(game, card.id, prompt.kind);
      render();
      return;
    }
    return select(cardName(card.id), options);
  }

  if (kind === 'unit' && prompt.kind === 'action') {
    const options = legal.filter((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === value);
    const unit = game.players[HUMAN].yard.find((u) => u.uid === value);
    if (unit && options.length) {
      selection = { label: `${cardName(unit.id)}’s attack`, options };
      render();
    }
  }
}

// ── Saving ───────────────────────────────────────────────────────────────────────────────────────
//
// Every change to the game ends in a render, so that is where it is saved. Closing the tab or going
// back Home keeps the game: the home screen then offers to continue it at the same decision, and a new
// Solo game replaces it. A finished game is forgotten.

function persist() {
  if (!game || tutorialGame) return;
  if (game.winner !== null) { clearSave(); return; }
  saveGame({
    game, difficulty, unitArrivals: [...unitArrivals], foeFrom, foeUnitsBefore: [...foeUnitsBefore],
  });
}

function resumeSavedGame(): boolean {
  const save = loadGame();
  if (!save) return false;
  game = save.game;
  tutorialGame = false;
  if (save.difficulty in DIFFICULTY) difficulty = save.difficulty as Difficulty;
  unitArrivals.clear();
  for (const [uid, round] of save.unitArrivals ?? []) unitArrivals.set(uid, round);
  foeFrom = save.foeFrom ?? game.log.length;
  foeUnitsBefore = new Set(save.foeUnitsBefore ?? []);
  // What's already on the board was on screen before: don't animate it arriving again.
  renderedFoeUnits = new Set(game.players[AI].yard.map((u) => u.uid));
  renderedTreats = new Map(game.players.flatMap((pl) => pl.pantry.map((t) => [t.card.uid, t.exhausted] as [number, boolean])));
  resetLogSounds(game);
  screen = 'game';
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

function render() {
  document.body.className = screen === 'game' ? 'game-screen' : 'menu-screen';
  // Scrolling lists (the deck builder's cards) keep their place when the screen is redrawn.
  const scrolled = new Map([...app.querySelectorAll<HTMLElement>('[data-keep-scroll]')]
    .map((el) => [el.dataset.keepScroll, [el.scrollTop, el.scrollLeft]] as const));
  app.innerHTML = (screen === 'home' ? renderHome() : screen === 'solo' ? renderSolo() : screen === 'decks' ? renderDeckBuilder()
    : screen === 'collection' ? renderShowcase() : renderGame())
    + (showSettings ? renderSettings() : '') + (ACCOUNTS ? renderAccount() : '');
  for (const el of app.querySelectorAll<HTMLElement>('[data-keep-scroll]'))
    [el.scrollTop, el.scrollLeft] = scrolled.get(el.dataset.keepScroll) ?? [0, 0];
  if (screen === 'collection') showcaseMounted();
  if (screen === 'solo') deckCarouselMounted(!scrolled.has('decks'));
  renderedFoeUnits = new Set(game?.players[AI].yard.map((u) => u.uid) ?? []);
  renderedTreats = new Map(game ? game.players.flatMap((pl) => pl.pantry.map((t) => [t.card.uid, t.exhausted] as [number, boolean])) : []);
  if (screen === 'game') { renderTutorial(showRules || showSettings); playLogSounds(game, HUMAN); } else stopTutorial();
  persist();
  // Never let the page end up scrolled sideways (a focused or enlarged card could otherwise do it).
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

/**
 * The home screen's modes, in two groups with space between them: playing (Solo, Friend, Ranked), then
 * your cards (Collection, Store, Deck builder). Coming-soon modes say what they will be.
 */
const MODE_GROUPS = [
  [
    { key: 'solo', name: 'Solo', sub: 'vs the AI', soon: '' },
    { key: 'friend', name: 'Friend', sub: 'Online',
      soon: 'Play a friend online: send them a link, they pick a deck, and you each play on your own device.' },
    { key: 'ranked', name: 'Ranked', sub: 'The ladder',
      soon: 'Ranked games against other players, with an Elo rating and a ladder to climb.' },
  ],
  [
    { key: 'collection', name: 'Collection', sub: 'Your cards', soon: '' },
    { key: 'store', name: 'Store', sub: 'New cards', soon: 'A store for new decks and cards.' },
    { key: 'decks', name: 'Deck builder', sub: 'Your decks', soon: '' },
  ],
];
const MODES = MODE_GROUPS.flat();

/** With accounts on, the tiles that need one, and the line on why that heads "Sign in or create account". */
const ACCOUNT_TILES: Record<string, string> = {
  collection: 'Your collection lives in your Via Mochi account, so it’s on every device.',
  decks: 'Your decks live in your Via Mochi account, so they’re on every device.',
};

/** The unfinished game, for the Resume button: "Round 4 · Sunny vs Pippin". */
function savedGameLabel(): string | null {
  const saved = loadGame()?.game;
  return saved ? `Round ${saved.round} · <span class="nowrap">${saved.players.map((pl) => esc(cardName(pl.hero.id))).join(' vs ')}</span>` : null;
}

function renderHome(): string {
  // Mochi, the mightiest Hero Cat, takes the centre spot.
  const heroes = ['SB1-P01-bigcat', 'SB1-H02-bigcat', 'SB1-H03-bigcat', 'SB1-H01-bigcat', 'SB1-P03-bigcat'];
  const saved = savedGameLabel();
  return `
  <div class="menu home">
    ${settingsButton('corner-settings')}
    <div class="hero-parade">
      ${heroes.map((k, i) => `<div class="parade-cat c${i}" style="background-image:url(${artUrl(k)})"></div>`).join('')}
    </div>
    <header class="title">
      <h1>Fruitcats</h1>
      <p>A cozy card game of fruit-hooded cats.</p>
    </header>
    <nav class="modes">
      ${MODE_GROUPS.map((group) => `
      <div class="mode-group">
        ${group.map((m) => {
          // Every tile is the same: picture, name, and one line under it. That line says "Coming soon",
          // or on Solo, that a game is waiting to be continued.
          const resume = m.key === 'solo' && saved;
          const needsAccount = ACCOUNTS && !signedIn() && m.key in ACCOUNT_TILES;
          const status = m.soon ? '<span class="mode-sub soon-line">Coming soon</span>'
            : needsAccount ? '<span class="mode-sub signin-line">Sign in to open</span>'
            : resume ? `<span class="mode-sub continue-line">Resume · Round ${loadGame()!.game.round}</span>`
            : `<span class="mode-sub">${m.sub}</span>`;
          return `
        <button class="mode-card ${m.soon ? 'soon' : ''} ${resume ? 'has-save' : ''}" data-click="${m.soon ? `home:soon:${m.key}` : `home:${m.key}`}">
          <img src="${BASE}ui/mode-${m.key}.webp" alt="">
          <span class="mode-text"><span class="mode-name">${m.name}</span>${status}</span>
        </button>`;
        }).join('')}
      </div>`).join('')}
    </nav>
    <p class="home-note" aria-live="polite">${esc(homeNote)}</p>
    <footer class="home-footer">
      <button class="footer-button" data-click="home:tutorial" title="A guided first game with tips">
        <img class="btn-ico" src="${BASE}ui/icon-tutorial.webp" alt="">Tutorial</button>
      <a class="footer-button" href="${BASE}docs.html"><img class="btn-ico" src="${BASE}ui/icon-rules.webp" alt="">Documentation</a>
    </footer>
  </div>`;
}

function renderDeckPicker(): string {
  const deckBlurb: Record<string, string> = {
    'zest-rush': 'Fast and fierce. Swarm the yard, dodge Guardians, and finish before they recover.',
    'orchard-guard': 'Patient and sturdy. Wall up with Guardians, heal, punish attackers, win the long game.',
    'mango-tango': 'Laid-back, then enormous. Gather extra Treats, then drop giants. Led by Mochi, the mightiest Hero Cat.',
  };
  // The chosen deck may have been deleted, or edited below 50 cards, since it was chosen.
  const chosen = deckForKey(myDeck);
  if (!chosen || !isReady(chosen)) myDeck = Object.keys(DECKS)[0];
  // Every deck is the same card in one carousel: the starters, then your own. One of yours still short
  // of 50 cards shows, but can't be picked yet.
  const decks = [
    ...Object.entries(DECKS).map(([key, deck]) => ({ key, deck, ready: true, blurb: deckBlurb[key] ?? '' })),
    ...listDecks().map((d) => {
      const ready = isReady(d);
      return { key: customKey(d.id), deck: d, ready,
        blurb: ready ? `Your own deck, led by ${esc(cardName(d.hero))}.`
          : `<span class="deck-unready">Not finished: ${deckSize(d)} / ${DECK_RULES.size} cards</span>` };
    }),
  ];
  return `
    <section class="picker deck-picker">
      <h2>Choose your deck</h2>
      <div class="deck-carousel">
        <div class="deck-track" data-keep-scroll="decks">
          <div class="deck-choices">
            ${decks.map(({ key, deck, ready, blurb }) => `
              <button class="deck-choice ${key.startsWith('custom:') ? 'mine' : ''} ${key === myDeck ? 'chosen' : ''}" data-click="solo:${key}" ${ready ? '' : 'disabled'}>
                <img src="${yourCardUrl(`${deck.hero}-kitten`)}" alt="${esc(CARDS[deck.hero].name)}">
                <span class="deck-name">${esc(deck.name)}</span>
                <span class="deck-class ${famClass(deck.hero)}">${esc(CARDS[deck.hero].family)} · ${esc(FAMILY_INFO[CARDS[deck.hero].family]?.mechanic ?? '')}</span>
                <span class="deck-blurb">${blurb}</span>
              </button>`).join('')}
          </div>
        </div>
        <button class="deck-arrow prev" data-deck-scroll="-1" aria-label="Previous decks">‹</button>
        <button class="deck-arrow next" data-deck-scroll="1" aria-label="More decks">›</button>
      </div>
    </section>`;
}

/**
 * The deck carousel, after each render: the chosen deck is slid into view if it's hidden (on arriving,
 * or after tapping one peeking at the edge), and the arrows show only where there are more decks.
 */
function deckCarouselMounted(first: boolean) {
  const track = app.querySelector<HTMLElement>('.deck-track');
  const chosen = track?.querySelector<HTMLElement>('.deck-choice.chosen');
  if (!track) return;
  if (chosen) {
    const t = track.getBoundingClientRect(), c = chosen.getBoundingClientRect();
    if (c.left < t.left || c.right > t.right)
      track.scrollTo({ left: track.scrollLeft + c.left - t.left - (t.width - c.width) / 2, behavior: first ? 'instant' : 'smooth' });
  }
  const carousel = track.parentElement!;
  const update = () => {
    carousel.classList.toggle('at-start', track.scrollLeft <= 4);
    carousel.classList.toggle('at-end', track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  };
  update();
  track.addEventListener('scroll', update, { passive: true });
}

function renderSolo(): string {
  const saved = savedGameLabel();
  return `
  <div class="menu solo">
    <div class="setup-bar">
      ${backButton()}
      <h2>Solo game</h2>
      ${settingsButton()}
    </div>
    <div class="setup-body">
      ${renderDeckPicker()}
      <section class="picker difficulty-picker">
        <h2>Difficulty</h2>
        <div class="difficulty-choices">
          ${Object.entries(DIFFICULTY).map(([key, d]) => `
            <button class="difficulty-choice ${key === difficulty ? 'chosen' : ''}" data-click="solo:${key}" aria-pressed="${key === difficulty}">
              <img src="${BASE}ui/diff-${key}.webp" alt="">
              <span class="diff-name">${d.label}</span>
              <span class="diff-sub">${d.blurb}</span>
            </button>`).join('')}
        </div>
      </section>
    </div>
    <div class="setup-footer">
      ${saved ? `
      <div class="resume-buttons">
        <button class="play-button twin" data-click="home:continue">
          <span class="twin-name">Resume game</span><span class="twin-sub">${saved}</span></button>
        <button class="play-button twin" data-click="solo:play" title="Start a new game with the deck and difficulty above; it replaces the unfinished one">
          <span class="twin-name">New game</span><span class="twin-sub">${esc(deckForKey(myDeck)?.name ?? '')} · ${DIFFICULTY[difficulty].label}</span></button>
      </div>` : '<button class="play-button" data-click="solo:play">Play</button>'}
    </div>
    <p class="coming">Coming soon: ${Object.values(CARDS).filter((c) => c.preview).map((c) => esc(c.name)).join(' · ')}</p>
  </div>`;
}

function renderGame(): string {
  const s = game!;
  const prompt = humanPrompt();
  const targets = new Set((selection?.options ?? (prompt?.kind === 'choose' || prompt?.kind === 'lucky' ? legalActions(s) : []))
    .map((a) => targetKey(actionTarget(a))).filter(Boolean));
  const legal = prompt ? legalActions(s) : [];
  const attackers = new Set(legal.flatMap((a) => (a.t === 'attack' && a.attacker.kind === 'unit' ? [a.attacker.uid] : [])));
  const playable = new Set(legal.flatMap((a) => (a.t === 'play' || a.t === 'pounce' ? [a.uid] : [])));

  return `
  <div class="game">
    <main class="board ${targets.size ? 'targeting' : ''}">
      ${renderPlayer(s, AI, targets)}
      ${renderYard(s, AI, targets, attackers)}
      ${renderMidbar(s, legal)}
      ${renderYard(s, HUMAN, targets, attackers)}
      ${renderPlayer(s, HUMAN, targets, legal)}
      ${renderHand(s, playable)}
    </main>
    <aside class="side">
      <div class="inspector"><img id="zoom" src="${yourCardUrl(heroKey(s, HUMAN))}" alt=""></div>
      <div class="side-buttons">
        <button data-click="ui:rules">Rules</button>
        ${settingsButton()}
        <button data-click="ui:quit">Home</button>
      </div>
      <div class="log-panel"><h3>Story so far</h3><ul class="log">${s.log.slice(-80).reverse().map((e) => `<li class="${e.player === HUMAN ? 'me' : e.player === AI ? 'foe' : e.text.startsWith('—') ? 'sys' : ''}">${esc(humanize(e.text))}</li>`).join('')}</ul></div>
    </aside>
    ${s.winner !== null ? renderGameOver(s) : ''}
    ${showRules ? renderRules() : ''}
  </div>`;
}

/**
 * The Treats tray at the end of each Yard: one face-down card per Treat. Ready Treats stand upright,
 * spent ones lie sideways. Planting, spending and readying each animate once, with a floating label,
 * so you can see resources move. You may look at your own Treats (rule 4) — hold one to read it.
 */
function renderPantry(s: GameState, p: PlayerId): string {
  const pl = s.players[p];
  const mine = p === HUMAN;
  let planted = 0, spent = 0, readied = 0;
  const tokens = pl.pantry.map((t) => {
    const before = renderedTreats.get(t.card.uid);
    const change = before === undefined ? 'new' : !before && t.exhausted ? 'spending' : before && !t.exhausted ? 'readying' : '';
    if (change === 'new') planted++;
    if (change === 'spending') spent++;
    if (change === 'readying') readied++;
    const cls = ['treat', t.exhausted && 'spent', change, mine && 'mine'].filter(Boolean).join(' ');
    const zoom = mine ? ` data-zoom="${yourCardUrl(t.card.id)}" data-zoom-card="${t.card.id}"` : '';
    return `<div class="${cls}"${zoom} title="${mine ? esc(CARDS[t.card.id].name) + ' — ' : ''}${t.exhausted ? 'spent this round' : 'ready to spend'}"></div>`;
  }).join('');
  const float = planted ? `+${planted} Treat${planted > 1 ? 's' : ''}` : spent ? `−${spent}` : readied ? 'Ready!' : '';
  const ready = readyTreats(s, p);
  return `<div class="pantry ${mine ? 'me' : 'foe'}" title="Treats are face-down cards that pay for other cards. They all get ready again at the start of each round.">
    <div class="pantry-label" title="Treats pay for your cards: a card costs the number in its top-left corner. Spent Treats ready again next round.">Treats <b>${ready}</b><span>/${pl.pantry.length} ready</span></div>
    ${isLush(s, p) && CARDS[pl.hero.id].family === 'Tropical' ? '<div class="lush-badge" title="Lush: 7 or more Treats — Lush bonuses are on">🌴 Lush</div>' : ''}
    <div class="treats" style="--n:${Math.max(1, pl.pantry.length)}">${tokens}</div>
    ${float ? `<span class="tray-float ${planted ? 'plus' : spent ? 'minus' : 'ready'}">${float}</span>` : ''}
  </div>`;
}

function renderPlayer(s: GameState, p: PlayerId, targets: Set<string>, legal: Action[] = []): string {
  const pl = s.players[p];
  const side = heroSide(s, p);
  const key = `hero:${p}`;
  // The Yarn Ball sits on the corner of the Hero Cat portrait (next to the name it crowded the Lives).
  const yarn = s.yarn === p ? `<span class="yarn" title="Holds the Yarn Ball: acts first">${YARN_ICON}${s.yarnTaken === p ? '<small>kept</small>' : ''}</span>` : '';
  const took = s.yarnTaken === p && s.yarn !== p ? `<span class="yarn" title="Took the Yarn Ball for next round">${YARN_ICON}<small>next</small></span>` : '';
  const canAbility = legal.some((a) => a.t === 'ability');
  const canAttack = legal.some((a) => a.t === 'attack' && a.attacker.kind === 'hero');

  return `
  <section class="player ${p === HUMAN ? 'me' : 'foe'} ${s.prompt?.player === p && s.winner === null ? 'thinking' : ''}">
    <div class="hero-slot">
    <div class="hero ${famClass(pl.hero.id)} ${pl.hero.exhausted ? 'exhausted' : ''} ${targets.has(key) ? 'targetable' : ''} ${pl.hero.grown ? 'grown' : ''}"
         data-click="${key}" data-zoom="${(p === HUMAN ? yourCardUrl : cardUrl)(heroKey(s, p))}" data-zoom-card="${heroKey(s, p)}">
      <div class="art" style="background-image:url(${artUrl(heroKey(s, p))})"></div>
      ${side.power ? `<div class="pow">${side.power}</div>` : ''}
    </div>
    ${yarn}${took}
    </div>
    <div class="stats">
      <div class="who">${esc(pl.name)} <span class="deck">${esc(pl.deckName)}</span></div>
      <div class="stat-row">
        <div class="lives" title="${pl.lives.length} of 9 Lives left"><span class="life-heart ${pl.lives.length <= 3 ? 'low' : ''}"><b>${pl.lives.length}</b></span></div>
        <div class="counters">
          <span title="Cards in hand">✋ ${pl.hand.length}</span>
          <span title="Cards in deck">📚 ${pl.deck.length}</span>
          <span title="Compost (discard pile)">🍂 ${pl.compost.length}</span>
        </div>
      </div>
      <div class="ability" title="${esc(side.text)}">${esc(side.text).replace(/(Exhaust[^:]*:|Grow Up:)/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
    </div>
    ${p === HUMAN && (canAbility || canAttack) ? `<div class="hero-actions">
      ${canAbility ? '<button class="primary" data-click="btn:ability">Use ability</button>' : ''}
      ${canAttack ? '<button class="primary" data-click="btn:heroattack">Big Cat attack</button>' : ''}
    </div>` : ''}
    ${p === AI ? `<div class="foe-hand">${pl.hand.map(() => '<div class="card-back"></div>').join('')}</div>` : ''}
    ${ACCOUNTS ? `<div class="player-face">${boardFace(p === HUMAN ? 'you' : 'computer', CARDS[pl.hero.id].family)}</div>` : ''}
  </section>`;
}

/**
 * Why a unit is tilted with "zzz". A unit arrives tired and cannot attack until the next round
 * (unless it has Zoomies); after it attacks or is exhausted by a card it is spent for the round.
 * Everything wakes up at the start of the next round.
 */
function restingLabel(u: Unit): { tag: string; why: string } {
  const arrived = unitArrivals.get(u.uid) === game?.round;
  if (!u.exhausted)
    return arrived && keywords(u.id).zoomies
      ? { tag: '', why: 'Zoomies: it can attack the very round it arrives, instead of resting first.' }
      : { tag: '', why: 'Ready: it can attack this round.' };
  return arrived
    ? { tag: 'new', why: 'Just arrived, so it is still settling in. It wakes up at the start of the next round and can attack then.' }
    : { tag: 'zzz', why: 'Already acted this round. It wakes up at the start of the next round.' };
}

function renderUnit(u: Unit, owner: PlayerId, targets: Set<string>, attackers: Set<number>): string {
  const k = keywords(u.id);
  const power = unitPower(u);
  const health = unitHealth(u) - u.damage;
  const chips = [
    isGuardian(u) && 'Guardian', isSneaky(u) && 'Sneaky', k.fierce && 'Fierce', k.tough && `Tough ${k.tough}`,
    k.ripen && (u.ripe ? `🍎+${u.ripe}` : '🍎 Ripen'),
    u.toy && `🧸 ${cardName(u.toy.id)}`,
  ].filter(Boolean);
  const key = `unit:${u.uid}`;
  if (game && !unitArrivals.has(u.uid)) unitArrivals.set(u.uid, game.round);
  const resting = restingLabel(u);
  const selected = selection?.options.some((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === u.uid);
  const cls = [
    'unit', famClass(u.id), u.exhausted && 'exhausted', targets.has(key) && 'targetable', selected && 'selected',
    owner === AI && !foeUnitsBefore.has(u.uid) && 'fresh',
    owner === AI && !renderedFoeUnits.has(u.uid) && 'arriving',
    owner === HUMAN && attackers.has(u.uid) && !selection && 'can-act',
  ].filter(Boolean).join(' ');
  return `
  <div class="${cls}" data-click="${key}" data-zoom="${(owner === HUMAN ? yourCardUrl : cardUrl)(u.id)}" data-zoom-card="${u.id}"
       data-zoom-state="${esc(resting.why)}" title="${esc(cardName(u.id))} — ${esc(resting.why)}">
    <div class="art" style="background-image:url(${artUrl(u.id)})"></div>
    <div class="uname">${esc(cardName(u.id))}</div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(String(c))}</span>`).join('')}</div>` : ''}
    <div class="pow ${power > (CARDS[u.id].power ?? 0) ? 'buffed' : ''} ${power > 9 ? 'two-digit' : ''}">${power}</div>
    <div class="hp ${u.damage ? 'hurt' : health > (CARDS[u.id].health ?? 0) ? 'buffed' : ''} ${health > 9 ? 'two-digit' : ''}">${health}</div>
    ${u.exhausted ? `<div class="zzz ${resting.tag}">${resting.tag === 'new' ? 'new' : 'zzz'}</div>` : ''}
  </div>`;
}

function renderYard(s: GameState, p: PlayerId, targets: Set<string>, attackers: Set<number>): string {
  const yard = s.players[p].yard;
  return `<section class="yard ${p === HUMAN ? 'me' : 'foe'}">
    ${yard.length ? yard.map((u) => renderUnit(u, p, targets, attackers)).join('') : `<div class="empty-yard">${p === HUMAN ? 'Your' : 'Their'} Yard is empty</div>`}
    ${renderPantry(s, p)}
  </section>`;
}

function renderHand(s: GameState, playable: Set<number>): string {
  const prompt = humanPrompt();
  const multi = prompt && (prompt.kind === 'mulligan' || prompt.kind === 'setupPlant' || prompt.kind === 'discard');
  const planting = prompt?.kind === 'plant';
  const luckyUid = prompt?.kind === 'lucky' ? prompt.uid : -1;
  const selectedUid = selection?.options.find((a) => a.t === 'play' || a.t === 'pounce') as { uid?: number } | undefined;
  return `<section class="hand">
    ${s.players[HUMAN].hand.map((c) => {
      const zestOn = (s.players[HUMAN].playedThisRound ?? 0) >= 1 && /\bZest:/.test(CARDS[c.id].text ?? '');
      const cls = [
        'hand-card', zestOn && 'zest-on', (playable.has(c.uid) || multi || planting) && 'playable', picks.has(c.uid) && 'picked',
        selectedUid?.uid === c.uid && 'selected', c.uid === luckyUid && 'lucky',
      ].filter(Boolean).join(' ');
      return `<button class="${cls}" data-click="hand:${c.uid}" data-zoom="${yourCardUrl(c.id)}" data-zoom-card="${c.id}"><img src="${yourCardUrl(c.id)}" alt="${esc(CARDS[c.id].name)}" decoding="async"></button>`;
    }).join('')}
  </section>`;
}

function renderMidbar(s: GameState, legal: Action[]): string {
  const prompt = humanPrompt();
  let text = '';
  let buttons = '';

  if (s.winner !== null) text = 'Game over.';
  else if (!prompt) text = `<span class="dots">Opponent's turn — they take one action, then it is yours again</span>`;
  else if (selection) {
    text = `Choose a target for <b>${esc(selection.label)}</b>.`;
    buttons = '<button data-click="btn:cancel">Cancel</button>';
  } else {
    switch (prompt.kind) {
      case 'mulligan':
        text = `<b>Mulligan.</b> Swap any cards you don't like — you get the same number back, so your hand stays `
          + `at 6. You'll plant <b>2</b> of them as Treats next, and keep the other <b>4</b>. `
          + `(${picks.size} selected.)`;
        buttons = `<button class="primary" data-click="btn:confirm">${picks.size ? `Replace ${picks.size}` : 'Keep hand'}</button>`;
        break;
      case 'setupPlant':
        text = `Pick <b>${prompt.count}</b> cards to plant face-down as <b>Treats</b>. Each planted card becomes <b>1 Treat</b>, whatever it costs, and is <b>not played</b> — so plant cards you need least right now.`;
        buttons = `<button class="primary" data-click="btn:confirm" ${picks.size === prompt.count ? '' : 'disabled'}>Plant ${picks.size}/${prompt.count}</button>`;
        break;
      case 'discard':
        text = `Too many cards: discard <b>${prompt.count}</b>.`;
        buttons = `<button class="primary" data-click="btn:confirm" ${picks.size === prompt.count ? '' : 'disabled'}>Discard ${picks.size}/${prompt.count}</button>`;
        break;
      case 'plant': {
        const chosen = picks.size === 1 ? s.players[HUMAN].hand.find((c) => c.uid === [...picks][0]) : undefined;
        text = chosen
          ? `Bury <b>${esc(cardName(chosen.id))}</b> as a Treat? It pays for other cards and can’t be played.`
          : '<b>New round!</b> You may bury one card face-down as <b>1 more Treat</b> (it won’t be played). Click a card, or Skip.';
        buttons = `${chosen ? '<button class="primary" data-click="btn:confirm">Bury it</button>'
          + '<button data-click="btn:cancel">Cancel</button>' : ''}
          <button data-click="btn:skip">Skip</button>`;
        break;
      }
      case 'action': {
        if (confirming === 'yarn') {
          text = `Take the <b>Yarn Ball</b>? You’ll act first next round, but you can only <b>pass</b> for the rest of this one.`;
          buttons = `<button class="primary" data-click="btn:yarn">Take it ${YARN_ICON}</button>`
            + '<button data-click="btn:cancel">Cancel</button>';
          break;
        }
        const hints = [];
        if (legal.some((a) => a.t === 'play')) hints.push('play a glowing card');
        if (legal.some((a) => a.t === 'attack')) hints.push('attack with a glowing unit');
        // "One thing, then they go" is the rule players miss most: they line up three attacks and are
        // surprised the opponent acts in between.
        // "Nothing left to do" reads like a bug when the real reason is that you can't afford anything:
        // about 1 opening in 10 starts with every card costing more than your 2 Treats.
        let why = 'Nothing left to do — pass.';
        if (!hints.length) {
          const costs = s.players[HUMAN].hand.map((c) => CARDS[c.id].cost ?? 0);
          const cheapest = costs.length ? Math.min(...costs) : 0;
          const treats = readyTreats(s, HUMAN);
          if (costs.length && cheapest > treats)
            why = `<b>You can't afford anything yet:</b> your cheapest card costs <b>${cheapest}</b> and you have `
              + `<b>${treats}</b> ready ${treats === 1 ? 'Treat' : 'Treats'}. Pass — next round you plant another `
              + `Treat and draw 2 cards.`;
          else if (costs.length) {
            // Affordable but unplayable: say which card and why, e.g. a Toy with no unit to attach to.
            const blocked = s.players[HUMAN].hand.find((c) => (CARDS[c.id].cost ?? 0) <= treats);
            why = `<b>Nothing you can play right now.</b> ${blocked ? esc(whyUnplayable(s, blocked.id, 'action')) : ''} Pass.`;
          }
        }
        text = `<b>Your action.</b> ${hints.length ? `${hints.join(' or ').replace(/^./, (c) => c.toUpperCase())} (click or drag).` : why}`
          + ` <span class="turn-hint">One thing, then your opponent acts.</span>`;
        buttons = `${legal.some((a) => a.t === 'takeYarn') ? `<button data-click="btn:yarn" title="Act first next round; you may only pass for the rest of this one">Take the Yarn ${YARN_ICON}</button>` : ''}
          <button class="primary" data-click="btn:pass">Pass</button>`;
        break;
      }
      case 'pounce':
        text = `${describeWindow(s)} <b>Pounce?</b> Click a glowing Pounce card, or let it happen.`;
        buttons = '<button class="primary" data-click="btn:decline">Let it happen</button>';
        break;
      case 'lucky': {
        const card = s.players[HUMAN].hand.find((c) => c.uid === prompt.uid)!;
        const free = legal.some((a) => a.t === 'lucky' && !a.target);
        const targeted = legal.some((a) => a.t === 'lucky' && a.target);
        text = `🍀 <b>Lucky!</b> The Life you lost is <b>${esc(cardName(card.id))}</b> — play it for free${targeted ? ' by choosing a target' : ''}?`;
        buttons = `${free ? '<button class="primary" data-click="btn:free">Play for free</button>' : ''}<button data-click="btn:keep">Keep in hand</button>`;
        break;
      }
      case 'choose':
        text = `Choose a unit for <b>${esc(cardName(prompt.sourceId))}</b>’s effect.`;
        break;
    }
  }
  // What the opponent just did, so its moves don't go unnoticed between your own.
  // (Hidden during a Pounce window, whose own prompt already describes the opponent's move.)
  const recap = humanPrompt()?.kind === 'pounce' ? [] : foeRecap(s).slice(-3);
  const recapLine = recap.length
    ? `<div class="recap"><b>Opponent:</b> ${recap.map((t) => esc(t.replace(/^Opponent('s)? /, (_, pos) => (pos ? 'their ' : '')))).join(' → ')}</div>`
    : '';
  return `<section class="midbar">
    <div class="round"><small>Round</small><b>${s.round}</b></div>
    <div class="prompt">${notice ? `<div class="notice">✓ ${esc(notice)}</div>` : ''}${recapLine}${text}${flash ? `<div class="flash">${esc(flash)}</div>` : ''}</div>
    <div class="buttons">${buttons}</div>
  </section>`;
}

/** A finished game means the next visit starts normally, and it goes on the tally. */
let countedGame: GameState | null = null;

function renderGameOver(s: GameState): string {
  if (countedGame !== s) {
    countedGame = s;
    markPlayed();
    count('finished');
    if (s.winner === HUMAN) count('won');
  }
  const won = s.winner === HUMAN;
  const heroP = won ? HUMAN : AI;
  return `<div class="overlay">
    <div class="game-over ${won ? 'won' : 'lost'}">
      <img src="${artUrl(`${s.players[heroP].hero.id}-bigcat`)}" alt="">
      <h2>${s.winner === 'draw' ? 'A draw!' : won ? 'You win!' : 'You lose!'}</h2>
      <p>${won ? 'Nine lives well spent.' : 'Every cat lands on its feet eventually.'} (${s.round} rounds)</p>
      <div class="buttons">
        <button class="primary" data-click="ui:again">Play again</button>
        <button data-click="ui:quit">Home</button>
      </div>
    </div>
  </div>`;
}

function renderSettings(): string {
  const choice = (setting: string, value: string, label: string, chosen: boolean) =>
    `<button class="${chosen ? 'chosen' : ''}" data-click="set:${setting}:${value}" aria-pressed="${chosen}">${label}</button>`;
  if (ACCOUNTS && accountPanelOpen()) {
    return `<div class="overlay"><div class="settings account-panel" role="dialog" aria-label="Account">${renderAccountPanel()}
      <button class="primary settings-done" data-click="ui:settings">Done</button></div></div>`;
  }
  return `<div class="overlay">
    <div class="settings" role="dialog" aria-label="Settings">
      <h2>Settings</h2>
      ${ACCOUNTS ? renderAccountRow() : ''}
      <div class="setting">
        <span class="setting-name">Sound</span>
        <div class="segmented">${choice('sound', 'on', 'On', soundEnabled())}${choice('sound', 'off', 'Off', !soundEnabled())}</div>
      </div>
      <div class="setting">
        <span class="setting-name">Opponent speed<small>How long the computer pauses before each move</small></span>
        <div class="segmented">${choice('speed', 'normal', 'Normal', speed === 'normal')}${choice('speed', 'fast', 'Fast', speed === 'fast')}</div>
      </div>
      <button class="primary settings-done" data-click="ui:settings">Done</button>
    </div>
  </div>`;
}

function renderRules(): string {
  return `<div class="overlay">
    <div class="rules">
      <h2>Quick rules</h2>
      <p><b>Goal:</b> knock out all 9 of the rival Hero Cat’s Lives.</p>
      <p><b>Each round:</b> ready everything, draw 2, and you may plant 1 card face-down as a <b>Treat</b>. Treats pay for cards — any card can be a Treat.</p>
      <p><b>Actions:</b> players alternate <i>one</i> action at a time: play a card, attack, use your Hero Cat’s ability, <b>Take the Yarn</b> (act first next round, but only pass for the rest of this one), or pass. The round ends when both pass in a row.</p>
      <p><b>Attacking:</b> exhaust a ready unit and pick a target. Units trade damage (damage stays). Hitting a Hero Cat takes a Life — <b>2</b> if the attacker is Fierce. Units enter exhausted unless they have <b>Zoomies</b>.</p>
      <p><b>Guardian</b> must be attacked first, unless the attacker is <b>Sneaky</b>. <b>Tough X</b> reduces damage taken by X.</p>
      <p><b>Reading a card:</b> press and hold any card to see it full size (or right-click it).</p>
      <p><b>How to play a card:</b> click it (or drag it onto the board). If it needs a target, the valid targets pulse pink — click one, or drop the card straight onto it. To attack, click or drag one of your ready units (yellow glow) onto an enemy.</p>
      <p><b>Families (classes):</b> each fruit family has a signature mechanic.
        <b>Citrus — Zest:</b> a bonus if you’ve already played another card this round.
        <b>Orchard — Ripen:</b> at the start of each round the unit gets +1/+1 (up to +2/+2).
        <b>Tropical — Sprout N:</b> put the top N cards of your deck into your Pantry as Treats;
        <b>Lush:</b> you have 7 or more Treats.</p>
      <p><b>Pounce:</b> when your opponent plays a card or attacks, you may play one Pounce card first.</p>
      <p><b>Lives:</b> a lost Life goes into your hand. If it’s <b>Lucky</b>, you may play it for free.</p>
      <p><b>Grow Up:</b> when its condition is met, your Kitten becomes a Big Cat — stronger ability, and it can attack.</p>
      <p><a href="${BASE}rules.html" target="_blank" rel="noopener">Full rulebook</a></p>
      ${summary() ? `<p class="progress-note">On this device: ${summary()}.</p>` : ''}
      <button class="primary" data-click="ui:rules">Got it</button>
    </div>
  </div>`;
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

// The deck builder's name boxes: the deck is renamed as you type (Enter just closes the keyboard).
app.addEventListener('input', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-rename], [data-newname]');
  if (input) deckInput(input);
  const field = ACCOUNTS ? (event.target as HTMLElement).closest<HTMLInputElement>('[data-acct]') : null;
  if (field) accountInput(field);
});
app.addEventListener('keydown', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-rename], [data-newname]');
  if (input && event.key === 'Enter') input.blur();
  const field = ACCOUNTS ? (event.target as HTMLElement).closest<HTMLInputElement>('[data-acct]') : null;
  if (field && event.key === 'Enter') { event.preventDefault(); accountEnter(field, { render }); }
});

app.addEventListener('click', (event) => {
  if (suppressClick) { suppressClick = false; return; }
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-click]');
  if (el && !(el as HTMLButtonElement).disabled) onClick(el.dataset.click!);
  // The deck carousel's arrows (for a mouse; fingers swipe): a page of decks at a time, no redraw.
  const arrow = (event.target as HTMLElement).closest<HTMLElement>('[data-deck-scroll]');
  const track = arrow?.parentElement?.querySelector<HTMLElement>('.deck-track');
  if (arrow && track) track.scrollBy({ left: Number(arrow.dataset.deckScroll) * track.clientWidth * 0.8, behavior: 'smooth' });
});

// ── Drag and drop ────────────────────────────────────────────────────────────────────────────────
//
// Drag a hand card onto the board to play it (or straight onto its target), or drag one of your
// ready units onto what it should attack. It is a gesture over the same actions as clicking: a drop
// that doesn't pick a target leaves the targets highlighted to click.

interface Drag { key: string; x0: number; y0: number; el: HTMLElement; ghost?: HTMLElement; options: Action[] }
let drag: Drag | null = null;
let suppressClick = false;

function dragOptions(key: string): Action[] {
  const prompt = humanPrompt();
  if (!game || !prompt) return [];
  const [kind, raw] = key.split(':');
  const uid = Number(raw);
  const legal = legalActions(game);
  if (kind === 'hand') {
    if (prompt.kind === 'plant') return [{ t: 'plant', uid }];
    return legal.filter((a) => (a.t === 'play' || a.t === 'pounce') && a.uid === uid);
  }
  if (kind === 'unit' && prompt.kind === 'action')
    return legal.filter((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === uid);
  return [];
}

app.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-click^="hand:"], [data-click^="unit:"]');
  if (!el) return;
  const options = dragOptions(el.dataset.click!);
  if (!options.length) return;
  drag = { key: el.dataset.click!, x0: event.clientX, y0: event.clientY, el, options };
});

window.addEventListener('pointermove', (event) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 8) return;
    const rect = drag.el.getBoundingClientRect();
    const ghost = drag.el.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    // Highlight where it can go.
    const label = drag.key.startsWith('hand:') ? 'the card you are dragging' : 'the attack';
    if (drag.options.some((a) => actionTarget(a))) { selection = { label, options: drag.options }; render(); }
    document.body.classList.add('dragging');
  }
  drag.ghost.style.transform = `translate(${event.clientX - drag.x0}px, ${event.clientY - drag.y0}px) rotate(3deg) scale(1.05)`;
});

window.addEventListener('pointerup', (event) => {
  const d = drag;
  drag = null;
  if (!d?.ghost) return;
  d.ghost.remove();
  document.body.classList.remove('dragging');
  suppressClick = true;
  window.setTimeout(() => { suppressClick = false; }, 0);

  const under = document.elementFromPoint(event.clientX, event.clientY);
  const dropKey = under?.closest<HTMLElement>('[data-click^="unit:"], [data-click^="hero:"]')?.dataset.click;
  const onTarget = d.options.find((a) => targetKey(actionTarget(a)) === dropKey);
  if (onTarget) return act(onTarget);

  const backInHand = !!under?.closest('.hand') && d.key.startsWith('hand:');
  const onBoard = !!under?.closest('.board') && !backInHand;
  const untargeted = d.options.filter((a) => !actionTarget(a));
  if (onBoard && d.options.length === 1 && untargeted.length === 1) return act(untargeted[0]);
  if (!onBoard || !d.options.some((a) => actionTarget(a))) { selection = null; render(); return; }
  // Dropped on the board but it needs a target: keep the targets lit for a click.
  selection = { label: d.key.startsWith('hand:') ? cardName(game!.players[HUMAN].hand.find((c) => `hand:${c.uid}` === d.key)?.id ?? '') : 'the attack', options: d.options };
  render();
});

app.addEventListener('mouseover', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
  const zoom = document.getElementById('zoom') as HTMLImageElement | null;
  if (el && zoom && zoom.src !== el.dataset.zoom) zoom.src = el.dataset.zoom!;
});

// ── Long press: show a card enlarged ─────────────────────────────────────────────────────────────
//
// Press and hold any card (in hand, on the board, a Hero Cat, your Treats) to read it full size;
// let go and it shrinks back. Moving the pointer cancels it (that's a drag), and the release after a
// long press isn't a click. Right-click opens the same preview on desktop, until you click.

const LONG_PRESS_MS = 450;
let pressTimer: number | undefined;
let pressAt: { x: number; y: number } | null = null;
/** The preview was opened by holding, so releasing closes it. */
let zoomHeld = false;

function openZoom(url: string, cardKey?: string, state?: string) {
  closeZoom();
  const text = cardKey ? zoomText(cardKey) : '';
  const used = GLOSSARY.filter((k) => k.test.test(text));
  const cost = cardKey && !/-(kitten|bigcat)$/.test(cardKey) ? CARDS[cardKey]?.cost : undefined;
  // Treats are the game's only currency, and a playtester got through a whole game without noticing.
  const price = cost === undefined ? '' : (() => {
    const ready = game ? readyTreats(game, HUMAN) : 0;
    const enough = ready >= cost;
    return `<p class="zoom-cost ${enough ? '' : 'short'}">Costs <b>${cost}</b> ${cost === 1 ? 'Treat' : 'Treats'}`
      + `${game ? ` · you have <b>${ready}</b> ready${enough ? '' : ' — not enough yet'}` : ''}</p>`;
  })();
  const status = state ? `<p class="zoom-state">${esc(state)}</p>` : '';
  const panel = used.length || price || status
    ? `<div class="zoom-info">${price}${status}${used.length
      ? `<dl class="zoom-keys">${used.map((k) => `<div><dt>${k.name}</dt><dd>${esc(k.text)}</dd></div>`).join('')}</dl>`
      : ''}</div>`
    : '';
  const overlay = document.createElement('div');
  overlay.id = 'zoom-overlay';
  overlay.className = panel ? 'with-keys' : '';
  overlay.innerHTML = `<img src="${url}" alt="">${panel}<span>Tap anywhere to close</span>`;
  overlay.addEventListener('click', closeZoom);
  document.body.appendChild(overlay);
  tutorialCardZoomed();
}

function closeZoom() {
  const overlay = document.getElementById('zoom-overlay');
  if (!overlay) return;
  overlay.remove();
  tutorialZoomClosed();
}

app.addEventListener('pointerdown', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
  if (!el || event.button !== 0) return;
  pressAt = { x: event.clientX, y: event.clientY };
  window.clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    pressAt = null;
    drag = null;           // a long press is never also a drag
    suppressClick = true;  // ...nor a click when the finger lifts
    openZoom(el.dataset.zoom!, el.dataset.zoomCard, el.dataset.zoomState);
    zoomHeld = true;
  }, LONG_PRESS_MS);
}, true);

window.addEventListener('pointermove', (event) => {
  if (pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 8) {
    window.clearTimeout(pressTimer);
    pressAt = null;
  }
}, true);

for (const type of ['pointerup', 'pointercancel'] as const) {
  window.addEventListener(type, () => {
    window.clearTimeout(pressTimer);
    pressAt = null;
    if (zoomHeld) { zoomHeld = false; closeZoom(); }
    // The click (if any) fires right after pointerup; afterwards stop swallowing clicks.
    if (suppressClick) window.setTimeout(() => { suppressClick = false; }, 0);
  }, true);
}

app.addEventListener('contextmenu', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
  if (!el) return;
  event.preventDefault();
  window.clearTimeout(pressTimer);
  openZoom(el.dataset.zoom!, el.dataset.zoomCard, el.dataset.zoomState);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ACCOUNTS && accountOpen()) { closeAccount({ render }); return; }
  if (event.key === 'Escape' && ACCOUNTS && showSettings && accountPanelOpen()) { closeAccountPanel(); render(); return; }
  if (event.key === 'Escape' && showSettings) { showSettings = false; render(); return; }
  if (screen === 'collection' && !showSettings && showcaseArrow(event.key, { render })) return;
  if (event.key === 'Escape') {
    if (document.getElementById('zoom-overlay')) { closeZoom(); return; }
    if (screen === 'collection' && showcaseEscape({ render })) return;
    if (selection) { selection = null; render(); }
  }
});

// Dev-only hook for automated UI testing and debugging in the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    fruitcats: {
      get game() { return game; }, chooseAction, legalActions, apply, render, CARDS,
      set fast(on: boolean) { aiDelayScale = on ? 0 : 1; },
      set aiDelay(scale: number) { aiDelayScale = scale; },
    },
  });
}

render();
