import './style.css';
import './skin.css';
import { clearSave, loadGame, saveGame } from './save';
import { playLogSounds, resetLogSounds, soundEnabled, toggleSound } from './sound';
import { count, summary } from './progress';
import { BASE, artUrl, backButton, cardUrl, esc, famClass, familyName, settingsButton } from './ui';
import { keepPictures } from './offline';
import { badgeMechanics, deckBlurb, familyInfo, mechanicGlossary } from './sets';
import { yourCardUrl } from './rarity';
import { deckClick, deckInput, openDeckBuilder, renderDeckBuilder, type BuilderHost } from './deckbuilder';
import { ACCOUNTS, ONLINE, STORE } from './flags';
import { openStore, openStoreForDeck, renderStore, storeClick, storeCodeEnter, storeCodeInput, storeEscape, type StoreHost } from './storefront';
import { refreshStore, storeAccess } from './shop';
import { soloFoeDecks } from '@fruitcats/store';
import { startSync, syncNow } from './sync';
import { saveAgreedTerms } from './auth';
import {
  accountClick, accountEnter, askForTermsIfNeeded, takeInviteFromLink, renderContactPanel, pickingPawtrait, accountInput, accountOpen, closeAccount, closeAccountPanel, openAccount, renderAccount,
  boardFace, renderAccountPanel, renderHomeAccount, signedIn, warmOwner, warmPawtraits,
} from './account';
import { openShowcase, renderShowcase, showcaseArrow, showcaseClick, showcaseEscape, showcaseMounted } from './showcase';
import { deckForKey, isReady, listDecks, customKey, loadChosenDeck, saveChosenDeck, firstDeck, ownedDeckKeys } from './mydecks';
import { addOpen, closeAddSheet, closeFriends, friendName, friendsClick, friendsInput, friendsMounted, openFriends, renderChallengeBanner, renderFriends, type FriendsHost } from './friends';
import { live, onGameFound, onLive, send, startLive, stopLive, wantConnection } from './live';
import { isPeerMatch } from './peer';
import {
  enterMatch, forgetOnline, hintText, leaveMatch, ol, onlineBar, onlineClick, onlineMessage, onlineSideButtons, onlineTicks,
  playerFace, renderOnlineResult, renderVersus, shownHand,
} from './online';
import {
  renderTutorial, startTutorial, stopTutorial, tutorialActive, tutorialAfterAction, tutorialCardZoomed, tutorialZoomClosed,
} from './tutorial';
import {
  CARDS, DECKS, DECK_RULES, LANES, MECHANICS, SETS, TERMS, abilitiesOf, evaluateCondition, unitKeywords, apply, cardName, chooseAction, createGame,
  deckSize, heroSide, interestOn, laneUnit, legalActions, levelCost, mayAct, other, targetRank, unitHealth, unitPower, viewFor,
  visibleLog, HAND_LIMIT, MULLIGAN_MAX,
  type Action, type DeckList, type GameState, type LogEntry, type PlayerId, type PlayerView, type Target, type Unit,
} from '@fruitcats/engine';
// ── Assets ───────────────────────────────────────────────────────────────────────────────────────

/** The painted Lantern (an emoji looks like a small dot on some devices). */
const YARN_ICON = `<img class="yarn-ico" src="${BASE}ui/lantern.webp" alt="Lantern">`;
// Absolute URLs: a relative url() inside a CSS variable resolves against the stylesheet that uses it
// (dist/assets/…) rather than the page, which broke the backgrounds in the published build.
// The shell's backdrop is a glowing night wood: tall trees with teal, magenta and orange canopies under a starry sky full
// of drifting sparks (glowwood-tall on portrait screens); painted from the owner's reference, 2026-09-27.
for (const [name, file] of [['--img-menu-bg', 'glowwood.webp'], ['--img-menu-bg-tall', 'glowwood-tall.webp'], ['--img-playmat', 'table.webp'], ['--img-cardback', 'cardback.webp'],
  ['--img-paw', 'stat-power.svg'], ['--img-heart', 'stat-heart.svg'], ['--img-store', 'tile-store.webp']])
  document.documentElement.style.setProperty(name, `url("${new URL(`${BASE}ui/${file}`, location.href).href}")`);
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
  plays: 'play', plants: 'plant', makes: 'make', passes: 'pass', keeps: 'keep', mulligans: 'mulligan', takes: 'take', loses: 'lose',
  discards: 'discard', wins: 'win', starts: 'start', POUNCES: 'POUNCE', AMBUSHES: 'AMBUSH', attacks: 'attack', uses: 'use',
};
const humanize = (text: string) =>
  youify(text).replace(/\bYou's\b/g, 'Your')
    .replace(/\bYou (\w+)\b/g, (m, verb: string) => (VERBS[verb] ? `You ${VERBS[verb]}` : m))
    .replace(/\bYou (\w+) their\b/g, 'You $1 your')
    .replace(/\bYou now has\b/g, 'You now have')
    .replace(/(?<!^)(?<![.!] )\bYour\b/g, 'your');

/** Online, the story names you by your display name: say "You" instead, as in Solo. */
function youify(text: string): string {
  if (!ol || !game) return text;
  const me = game.players[mySeat].name;
  return text.split(`${me}'s`).join("You's").split(`${me} `).join('You ');
}


// ── App state ────────────────────────────────────────────────────────────────────────────────────

/** Your seat and the other player's. In Solo you're always seat 0; online, the server says which (online.ts). */
let mySeat: PlayerId = 0;
let theirSeat: PlayerId = 1;

/** Home: the game modes. Solo: deck and difficulty for a game against the AI. Decks: the deck builder.
 *  Collection: your Display Case and the Binder. */
type Screen = 'home' | 'solo' | 'friends' | 'decks' | 'collection' | 'store' | 'game';
interface Selection {
  label: string;
  /** The moves still in the running: each click on the board narrows them down. */
  options: Action[];
  /** Other things to do with what you picked (offer it, set it face-down), as buttons. */
  alts?: { label: string; options: Action[] }[];
  /** The card or unit picked, when it has no move to narrow (it can only be offered). */
  uid?: number;
}

/**
 * Whether this browser has played before. A first-timer pressing the big button gets the walkthrough:
 * it used to be a small button in the corner, so most people never saw it.
 */
const PLAYED_KEY = 'fruitcats-played';
const hasPlayed = () => { try { return localStorage.getItem(PLAYED_KEY) === 'yes'; } catch { return false; } };
const markPlayed = () => { try { localStorage.setItem(PLAYED_KEY, 'yes'); } catch { /* private mode: not remembered */ } };

const DIFFICULTY = {
  // The keys stay kitten/cat/tiger (saved settings use them); players see young, wise and ancient trees.
  kitten: { label: 'Young', blurb: 'Gentle, for learning', skill: 0.55, img: 'diff-young' },
  cat: { label: 'Wise', blurb: 'A fair match', skill: 0.85, img: 'diff-wise' },
  tiger: { label: 'Ancient', blurb: 'Plays its best', skill: 1, img: 'diff-ancient' },
};
type Difficulty = keyof typeof DIFFICULTY;

let screen: Screen = 'home';
/** What a "Coming soon" mode will do, shown on the home screen after tapping it. */
let homeNote = '';
/** A starter deck's key, or `custom:<id>` for one of your own (see mydecks.ts). */
let myDeck = loadChosenDeck();
/** The deck in the middle of Solo's carousel. It's the one you play, unless it isn't finished yet. */
let deckInView = myDeck;
let difficulty: Difficulty = hasPlayed() ? 'cat' : 'kitten';   // meet the gentlest opponent first
let game: GameState | null = null;
/**
 * The card the side panel's inspector shows: the last one hovered or tapped (your Hero before that). Kept on
 * narrow screens too, where there is no inspector: it is what the magnifier button opens full size. `key` is
 * the card's id (a Hero's side), and `state` why a unit is resting, for the enlarged view's explanations.
 */
let inspected: { url: string; key?: string; state?: string } | null = null;
/** The tutorial isn't saved: its balloons can't pick up halfway through. */
let tutorialGame = false;
let selection: Selection | null = null;
let picks = new Set<number>();
let showRules = false;
let showSettings = false;
/** The Story so far drawer (the game's transcript) is out: it slides in beside the board and stays until closed. */
let showStory = false;
/**
 * A wide screen (an iPad sideways, a PC): the two players' plaques sit in the panel beside the board with the card
 * reader between them, so the board's whole height goes to bigger cards, with their rules text on them. Narrower
 * screens keep the player bars on the board. Crossing the line redraws the game.
 */
const WIDE = window.matchMedia('(min-width: 1001px)');
let drawnWide = WIDE.matches;
const relayout = () => { if (screen === 'game' && WIDE.matches !== drawnWide) render(); };
WIDE.addEventListener('change', relayout);
window.addEventListener('resize', relayout);   // some browsers resize without a media-query change event
/** Settings' sections (Gameplay, Sound, Account, Contact us). Null: none picked yet; a wide screen shows the first, a phone shows the list. */
type SettingsSection = 'gameplay' | 'sound' | 'account' | 'contact';
let settingsSection: SettingsSection | null = null;
let flash = '';
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

/** A click target's key: a unit, a Hero, or one of a player's lanes (an empty one, or one an effect is aimed at). */
const targetKey = (t?: Target) =>
  (!t ? '' : t.kind === 'unit' ? `unit:${t.uid}` : t.kind === 'hero' ? `hero:${t.player}` : `lane:${t.player}:${t.lane}`);

/**
 * What you may see of the game: online, the view the server sent; in Solo, the same view, made here. During the Muster
 * it shows the opponent as they stood when it began, so the computer building its side never shows early.
 */
function seen(): GameState | null {
  if (!game) return null;
  return ol ? game : viewFor(game, mySeat);
}

/** The decision in front of you, if any: the mulligan, or the Muster until you are Ready. */
function humanPrompt() {
  return game && game.winner === null && mayAct(game, mySeat) ? game.prompt : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

/** A friendly confirmation of the player's own last move (what they just offered). */
let notice = '';
/** The last Clash, as its story: shown as a report until you move on. No animation: the Clash is read, not watched. */
let clashReport: { round: number; lines: LogEntry[] } | null = null;

/** If a Clash was played since the story had `from` lines (those you may read), it becomes the report. */
function noteClash(from: number) {
  if (!game) return;
  const log = visibleLog(game.log, mySeat);
  const start = log.findIndex((e, i) => i >= from && e.text === '— Clash —');
  if (start < 0) return;
  let end = log.findIndex((e, i) => i > start && /^— Round \d+ —$/.test(e.text));
  if (end < 0) end = log.length;
  clashReport = { round: log[start].round, lines: log.slice(start, end) };
}

function act(action: Action) {
  if (!game) return;
  if (ol) { actOnline(action); return; }
  const me = game.players[mySeat];
  const from = visibleLog(game.log, mySeat).length;
  const offered = action.t === 'offer' ? (me.hand.find((c) => c.uid === action.uid) ?? me.yard.find((u) => u.uid === action.uid))?.id : undefined;
  try {
    apply(game, action, mySeat);
    tutorialAfterAction(action);
    flash = '';
    notice = offered ? `Offered ${cardName(offered)}: you have ${me.offerings} ${TERMS.offerings}.` : '';
  } catch (error) {
    flash = (error as Error).message;
  }
  selection = null;
  picks = new Set();
  runAi();
  noteClash(from);
  render();
}

/** Online: the move goes to the server, which checks it and sends the result back (onLive, below). */
function actOnline(action: Action) {
  if (!game || !ol || ol.sent || ol.end) return;
  if (!send({ t: 'act', match: ol.info.id, seq: (game as PlayerView).seq, action })) { flash = 'Not connected. Reconnecting…'; render(); return; }
  ol.sent = true;
  hintLine = '';
  flash = '';
  notice = '';
  selection = null;
  picks = new Set();
  render();
}

// ── Online games ─────────────────────────────────────────────────────────────────────────────────
//
// The server sends the whole match when it starts (or when you come back to it), then a view after every move that
// is yours to know about: during the Muster only your own, then the Clash for both. Each view carries only the
// story lines since the last one.

/** The whole story of the online game so far, as received (views bring only its new lines). */
let storyLines: PlayerView['log'] = [];
/** A teaching game's suggested move, in words, until the next move. */
let hintLine = '';

function openOnline(msg: Extract<Parameters<Parameters<typeof onLive>[0]>[0], { t: 'match' }>) {
  const same = ol?.info.id === msg.info.id;
  enterMatch(msg);
  mySeat = msg.info.seat;
  theirSeat = other(mySeat);
  stopTutorial();
  tutorialGame = false;
  storyLines = msg.view.log;
  game = msg.view;
  if (!same) { resetLogSounds(game); inspected = null; clashReport = null; }
  selection = null; picks = new Set(); notice = ''; flash = '';
  if (screen === 'friends') closeFriends();
  screen = 'game';
  showSettings = false;
  render();
  // The Versus splash goes by itself.
  if (ol && ol.versusUntil > Date.now()) window.setTimeout(render, ol.versusUntil - Date.now() + 50);
}

/** Leave an online game for Home. A game still going carries on: the Friend tile offers to rejoin it. */
function leaveOnline() {
  if (ol?.end) { leaveMatch(); game = null; }
  screen = 'home';
  homeNote = '';
}

/** Stop drawing an online game (Solo is starting), without leaving it: it can be rejoined. */
function setOnlineAside() {
  if (ol?.end) leaveMatch();
  forgetOnline();
  mySeat = 0;
  theirSeat = 1;
}

onLive((msg) => {
  if (msg.t === 'match') { openOnline(msg); return; }
  if (!onlineMessage(msg)) {
    if (msg.t === 'error' && ol && screen === 'game' && msg.message !== 'replaced' && msg.message !== 'signed_out') { ol.sent = false; flash = msg.message; render(); }
    return;
  }
  if (msg.t === 'view') {
    // The view carries only the story lines since the last one: put the story back together.
    const from = Math.min(msg.logFrom, storyLines.length);
    storyLines = [...storyLines.slice(0, msg.logFrom), ...msg.view.log];
    game = { ...msg.view, log: storyLines };
    noteClash(from);
  }
  if (msg.t === 'hint' && game) {
    hintLine = msg.action ? hintText(game, msg.action) : 'No suggestion right now.';
    const a = msg.action;
    if (a && (a.t === 'play' || a.t === 'ability' || a.t === 'ambush' || a.t === 'move')) selection = { label: 'the suggested move', options: [a] };
  }
  render();
});

/**
 * Solo: the computer builds its side of the Muster at once, out of sight (you see its board as it stood when the
 * Muster began), and answers its mulligan. It never needs to wait for you: nothing it does shows until the Clash.
 */
function runAi() {
  if (!game || ol) return;
  const skill = tutorialActive() ? 0.45 : DIFFICULTY[difficulty].skill;
  for (let guard = 0; guard < 400 && game.winner === null && mayAct(game, theirSeat); guard++) {
    apply(game, chooseAction(game, { skill, random: aiRandom, seat: theirSeat }), theirSeat);
  }
}

/** For the tutorial: carry on after a balloon closes. */
function scheduleAi() {
  const from = game ? visibleLog(game.log, mySeat).length : 0;
  runAi();
  noteClash(from);
  render();
}

function startGame(tutorial = false) {
  setOnlineAside();
  // The opponent leads one of the other decks, at random. The tutorial is always the Domowiki against the Pari (the
  // two folk starter decks), with you holding the Lantern.
  const mine = deckForKey(myDeck) ?? DECKS[firstDeck()];
  const others = soloFoeDecks(mine.hero);
  const theirDeck = tutorial ? 'pari'
    : devFoe && others.includes(devFoe) ? devFoe : others[Math.floor(Math.random() * others.length)];
  inspected = null;
  clashReport = null;
  game = tutorial
    ? createGame({ decks: ['domowiki', 'pari'], names: ['You', 'Opponent'], firstPlayer: mySeat })
    : createGame({ decks: [mine, theirDeck], names: ['You', 'Opponent'], seed: devSeed });
  aiRandom = devSeed === undefined || tutorial ? undefined : mulberry(devSeed);
  tutorialGame = tutorial;
  // Both decks' pictures, kept by the offline worker, so a later game with them shows every card with no connection.
  keepPictures(game.players.flatMap((pl, p) => {
    const face = p === mySeat ? yourCardUrl : cardUrl;
    const ids = [...new Set([...pl.deck, ...pl.hand, ...pl.lives].map((c) => c.id))];
    const hero = [`${pl.hero.id}-kitten`, `${pl.hero.id}-bigcat`];
    return [...ids.flatMap((id) => [face(id), artUrl(id)]), ...hero.flatMap((k) => [face(k), artUrl(k)])];
  }));
  resetLogSounds(game);
  if (tutorial) startTutorial({
    game: () => game, rerender: render, resumeAi: scheduleAi,
    selection: () => selection && { label: selection.label, attack: false },
    skipped: markPlayed,
  });
  else stopTutorial();
  // Swapping cards before you know what a card costs is a decision made in the dark, so on a first game the hand is
  // kept for you and the bar says so. (The engine always asks; the app may answer.)
  if (tutorial && game.prompt?.kind === 'mulligan' && game.prompt.player === mySeat) {
    const hand = game.players[mySeat].hand;
    const cheap = hand.filter((c) => (CARDS[c.id].cost ?? 0) <= 2 && CARDS[c.id].type !== 'Trick');
    // A hand with nothing cheap can't field a unit in round 1, so swap its priciest cards: an ordinary legal mulligan.
    const priciest = [...hand].sort((a, b) => (CARDS[b.id].cost ?? 0) - (CARDS[a.id].cost ?? 0)).slice(0, 3);
    const swap = cheap.length ? [] : priciest.map((c) => c.uid);
    apply(game, { t: 'mulligan', uids: swap }, mySeat);
    notice = swap.length
      ? 'Swapped your 3 priciest cards for fresh ones: that free redraw is called a mulligan.'
      : 'Kept your opening hand. Every game starts with one free redraw, a mulligan, and I took it for you.';
  }
  runAi();
  screen = 'game';
  selection = null;
  picks = new Set();
  render();
}

/**
 * What each keyword means, in plain words. Shown under a card when you enlarge it (press and hold),
 * because a playtester kept forgetting what a mechanic did and iOS has no hover to put a tooltip on.
 * `test` finds the keyword in the card's rules text.
 */
/** Set mechanics (Well-Fed, Rain-Fed, …) explain themselves from their set's data; the core keywords are here. */
const glossary = () => [...mechanicGlossary(), ...CORE_GLOSSARY];
const CORE_GLOSSARY: { name: string; test: RegExp; text: string }[] = [
  { name: 'Guardian', test: /\bGuardian\b/, text: 'The tank: enemies hit Guardians first. (Sneaky enemies hit them last.)' },
  { name: 'Elusive', test: /\bElusive\b/, text: 'The carry: enemies hit it late, after every plain unit and Guardian.' },
  { name: 'Lure', test: /\bLure\b/, text: 'The decoy: enemies hit it last, but Sneaky enemies must hit it first.' },
  { name: 'Sneaky', test: /\bSneaky\b/, text: 'The assassin: hits the enemy’s Lures first, then their Elusive units; Guardians last.' },
  { name: 'Fierce', test: /\bFierce\b/, text: 'Worth 2 Candles instead of 1 if it is still standing when its side wins the Clash.' },
  { name: TERMS.keywords.Zoomies, test: /\b(Swift|Zoomies)\b/, text: 'Hits first in every bout: a unit it knocks down never hits back.' },
  { name: 'Tough', test: /\bTough\b/, text: 'Takes that much less damage from every hit.' },
  { name: 'Lucky', test: /\bLucky\b/, text: 'If this card turns up as a Candle you lost, you may play it for free in the next Muster.' },
  { name: TERMS.keywords.Pounce, test: /\b(Ambush|Pounce)\b/, text: 'Set it face-down in one of your lanes: it happens when the Clash begins, if its lane holds what it needs (otherwise it waits). It can also be played like any card.' },
  { name: 'Hello', test: /\bHello\b/, text: 'Happens when you play the card.' },
  { name: 'Goodbye', test: /\bGoodbye\b/, text: 'Happens each time this unit goes down in a Clash.' },
  { name: 'Awaken', test: /\b(Awaken|Grow Up)\b/, text: 'Once this is true, your Hero Awakens for good: a stronger ability, and it strikes when the Clash begins (unless you used its ability).' },
  // "Exhaust:" is the price of a Hero's ability; "Exhaust an enemy unit" is an effect. One line covers both.
  { name: 'Exhaust', test: /\bExhaust\b/, text: 'An exhausted unit deals no damage in this Clash. On a Hero, “Exhaust:” is the price of its ability: that round it doesn’t strike.' },
];

/** The rules text of whatever a long press enlarged: a card id, or a Hero side like "DW1-H01-bigcat". */
function zoomText(key: string): string {
  const side = /^(.*)-(kitten|bigcat)$/.exec(key);
  const card = CARDS[side ? side[1] : key];
  if (!card) return '';
  if (!side) return card.text ?? '';
  return (side[2] === 'kitten' ? card.kitten?.text : card.bigCat?.text) ?? '';
}

/** A plain-language reason a card in hand can't be played right now. */
function whyUnplayable(s: GameState, id: string): string {
  const def = CARDS[id];
  const name = cardName(id);
  const me = s.players[mySeat];
  if (abilitiesOf(id).some((a) => a.pounceOnly)) return `${name} can only be set face-down, as an Ambush in one of your lanes.`;
  if ((def.cost ?? 0) > me.offerings) return `${name} costs ${def.cost} ${TERMS.offerings}, and you have ${me.offerings}. You get more at the start of each round, and you can offer cards you don't need.`;
  if (def.type === 'Cat' && me.yard.some((u) => u.id === id)) return `${name} is already on your board, and Fabled cards are one of a kind.`;
  if (def.type === 'Cat' || def.type === 'Critter') return `All your lanes are taken: your Hero is Level ${me.hero.level}. Level up for one more lane.`;
  if (def.type === 'Toy') return `${name} needs one of your units without a Talisman to attach to.`;
  return `${name} has no target right now.`;
}

/** Pick a card or a unit: its moves, and other things to do with it (Offer it, set it face-down) as buttons. */
function select(label: string, options: Action[], alts: { label: string; options: Action[] }[] = []) {
  if (options.length === 1 && !paramOf(options) && !alts.length) return act(options[0]);
  selection = { label, options, alts };
  render();
}

// A move is picked by narrowing it down: a lane for a new unit (or a unit's move), the lane an Ambush goes to, then
// what it aims at. Each click keeps the moves that agree with it, until only one is left.
type Param = 'slot' | 'lane' | 'target' | 'target2';
const PARAMS: Param[] = ['slot', 'lane', 'target', 'target2'];

function valueKey(a: Action, p: Param): string {
  if (p === 'slot') return 'slot' in a && a.slot !== undefined ? `slot:${a.slot}` : '';
  if (p === 'lane') return a.t === 'ambush' ? `slot:${a.lane}` : '';
  if (p === 'target') return 'target' in a ? targetKey(a.target) : '';
  return 'target2' in a ? targetKey(a.target2) : '';
}

/** What the next click among these moves decides, or null when they're all the same move. */
function paramOf(options: Action[]): Param | null {
  for (const p of PARAMS) if (new Set(options.map((a) => valueKey(a, p))).size > 1) return p;
  return null;
}

/** The keys a click on the board stands for: a unit is also the lane it stands in. */
function clickKeys(key: string, v: GameState): string[] {
  const [kind, a, b] = key.split(':');
  if (kind === 'unit') {
    const uid = Number(a);
    const mine = v.players[mySeat].yard.find((u) => u.uid === uid);
    const theirs = v.players[theirSeat].yard.find((u) => u.uid === uid);
    return [key, ...(mine ? [`slot:${mine.slot}`, `lane:${mySeat}:${mine.slot}`] : []), ...(theirs ? [`lane:${theirSeat}:${theirs.slot}`] : [])];
  }
  if (kind === 'lane') return [key, ...(Number(a) === mySeat ? [`slot:${b}`] : [])];
  return [key];
}

/** What a selection lights up on the board, as the keys of what to light. */
function lit(v: GameState): Set<string> {
  const out = new Set<string>();
  if (!selection) return out;
  const p = paramOf(selection.options);
  if (!p) return out;
  for (const a of selection.options) {
    const k = valueKey(a, p);
    if (!k) continue;
    const [kind, x, y] = k.split(':');
    if (kind === 'slot') {
      const u = laneUnit(v, mySeat, Number(x));
      out.add(u ? `unit:${u.uid}` : `lane:${mySeat}:${x}`);
    } else if (kind === 'lane') {
      const u = laneUnit(v, Number(x) as PlayerId, Number(y));
      out.add(u ? `unit:${u.uid}` : k);
    } else out.add(k);
  }
  return out;
}

function onClick(key: string) {
  const [kind, raw] = key.split(':');
  const value = Number(raw);

  // Tapping a Hero Cat's ability line opens the card with its keywords explained: a playtester
  // couldn't find out what the opponent's ability did (the portrait's long press wasn't discovered).
  if (kind === 'heroinfo' && game) {
    const p = value as PlayerId;
    openZoom((p === mySeat ? yourCardUrl : cardUrl)(heroKey(game, p)), heroKey(game, p));
    return;
  }
  if (kind === 'home') {
    homeNote = '';
    // With accounts on, your cards live in your account: signed out, these tiles open "Sign in or create account",
    // then carry on to where you were going.
    const needs = ACCOUNTS && !signedIn() ? ACCOUNT_TILES[raw] : undefined;
    if (needs) { openAccount({ render }, needs, () => onClick(key)); return; }
    if (raw === 'solo') screen = 'solo';
    else if (raw === 'friend' && ONLINE) {
      // A game still going opens straight away; one this screen has lost track of is asked for again.
      // A game still going is rejoined as soon as the connection opens (live.ts).
      if (ol && game && !ol.end) screen = 'game';
      else {
        openFriends(friendsHost);
        screen = 'friends';
        if ((live.connected || isPeerMatch(live.match)) && live.match && !ol) send({ t: 'rejoin', match: live.match });
      }
    }
    else if (raw === 'decks') { openDeckBuilder(); screen = 'decks'; }
    else if (raw === 'collection') { openShowcase({ render }); screen = 'collection'; if (ACCOUNTS) void syncNow(); }
    else if (raw === 'store' && storeOpen()) { openStore(storeHost); screen = 'store'; }
    else if (raw === 'continue') { if (resumeSavedGame()) { render(); scheduleAi(); return; } }
    else if (raw === 'tutorial') { startGame(true); return; }
    else if (raw === 'soon') homeNote = MODES.find((m) => m.key === key.split(':')[2])?.soon ?? '';
    render();
    return;
  }
  if (kind === 'solo') {
    // Always a normal game: the guided one is the Tutorial, which Home puts first until you've played.
    if (raw === 'play') { startGame(); return; }
    if (raw in DIFFICULTY) { difficulty = raw as Difficulty; render(); return; }
    return;
  }
  if (ONLINE && kind === 'pf') {
    const rest = key.slice('pf:'.length);
    // A challenge from the banner on another screen opens Play a friend at that challenge.
    if (rest.startsWith('see:') && screen !== 'friends') { openFriends(friendsHost, rest.slice(4)); screen = 'friends'; render(); return; }
    friendsClick(rest, friendsHost);
    return;
  }
  if (ONLINE && kind === 'ol') {
    if (onlineClick(key.slice('ol:'.length)) === 'home') leaveOnline();
    render();
    return;
  }
  if (kind === 'deck') {
    deckClick(raw, key.split(':').slice(2).join(':'), builderHost);
    return;
  }
  if (STORE && kind === 'store') {
    storeClick(raw, key.split(':').slice(2).join(':'), storeHost);
    return;
  }
  if (kind === 'col') {
    showcaseClick(raw, key.split(':').slice(2).join(':'), { render });
    return;
  }
  if (ACCOUNTS && kind === 'acct') {
    if (raw === 'open') showSettings = false;
    if (raw === 'contact') { showSettings = true; settingsSection = 'contact'; }
    // Home's Pawtrait opens Settings on its Account section.
    if (raw === 'home') { showSettings = true; settingsSection = 'account'; warmPawtraits(); warmOwner(render); render(); return; }
    void accountClick({ render }, key.slice('acct:'.length));
    return;
  }
  if (kind === 'set') {
    const choice = key.split(':')[2];
    if (raw === 'sound' && (choice === 'on') !== soundEnabled()) toggleSound();
    render();
    return;
  }
  if (kind === 'ui') {
    if (raw === 'rules') showRules = !showRules;
    if (raw === 'zoom') { toggleZoom(); return; }
    if (raw === 'story') { toggleStory(); return; }
    // Settings closes, and opens fresh on its first section next time.
    if (raw === 'settings') { showSettings = !showSettings; settingsSection = null; if (ACCOUNTS) { closeAccountPanel(); if (showSettings) { warmPawtraits(); warmOwner(render); } } }
    if (raw === 'settab') { settingsSection = key.split(':')[2] as SettingsSection; if (ACCOUNTS) closeAccountPanel(); }
    if (raw === 'settingsback') settingsSection = null;
    if (raw === 'back') { if (screen === 'friends') closeFriends(); screen = 'home'; homeNote = ''; }
    if (raw === 'quit') { stopTutorial(); game = null; clashReport = null; screen = 'home'; homeNote = ''; showStory = false; }
    if (raw === 'again') { startGame(); return; }
    render();
    return;
  }

  if (kind === 'report') { clashReport = null; render(); return; }

  const prompt = humanPrompt();
  const v = seen();
  if (!game || !v || !prompt) return;
  const legal = legalActions(game, mySeat);

  // A selection takes clicks on the board: each narrows it down.
  if (selection && (kind === 'unit' || kind === 'lane' || kind === 'hero')) {
    const p = paramOf(selection.options);
    if (p) {
      const keys = clickKeys(key, v);
      const left = selection.options.filter((a) => keys.includes(valueKey(a, p)));
      if (left.length) {
        if (!paramOf(left)) return act(left[0]);
        selection = { ...selection, options: left, alts: [] };
        render();
        return;
      }
    }
  }

  if (kind === 'btn') {
    switch (raw) {
      case 'ready': return act({ t: 'ready' });
      case 'level': return act({ t: 'levelUp' });
      case 'cancel': selection = null; picks = new Set(); render(); return;
      case 'confirm':
        if (prompt.kind === 'mulligan') return act({ t: 'mulligan', uids: [...picks] });
        return;
      case 'ability': return select('your Hero’s ability', legal.filter((a) => a.t === 'ability'));
      case 'alt': {
        const alt = selection?.alts?.[value];
        if (alt) select(alt.label, alt.options);
        return;
      }
    }
    return;
  }

  if (kind === 'hand') {
    if (prompt.kind === 'mulligan') {
      if (picks.has(value)) picks.delete(value);
      else if (picks.size < MULLIGAN_MAX) picks.add(value);
      render();
      return;
    }
    const card = game.players[mySeat].hand.find((c) => c.uid === value)!;
    const plays = legal.filter((a) => (a.t === 'play' || a.t === 'lucky') && a.uid === value);
    const ambush = legal.filter((a) => a.t === 'ambush' && a.uid === value);
    const offer = legal.filter((a) => a.t === 'offer' && a.uid === value);
    const name = cardName(card.id);
    const offerAlt = offer.length ? [{ label: `Offer it (+1 ${TERMS.offering})`, options: offer }] : [];
    const ambushAlt = ambush.length ? [{ label: 'Set it face-down', options: ambush }] : [];
    flash = '';
    if (plays.length) return select(name, plays, [...ambushAlt, ...offerAlt]);
    if (ambush.length) return select(`${name}, face-down`, ambush, offerAlt);
    flash = whyUnplayable(game, card.id);
    selection = { label: name, options: [], alts: offerAlt, uid: value };
    render();
    return;
  }

  if (kind === 'unit') {
    const mine = game.players[mySeat].yard.find((u) => u.uid === value);
    if (!mine) return;
    const moves = legal.filter((a) => a.t === 'move' && a.uid === value);
    const offer = legal.filter((a) => a.t === 'offer' && a.uid === value);
    selection = {
      label: `${cardName(mine.id)}: a lane to move to`, options: moves, uid: value,
      alts: offer.length ? [{ label: `Offer it (+1; it leaves the board)`, options: offer }] : [],
    };
    render();
  }
}

// ── Saving ───────────────────────────────────────────────────────────────────────────────────────
//
// Every change to the game ends in a render, so that is where it is saved. Closing the tab or going
// back Home keeps the game: the home screen then offers to continue it at the same decision, and a new
// Solo game replaces it. A finished game is forgotten.

function persist() {
  if (!game || tutorialGame || ol) return;
  if (game.winner !== null) { clearSave(); return; }
  saveGame({ game, difficulty });
}

function resumeSavedGame(): boolean {
  const save = loadGame();
  if (!save) return false;
  setOnlineAside();
  game = save.game;
  inspected = null;
  clashReport = null;
  tutorialGame = false;
  if (save.difficulty in DIFFICULTY) difficulty = save.difficulty as Difficulty;
  resetLogSounds(game);
  screen = 'game';
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

/** The connection's news redraws the screen, but never in the middle of an animation (it redraws after). */
function renderUnlessAnimating() { render(); }

let drawnBackdrop = '';   // the screen (without its dialogs) as last drawn, and how many nodes it made in #app
let drawnBackdropNodes = 0;

function render() {
  document.body.className = screen === 'game' ? 'game-screen' : 'menu-screen';
  // Scrolling lists (the deck builder's cards) keep their place when the screen is redrawn.
  const scrolled = new Map([...app.querySelectorAll<HTMLElement>('[data-keep-scroll]')]
    .map((el) => [el.dataset.keepScroll, [el.scrollTop, el.scrollLeft]] as const));
  // Signed in, the game says "I'm here" now and then; it holds a connection only while playing online: on Play a friend,
  // and while an online game is going (or its result is showing). Signing out stops both.
  if (ONLINE && signedIn()) {
    startLive({ render: renderUnlessAnimating });
    // A Friend game played directly between the two devices needs no connection (peer.ts).
    wantConnection(screen === 'friends' || (!!ol && !isPeerMatch(ol.info.id) && (!ol.end || screen === 'game')));
  } else if (ONLINE) stopLive();
  // Settings pops in when it opens, not again each time it is redrawn (picking a section) while it is showing.
  const settingsWasOpen = !!app.querySelector('.settings-dialog');
  const backdrop = (screen === 'home' ? renderHome() : screen === 'solo' ? renderSolo() : screen === 'friends' && ONLINE ? renderFriends()
    : screen === 'decks' ? renderDeckBuilder()
    : screen === 'collection' ? renderShowcase() : screen === 'store' && STORE ? renderStore() : renderGame())
    + (ONLINE ? renderChallengeBanner(screen === 'friends', screen === 'game' && !!ol && !ol.end) : '');
  const overlays = (showSettings ? renderSettings(settingsWasOpen) : '') + (ACCOUNTS ? renderAccount() : '');
  // Picking a section redraws only the dialog: the screen behind it is left alone, so it doesn't flicker.
  const backdropKept = settingsWasOpen && showSettings && backdrop === drawnBackdrop;
  if (backdropKept) {
    while (app.childNodes.length > drawnBackdropNodes) app.lastChild!.remove();
    app.insertAdjacentHTML('beforeend', overlays);
  } else {
    app.innerHTML = backdrop;
    drawnBackdrop = backdrop;
    drawnBackdropNodes = app.childNodes.length;
    app.insertAdjacentHTML('beforeend', overlays);
    for (const el of app.querySelectorAll<HTMLElement>('[data-keep-scroll]'))
      [el.scrollTop, el.scrollLeft] = scrolled.get(el.dataset.keepScroll) ?? [0, 0];
    if (screen === 'collection') showcaseMounted();
    if (screen === 'solo' || screen === 'friends') deckCarouselMounted(!scrolled.has('decks'));
    if (screen === 'friends') friendsMounted();
  }
  handOverlap();
  if (screen === 'game') { renderTutorial(showRules || showSettings); playLogSounds(game, mySeat); } else stopTutorial();
  persist();
  // Never let the page end up scrolled sideways (a focused or enlarged card could otherwise do it).
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

/**
 * The home screen's modes, in two groups with space between them: playing (Solo, Friend, Ranked), then
 * your cards (Collection, Store, Deck builder). Coming-soon modes say what they will be.
 */
/**
 * Home's tiles, each drawn as a card of one of the decks: in that deck's frame colours, with an illustration in its
 * style of its folk at the tile's business (a domowik dealing a game for one; two paris playing over tea), a type line,
 * and rules text: a keyword line on what the tile is, and a line of flavour.
 */
type ModeCard = { name: string; sub: string; deck: string; code: string; icon: string; type: string; key: string; kw: string; text: string; flavor: string };
const MODE_GROUPS = [
  [
    { key: 'solo', name: 'Solo', sub: 'vs the AI', soon: '', deck: 'domowiki', code: 'FB-01', icon: 'one', type: 'Game mode · 1 player',
      kw: 'Play', text: 'any deck against the AI.', flavor: 'No one to blame but the AI.' },
    { key: 'friend', name: 'Friend', sub: 'Online', deck: 'pari', code: 'FB-02', icon: 'two', type: 'Game mode · 2 players',
      kw: 'Play', text: 'a friend, each on your own device.', flavor: 'Still friends after. Mostly.',
      soon: 'Play with a friend online: add each other with a code, then you each play on your own device.' },
    { key: 'ranked', name: 'Ranked', sub: 'The ladder', deck: 'huihai', code: 'FB-03', icon: 'crown', type: 'Game mode · Rated',
      kw: 'Climb', text: 'the ladder, game by game.', flavor: 'Humility sold separately.',
      soon: 'Ranked games against other players, with an Elo rating and a ladder to climb.' },
  ],
  [
    { key: 'collection', name: 'Collection', sub: 'Your cards', soon: '', deck: 'jiaoren', code: 'FB-04', icon: 'pearl', type: 'Cards · Library',
      kw: 'Keep', text: 'every card you own, deck by deck.', flavor: 'Hoarding, but make it art.' },
    { key: 'store', name: 'Store', sub: 'New cards', deck: 'aluxes', code: 'FB-05', icon: 'bag', type: 'Cards · Shop',
      kw: 'Find', text: 'new decks and cards.', flavor: 'The alux takes exact change.', soon: 'A store for new decks and cards.' },
    { key: 'decks', name: 'Deck builder', sub: 'Your decks', soon: '', deck: 'domowiki', code: 'FB-06', icon: 'stack', type: 'Cards · Workshop',
      kw: 'Build', text: 'a Hero and 50 cards of your own.', flavor: 'Fifty cards. Zero regrets.' },
  ],
];
const MODE_EXTRAS: ModeCard[] = [
  { key: 'tutorial', name: 'Tutorial', sub: 'With tips', deck: 'pari', code: 'FB-07', icon: 'book', type: 'Lessons · Guided',
    kw: 'Learn', text: 'your first game, with tips.', flavor: 'Nobody is born knowing this.' },
  { key: 'docs', name: 'Documentation', sub: 'The rules', deck: 'huihai', code: 'FB-08', icon: 'scroll', type: 'Lessons · Reference',
    kw: 'Read', text: 'the rules, in full.', flavor: 'Legends read the manual.' },
];
/** The decks the tiles borrow: their frames' colours (as the cards draw them) and their names for the footer. */
const MODE_DECKS: Record<string, { name: string; main: string; dark: string; tint: string }> = {
  domowiki: { name: 'Domowiki', main: '#5B3F9E', dark: '#2E1F5C', tint: '#EEE8FB' },
  pari: { name: 'Pari', main: '#2E5C9E', dark: '#16305A', tint: '#E3ECF8' },
  aluxes: { name: 'Aluxes', main: '#2E8FA3', dark: '#1A4D5C', tint: '#DCF1F5' },
  jiaoren: { name: 'Jiaoren', main: '#D9735F', dark: '#7A2E2A', tint: '#FCE9E3' },
  huihai: { name: 'Hui Hai', main: '#4E9A3A', dark: '#24501A', tint: '#E9F5E1' },
};
/** The small emblems in the cards' corner badges, drawn in the frame's colour. */
const MODE_ICONS: Record<string, string> = {
  one: '<rect x="8" y="4" width="10" height="15" rx="2"/>',
  two: '<rect x="4" y="6" width="10" height="14" rx="2"/><rect x="10" y="3" width="10" height="14" rx="2"/>',
  crown: '<path d="M4 17 L5 7 L9.5 11 L12 5 L14.5 11 L19 7 L20 17 Z"/>',
  pearl: '<circle cx="12" cy="12" r="6"/><circle cx="10" cy="10" r="1.6" class="lit"/>',
  bag: '<path d="M6 9 H18 L17 20 H7 Z"/><path d="M9 9 V7 a3 3 0 0 1 6 0 V9" fill="none"/>',
  stack: '<rect x="5" y="9" width="12" height="11" rx="2"/><path d="M8 6 H19 V17" fill="none"/>',
  book: '<path d="M3 6 C7 4 10 5 12 7 C14 5 17 4 21 6 V19 C17 17 14 18 12 20 C10 18 7 17 3 19 Z"/>',
  scroll: '<path d="M6 5 H17 a2 2 0 0 1 0 4 H16 V19 H7 a2 2 0 0 1 0 -4 V5 Z"/>',
};
const MODES = MODE_GROUPS.flat();

/** With accounts on, the tiles that need one, and the line on why that heads "Sign in or create account". */
const ACCOUNT_TILES: Record<string, string> = {
  friend: 'Your friends live in your Via Mochi account: add them, and play them online.',
  collection: 'Your collection lives in your Via Mochi account, so it’s on every device.',
  decks: 'Your decks live in your Via Mochi account, so they’re on every device.',
};

/**
 * The Store opens only for an account the Fruitcats API lets in (its testers, until launch). For everyone else, signed
 * in or not, the tile stays "Coming soon" (store-plan.md, Hidden until launch).
 */
const storeOpen = () => STORE && signedIn() && storeAccess() === 'open';

const storeHost: StoreHost = {
  render,
  openDeckBuilder: () => { openDeckBuilder(); screen = 'decks'; render(); },
  backToBuilder: () => { screen = 'decks'; render(); },
};
/** The deck builder can send a deck's missing cards to the Store. */
const builderHost: BuilderHost = {
  render,
  openStore: (deck: DeckList) => { if (STORE) { openStoreForDeck(storeHost, deck); screen = 'store'; render(); } },
};

/** The unfinished game, for the Resume button: "Round 4 · Dziadziuś vs Parijan". */
function savedGameLabel(): string | null {
  const saved = loadGame()?.game;
  return saved ? `Round ${saved.round} · <span class="nowrap">${saved.players.map((pl) => esc(cardName(pl.hero.id))).join(' vs ')}</span>` : null;
}

/** The Friend tile's line: a game to go back to, a friend who wants to play, or just "Online". */
function friendTileLine(): { line: string; badge: number; waiting: boolean } {
  const n = live.incoming.length;
  if (!live.open) return { line: '<span class="mode-sub">Paused for now</span>', badge: 0, waiting: false };
  if (live.waiting) return { line: `<span class="mode-sub continue-line">In line · ${live.waiting.position}</span>`, badge: 0, waiting: true };
  // Short, plain words: the line must fit under the tile on the narrowest phone.
  if ((ol && !ol.end) || live.match) return { line: '<span class="mode-sub continue-line">Back to the game</span>', badge: n, waiting: true };
  if (n) return { line: '<span class="mode-sub continue-line">Join the game</span>', badge: n, waiting: true };
  if (live.outgoing) return { line: `<span class="mode-sub continue-line">Waiting for ${esc(friendName(live.outgoing.to))}</span>`, badge: 0, waiting: true };
  return { line: '<span class="mode-sub">Online</span>', badge: 0, waiting: false };
}

/** One of Home's tiles as a card. `open` is the element's opening tag without its brackets (a button or a link). */
/**
 * Each card's own colour, stepping around the colour wheel in the order the cards are laid out (red, orange, gold,
 * green, teal, blue, violet, magenta), all at one lightness and strength: a spectrum, so no card shouts and none
 * repeats. OKLCH hue in degrees.
 */
const MODE_HUES: Record<string, number> = { solo: 25, friend: 55, ranked: 88, collection: 145, store: 195, decks: 250, tutorial: 295, docs: 340 };
const modeColours = (key: string) => {
  const h = MODE_HUES[key] ?? 280;
  return `--main:oklch(0.56 0.14 ${h});--dark:oklch(0.32 0.08 ${h});--tint:oklch(0.93 0.03 ${h})`;
};

function modeCard(open: string, m: ModeCard, status: string, badge: number): string {
  const tag = open.split(' ')[0], d = MODE_DECKS[m.deck];
  return `
      <${open} style="${modeColours(m.key)}">
        ${badge ? `<span class="mode-badge" aria-label="${badge} waiting">${badge}</span>` : ''}
        <span class="mc-frame"><span class="mc-face">
          <span class="mc-bar"><span class="mc-gem" aria-hidden="true"><svg viewBox="0 0 24 24">${MODE_ICONS[m.icon]}</svg></span><span class="mc-name ${m.name.length > 8 ? 'long' : ''}">${m.name}</span></span>
          <span class="mc-art"><img src="${BASE}ui/mode-${m.key}-v4.webp" alt="" draggable="false"></span>
          <span class="mc-type"><span>${m.type}</span><small>${m.code}</small></span>
          <span class="mc-text"><span class="mc-rule"><b>${m.kw}:</b> ${m.text}</span>
            ${status ? status.replace(/mode-sub/g, 'mc-state') : `<span class="mc-flavor">${m.flavor}</span><span class="mc-short">${m.sub}</span>`}</span>
          <span class="mc-foot">Folkborn · ${d.name}</span>
        </span></span>
      </${tag}>`;
}

function renderHome(): string {
  const saved = savedGameLabel();
  return `
  <div class="menu home">
    ${ACCOUNTS ? renderHomeAccount() : ''}
    ${settingsButton('corner-settings')}
    <header class="title">
      <h1>Folkborn</h1>
      <p>Gentle legends from every corner of the world</p>
    </header>
    <nav class="modes card-grid">
      ${MODES.map((mode) => {
        // The Store tile opens when the Store is built in and open to you (store-plan.md, Hidden until launch).
        const m = (mode.key === 'store' && storeOpen()) || (mode.key === 'friend' && ONLINE) ? { ...mode, soon: '' } : mode;
        // Under the card's line, only what's worth saying now: Sign in to open, a game to resume, or what's happening
        // with a friend. A Coming soon card says so across its picture (skin.css).
        const resume = m.key === 'solo' && saved;
        const needsAccount = ACCOUNTS && !signedIn() && m.key in ACCOUNT_TILES && !(m.key === 'friend' && !ONLINE);
        const friend = m.key === 'friend' && ONLINE && !needsAccount ? friendTileLine() : null;
        const status = m.soon ? ''
          : needsAccount ? '<span class="mode-sub signin-line">Sign in to open</span>'
          : resume ? `<span class="mode-sub continue-line">Resume · Round ${loadGame()!.game.round}</span>`
          : friend?.waiting ? friend.line
          : friend && !live.open ? friend.line : '';
        return modeCard(`button class="mcard ${m.soon ? 'soon' : ''} ${resume || friend?.waiting ? 'has-save' : ''}" data-click="${m.soon ? `home:soon:${m.key}` : `home:${m.key}`}"`,
          m, status, friend?.badge ?? 0);
      }).join('')}
      ${modeCard('button class="mcard" data-click="home:tutorial" title="A guided first game with tips"', MODE_EXTRAS[0], '', 0)}
      ${modeCard(`a class="mcard" href="${BASE}docs.html"`, MODE_EXTRAS[1], '', 0)}
    </nav>
    <p class="home-note" aria-live="polite">${esc(homeNote)}</p>
  </div>`;
}

/** The decks to choose from: the ready-made ones you have (the starters, and any from the Store), then your own. */
function deckChoices() {
  return [
    ...ownedDeckKeys().map((key) => {
      const deck = DECKS[key], lore = SETS[CARDS[deck.hero]?.set ?? '']?.lore;
      return { key, deck, ready: true, origin: lore?.eyebrow ?? lore?.from ?? '', blurb: esc(deckBlurb(key)) };
    }),
    ...listDecks().map((d) => {
      const ready = isReady(d);
      return { key: customKey(d.id), deck: d, ready, origin: 'Your own deck',
        blurb: ready ? `Your own deck, led by ${esc(cardName(d.hero))}.`
          : `<span class="deck-unready">Not finished: ${deckSize(d)} / ${DECK_RULES.size} cards</span>` };
    }),
  ];
}
type DeckChoice = ReturnType<typeof deckChoices>[number];

/**
 * Choosing a deck, as the Collection shows a deck's cards: one deck at a time, its Hero's card large, swiped (or turned
 * with the arrows), with dots saying how many there are, and beside it what the deck is and how it plays. The deck
 * showing is the one you play. Solo and Play a friend both use it.
 */
function renderDeckPicker(): string {
  // The chosen deck may have been deleted, or edited below 50 cards, since it was chosen.
  const chosen = deckForKey(myDeck);
  if (!chosen || !isReady(chosen)) myDeck = firstDeck();
  if (!deckForKey(deckInView)) deckInView = myDeck;
  const decks = deckChoices();
  const index = Math.max(0, decks.findIndex((d) => d.key === deckInView));
  return `
    <section class="picker deck-picker" aria-label="Choose your deck">
      <div class="dk-carousel">
        <div class="dk-track" data-keep-scroll="decks">
          ${decks.map((d, i) => `
            <div class="dk-slide ${i === index ? 'on' : ''}" data-deck="${esc(d.key)}" data-ready="${d.ready}">
              <img class="dk-card" src="${yourCardUrl(`${d.deck.hero}-kitten`)}" alt="${esc(d.deck.name)}, led by ${esc(CARDS[d.deck.hero].name)}" draggable="false">
            </div>`).join('')}
        </div>
        <button class="dk-arrow prev" data-deck-scroll="-1" aria-label="Previous deck">‹</button>
        <button class="dk-arrow next" data-deck-scroll="1" aria-label="Next deck">›</button>
        ${renderDeckDots(decks.length, index)}
      </div>
      ${renderDeckInfo(decks[index])}
    </section>`;
}

function renderDeckDots(count: number, index: number): string {
  if (count < 2) return '';
  return `<span class="dk-dots" role="img" aria-label="Deck ${index + 1} of ${count}">${Array.from({ length: count }, (_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** Beside the card: where the deck's folk come from, its name, its way of playing, how it plays, and its Hero. */
function renderDeckInfo(d: DeckChoice | undefined): string {
  if (!d) return '<div class="dk-info"></div>';
  const hero = CARDS[d.deck.hero];
  return `
      <div class="dk-info" aria-live="polite">
        ${d.origin ? `<p class="dk-origin">${esc(d.origin)}</p>` : ''}
        <h2 class="dk-name">${esc(d.deck.name)}</h2>
        <p class="dk-tags"><span class="deck-class ${famClass(d.deck.hero)}">${esc(familyName(hero.family))} · ${esc(familyInfo(hero.family)?.mechanic ?? '')}</span></p>
        <p class="dk-about">${d.blurb}</p>
        <p class="dk-hero">Hero: <b>${esc(cardName(d.deck.hero))}</b></p>
      </div>`;
}

/** What Play a friend needs from this file: Solo's deck picker, and the deck showing in it. */
const friendsHost: FriendsHost = {
  render,
  deckPicker: renderDeckPicker,
  chosenDeck() {
    const d = deckForKey(deckInView);
    if (!d || !isReady(d)) return null;
    return { name: d.name, hero: d.hero, cards: { ...d.cards } };
  },
  hasPlayed,
};

/** How far apart the decks in the picker are: a deck's width and the gap between two. */
const deckPitch = (track: HTMLElement) => {
  const [a, b] = track.querySelectorAll<HTMLElement>('.dk-slide');
  return Math.max(1, b ? b.offsetLeft - a.offsetLeft : track.clientWidth);
};

/** Turns the deck picker by `step` decks (the arrows; fingers swipe). */
function turnDeck(step: number) {
  const track = app.querySelector<HTMLElement>('.dk-track');
  if (!track) return;
  const i = Math.round(track.scrollLeft / deckPitch(track)) + step;
  track.scrollTo({ left: i * deckPitch(track), behavior: 'smooth' });
}

/**
 * The deck picker, after each render. Each deck fills the strip's width, so exactly one shows. As you swipe, the deck
 * that settles is chosen in place, without redrawing the screen under your finger: its words, the dots and Play
 * follow it.
 */
function deckCarouselMounted(first: boolean) {
  const track = app.querySelector<HTMLElement>('.dk-track');
  if (!track) return;
  const slides = [...track.querySelectorAll<HTMLElement>('.dk-slide')];
  const carousel = track.parentElement!;
  const start = slides.findIndex((el) => el.dataset.deck === deckInView);
  if (first && start > 0) track.scrollTo({ left: start * deckPitch(track), behavior: 'instant' });
  let frame = 0;
  const update = () => {
    frame = 0;
    const i = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / deckPitch(track))));
    carousel.classList.toggle('at-start', i === 0);
    carousel.classList.toggle('at-end', i === slides.length - 1);
    const slide = slides[i], key = slide.dataset.deck!;
    if (key === deckInView) return;
    deckInView = key;
    if (slide.dataset.ready === 'true') { myDeck = key; saveChosenDeck(myDeck); }
    slides.forEach((el, k) => el.classList.toggle('on', k === i));
    const dots = carousel.querySelector('.dk-dots');
    if (dots) dots.outerHTML = renderDeckDots(slides.length, i);
    const info = app.querySelector('.dk-info');
    if (info) info.outerHTML = renderDeckInfo(deckChoices().find((d) => d.key === key));
    const footer = app.querySelector('.setup-footer');
    if (footer && screen === 'solo') footer.outerHTML = renderSoloFooter();
    // Play a friend: its button waits for a finished deck too.
    for (const b of app.querySelectorAll<HTMLButtonElement>('[data-click="pf:challenge"], [data-click^="pf:accept:"]'))
      b.disabled = slide.dataset.ready !== 'true' || !live.connected;
  };
  update();
  track.addEventListener('scroll', () => { frame ||= requestAnimationFrame(update); }, { passive: true });
}

/** Play, or Resume and New game. A new game waits until the deck in the middle is finished. */
function renderSoloFooter(): string {
  const saved = savedGameLabel();
  const deck = deckForKey(deckInView);
  const blocked = !deck || !isReady(deck);
  const note = blocked ? 'Finish this deck in the Deck builder to play it' : '';
  return `
    <div class="setup-footer">
      ${saved ? `
      <div class="resume-buttons">
        <button class="play-button twin" data-click="home:continue">
          <span class="twin-name">Resume game</span><span class="twin-sub">${saved}</span></button>
        <button class="play-button twin" data-click="solo:play" ${blocked ? 'disabled' : ''} title="${note || 'Start a new game with the deck and difficulty above; it replaces the unfinished one'}">
          <span class="twin-name">New game</span><span class="twin-sub">${blocked ? 'Deck not finished' : `${esc(deck.name)} · ${DIFFICULTY[difficulty].label}`}</span></button>
      </div>` : `<button class="play-button" data-click="solo:play" ${blocked ? 'disabled' : ''} title="${note}">${blocked ? 'Deck not finished' : 'Play'}</button>`}
    </div>`;
}

function renderSolo(): string {
  return `
  <div class="menu solo">
    <div class="scene-bg scene-solo" aria-hidden="true"></div>
    <div class="setup-bar">
      ${backButton()}
      <span></span>
      ${settingsButton()}
    </div>
    <header class="scene-title"><h1 class="sr-only">Solo game</h1></header>
    <div class="setup-body solo-stage">
      ${renderDeckPicker()}
      <section class="dk-diff" aria-label="Difficulty">
        <h2 class="dk-diff-title">Difficulty</h2>
        <div class="dk-diff-choices" role="radiogroup" aria-label="Difficulty">
          ${Object.entries(DIFFICULTY).map(([key, d]) => `
            <button class="${key === difficulty ? 'chosen' : ''}" role="radio" aria-checked="${key === difficulty}" data-click="solo:${key}">
              <span class="dk-diff-name">${d.label}</span><span class="dk-diff-sub">${d.blurb}</span>
            </button>`).join('')}
        </div>
      </section>
      ${renderSoloFooter()}
    </div>
  </div>`;
}

function renderGame(): string {
  const s = game!;
  const v = seen()!;
  const prompt = humanPrompt();
  const legal = prompt ? legalActions(s, mySeat) : [];
  const hl = lit(v);
  const playable = new Set(legal.flatMap((a) => (a.t === 'play' || a.t === 'lucky' || a.t === 'ambush' ? [a.uid] : [])));

  const wide = drawnWide = WIDE.matches;
  const foeBar = renderPlayer(v, theirSeat);
  const myBar = renderPlayer(v, mySeat, legal);
  return `
  <div class="game">
    <main class="board ${hl.size ? 'targeting' : ''} ${wide ? 'wide' : ''}">
      ${wide ? '' : foeBar}
      ${renderLanes(v, theirSeat, hl)}
      ${renderMidbar(v, legal)}
      ${renderLanes(v, mySeat, hl)}
      ${wide ? '' : myBar}
      ${renderHand(v, playable)}
    </main>
    <aside class="side ${wide ? 'wide' : ''}">
      ${wide ? foeBar : ''}
      <div class="inspector"><img id="zoom" src="${inspected?.url ?? yourCardUrl(heroKey(s, mySeat))}" alt="">
        ${wide ? '<small class="inspector-hint">Tap a card to read it here · hold it or 🔍 for full size</small>' : ''}</div>
      ${wide ? myBar : ''}
      <div class="side-buttons">
        <button class="icon-button zoom-button" data-click="ui:zoom" title="Read the card full size" aria-label="Read the card full size"><img src="${BASE}ui/icon-zoom.webp" alt=""></button>
        <button class="icon-button story-button" data-click="ui:story" title="Story so far" aria-label="Story so far" aria-pressed="${showStory}"><img src="${BASE}ui/icon-story.webp" alt=""></button>
        <button data-click="ui:rules">Rules</button>
        ${settingsButton()}
        ${backButton(ol ? 'ol:home' : 'ui:quit', 'Home')}
        ${onlineSideButtons()}
      </div>
    </aside>
    ${renderStory(v)}
    ${clashReport && !(ol && ol.versusUntil > Date.now()) ? renderClashReport(v) : ''}
    ${ol ? renderOnlineResult(s) : s.winner !== null && !clashReport ? renderGameOver(s) : ''}
    ${ol ? renderVersus(s as PlayerView) : ''}
    ${showRules ? renderRules() : ''}
  </div>`;
}

function handOverlap() {
  const hand = app.querySelector<HTMLElement>('.hand');
  if (!hand) return;
  const cards = hand.querySelectorAll<HTMLElement>('.hand-card');
  const width = cards.length ? cards[0].getBoundingClientRect().width : 0;
  hand.classList.toggle('overlapping', cards.length > 1 && cards.length * width + (cards.length - 1) * 8 > hand.clientWidth);
}
window.addEventListener('resize', handOverlap);

/**
 * Story so far: the game's transcript in a drawer that slides in from the board's edge (from the right beside the
 * panel; up from the bottom on a narrow screen). It is part of the board, not a dialog: no backdrop, and the game
 * goes on while it is out. Newest at the bottom, where the eye lands, and it keeps its scroll between redraws.
 */
function renderStory(s: GameState): string {
  return `<aside class="story-drawer ${showStory ? 'open' : ''}" aria-hidden="${!showStory}" aria-label="Story so far">
    <div class="story-head"><h3>Story so far</h3>
      <button class="icon-button story-close" data-click="ui:story" title="Close" aria-label="Close">×</button></div>
    <ul class="log" data-keep-scroll="story">${s.log.slice(-120).reverse().map((e) => `<li class="${e.player === mySeat ? 'me' : e.player === theirSeat ? 'foe' : e.text.startsWith('—') ? 'sys' : ''}">${esc(humanize(e.text))}</li>`).join('')}</ul>
  </aside>`;
}

/** The Story drawer slides rather than snapping: toggled on the drawn screen, and the next redraw keeps it. */
function toggleStory() {
  showStory = !showStory;
  const drawer = app.querySelector<HTMLElement>('.story-drawer');
  if (!drawer) { render(); return; }
  drawer.classList.toggle('open', showStory);
  drawer.setAttribute('aria-hidden', String(!showStory));
  app.querySelector('.story-button')?.setAttribute('aria-pressed', String(showStory));
}

/** A card's rules text with its keywords in bold, for the unit tiles on a wide screen. */
function rulesHtml(text: string): string {
  let html = esc(text);
  for (const k of glossary()) html = html.replace(new RegExp(`${k.test.source}:?`, 'g'), '<b>$&</b>');
  return html.replace(/\n/g, '<br>');
}
function renderPlayer(s: GameState, p: PlayerId, legal: Action[] = []): string {
  const pl = s.players[p];
  const side = heroSide(s, p);
  const mine = p === mySeat;
  // The Lantern sits on the corner of the Hero portrait: its holder's effects go first in the Clash.
  const lantern = s.yarn === p ? `<span class="yarn" title="Holds the Lantern: their effects go first">${YARN_ICON}</span>` : '';
  const canAbility = mine && legal.some((a) => a.t === 'ability');
  const next = levelCost(s, p);
  const interest = interestOn(s, pl.offerings);
  const deciding = s.winner === null && s.prompt !== null && mayAct(s, p);
  const badges = badgeMechanics(CARDS[pl.hero.id].family).filter(([name]) => evaluateCondition(s, p, name))
    .map(([name, m]) => `<span class="lush-badge" title="${esc(m.badge.title ?? name)}">${m.badge.icon ?? ''} ${esc(name)}</span>`).join('');

  return `
  <section class="player ${mine ? 'me' : 'foe'} ${deciding ? 'thinking' : ''}">
    <div class="hero-slot">
    <div class="hero ${famClass(pl.hero.id)} ${pl.hero.exhausted ? 'exhausted' : ''} ${pl.hero.grown ? 'grown' : ''}"
         data-click="heroinfo:${p}" data-zoom="${(mine ? yourCardUrl : cardUrl)(heroKey(s, p))}" data-zoom-card="${heroKey(s, p)}">
      <div class="art" style="background-image:url(${artUrl(heroKey(s, p))})"></div>
      ${side.power ? `<div class="pow">${side.power}</div>` : ''}
    </div>
    ${lantern}
    </div>
    <div class="stats">
      <div class="who">${esc(ol && mine ? 'You' : pl.name)} <span class="deck">${esc(pl.deckName)}</span></div>
      <div class="stat-row">
        <div class="lives" title="${pl.lives.length} of ${9 - (pl.handicap ?? 0)} Candles left${pl.handicap ? ` (a handicap of ${pl.handicap})` : ''}"><span class="life-heart ${pl.lives.length <= 3 ? 'low' : ''}"><b>${pl.lives.length}</b></span></div>
        <div class="purse" title="${TERMS.offerings}: what you pay with. Saved ones earn interest: +1 for every ${s.rules.interestPer} at the start of each round (at most ${s.rules.interestMax}).">
          <b>${pl.offerings}</b> ${TERMS.offerings}${interest ? ` <small>+${interest}</small>` : ''}</div>
        <div class="level" title="Your Hero's Level: how many units you may field.${next !== null ? ` The next Level costs ${next}.` : ''}">Level <b>${pl.hero.level}</b> <small>${pl.yard.length + (pl.fallen?.length ?? 0)}/${pl.hero.level}</small></div>
        <div class="counters">
          <span title="Cards in hand">✋ ${pl.hand.length}</span>
          <span title="Cards in deck">📚 ${pl.deck.length}</span>
        </div>
        ${badges}
      </div>
      <div class="ability" title="${esc(side.text)}" data-click="heroinfo:${p}"
           data-zoom="${(mine ? yourCardUrl : cardUrl)(heroKey(s, p))}" data-zoom-card="${heroKey(s, p)}">${esc(side.text).replace(/(Exhaust[^:]*:|Awaken:)/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
      ${canAbility ? '<div class="hero-actions"><button class="primary" data-click="btn:ability">Use ability</button></div>' : ''}
    </div>
    ${ol ? `<div class="player-face online">${playerFace(p)}</div>`
      : ACCOUNTS ? `<div class="player-face">${boardFace(mine ? 'you' : 'computer', CARDS[pl.hero.id].family)}</div>` : ''}
  </section>`;
}

/** A unit's mechanic chips: each keyword that keeps a counter, with its icon and how far it has grown (🌽+1). */
function counterChips(u: Unit, keywordList: string[]): string[] {
  return keywordList.flatMap((name) => {
    const counter = MECHANICS[name]?.counter;
    if (!counter) return [];
    const n = u.counters?.[counter.name] ?? 0;
    const icon = MECHANICS[name].icon ?? '';
    return [n ? `${icon}+${n}` : `${icon} ${name}`.trim()];
  });
}

const ROLE = ['Lure', 'Elusive', '', 'Guardian'];

function renderUnit(s: GameState, u: Unit, owner: PlayerId, hl: Set<string>): string {
  const k = unitKeywords(u, s);
  const power = unitPower(u, s);
  const health = unitHealth(u, s) - u.damage;
  const chips = [
    ROLE[targetRank(u, s)], k.sneaky && 'Sneaky', k.fierce && 'Fierce', k.zoomies && 'Swift', k.tough && `Tough ${k.tough}`,
    ...counterChips(u, k.all),
    u.toy && `🧿 ${cardName(u.toy.id)}`,
  ].filter(Boolean);
  const key = `unit:${u.uid}`;
  const why = u.exhausted ? 'Exhausted: it deals no damage in this Clash.' : 'Ready to fight in the Clash.';
  const cls = [
    'unit', famClass(u.id), u.exhausted && 'exhausted', hl.has(key) && 'targetable', selection?.uid === u.uid && 'selected',
  ].filter(Boolean).join(' ');
  return `
  <div class="${cls}" data-click="${key}" data-zoom="${(owner === mySeat ? yourCardUrl : cardUrl)(u.id)}" data-zoom-card="${u.id}"
       data-zoom-state="${esc(why)}" title="${esc(cardName(u.id))}: ${esc(why)}">
    <div class="art" style="background-image:url(${artUrl(u.id)})"></div>
    ${u.stars ? `<div class="stars" title="${u.stars} copies merged">${'★'.repeat(u.stars)}</div>` : ''}
    <div class="ubox">
      <div class="uname">${esc(cardName(u.id))}</div>
      ${CARDS[u.id]?.text ? `<div class="utext">${rulesHtml(CARDS[u.id].text!)}</div>` : ''}
      <div class="pow ${power > (CARDS[u.id].power ?? 0) ? 'buffed' : ''} ${power > 9 ? 'two-digit' : ''}">${power}</div>
      <div class="hp ${u.damage ? 'hurt' : health > (CARDS[u.id].health ?? 0) ? 'buffed' : ''} ${health > 9 ? 'two-digit' : ''}">${health}</div>
    </div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(String(c))}</span>`).join('')}</div>` : ''}
    ${u.exhausted ? '<div class="zzz">zzz</div>' : ''}
  </div>`;
}

/**
 * A player's six lanes, left to right: a unit fights the enemy across from it first. Empty lanes are outlines you
 * can play into; a face-down card marks an Ambush, and a little target an effect of yours aimed at their lane.
 */
function renderLanes(s: GameState, p: PlayerId, hl: Set<string>): string {
  const pl = s.players[p];
  const mine = p === mySeat;
  const foeHand = !mine
    ? `<div class="foe-hand-slot">${shownHand(s) ?? `<div class="foe-hand">${pl.hand.map(() => '<div class="card-back"></div>').join('')}</div>`}
      <div class="pantry-label foe-hand-label">${pl.hand.length} in hand</div></div>` : '';
  const aimed = (lane: number) => (s.players[mySeat].pending ?? [])
    .filter((x) => x.target?.kind === 'lane' && x.target.player === p && x.target.lane === lane).map((x) => cardName(x.sourceId));
  const lanes = Array.from({ length: LANES }, (_, i) => {
    const u = laneUnit(s, p, i);
    const ambush = (pl.ambushes ?? []).find((a) => a.lane === i);
    const marks = [
      ambush ? `<span class="ambush-mark" title="${mine ? `Your Ambush: ${esc(cardName(ambush.card.id))}` : 'A face-down Ambush'}">${mine ? '' : '?'}</span>` : '',
      ...aimed(i).map((n) => `<span class="aim-mark" title="${esc(n)} is aimed here: it happens when the Clash begins">🎯</span>`),
    ].join('');
    if (u) return `<div class="lane">${renderUnit(s, u, p, hl)}${marks}</div>`;
    const key = `lane:${p}:${i}`;
    return `<div class="lane empty ${hl.has(key) ? 'targetable' : ''}" data-click="${key}" title="${mine ? 'Your' : 'Their'} lane ${i + 1}"><span class="lane-no">${i + 1}</span>${marks}</div>`;
  }).join('');
  return `<section class="yard lanes ${mine ? 'me' : 'foe'}" style="--n:${LANES}">${foeHand}${lanes}</section>`;
}

function renderHand(s: GameState, playable: Set<number>): string {
  const prompt = humanPrompt();
  const mulligan = prompt?.kind === 'mulligan';
  const me = s.players[mySeat];
  const free = new Set(me.free ?? []);
  const n = me.hand.length;
  return `<section class="hand" style="--n:${n};--gaps:${Math.max(1, n - 1)}">
    ${me.hand.map((c) => {
      const cls = [
        'hand-card', (playable.has(c.uid) || mulligan) && 'playable', picks.has(c.uid) && 'picked',
        selection?.options.some((a) => 'uid' in a && a.uid === c.uid && a.t !== 'move') && 'selected', free.has(c.uid) && 'lucky',
      ].filter(Boolean).join(' ');
      // A unit's Health is printed on the card's bottom-right corner, which a bigger hand's overlap hides: it is
      // repeated as a chip on the left edge, over the art, while the hand overlaps (see handOverlap).
      const health = CARDS[c.id].health;
      const hp = health !== undefined ? `<span class="hand-hp" aria-hidden="true">${health}</span>` : '';
      const tag = free.has(c.uid) ? '<span class="free-tag">Free</span>' : '';
      return `<button class="${cls}" data-click="hand:${c.uid}" data-zoom="${yourCardUrl(c.id)}" data-zoom-card="${c.id}"><img src="${yourCardUrl(c.id)}" alt="${esc(CARDS[c.id].name)}" decoding="async">${hp}${tag}</button>`;
    }).join('')}
  </section>`;
}

const PARAM_WORDS: Record<Param, string> = { slot: 'a lane', lane: 'a lane to set it in', target: 'a target', target2: 'a second target' };

function renderMidbar(s: GameState, legal: Action[]): string {
  const prompt = humanPrompt();
  const me = s.players[mySeat];
  let text = '';
  let buttons = '';

  const onl = ol ? onlineBar(s, !!prompt) : null;
  if (s.winner !== null) text = 'Game over.';
  else if (!prompt) text = onl?.text ?? '<span class="dots">Your opponent is deciding</span>';
  else if (selection) {
    const p = paramOf(selection.options);
    const lane = selection.options.some((a) => 'target' in a && a.target?.kind === 'lane');
    text = p
      ? `Choose ${PARAM_WORDS[p]} for <b>${esc(selection.label)}</b>.${lane && p === 'target' ? ' An effect aimed at their lane happens when the Clash begins, to whoever stands there.' : ''}`
      : `<b>${esc(selection.label)}</b>`;
    buttons = (selection.alts ?? []).map((alt, i) => `<button data-click="btn:alt:${i}">${esc(alt.label)}</button>`).join('')
      + '<button data-click="btn:cancel">Cancel</button>';
  } else if (prompt.kind === 'mulligan') {
    text = `<b>Mulligan.</b> Swap up to <b>${MULLIGAN_MAX}</b> cards you don't like: you get the same number back. (${picks.size} selected.)`;
    buttons = `<button class="primary" data-click="btn:confirm">${picks.size ? `Replace ${picks.size}` : 'Keep hand'}</button>`;
  } else {
    const level = legal.find((a) => a.t === 'levelUp');
    const over = me.hand.length - HAND_LIMIT;
    const interest = interestOn(s, me.offerings);
    text = `<b>Muster, round ${s.round}.</b> Build your side in secret: play units into your lanes, move them, level up, then press <b>Ready</b>. `
      + `You have <b>${me.offerings}</b> ${TERMS.offerings}${interest ? ` (saved, they earn <b>+${interest}</b> next round)` : ''}.`;
    if (over > 0) text += ` <b>Too many cards:</b> offer ${over} before you can be Ready (tap a card, then Offer it).`;
    buttons = `${level ? `<button data-click="btn:level" title="One more lane">Level up <small>(${levelCost(s, mySeat)})</small></button>` : ''}
      <button class="primary" data-click="btn:ready" ${over > 0 ? 'disabled' : ''}>Ready</button>`;
  }
  if (prompt && onl?.text) text = `${onl.text} ${text}`;
  if (onl?.buttons) buttons = `${onl.buttons}${buttons}`;
  return `<section class="midbar">
    <div class="round"><small>Round</small><b>${s.round}</b></div>
    <div class="prompt">${notice ? `<div class="notice">✓ ${esc(notice)}</div>` : ''}${text}${hintLine && prompt ? `<div class="hint-line">💡 ${esc(hintLine)}</div>` : ''}${flash ? `<div class="flash">${esc(flash)}</div>` : ''}</div>
    <div class="buttons">${buttons}</div>
  </section>`;
}

/**
 * The Clash, as a report to read: what happened before the fight, then each bout, then who won and what it cost.
 * Nothing moves on the board; the board shows how things stand.
 */
function renderClashReport(s: GameState): string {
  const report = clashReport!;
  const sections: { title: string; lines: LogEntry[] }[] = [{ title: 'Before the fight', lines: [] }];
  let result: LogEntry[] = [];
  for (const e of report.lines.slice(1)) {
    if (/^Bout \d+\.$/.test(e.text)) { sections.push({ title: e.text.replace('.', ''), lines: [] }); continue; }
    if (/ wins the Clash | still stand: |Nobody wins the Clash|loses a Candle|wins!$/.test(e.text) || result.length) { result = [...result, e]; continue; }
    sections.at(-1)!.lines.push(e);
  }
  const line = (e: LogEntry) => `<li class="${e.player === mySeat ? 'me' : e.player === theirSeat ? 'foe' : ''}">${esc(humanize(e.text))}</li>`;
  const body = sections.filter((x) => x.lines.length)
    .map((x) => `<section><h3>${esc(x.title)}</h3><ul>${x.lines.map(line).join('')}</ul></section>`).join('');
  const over = s.winner !== null;
  return `<div class="overlay">
    <div class="clash-report" role="dialog" aria-label="The Clash">
      <h2>The Clash · round ${report.round}</h2>
      <div class="cr-body" data-keep-scroll="clash">${body}</div>
      <ul class="cr-result">${result.map(line).join('')}</ul>
      <button class="primary" data-click="report:close">${over ? 'See the result' : 'On to the next round'}</button>
    </div>
  </div>`;
}

let countedGame: GameState | null = null;

function renderGameOver(s: GameState): string {
  if (countedGame !== s) {
    countedGame = s;
    markPlayed();
    count('finished');
    if (s.winner === mySeat) count('won');
  }
  const won = s.winner === mySeat;
  const heroP = won ? mySeat : theirSeat;
  return `<div class="overlay">
    <div class="game-over ${won ? 'won' : 'lost'}">
      <img src="${artUrl(`${s.players[heroP].hero.id}-bigcat`)}" alt="">
      <h2>${s.winner === 'draw' ? 'A draw!' : won ? 'You win!' : 'You lose!'}</h2>
      <p>${won ? 'The old tales will remember this one.' : 'Every legend stumbles before it soars.'} (${s.round} rounds)</p>
      <div class="buttons">
        <button class="primary" data-click="ui:again">Play again</button>
        <button data-click="ui:quit">Home</button>
      </div>
    </div>
  </div>`;
}

function renderSettings(alreadyOpen: boolean): string {
  const choice = (setting: string, value: string, label: string, chosen: boolean) =>
    `<button class="${chosen ? 'chosen' : ''}" data-click="set:${setting}:${value}" aria-pressed="${chosen}">${label}</button>`;
  const row = (name: string, note: string, buttons: string) =>
    `<div class="setting">
        <span class="setting-name">${name}${note ? `<small>${note}</small>` : ''}</span>
        <div class="segmented">${buttons}</div>
      </div>`;
  const labels: Record<SettingsSection, string> = { gameplay: 'Gameplay', sound: 'Sound', account: 'Account', contact: 'Contact us' };
  const ids: SettingsSection[] = ACCOUNTS ? ['gameplay', 'sound', 'account'] : ['gameplay', 'sound'];
  // A wide screen always shows a section (the first, until one is picked); a phone shows the list until one is.
  const current = settingsSection ?? 'gameplay';
  const tab = (id: SettingsSection, cls = '') =>
    `<button class="settings-tab ${cls} ${id === current ? 'chosen' : ''}" data-click="ui:settab:${id}"
      aria-current="${id === current ? 'page' : 'false'}">${labels[id]}</button>`;
  const body: Record<SettingsSection, () => string> = {
    gameplay: () => `
      <p class="setting-note">The Clash is a report to read, not an animation: nothing to switch on or off here.</p>
      ${ONLINE && signedIn() ? `<p class="setting-note">${esc(onlineStatus())}</p>` : ''}`,
    sound: () => row('Sound', '', choice('sound', 'on', 'On', soundEnabled()) + choice('sound', 'off', 'Off', !soundEnabled())),
    account: () => (ACCOUNTS ? `<div class="account-panel">${renderAccountPanel()}</div>` : ''),
    contact: () => (ACCOUNTS ? `<div class="account-panel">${renderContactPanel()}</div>` : ''),
  };
  // The Pawtrait picker brings its own title and back button.
  const title = current === 'account' && ACCOUNTS && pickingPawtrait() ? '' : `<h3>${labels[current]}</h3>`;
  return `<div class="overlay">
    <div class="settings settings-dialog ${settingsSection ? 'has-section' : ''} ${alreadyOpen ? 'no-pop' : ''}" role="dialog" aria-label="Settings">
      <div class="settings-head">
        <button class="icon-button settings-back" data-click="ui:settingsback" aria-label="Back to Settings" title="Back to Settings">‹</button>
        <h2>Settings</h2>
        <button class="icon-button settings-close" data-click="ui:settings" aria-label="Close" title="Close">×</button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings sections">
          ${ids.map((id) => tab(id)).join('')}
          ${ACCOUNTS ? tab('contact', 'settings-tab-contact') : ''}
        </nav>
        <section class="settings-pane" aria-label="${labels[current]}">
          ${title}
          ${body[current]()}
        </section>
      </div>
    </div>
  </div>`;
}

/**
 * How online play stands, in a sentence, for Settings. The game never depends on our servers to play: this only says
 * what works while they don't answer, so nobody has to wonder whether something is broken.
 */
function onlineStatus(): string {
  if (!navigator.onLine) return 'You’re offline. Solo, your decks and the Collection work as usual.';
  if (live.answering === false) {
    return 'Our servers aren’t answering right now. Solo, your decks and the Collection work as usual, and a game with a '
      + 'friend that’s already going carries on. New games with friends can start when they’re back.';
  }
  return live.answering ? 'Online play is working.' : 'Checking online play…';
}

function renderRules(): string {
  const r = game?.rules;
  return `<div class="overlay">
    <div class="rules" role="dialog" aria-label="Quick rules">
      <button class="icon-button rules-close" data-click="ui:rules" aria-label="Close" title="Close">×</button>
      <h2>Quick rules</h2>
      <p><b>Goal:</b> blow out all 9 of the rival Hero’s Candles.</p>
      <p><b>Each round:</b> the <b>Muster</b>, then the <b>Clash</b>. At the start of each round (but the first) you draw 2 cards and get your income in ${TERMS.offerings}.</p>
      <p><b>${TERMS.offerings} are money.</b> What you don’t spend is kept, and every ${r?.interestPer ?? 5} saved earn 1 more at the start of the next round (at most ${r?.interestMax ?? 3}). You can also offer a card from your hand, or a unit from your board, for 1.</p>
      <p><b>The Muster:</b> you and your opponent build at the same time, in secret, until you both press Ready. Play units into your six lanes (as many as your Hero’s <b>Level</b>; level up for more), move them, play Charms and Talismans, set an <b>Ambush</b> face-down in a lane, use your Hero’s ability. You see their board as it was when the Muster began.</p>
      <p><b>Stars:</b> play a second copy of a Creature you have on the board and it merges: 2 stars, twice its printed Power and Health; a third copy makes 3. Fabled never merge.</p>
      <p><b>Aimed at the enemy:</b> damage and other effects aimed at their units are aimed at a <b>lane</b>, and happen when the Clash begins, to whoever stands there. With nobody there, they fizzle.</p>
      <p><b>The Clash</b> plays itself. In each bout every unit hits one enemy, all at once (Swift units first). Who it hits: <b>Guardians</b> first, then plain units, then <b>Elusive</b> ones, <b>Lures</b> last; <b>Sneaky</b> units go the other way round. Among equals, the one across from it, then the nearest. A unit whose damage reaches its Health goes down.</p>
      <p><b>Winning the Clash:</b> when one side has nobody standing, it loses a Candle for each enemy unit still standing (2 for a <b>Fierce</b> one), at most ${r?.clashCandleCap ?? 2}. If both sides still stand after ${r?.boutCap ?? 8} bouts, both lose Candles. Then every unit stands up again: <b>nothing on the board is lost in a Clash</b>.</p>
      <p><b>Candles:</b> a lost Candle goes into your hand. If it’s <b>Lucky</b>, you may play it for free in the next Muster.</p>
      <p><b>Your Hero:</b> its ability can be used once a round. When its Awaken condition is met it Awakens for good, and strikes when the Clash begins (unless you used its ability that round).</p>
      <p><b>Hand limit:</b> you can’t be Ready with more than ${HAND_LIMIT} cards: offer the extra ones.</p>
      <p><b>Reading a card:</b> press and hold any card to see it full size (or right-click it). The book button opens the story so far.</p>
      <p><b>Families:</b> each family has a signature mechanic.
        ${Object.entries(MECHANICS).filter(([, m]) => m.family).map(([name, m]) => `<b>${esc(familyName(m.family))} — ${esc(name)}:</b> ${esc(m.reminder)}`).join('\n        ')}</p>
      <p><a href="${BASE}rules.html" target="_blank" rel="noopener">Full rulebook</a></p>
      ${summary() ? `<p class="progress-note">On this device: ${summary()}.</p>` : ''}
      <button class="primary" data-click="ui:rules">Got it</button>
    </div>
  </div>`;
}

// No drag and drop: a card is played by tapping it, then the lane or the target, which light up.
let suppressClick = false;

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

// The deck builder's name boxes: the deck is renamed as you type (Enter just closes the keyboard).
app.addEventListener('input', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-rename], [data-newname], [data-deckcode]');
  if (input) deckInput(input);
  const field = ACCOUNTS ? (event.target as HTMLElement).closest<HTMLInputElement>('[data-acct]') : null;
  if (field) accountInput(field);
  const pf = ONLINE ? (event.target as HTMLElement).closest<HTMLInputElement>('[data-pf]:not([type="checkbox"])') : null;
  if (pf) friendsInput(pf);
  const code = (event.target as HTMLElement).closest<HTMLInputElement>('[data-storecode]');
  if (code) storeCodeInput(code.value);
});
// Play with a friend's Teaching game switch is a checkbox: it reports a change, not input.
app.addEventListener('change', (event) => {
  const pf = ONLINE ? (event.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"][data-pf]') : null;
  if (pf) friendsInput(pf);
});
app.addEventListener('keydown', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-rename], [data-newname]');
  if (input && event.key === 'Enter') input.blur();
  const field = ACCOUNTS ? (event.target as HTMLElement).closest<HTMLInputElement>('[data-acct]') : null;
  if (field && event.key === 'Enter' && field.tagName !== 'TEXTAREA') { event.preventDefault(); accountEnter(field, { render }); }
  const code = (event.target as HTMLElement).closest<HTMLInputElement>('[data-storecode]');
  if (code && event.key === 'Enter') { event.preventDefault(); storeCodeEnter(storeHost); }
});

app.addEventListener('click', (event) => {
  if (suppressClick) { suppressClick = false; return; }
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-click]');
  if (el && !(el as HTMLButtonElement).disabled) onClick(el.dataset.click!);
  // The deck picker's arrows (for a mouse; fingers swipe).
  const arrow = (event.target as HTMLElement).closest<HTMLElement>('[data-deck-scroll]');
  if (arrow) turnDeck(Number(arrow.dataset.deckScroll));
});


// The side panel's inspector shows the card you point at: hovered with a mouse, or tapped on a touch
// screen (a tap fires no reliable mouseover on iPad). The choice is remembered, so redrawing the screen
// after the tap (the card gets selected) keeps showing it instead of snapping back to your Hero.
function inspect(el: HTMLElement | null) {
  if (!el?.dataset.zoom) return;
  inspected = { url: el.dataset.zoom, key: el.dataset.zoomCard, state: el.dataset.zoomState };
  const zoom = document.getElementById('zoom') as HTMLImageElement | null;
  if (zoom && zoom.src !== inspected.url) zoom.src = inspected.url;
}
app.addEventListener('mouseover', (event) => inspect((event.target as HTMLElement).closest<HTMLElement>('[data-zoom]')));

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
  const used = glossary().filter((k) => k.test.test(text));
  const cost = cardKey && !/-(kitten|bigcat)$/.test(cardKey) ? CARDS[cardKey]?.cost : undefined;
  // Offerings are the game's only currency, and a playtester got through a whole game without noticing.
  const price = cost === undefined ? '' : (() => {
    const have = game ? game.players[mySeat].offerings : 0;
    const enough = have >= cost;
    return `<p class="zoom-cost ${enough ? '' : 'short'}">Costs <b>${cost}</b> ${cost === 1 ? 'Offering' : 'Offerings'}`
      + `${game ? ` · you have <b>${have}</b>${enough ? '' : ': not enough yet'}` : ''}</p>`;
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
  overlay.innerHTML = `<img src="${url}" alt="">${panel}<span class="zoom-hint">Tap anywhere to close</span>`;
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

/**
 * The magnifier button in the bottom row: the card you last pointed at (the one in the inspector; your Hero before
 * any) opens full size, and pressing it again closes it. For players who can't hold a card steady, or read the
 * small print: the enlarged card is the biggest the screen allows.
 */
function toggleZoom() {
  if (document.getElementById('zoom-overlay')) { closeZoom(); return; }
  if (!game) return;
  const card = inspected ?? { url: yourCardUrl(heroKey(game, mySeat)), key: heroKey(game, mySeat) };
  openZoom(card.url, card.key, card.state);
}

app.addEventListener('pointerdown', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
  touchLog(event, el);
  if (!el || event.button !== 0) return;
  inspect(el);
  pressAt = { x: event.clientX, y: event.clientY };
  window.clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    pressAt = null;

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
  window.addEventListener(type, (event) => {
    touchLog(event, (event.target as HTMLElement).closest?.<HTMLElement>('[data-zoom]') ?? null);
    window.clearTimeout(pressTimer);
    pressAt = null;
    if (zoomHeld) { zoomHeld = false; closeZoom(); }
    // The click (if any) fires right after pointerup; afterwards stop swallowing clicks.
    if (suppressClick) window.setTimeout(() => { suppressClick = false; }, 0);
  }, true);
}

/**
 * With ?debug in the address: a readout of what the cards hear from the finger, for checking taps and long presses
 * on a device we can't test here (an iPad said the opponent's cards didn't answer, 2026-09-28).
 */
const TOUCH_DEBUG = /[?&]debug(&|=|$)/.test(location.search);
const touchCounts: Record<string, number> = {};
function touchLog(e: PointerEvent, el: HTMLElement | null) {
  if (!TOUCH_DEBUG || screen !== 'game') return;
  touchCounts[e.type] = (touchCounts[e.type] ?? 0) + 1;
  let panel = document.getElementById('touch-debug');
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = 'touch-debug';
    panel.style.cssText = 'position:fixed;left:8px;top:60px;z-index:999;margin:0;padding:8px;max-width:60vw;font:11px/1.35 monospace;'
      + 'color:#0f0;background:rgba(0,0,0,.8);border-radius:6px;pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(panel);
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  panel.textContent = [
    `build ${document.querySelector<HTMLScriptElement>('script[src*="main-"]')?.src.split('/').pop() ?? '?'}`,
    `last ${e.type} (${e.pointerType}, button ${e.button}) at ${Math.round(e.clientX)},${Math.round(e.clientY)}`,
    Object.entries(touchCounts).map(([k, n]) => `${k.replace('pointer', '')} ${n}`).join(' · '),
    `card under it: ${el ? `${el.dataset.zoomCard ?? '?'} (${el.className.split(' ')[0]}, ${el.closest('.foe') ? 'theirs' : 'yours'})` : 'none'}`,
    `inspector shows: ${inspected?.key ?? 'your Hero'} · enlarged: ${document.getElementById('zoom-overlay') ? 'yes' : 'no'}`,
    `under finger: ${under ? `${under.tagName.toLowerCase()}.${[...under.classList].join('.')}` : 'nothing'}`,
  ].join('\n');
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
  if (event.key === 'Escape' && showSettings) { showSettings = false; settingsSection = null; if (ACCOUNTS) closeAccountPanel(); render(); return; }
  if (event.key === 'Escape' && ONLINE && screen === 'friends' && addOpen()) { closeAddSheet(); return; }
  if (screen === 'collection' && !showSettings && showcaseArrow(event.key, { render })) return;
  if (event.key === 'Escape') {
    if (document.getElementById('zoom-overlay')) { closeZoom(); return; }
    if (showStory && screen === 'game') { toggleStory(); return; }
    if (screen === 'collection' && showcaseEscape({ render })) return;
    if (STORE && screen === 'store' && storeEscape(storeHost)) return;
    if (selection) { selection = null; render(); }
  }
});

// Dev-only hook for automated UI testing and debugging in the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    fruitcats: {
      get game() { return game; }, chooseAction, legalActions, apply, render, CARDS, act, viewFor,
      get online() { return ol; },
    },
  });
}

if (ONLINE) onlineTicks(renderUnlessAnimating);
// A friend said yes while this game wasn't connected (closed, in the background, on another screen): from Home or Play
// a friend, go straight to the game. (Anywhere else, the Friend tile says "Back to the game".)
if (ONLINE) onGameFound(() => {
  if (screen !== 'home' && screen !== 'friends') return;
  // A game played directly opens from the other device (or this one), with no connection to the API needed.
  if (isPeerMatch(live.match) && !ol) { send({ t: 'rejoin', match: live.match! }); return; }
  if (screen !== 'friends') { openFriends(friendsHost); screen = 'friends'; }
  render();   // Play a friend connects, and the connection takes the game back up (welcome's match)
});
render();
// Signed in on this device: bring the decks and Showcase up to date with the account.
if (ACCOUNTS) { startSync({ render }); void askForTermsIfNeeded({ render }); void saveAgreedTerms(); }
// An invite link for playtesters (?invite=CODE): open the account window, and the code is used after their email.
if (ACCOUNTS && takeInviteFromLink()) openAccount({ render }, 'You’re invited! Type your email to create your account.');
// Whether the Store is open to this account, and what it bought: Home's Store tile and the deck builder use both.
// Refreshed again whenever the game comes back to the front or back online (at most once a minute), so cards the
// account no longer has (a refund; later, a trade) don't linger on this device. Set up signed out too: signing in
// later asks at once (account.ts), and coming back to the front keeps asking (2026-09-26, the tile stayed "Coming
// soon" on a phone that signed in after the game started).
if (STORE) {
  let last = 0, failures = 0, retry = 0;
  const refresh = () => {
    if (!signedIn() || Date.now() - last < 60_000) return;
    last = Date.now();
    window.clearTimeout(retry);
    void refreshStore().then((answered) => {
      if (screen === 'home' || screen === 'decks') render();
      // No answer (offline, or the API restarting): ask again by itself, soon at first, rather than leaving the tile
      // on "Coming soon" until the player happens to leave and come back.
      if (answered) { failures = 0; return; }
      retry = window.setTimeout(() => { last = 0; refresh(); }, [5_000, 15_000, 30_000, 60_000][Math.min(failures++, 3)]);
    });
  };
  refresh();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('online', refresh);
}
