import './style.css';
import './skin.css';
import { clearSave, loadGame, saveGame } from './save';
import { playLogSounds, resetLogSounds, soundEnabled, toggleSound } from './sound';
import { count, summary } from './progress';
import { BASE, altKey, altOf, artUrl, backButton, cardUrl, esc, famClass, familyName, settingsButton } from './ui';
import { keepPictures } from './offline';
import { CLASS_ICON, CLASS_TEXT, LEGEND, abilityLines } from './glyphs';
import { applyBeat, beatCaption, boardMap, buildReplay, resultLine, signed, summarize, type Beat, type Replay, type Summary } from './replay';
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
  playerFace, renderOnlineResult, renderVersus, shownShop,
} from './online';
import {
  renderTutorial, startTutorial, stopTutorial, tutorialActive, tutorialAfterAction, tutorialCardZoomed, tutorialZoomClosed,
} from './tutorial';
import {
  CARDS, DECKS, DECK_RULES, LANES, MECHANICS, SETS, TERMS, abilitiesOf, evaluateCondition, unitKeywords, apply, cardName, chooseAction, createGame,
  deckSize, heroSide, interestOn, isOpenLane, laneUnit, traitsOf, legalActions, levelCost, mayAct, other, rollCost, sellValue, streakBonus, unitClass, isTaunt, isUnitCard, TRAITS, unitHealth,
  unitPower, viewFor, visibleEvents,
  type Action, type BoardUnit, type DeckList, type GameEvent, type GameState, type PlayerId, type PlayerView, type Target, type Unit,
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
  plays: 'play', buys: 'buy', sells: 'sell', rolls: 'roll', makes: 'make', passes: 'pass', keeps: 'keep', takes: 'take', loses: 'lose',
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
  /** Other things to do with what you picked (sell it, set it face-down), as buttons. */
  alts?: { label: string; options: Action[] }[];
  /** The card or unit picked, when it has no move to narrow (it can only be sold, or not bought at all). */
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
/**
 * The shop card you are reading: a tap shows it (in the side panel on a wide screen) and puts a Buy button in the
 * bar; only Buy starts placing it. The owner (2026-10-02): "I just want to read the card", not deploy it.
 */
let viewing: number | null = null;
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

/** The decision in front of you, if any: the Muster until you are Ready (and not while the last Clash is on screen). */
function humanPrompt() {
  return game && !replay && game.winner === null && mayAct(game, mySeat) ? game.prompt : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

/** A friendly confirmation of the player's own last move (what they just sold). */
let notice = '';
// ── The Clash, replayed on the board ─────────────────────────────────────────────────────────────
//
// When a Clash has been fought, the board shows it: the units as they stood, then beat by beat (an effect, a strike, the
// units that go down) with the attackers lunging, the numbers flying and the fallen greyed out. Then a summary of who
// did what, under the board, until you move on to the next round. Cards move; nothing else is animated.

interface ReplayRun {
  r: Replay;
  /** The section (0: before the fight, then the bouts) and the next beat in it. */
  section: number;
  beat: number;
  /** The board as the replay has it now. */
  units: Map<number, BoardUnit>;
  playing: boolean;
  done: boolean;
  /** What the last beat was, in words, and the ones before it. */
  lines: string[];
  summary?: Summary;
  timer?: number;
}

let replay: ReplayRun | null = null;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

/** Events the player may see, from `from` on: online, a view brings only the new ones; in Solo, from the whole game. */
function visibleFrom(from: number): GameEvent[] {
  return game ? (ol ? game.events : visibleEvents(game.events, mySeat).slice(from)) : [];
}
const eventMark = () => (game && !ol ? visibleEvents(game.events, mySeat).length : 0);

/** If these events hold a Clash, play it on the board. */
function noteClash(events: GameEvent[]) {
  const r = buildReplay(events);
  if (!r) return;
  stopReplay();
  replay = { r, section: 0, beat: 0, units: boardMap(r.sections[0].board), playing: true, done: false, lines: [`Round ${r.round}: the Clash begins.`] };
  replay.timer = window.setTimeout(replayTick, 900);
}

function stopReplay() {
  if (replay?.timer) window.clearTimeout(replay.timer);
  replay = null;
}

const heroName = (p: PlayerId) => (game ? cardName(game.players[p].hero.id) : '');

function replayTick() {
  const rp = replay;
  if (!rp || rp.done || !rp.playing) return;
  const wait = replayStep(rp);
  if (!rp.done && rp.playing) rp.timer = window.setTimeout(replayTick, wait);
}

/** One beat of the replay (or the start of the next bout, or the end): returns how long to show it. */
function replayStep(rp: ReplayRun): number {
  const section = rp.r.sections[rp.section];
  if (rp.beat < section.beats.length) {
    const beat = section.beats[rp.beat++];
    const caption = beatCaption(beat, rp.units, heroName);
    applyBeat(rp.units, beat);
    if (caption) rp.lines.push(caption);
    render();
    beatFx(beat);
    return beat.kind === 'strike' ? 1250 : beat.kind === 'down' ? 800 : 1050;
  }
  if (rp.section + 1 < rp.r.sections.length) {
    const next = rp.r.sections[++rp.section];
    rp.beat = 0;
    rp.units = boardMap(next.board);
    rp.lines.push(`Bout ${next.bout}.`);
    render();
    return 550;
  }
  finishReplay(rp);
  return 0;
}

function finishReplay(rp: ReplayRun) {
  if (rp.timer) window.clearTimeout(rp.timer);
  rp.done = true;
  rp.playing = false;
  rp.units = boardMap(rp.r.end);
  rp.summary = summarize(rp.r, mySeat);
  render();
}

function replayClick(what: string) {
  const rp = replay;
  if (!rp) return;
  if (rp.timer) window.clearTimeout(rp.timer);
  if (what === 'pause') { rp.playing = false; render(); return; }
  if (what === 'play') { rp.playing = true; render(); replayTick(); return; }
  if (what === 'step') { rp.playing = false; const wait = replayStep(rp); void wait; if (!rp.done) render(); return; }
  if (what === 'skip') { finishReplay(rp); return; }
  if (what === 'again') {
    Object.assign(rp, { section: 0, beat: 0, units: boardMap(rp.r.sections[0].board), playing: true, done: false, lines: [`Round ${rp.r.round}: the Clash begins.`] });
    delete rp.summary;
    render();
    rp.timer = window.setTimeout(replayTick, 700);
    return;
  }
  if (what === 'close') { stopReplay(); render(); }
}

// The effects of a beat, on the board just drawn: an attacker lunges at its target, numbers fly up from whoever they
// touched, the card an effect came from glows. Positions come from the screen, so they work at any size.
const unitEl = (uid: number) => app.querySelector<HTMLElement>(`.board [data-click="unit:${uid}"]`);

function beatFx(beat: Beat) {
  const still = REDUCED_MOTION.matches;
  if (beat.src?.uid !== undefined) glow(unitEl(beat.src.uid));
  beat.changes.forEach((c, i) => {
    const delay = beat.kind === 'strike' ? (i % 6) * 60 : i * 120;
    switch (c.t) {
      case 'hit': {
        const to = unitEl(c.to);
        if ('uid' in c.from) { if (!still) lunge(unitEl(c.from.uid), to, delay); }
        else glow(app.querySelector<HTMLElement>(`.player [data-click="heroinfo:${c.from.hero}"]`));
        floatText(to, c.dealt ? `−${c.dealt}` : '0', c.dealt ? 'dmg' : 'none', delay + 200);
        if (c.dealt && !still) shake(to, delay + 200);
        break;
      }
      case 'damage': floatText(unitEl(c.to), `−${c.amount}`, 'dmg', delay); if (!still) shake(unitEl(c.to), delay); break;
      case 'heal': floatText(unitEl(c.to), `+${c.amount}`, 'heal', delay); break;
      case 'buff': {
        const words = [c.power ? `${signed(c.power)} ⚔` : '', c.health ? `${signed(c.health)} ♥` : ''].filter(Boolean).join(' ');
        floatText(unitEl(c.to), words, (c.power ?? 0) + (c.health ?? 0) < 0 ? 'debuff' : 'buff', delay);
        break;
      }
      case 'exhaust': floatText(unitEl(c.to), 'zzz', 'none', delay); break;
      case 'summon': pop(unitEl(c.unit.uid)); break;
      case 'down': fade(unitEl(c.to)); break;
      case 'ambush': {
        const lanes = app.querySelectorAll<HTMLElement>(`.yard.${c.p === mySeat ? 'me' : 'foe'} .lane`);
        const lane = lanes[c.lane];
        glow(lane);
        floatText(lane, `Ambush! ${cardName(c.cardId)}`, 'buff', 0);
        break;
      }
      case 'awaken': glow(app.querySelector<HTMLElement>(`.player [data-click="heroinfo:${c.p}"]`)); break;
    }
  });
}

function animate(el: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions) {
  if (el && typeof (el as HTMLElement).animate === 'function') (el as HTMLElement).animate(frames, options);
}

function lunge(from: HTMLElement | null, to: HTMLElement | null, delay: number) {
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) * 0.38, dy = (b.top + b.height / 2 - (a.top + a.height / 2)) * 0.38;
  animate(from, [{ transform: 'none', zIndex: 5 }, { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, zIndex: 5, offset: 0.45 }, { transform: 'none', zIndex: 5 }],
    { duration: 520, delay, easing: 'ease-in-out' });
}

function shake(el: HTMLElement | null, delay: number) {
  animate(el, [{ transform: 'none' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }],
    { duration: 320, delay });
}

function glow(el: HTMLElement | null) {
  animate(el, [{ boxShadow: '0 0 0 0 rgba(255, 215, 106, 0)' }, { boxShadow: '0 0 0 4px #ffd76a, 0 0 22px 6px rgba(255, 215, 106, 0.9)', offset: 0.3 },
    { boxShadow: '0 0 0 0 rgba(255, 215, 106, 0)' }], { duration: 950 });
}

function pop(el: HTMLElement | null) {
  animate(el, [{ transform: 'scale(0.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'ease-out' });
}

function fade(el: HTMLElement | null) {
  animate(el, [{ filter: 'none', opacity: 1 }, { filter: 'grayscale(1) brightness(0.6)', opacity: 0.55 }], { duration: 450 });
}

/** A number or a word rising from a card: −3 in red for damage, +2 in green for a heal, a buff in gold. */
function floatText(el: HTMLElement | null, text: string, kind: 'dmg' | 'heal' | 'buff' | 'debuff' | 'none', delay: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = `fx-float ${kind}`;
  span.textContent = text;
  span.style.left = `${r.left + r.width / 2}px`;
  span.style.top = `${r.top + r.height * 0.35}px`;
  span.style.opacity = '0';
  document.body.appendChild(span);
  const rise = REDUCED_MOTION.matches ? 0 : -42;
  const done = () => span.remove();
  if (typeof span.animate === 'function') {
    span.animate([{ opacity: 0, transform: 'translate(-50%, 0) scale(0.8)' }, { opacity: 1, transform: 'translate(-50%, -10px) scale(1.15)', offset: 0.2 },
      { opacity: 1, transform: `translate(-50%, ${rise * 0.7}px)`, offset: 0.7 }, { opacity: 0, transform: `translate(-50%, ${rise}px)` }],
      { duration: 1100, delay, easing: 'ease-out' }).onfinish = done;
  } else window.setTimeout(done, 1200 + delay);
}

function act(action: Action) {
  if (!game) return;
  if (ol) { actOnline(action); return; }
  const me = game.players[mySeat];
  const from = eventMark();
  const sold = action.t === 'sell' ? me.yard.find((u) => u.uid === action.uid)?.id : undefined;
  try {
    apply(game, action, mySeat);
    tutorialAfterAction(action);
    flash = '';
    notice = sold ? `Sold ${cardName(sold)}: you have ${me.offerings} ${TERMS.offerings}.` : '';
  } catch (error) {
    flash = (error as Error).message;
  }
  selection = null;
  viewing = null;
  runAi();
  noteClash(visibleFrom(from));
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
  viewing = null;
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
  if (!same) { resetLogSounds(game); inspected = null; stopReplay(); }
  selection = null; notice = ''; flash = '';
  viewing = null;
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
    void from;
    noteClash(visibleFrom(0));
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
 * Muster began). It never needs to wait for you: nothing it does shows until the Clash.
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
  const from = eventMark();
  runAi();
  noteClash(visibleFrom(from));
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
  stopReplay();
  game = tutorial
    ? createGame({ decks: ['domowiki', 'pari'], names: ['You', 'Opponent'], firstPlayer: mySeat })
    : createGame({ decks: [mine, theirDeck], names: ['You', 'Opponent'], seed: devSeed });
  aiRandom = devSeed === undefined || tutorial ? undefined : mulberry(devSeed);
  tutorialGame = tutorial;
  // Both decks' pictures, kept by the offline worker, so a later game with them shows every card with no connection.
  keepPictures(game.players.flatMap((pl, p) => {
    const face = p === mySeat ? yourCardUrl : cardUrl;
    const ids = [...new Set([...pl.deck, ...pl.shop].map((c) => c.id))];
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
  runAi();
  screen = 'game';
  selection = null;
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
  // The classes (0.7): how a unit fights. A card says its class first ("Tank. Taunt.").
  ...(Object.keys(CLASS_TEXT) as (keyof typeof CLASS_TEXT)[])
    .map((c) => ({ name: `${CLASS_ICON[c]} ${c}`, test: new RegExp(`\\b${c}\\b`), text: CLASS_TEXT[c] })),
  { name: 'Taunt', test: /\bTaunt\b/, text: 'Every enemy hits it first while it stands, Assassins included.' },
  { name: 'Stun', test: /deals no damage in the first/, text: 'A stunned unit deals no damage in the bouts it says; after that it fights again.' },
  { name: 'Fierce', test: /\bFierce\b/, text: 'Worth 2 Candles instead of 1 if it is still standing when its side wins the Clash.' },
  { name: TERMS.keywords.Zoomies, test: /\b(Swift|Zoomies)\b/, text: 'Hits first in every bout: a unit it knocks down never hits back.' },
  { name: 'Tough', test: /\bTough\b/, text: 'Takes that much less damage from every hit.' },
  { name: 'Free roll', test: /\bfree rolls?\b/, text: 'Your next roll of the shop costs nothing: a new shop, dealt from your deck.' },
  { name: TERMS.keywords.Pounce, test: /\b(Ambush|Pounce)\b/, text: 'Set it face-down in one of your lanes: it happens when the Clash begins, if its lane holds what it needs (otherwise it waits). It can also be played like any card.' },
  { name: 'Hello', test: /\bHello\b/, text: 'Happens when you buy the card.' },
  { name: 'Clash start', test: /\bClash start\b/, text: 'Happens once, when the Clash begins, before the first bout. The enemy across is the one in the lane facing this unit; the units next to it are yours, one lane to either side.' },
  { name: 'Each bout', test: /\bEach bout\b/, text: 'Happens at the start of every bout of the Clash.' },
  { name: 'Every second bout', test: /\bEvery second bout\b/, text: 'Happens at the start of bouts 2, 4, 6 and 8.' },
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

/** A plain-language reason a card in the shop can't be bought right now. */
function whyUnplayable(s: GameState, id: string): string {
  const def = CARDS[id];
  const name = cardName(id);
  const me = s.players[mySeat];
  if (abilitiesOf(id).some((a) => a.pounceOnly)) return `${name} can only be set face-down, as an Ambush in one of your lanes.`;
  if ((def.cost ?? 0) > me.offerings) return `${name} costs ${def.cost} ${TERMS.offerings}, and you have ${me.offerings}. You get more at the start of each round, and you can sell a unit.`;
  if (def.type === 'Cat' && me.yard.some((u) => u.id === id)) return `${name} is already on your board, and Fabled cards are one of a kind.`;
  if (def.type === 'Cat' || def.type === 'Critter') return `You have as many units as your Hero’s Level (${me.hero.level}). Level up to field one more, or sell a unit (tap it) to make room.`;
  if (def.type === 'Toy') return `${name} needs one of your units without a Talisman to attach to.`;
  return `${name} has no target right now.`;
}

/** Pick a card or a unit: its moves, and other things to do with it (sell it, set it face-down) as buttons. */
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
  // A trait's chip: every tier of it (a phone has no hover for the chip's title).
  if (kind === 'trait' && game) {
    openTrait(game, Number(raw[0]) as PlayerId, raw.slice(2));
    return;
  }
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
    if (raw === 'quit') { stopTutorial(); game = null; stopReplay(); screen = 'home'; homeNote = ''; showStory = false; }
    if (raw === 'again') { startGame(); return; }
    render();
    return;
  }

  if (kind === 'replay') { replayClick(raw); return; }

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
      case 'roll': return act({ t: 'roll' });
      case 'cancel': selection = null; viewing = null; render(); return;
      case 'buy':
      case 'facedown': {
        const uid = viewing;
        viewing = null;
        if (uid === null) return;
        const card = game.players[mySeat].shop.find((c) => c.uid === uid);
        if (!card) { render(); return; }
        const plays = legal.filter((a) => a.t === 'play' && a.uid === uid);
        const ambush = legal.filter((a) => a.t === 'ambush' && a.uid === uid);
        const name = cardName(card.id);
        if (raw === 'facedown' && ambush.length) return select(`${name}, face-down`, ambush);
        if (plays.length) return select(name, plays, ambush.length ? [{ label: 'Set it face-down', options: ambush }] : []);
        if (ambush.length) return select(`${name}, face-down`, ambush);
        render();
        return;
      }
      case 'ability': return select('your Hero’s ability', legal.filter((a) => a.t === 'ability'));
      case 'alt': {
        const alt = selection?.alts?.[altOf(key)];
        if (alt) select(alt.label, alt.options);
        return;
      }
    }
    return;
  }

  // A tap on a shop card reads it: Buy (in the bar) places it.
  if (kind === 'hand') {
    flash = '';
    selection = null;
    viewing = value;
    render();
    return;
  }

  if (kind === 'unit') {
    const mine = game.players[mySeat].yard.find((u) => u.uid === value);
    if (!mine) return;
    const moves = legal.filter((a) => a.t === 'move' && a.uid === value);
    const sell = legal.filter((a) => a.t === 'sell' && a.uid === value);
    selection = {
      label: `${cardName(mine.id)}: a lane to move to`, options: moves, uid: value,
      alts: sell.length ? [{ label: `Sell it (+${sellValue(game, mine)})`, options: sell }] : [],
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
  stopReplay();
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
  const playable = new Set(legal.flatMap((a) => (a.t === 'play' || a.t === 'ambush' ? [a.uid] : [])));

  const wide = drawnWide = WIDE.matches;
  const foeBar = renderPlayer(v, theirSeat);
  const myBar = renderPlayer(v, mySeat, legal);
  return `
  <div class="game">
    <main class="board ${hl.size ? 'targeting' : ''} ${wide ? 'wide' : ''} ${replay ? 'replaying' : ''}">
      ${wide ? '' : foeBar}
      ${renderLanes(v, theirSeat, hl)}
      ${renderMidbar(v, legal)}
      ${renderLanes(v, mySeat, hl)}
      ${wide ? '' : myBar}
      ${replay ? renderReplayPanel() : renderShop(v, playable)}
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
    ${ol ? (replay ? '' : renderOnlineResult(s)) : s.winner !== null && !replay ? renderGameOver(s) : ''}
    ${ol ? renderVersus(s as PlayerView) : ''}
    ${showRules ? renderRules() : ''}
  </div>`;
}

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

function renderPlayer(s: GameState, p: PlayerId, legal: Action[] = []): string {
  const pl = s.players[p];
  const side = heroSide(s, p);
  const mine = p === mySeat;
  // The Lantern sits on the corner of the Hero portrait: its holder's effects go first in the Clash.
  const lantern = s.yarn === p ? `<span class="yarn" title="Holds the Lantern: their effects go first">${YARN_ICON}</span>` : '';
  const canAbility = mine && legal.some((a) => a.t === 'ability');
  const next = levelCost(s, p);
  const interest = interestOn(s, pl.offerings) + streakBonus(s, pl.streak ?? 0);
  const deciding = s.winner === null && s.prompt !== null && mayAct(s, p);
  // While the Clash plays, the Candles it costs are not lost yet.
  const lives = replay && !replay.done ? pl.lives + replay.r.lost[p] : pl.lives;
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
        <div class="lives" title="${lives} of ${9 - (pl.handicap ?? 0)} Candles left${pl.handicap ? ` (a handicap of ${pl.handicap})` : ''}"><span class="life-heart ${lives <= 3 ? 'low' : ''}"><b>${lives}</b></span></div>
        <div class="purse" title="${TERMS.offerings}: what you pay with. Saved ones earn interest: +1 for every ${s.rules.interestPer} at the start of each round (at most ${s.rules.interestMax}). Clashes lost in a row earn more.${pl.streak ? ` Lost in a row: ${pl.streak}.` : ''}">
          <b>${pl.offerings}</b> ${TERMS.offerings}${interest ? ` <small>+${interest}</small>` : ''}</div>
        <div class="level" title="Your Hero's Level: how many of your lanes are open, from the left.${next !== null ? ` The next Level costs ${next}.` : ''}">Level <b>${pl.hero.level}</b> <small>${pl.yard.length + (pl.fallen?.length ?? 0)}/${pl.hero.level}</small></div>
        <div class="counters">
          <span title="Cards in deck">📚 ${pl.deck.length}</span>
        </div>
        ${badges}
      </div>
      ${drawnWide ? '' : renderTraits(s, p)}
      <div class="ability" title="${esc(side.text)}" data-click="heroinfo:${p}"
           data-zoom="${(mine ? yourCardUrl : cardUrl)(heroKey(s, p))}" data-zoom-card="${heroKey(s, p)}">${esc(side.text).replace(/(Exhaust[^:]*:|Awaken:)/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
      ${canAbility ? '<div class="hero-actions"><button class="primary" data-click="btn:ability">Use ability</button></div>' : ''}
    </div>
    ${ol ? `<div class="player-face online">${playerFace(p)}</div>`
      : ACCOUNTS ? `<div class="player-face">${boardFace(mine ? 'you' : 'computer', CARDS[pl.hero.id].family)}</div>` : ''}
  </section>`;
}

/**
 * A player's traits, as small chips under their plaque: the trait's icon and how many different units count for it
 * against the next tier ("🛡 2/4"); lit when a tier is on. The tier's text is the chip's title.
 */
function renderTraits(s: GameState, p: PlayerId): string {
  const traits = traitsOf(s, p).sort((a, b) => b.tier - a.tier || b.count - a.count);
  if (!traits.length) return '';
  const chips = traits.map((t) => {
    const next = t.def.tiers.find((x) => x.at > t.count)?.at;
    const now = t.tier >= 0 ? t.def.tiers[t.tier].text : `At ${t.def.tiers[0].at}: ${t.def.tiers[0].text}`;
    const title = `${t.name}: ${t.count} unit${t.count === 1 ? '' : 's'}. ${now}${next && t.tier >= 0 ? ` At ${next}: ${t.def.tiers[t.tier + 1].text}` : ''}`;
    return `<span class="trait ${t.tier >= 0 ? 'on' : ''}" role="button" data-click="trait:${p}~${esc(t.name)}" title="${esc(title)}">${t.def.icon ?? ''} ${esc(t.name)} <b>${t.count}${next ? `/${next}` : ''}</b></span>`;
  }).join('');
  return `<div class="traits">${chips}</div>`;
}

/**
 * What buying a unit would do to its family's trait: "🏠 3/4" (3 different units after it, 4 for the next bonus). Nothing
 * for a copy of a unit already on the board (it merges: still one unit), or a family with no trait.
 */
function traitHint(s: GameState, id: string): string {
  const card = CARDS[id];
  if (!card || !isUnitCard(id) || s.players[mySeat].yard.some((u) => u.id === id)) return '';
  const entry = Object.entries(TRAITS).find(([, t]) => t.family === card.family);
  if (!entry) return '';
  const [name, def] = entry;
  const now = traitsOf(s, mySeat).find((t) => t.name === name)?.count ?? 0;
  const next = def.tiers.find((x) => x.at > now)?.at;
  return `${def.icon ?? ''} ${now + 1}${next ? `/${next}` : ''}`.trim();
}

/**
 * On a wide screen, a player's traits as a column beside their lanes (TFT's trait tracker): each family with how many
 * different units count and its breakpoints (2 · 4 · 6), the reached ones lit. Tap one to read its tiers.
 */
function renderTraitColumn(s: GameState, p: PlayerId): string {
  const traits = traitsOf(s, p).sort((a, b) => b.tier - a.tier || b.count - a.count);
  const rows = traits.map((t) => {
    const marks = t.def.tiers.map((x, i) => `<i class="${t.count >= x.at ? 'got' : ''} ${i === t.tier ? 'on' : ''}">${x.at}</i>`).join('');
    const now = t.tier >= 0 ? t.def.tiers[t.tier].text : `At ${t.def.tiers[0].at}: ${t.def.tiers[0].text}`;
    return `<div class="tcol-trait ${t.tier >= 0 ? 'on' : ''}" role="button" data-click="trait:${p}~${esc(t.name)}" title="${esc(`${t.name}: ${now}`)}">
      <span class="tcol-name">${t.def.icon ?? ''} ${esc(t.name)}</span><span class="tcol-marks"><b>${t.count}</b>${marks}</span></div>`;
  }).join('');
  return `<div class="trait-col" aria-label="${p === mySeat ? 'Your' : 'Their'} traits">${rows || `<small class="tcol-none">No family bonus yet</small>`}</div>`;
}

/** Copies on the way to a unit's next star, as pips: ●●○ (two of the three that make 2★). */
function copyPips(s: GameState, u: Unit): string {
  const copies = u.copies ?? 1;
  const next = s.rules.starCopies.find((n) => n > copies);
  if (!next) return '';
  const from = [1, ...s.rules.starCopies].filter((n) => n <= copies).pop()!;
  return `<span class="pips">${'●'.repeat(copies - from + 1)}${'○'.repeat(next - copies)}</span>`;
}

const starTitle = (s: GameState, u: Unit): string => {
  const copies = u.copies ?? 1;
  const next = s.rules.starCopies.find((n) => n > copies);
  return `${copies} ${copies === 1 ? 'copy' : 'copies'} merged${next ? `: ${next - copies} more for the next star` : ''}`;
};

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


/** A unit on the board; `shown` draws it as a replay of the Clash has it (its numbers then, and whether it fell). */
function renderUnit(s: GameState, u: Unit, owner: PlayerId, hl: Set<string>, shown?: BoardUnit): string {
  const k = unitKeywords(u, s);
  const power = shown ? shown.power : unitPower(u, s);
  const health = shown ? Math.max(0, shown.health - shown.damage) : unitHealth(u, s) - u.damage;
  const hurt = shown ? shown.damage > 0 : u.damage > 0;
  const exhausted = shown ? !!shown.exhausted : u.exhausted;
  // Its class as an icon in the corner; its keywords as chips; each ability as a short line under its name.
  const klass = unitClass(u);
  const chips = [
    isTaunt(u, s) && 'Taunt', k.zoomies && 'Swift', k.tough && `Tough ${k.tough}`, k.fierce && 'Fierce',
    ...counterChips(u, k.all),
    u.toy && `🧿 ${cardName(u.toy.id)}`,
  ].filter(Boolean);
  const lines = abilityLines(u.id);
  const key = `unit:${u.uid}`;
  const why = shown?.down ? 'It went down in this Clash.' : exhausted ? 'Exhausted: it deals no damage in this Clash.' : 'Ready to fight in the Clash.';
  const cls = [
    'unit', famClass(u.id), exhausted && 'exhausted', shown?.down && 'down', hl.has(key) && 'targetable', selection?.uid === u.uid && 'selected',
  ].filter(Boolean).join(' ');
  return `
  <div class="${cls}" data-click="${key}" data-zoom="${(owner === mySeat ? yourCardUrl : cardUrl)(u.id)}" data-zoom-card="${u.id}"
       data-zoom-state="${esc(why)}" title="${esc(cardName(u.id))}: ${esc(why)}">
    <div class="art" style="background-image:url(${artUrl(u.id)})"></div>
    <div class="uclass" title="${klass}: ${esc(CLASS_TEXT[klass])}">${CLASS_ICON[klass]}</div>
    ${u.stars || (u.copies ?? 1) > 1 ? `<div class="stars" title="${starTitle(s, u)}">${'★'.repeat(u.stars ?? 1)}${copyPips(s, u)}</div>` : ''}
    <div class="ubox">
      <div class="uname">${esc(cardName(u.id))}</div>
      ${lines.length ? `<div class="uline">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
      ${klass === 'Support' ? '' : `<div class="pow ${power > (CARDS[u.id].power ?? 0) ? 'buffed' : ''} ${power > 9 ? 'two-digit' : ''}">${power}</div>`}
      <div class="hp ${hurt ? 'hurt' : health > (CARDS[u.id].health ?? 0) ? 'buffed' : ''} ${health > 9 ? 'two-digit' : ''}">${health}</div>
    </div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(String(c))}</span>`).join('')}</div>` : ''}
    ${exhausted && !shown?.down ? '<div class="zzz">zzz</div>' : ''}
  </div>`;
}

/**
 * A player's six lanes, left to right: a unit fights the enemy across from it first. Empty lanes are outlines you
 * can play into; a face-down card marks an Ambush, and a little target an effect of yours aimed at their lane.
 */
function renderLanes(s: GameState, p: PlayerId, hl: Set<string>): string {
  if (replay) return renderReplayLanes(s, p);
  const pl = s.players[p];
  const mine = p === mySeat;
  // A teaching game's open shop (the opponent showing it) sits at the start of their lanes.
  const shown = !mine ? shownShop(s) : null;
  const foeHand = shown ? `<div class="foe-hand-slot">${shown}</div>` : '';
  const aimed = (lane: number) => (s.players[mySeat].pending ?? [])
    .filter((x) => x.target?.kind === 'lane' && x.target.player === p && x.target.lane === lane).map((x) => cardName(x.sourceId));
  const lanes = Array.from({ length: LANES }, (_, i) => {
    const u = laneUnit(s, p, i);
    const ambush = (pl.ambushes ?? []).find((a) => a.lane === i);
    const marks = [
      ambush ? `<span class="ambush-mark" title="${mine ? `Your Ambush: ${esc(cardName(ambush.card.id))}` : 'A face-down Ambush'}">${mine ? '' : '?'}</span>` : '',
      ...aimed(i).map((n) => `<span class="aim-mark" title="${esc(n)} is aimed here: it happens when the Clash begins">🎯</span>`),
    ].join('');
    const locked = !isOpenLane(s, p, i);
    if (u) return `<div class="lane ${locked ? 'locked' : ''}">${renderUnit(s, u, p, hl)}${marks}</div>`;
    const key = `lane:${p}:${i}`;
    // A locked lane opens at Level i + 1. Their locked lanes can still be aimed at (their Level may have grown since).
    if (locked && !hl.has(key)) {
      return `<div class="lane empty locked" title="${mine ? 'Your' : 'Their'} lane ${i + 1}: locked until Level ${i + 1}"><span class="lane-lock">🔒<small>Lv ${i + 1}</small></span>${marks}</div>`;
    }
    return `<div class="lane empty ${locked ? 'locked' : ''} ${hl.has(key) ? 'targetable' : ''}" data-click="${key}" title="${mine ? 'Your' : 'Their'} lane ${i + 1}"><span class="lane-no">${i + 1}</span>${marks}</div>`;
  }).join('');
  return `<section class="yard lanes ${mine ? 'me' : 'foe'} ${drawnWide ? 'with-traits' : ''}" style="--n:${LANES}">${foeHand}${drawnWide ? renderTraitColumn(s, p) : ''}${lanes}</section>`;
}

/**
 * What a shop card is, readable at a glance on a phone without enlarging it: a unit shows its Power and Health on a
 * dark strip, a Charm or a Talisman says so on a light one. Brightness and shape tell them apart, not hue, which the
 * families' frame colours already use.
 */
function shopTag(id: string, hint = ''): string {
  const def = CARDS[id];
  if (def.type === 'Critter' || def.type === 'Cat') {
    const klass = unitClass(id);
    return `${hint ? `<span class="shop-trait" title="Buying it brings this trait to ${esc(hint)}">${esc(hint)}</span>` : ''}`
      + `<span class="shop-tag unit-tag" aria-hidden="true"><span class="tag-class">${CLASS_ICON[klass]}</span><b class="tag-pw">${def.power ?? 0}</b>⚔<b class="tag-hp">${def.health ?? 0}</b>♥</span>`;
  }
  const word = TERMS.types[def.type as keyof typeof TERMS.types] ?? def.type;
  const kind = def.type === 'Toy' ? 'talisman-tag' : 'charm-tag';
  return `<span class="shop-tag ${kind}" aria-hidden="true">${def.type === 'Toy' ? '◆' : '✦'} ${esc(word)}</span>`;
}

/**
 * Your shop: the cards dealt from your deck this round, side by side (never overlapping: there are at most six).
 * Tap one to buy it; what you don't buy goes back into your deck at the next Start or roll.
 */
function renderShop(s: GameState, playable: Set<number>): string {
  const me = s.players[mySeat];
  const n = me.shop.length;
  const cards = me.shop.map((c) => {
    const cls = [
      'hand-card', playable.has(c.uid) && 'playable',
      selection?.options.some((a) => 'uid' in a && a.uid === c.uid && a.t !== 'move') && 'selected',
      selection?.uid === c.uid && 'selected', viewing === c.uid && 'selected',
    ].filter(Boolean).join(' ');
    // Drawn at once, not decoded later: every redraw makes the images anew, and late ones flash the card backs.
    return `<button class="${cls}" data-click="hand:${c.uid}" data-zoom="${yourCardUrl(c.id)}" data-zoom-card="${c.id}"><img src="${yourCardUrl(c.id)}" alt="${esc(CARDS[c.id].name)}" decoding="sync">${shopTag(c.id, traitHint(s, c.id))}</button>`;
  }).join('');
  return `<section class="hand shop" style="--n:${Math.max(n, 1)};--gaps:${Math.max(1, n - 1)}" aria-label="Your shop">
    ${cards || '<p class="shop-empty">Nothing left in your shop. Roll for a new one, or press Ready.</p>'}
  </section>`;
}

const PARAM_WORDS: Record<Param, string> = { slot: 'a lane', lane: 'a lane to set it in', target: 'a target', target2: 'a second target' };

function renderMidbar(s: GameState, legal: Action[]): string {
  if (replay) return renderReplayBar(s);
  const prompt = humanPrompt();
  const me = s.players[mySeat];
  let text = '';
  let buttons = '';

  const onl = ol ? onlineBar(s, !!prompt) : null;
  if (s.winner !== null) text = 'Game over.';
  else if (!prompt) text = onl?.text ?? '<span class="dots">Your opponent is deciding</span>';
  else if (viewing !== null && !selection && me.shop.some((c) => c.uid === viewing)) {
    // Reading a shop card: its price, and Buy if it can be bought now (or why not).
    const id = me.shop.find((c) => c.uid === viewing)!.id;
    const cost = CARDS[id].cost ?? 0;
    const canBuy = legal.some((a) => a.t === 'play' && a.uid === viewing);
    const canSet = legal.some((a) => a.t === 'ambush' && a.uid === viewing);
    const why = canBuy || canSet ? '' : whyUnplayable(s, id);
    text = `<b>${esc(cardName(id))}</b> · ${cost} ${cost === 1 ? TERMS.offering : TERMS.offerings}${why ? `<div class="hint-line">${esc(why)}</div>` : ''}`;
    buttons = `${canBuy ? `<button class="primary" data-click="btn:buy">Buy <small>(${cost})</small></button>` : ''}
      ${canSet ? `<button data-click="btn:facedown">Set it face-down</button>` : ''}
      <button data-click="btn:cancel">Close</button>`;
  } else if (selection) {
    const p = paramOf(selection.options);
    const lane = selection.options.some((a) => 'target' in a && a.target?.kind === 'lane');
    text = p
      ? `Choose ${PARAM_WORDS[p]} for <b>${esc(selection.label)}</b>.${lane && p === 'target' ? ' An effect aimed at their lane happens when the Clash begins, to whoever stands there.' : ''}`
      : `<b>${esc(selection.label)}</b>`;
    buttons = (selection.alts ?? []).map((alt, i) => `<button data-click="${altKey(i)}">${esc(alt.label)}</button>`).join('')
      + '<button data-click="btn:cancel">Cancel</button>';
  } else {
    const level = legal.find((a) => a.t === 'levelUp');
    const roll = legal.find((a) => a.t === 'roll');
    const interest = interestOn(s, me.offerings);
    const cost = rollCost(s, mySeat);
    text = `<b>Muster.</b> Buy from your shop, then press <b>Ready</b>. <b>${me.offerings}</b> ${TERMS.offerings}`
      + `${interest ? ` <span class="turn-hint">(+${interest} if saved)</span>` : ''}.`;
    buttons = `${roll ? `<button data-click="btn:roll" title="A new shop from your deck">Roll <small>(${cost ? cost : 'free'})</small></button>` : ''}
      ${level ? `<button data-click="btn:level" title="One more lane">Level up <small>(${levelCost(s, mySeat)})</small></button>` : ''}
      <button class="primary" data-click="btn:ready">Ready</button>`;
  }
  if (prompt && onl?.text) text = `${onl.text} ${text}`;
  if (onl?.buttons) buttons = `${onl.buttons}${buttons}`;
  return `<section class="midbar">
    <div class="round"><small>Round</small><b>${s.round}</b></div>
    <div class="prompt">${notice ? `<div class="notice">✓ ${esc(notice)}</div>` : ''}${text}${hintLine && prompt ? `<div class="hint-line">💡 ${esc(hintLine)}</div>` : ''}${flash ? `<div class="flash">${esc(flash)}</div>` : ''}</div>
    <div class="buttons">${buttons}</div>
  </section>`;
}

/** The bar between the two rows while the Clash plays: where it is, what just happened, and the controls. */
function renderReplayBar(s: GameState): string {
  const rp = replay!;
  const section = rp.r.sections[rp.section];
  const where = section.bout ? `Bout ${section.bout}` : 'Before the fight';
  const text = rp.done
    ? `<b>${esc(resultLine(rp.r, mySeat))}</b>`
    : `<b>The Clash</b> · ${where}<div class="replay-now">${esc(rp.lines.at(-1) ?? '')}</div>`;
  const buttons = rp.done
    ? `<button data-click="replay:again">Watch again</button>
       <button class="primary" data-click="replay:close">${s.winner !== null ? 'See the result' : 'Next round'}</button>`
    : `${rp.playing ? '<button data-click="replay:pause">Pause</button>'
        : '<button data-click="replay:play">Play</button><button data-click="replay:step">Step</button>'}
       <button data-click="replay:skip">Skip to the end</button>`;
  return `<section class="midbar replay-bar">
    <div class="round"><small>Round</small><b>${rp.r.round}</b></div>
    <div class="prompt">${text}</div>
    <div class="buttons">${buttons}</div>
  </section>`;
}

/**
 * Under the board while the Clash plays: what happens, line by line. When it is over, who did what (damage dealt and
 * taken, who fell in which bout) and what decided it, in a sentence or two you can act on.
 */
function renderReplayPanel(): string {
  const rp = replay!;
  if (!rp.done || !rp.summary) {
    const lines = rp.lines.slice(-4);
    return `<section class="hand shop replay-panel" aria-live="polite"><ul class="replay-lines">${lines
      .map((l, i) => `<li class="${i === lines.length - 1 ? 'now' : ''}">${esc(l)}</li>`).join('')}</ul></section>`;
  }
  const sum = rp.summary;
  const side = (p: PlayerId) => {
    const units = sum.units.filter((u) => u.p === p).sort((a, b) => b.dealt - a.dealt || b.taken - a.taken);
    const fate = (fell: number | null) => (fell === null ? 'stood' : fell === 0 ? 'fell before bout 1' : `fell in bout ${fell}`);
    const rows = units.map((u) => `<tr class="${u.fell !== null ? 'fell' : 'stood'}"><td>${esc(cardName(u.id))}</td><td>${u.dealt}</td><td>${u.taken}</td><td>${fate(u.fell)}</td></tr>`).join('');
    const hero = sum.heroes[p] ? `<tr><td>${esc(heroName(p))} <small>(Hero)</small></td><td>${sum.heroes[p]}</td><td></td><td></td></tr>` : '';
    return `<div class="sum-side ${p === mySeat ? 'me' : 'foe'}"><h4>${p === mySeat ? 'Your units' : 'Their units'}</h4>
      <table><thead><tr><th></th><th title="Damage dealt">⚔ dealt</th><th title="Damage taken">♥ taken</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No units</td></tr>'}${hero}</tbody></table></div>`;
  };
  return `<section class="hand shop replay-panel clash-report" aria-label="The Clash, in numbers">
    <div class="sum-sides">${side(mySeat)}${side(theirSeat)}</div>
    ${sum.hints.length ? `<ul class="sum-hints">${sum.hints.map((h) => `<li>💡 ${esc(h)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

/** The six lanes as the replay has them: the units as they stood at that moment of the Clash, the fallen greyed. */
function renderReplayLanes(s: GameState, p: PlayerId): string {
  const units = [...replay!.units.values()].filter((u) => u.p === p);
  const lanes = Array.from({ length: LANES }, (_, i) => {
    const b = units.find((u) => u.slot === i && !u.down) ?? units.find((u) => u.slot === i);
    const locked = !isOpenLane(s, p, i);
    if (b) return `<div class="lane ${locked ? 'locked' : ''}">${renderUnit(s, replayUnit(s, b), p, new Set(), b)}</div>`;
    return locked
      ? `<div class="lane empty locked"><span class="lane-lock">🔒<small>Lv ${i + 1}</small></span></div>`
      : `<div class="lane empty"><span class="lane-no">${i + 1}</span></div>`;
  }).join('');
  return `<section class="yard lanes ${p === mySeat ? 'me' : 'foe'} ${drawnWide ? 'with-traits' : ''}" style="--n:${LANES}">${drawnWide ? renderTraitColumn(s, p) : ''}${lanes}</section>`;
}

/** A unit of the replay as the board draws it: the game's own unit while it has it (its Talisman, its counters). */
function replayUnit(s: GameState, b: BoardUnit): Unit {
  return s.players[b.p].yard.find((u) => u.uid === b.uid)
    ?? { uid: b.uid, id: b.id, slot: b.slot, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, ...(b.stars ? { stars: b.stars } : {}), ...(b.copies ? { copies: b.copies } : {}) };
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
      <p class="setting-note">The Clash plays on the board, one beat at a time: pause it, step through it, or skip to the summary.</p>
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
      <p><b>Each round:</b> the <b>Muster</b>, then the <b>Clash</b>. At the start of each round you get a new <b>shop</b>: ${r?.shopSize ?? 6} cards dealt from your own deck. From round 2 you also get your income in ${TERMS.offerings}.</p>
      <p><b>The shop:</b> buy what you want at its price. What you don’t buy goes back into your deck. <b>Roll</b> (${r?.rollCost ?? 1} ${TERMS.offering}) for a new shop. A card’s price is its <b>tier</b>, 1 to 5: the higher your Hero’s Level, the more often the shop deals the high tiers.</p>
      <p><b>${TERMS.offerings} are money.</b> What you don’t spend is kept, and every ${r?.interestPer ?? 5} saved earn 1 more at the start of the next round (at most ${r?.interestMax ?? 3}). Losing Clashes in a row earns more too: +1 after two, up to +3 after five.</p>
      <p><b>The Muster:</b> you and your opponent build at the same time, in secret, until you both press Ready. Buy units into your open lanes (your Hero’s <b>Level</b> opens that many, from the left; level up to open more), move them, buy Charms and Talismans, set an <b>Ambush</b> face-down in a lane, use your Hero’s ability. You see their board as it was when the Muster began.</p>
      <p><b>Selling:</b> tap a unit of yours to sell it. You get back what you paid, its merged copies included, less 1 for each star it has. Sell to make room for something better.</p>
      <p><b>Stars:</b> buy a copy of a Creature you have on the board and it merges into it, even when your lanes are full (the dots on the unit count them). <b>3 copies make 2 stars</b>, twice its printed Power and Health; <b>5 make 3 stars</b>. Fabled never merge.</p>
      <p><b>Classes</b> say how a unit fights (its icon is in the card’s corner): 🛡 <b>Tank</b> and 👊 <b>Bruiser</b> fight at the front; 🏹 <b>Marksman</b>, ✨ <b>Mage</b> and 💠 <b>Support</b> at the back (a Support never attacks: it helps the units next to it); 🗡 <b>Assassin</b> strikes first and goes for the back. A unit with <b>Taunt</b> is hit first by everyone.</p>
      <p><b>Families</b> are synergies: 2, 4 or 6 different units of one family on your board turn on its bonus. The trait column beside your lanes shows them; tap one to read it.</p>
      <p><b>In the fight:</b> ${esc(LEGEND)}</p>
      <p><b>Aimed at the enemy:</b> damage and other effects aimed at their units are aimed at a <b>lane</b>, and happen when the Clash begins, to whoever stands there. With nobody there, they fizzle. A face-down Ambush happens only if its lane holds what it needs; otherwise it waits for a later Clash.</p>
      <p><b>The Clash</b> plays itself: first the aimed effects and Ambushes, then Awakened Heroes strike, then the bouts. In each bout every unit hits one enemy, all at once (Assassins and Swift units first). Who it hits: a unit with <b>Taunt</b> first, then <b>Tanks</b>, then Bruisers and Assassins, then the back; an <b>Assassin</b> goes for the back first, unless a unit taunts. Among equals, the one across from it, then the nearest. A unit whose damage reaches its Health goes down. An <b>exhausted</b> unit deals no damage in this Clash, but can still be hit.</p>
      <p><b>Winning the Clash:</b> when one side has nobody standing, it loses a Candle for each enemy unit still standing (2 for a <b>Fierce</b> one, 1 more if their Hero struck), at most ${r?.clashCandleCap ?? 2}. If both sides still stand after ${r?.boutCap ?? 8} bouts, both lose Candles. Then every unit stands up again: <b>nothing on the board is lost in a Clash</b>.</p>
      <p><b>Your Hero:</b> its ability can be used once a round. When its Awaken condition is met it Awakens for good, and strikes when the Clash begins (unless you used its ability that round).</p>
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

/** A trait, tapped: how many units count for it, and what each of its tiers does, the one that's on lit. */
function openTrait(s: GameState, p: PlayerId, name: string) {
  const t = traitsOf(s, p).find((x) => x.name === name);
  if (!t) return;
  closeZoom();
  const rows = t.def.tiers.map((x, i) =>
    `<div class="${i === t.tier ? 'on' : ''}"><dt>${x.at} units${i === t.tier ? ' · on' : ''}</dt><dd>${esc(x.text)}</dd></div>`).join('');
  const whose = p === mySeat ? 'You have' : 'They have';
  const overlay = document.createElement('div');
  overlay.id = 'zoom-overlay';
  overlay.innerHTML = `<div class="zoom-info trait-info"><p class="zoom-state">${t.def.icon ?? ''} <b>${esc(t.name)}</b>: ${whose} ${t.count}`
    + ` (different units count; copies merged into one count once).</p><dl class="zoom-keys trait-tiers">${rows}</dl></div>`
    + '<span class="zoom-hint">Tap anywhere to close</span>';
  overlay.addEventListener('click', closeZoom);
  document.body.appendChild(overlay);
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
    if (selection || viewing !== null) { selection = null; viewing = null; render(); }
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
