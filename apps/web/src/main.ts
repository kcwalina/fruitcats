import './style.css';
import {
  CARDS, DECKS, apply, cardName, chooseAction, createGame, heroSide, isGuardian, isSneaky, keywords,
  legalActions, readyTreats, unitHealth, unitPower,
  type Action, type GameState, type PlayerId, type Target, type Unit,
} from '@fruitcats/engine';

// ── Assets ───────────────────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;
const artUrl = (key: string) => `${BASE}sb1/${key}.webp`;
const cardUrl = (key: string) => `${BASE}cards/sb1/${key}.webp`;
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

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ── App state ────────────────────────────────────────────────────────────────────────────────────

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Screen = 'menu' | 'game';
interface Selection {
  label: string;
  options: Action[];
}

const DIFFICULTY = { kitten: { label: 'Kitten', skill: 0.55 }, cat: { label: 'Cat', skill: 0.85 }, bigcat: { label: 'Big Cat', skill: 1 } };
type Difficulty = keyof typeof DIFFICULTY;

let screen: Screen = 'menu';
let myDeck = 'zest-rush';
let difficulty: Difficulty = 'cat';
let game: GameState | null = null;
let selection: Selection | null = null;
let picks = new Set<number>();
let aiTimer: number | undefined;
let showRules = false;
let flash = '';
/** Multiplier on the AI's "thinking" pause; the dev hook sets it to 0 for automated UI tests. */
let aiDelayScale = 1;

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
/** Opponent units already on screen, so the arrival animation plays once per unit, not per re-render. */
let renderedFoeUnits = new Set<number>();
/** Treat counts already on screen per player, so newly planted Treats get a short "pop". */
let renderedTreats: [number, number] = [0, 0];
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
    markHumanTurnDone();
    flash = '';
    notice = plantedNames.length
      ? `Planted ${plantedNames.join(' and ')} as ${plantedNames.length > 1 ? 'Treats' : 'a Treat'} — you now have ${me.pantry.length} (see Treats in your bar below).`
      : '';
  } catch (error) {
    flash = (error as Error).message;
  }
  selection = null;
  picks = new Set();
  render();
  scheduleAi();
}

function scheduleAi() {
  window.clearTimeout(aiTimer);
  if (!game || game.winner !== null || game.prompt?.player !== AI) return;
  const delay = aiDelayScale * (game.prompt.kind === 'pounce' || game.prompt.kind === 'plant' ? 450 : 850);
  aiTimer = window.setTimeout(() => {
    if (!game || game.prompt?.player !== AI) return;
    apply(game, chooseAction(game, { skill: DIFFICULTY[difficulty].skill }));
    render();
    scheduleAi();
  }, delay);
}

function startGame() {
  // The opponent leads one of the other decks, at random.
  const others = Object.keys(DECKS).filter((d) => d !== myDeck);
  const theirDeck = others[Math.floor(Math.random() * others.length)];
  game = createGame({ decks: [myDeck, theirDeck], names: ['You', 'Opponent'] });
  markHumanTurnDone();
  screen = 'game';
  selection = null;
  picks = new Set();
  render();
  scheduleAi();
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

  if (kind === 'menu') {
    if (raw === 'play') startGame();
    else if (raw in DIFFICULTY) { difficulty = raw as Difficulty; render(); }
    else if (raw in DECKS) { myDeck = raw; render(); }
    return;
  }
  if (kind === 'ui') {
    if (raw === 'rules') showRules = !showRules;
    if (raw === 'quit') { window.clearTimeout(aiTimer); game = null; screen = 'menu'; }
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
      case 'yarn': return act({ t: 'takeYarn' });
      case 'decline': return act({ t: 'decline' });
      case 'skip': return act({ t: 'skipPlant' });
      case 'keep': return act({ t: 'keepLucky' });
      case 'free': return act(legal.find((a) => a.t === 'lucky' && !a.target)!);
      case 'cancel': selection = null; render(); return;
      case 'confirm':
        if (prompt.kind === 'mulligan') return act({ t: 'mulligan', uids: [...picks] });
        if (prompt.kind === 'setupPlant') return act({ t: 'setupPlant', uids: [...picks] });
        if (prompt.kind === 'discard') return act({ t: 'discard', uids: [...picks] });
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
    if (prompt.kind === 'plant') return act({ t: 'plant', uid: value });
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

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

function render() {
  app.innerHTML = screen === 'menu' ? renderMenu() : renderGame();
  renderedFoeUnits = new Set(game?.players[AI].yard.map((u) => u.uid) ?? []);
  renderedTreats = game ? [game.players[0].pantry.length, game.players[1].pantry.length] : [0, 0];
  // Never let the page end up scrolled sideways (a focused or enlarged card could otherwise do it).
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

function renderMenu(): string {
  // Mochi, the mightiest Hero Cat, takes the centre spot.
  const heroes = ['SB1-P01-bigcat', 'SB1-H02-bigcat', 'SB1-H03-bigcat', 'SB1-H01-bigcat', 'SB1-P03-bigcat'];
  const deckBlurb: Record<string, string> = {
    'zest-rush': 'Fast and fierce. Swarm the yard, dodge Guardians, and finish before they recover.',
    'orchard-guard': 'Patient and sturdy. Wall up with Guardians, heal, punish attackers, win the long game.',
    'mango-tango': 'Laid-back, then enormous. Gather extra Treats, then drop giants. Led by Mochi, the mightiest Hero Cat.',
  };
  return `
  <div class="menu">
    <div class="hero-parade">
      ${heroes.map((k, i) => `<div class="parade-cat c${i}" style="background-image:url(${artUrl(k)})"></div>`).join('')}
    </div>
    <header class="title">
      <h1>Fruitcats</h1>
      <p>Every cat has nine lives. Make yours count.</p>
    </header>
    <section class="picker">
      <h2>Choose your Hero Cat</h2>
      <div class="deck-choices">
        ${Object.entries(DECKS).map(([key, deck]) => `
          <button class="deck-choice ${key === myDeck ? 'chosen' : ''}" data-click="menu:${key}">
            <img src="${cardUrl(`${deck.hero}-kitten`)}" alt="${esc(CARDS[deck.hero].name)}">
            <span class="deck-name">${esc(deck.name)}</span>
            <span class="deck-blurb">${deckBlurb[key] ?? ''}</span>
          </button>`).join('')}
      </div>
      <div class="start-row">
        <div class="difficulty">
          <span>Opponent:</span>
          ${Object.entries(DIFFICULTY).map(([key, d]) => `
            <button class="${key === difficulty ? 'chosen' : ''}" data-click="menu:${key}">${d.label}</button>`).join('')}
        </div>
        <button class="play-button" data-click="menu:play">Play</button>
      </div>
      <p class="coming">Coming soon: ${Object.values(CARDS).filter((c) => c.preview).map((c) => esc(c.name)).join(' · ')}</p>
    </section>
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
      <div class="inspector"><img id="zoom" src="${cardUrl(heroKey(s, HUMAN))}" alt=""></div>
      <div class="side-buttons">
        <button data-click="ui:rules">Rules</button>
        <button data-click="ui:quit">Menu</button>
      </div>
      <ul class="log">${s.log.slice(-80).reverse().map((e) => `<li class="${e.player === HUMAN ? 'me' : e.player === AI ? 'foe' : e.text.startsWith('—') ? 'sys' : ''}">${esc(humanize(e.text))}</li>`).join('')}</ul>
    </aside>
    ${s.winner !== null ? renderGameOver(s) : ''}
    ${showRules ? renderRules() : ''}
  </div>`;
}

/**
 * The Pantry: one small face-down card per Treat. Ready Treats stand upright, spent ones lie sideways.
 * You may look at your own Treats (rule 4), so yours show their art and preview on hover.
 */
function renderPantry(s: GameState, p: PlayerId, ready: number): string {
  const pl = s.players[p];
  const seen = renderedTreats[p];
  const tokens = pl.pantry.map((t, i) => {
    const mine = p === HUMAN;
    const cls = ['treat', t.exhausted && 'spent', i >= seen && 'new', mine && 'mine'].filter(Boolean).join(' ');
    const art = mine ? ` style="background-image:url(${artUrl(t.card.id)})" data-zoom="${cardUrl(t.card.id)}"` : '';
    return `<div class="${cls}"${art} title="${mine ? esc(CARDS[t.card.id].name) + ' — ' : ''}${t.exhausted ? 'spent this round' : 'ready to spend'}"></div>`;
  }).join('');
  return `<div class="pantry" title="Treats pay for cards. They all get ready again at the start of each round.">
    <div class="pantry-label">Treats <b>${ready}</b>/${pl.pantry.length} ready</div>
    <div class="treats">${tokens || '<span class="no-treats">none yet</span>'}</div>
  </div>`;
}

function renderPlayer(s: GameState, p: PlayerId, targets: Set<string>, legal: Action[] = []): string {
  const pl = s.players[p];
  const side = heroSide(s, p);
  const key = `hero:${p}`;
  const ready = readyTreats(s, p);
  const yarn = s.yarn === p ? `<span class="yarn" title="Holds the Yarn Ball: acts first">🧶${s.yarnTaken === p ? ' kept' : ''}</span>` : '';
  const took = s.yarnTaken === p && s.yarn !== p ? `<span class="yarn" title="Took the Yarn Ball for next round">🧶 next</span>` : '';
  const canAbility = legal.some((a) => a.t === 'ability');
  const canAttack = legal.some((a) => a.t === 'attack' && a.attacker.kind === 'hero');
  const lives = Array.from({ length: 9 }, (_, i) => `<i class="${i < pl.lives.length ? 'on' : ''}"></i>`).join('');

  return `
  <section class="player ${p === HUMAN ? 'me' : 'foe'} ${s.prompt?.player === p && s.winner === null ? 'thinking' : ''}">
    <div class="hero ${pl.hero.exhausted ? 'exhausted' : ''} ${targets.has(key) ? 'targetable' : ''} ${pl.hero.grown ? 'grown' : ''}"
         data-click="${key}" data-zoom="${cardUrl(heroKey(s, p))}">
      <div class="art" style="background-image:url(${artUrl(heroKey(s, p))})"></div>
      <div class="hero-name">${esc(side.name)}</div>
      ${side.power ? `<div class="pow">${side.power}</div>` : ''}
    </div>
    <div class="stats">
      <div class="who">${esc(pl.name)} ${yarn}${took} <span class="deck">${esc(pl.deckName)}</span></div>
      <div class="stat-row">
        <div class="lives" title="${pl.lives.length} Lives left">${lives}<b>${pl.lives.length}</b></div>
        <div class="counters">
          <span title="Cards in hand">✋ ${pl.hand.length}</span>
          <span title="Cards in deck">📚 ${pl.deck.length}</span>
          <span title="Compost (discard pile)">🍂 ${pl.compost.length}</span>
        </div>
      </div>
      <div class="ability" title="${esc(side.text)}">${esc(side.text).replace(/(Exhaust[^:]*:|Grow Up:)/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
    </div>
    ${renderPantry(s, p, ready)}
    ${p === HUMAN && (canAbility || canAttack) ? `<div class="hero-actions">
      ${canAbility ? '<button data-click="btn:ability">Use ability</button>' : ''}
      ${canAttack ? '<button data-click="btn:heroattack">Big Cat attack</button>' : ''}
    </div>` : ''}
    ${p === AI ? `<div class="foe-hand">${pl.hand.map(() => '<div class="card-back"></div>').join('')}</div>` : ''}
  </section>`;
}

function renderUnit(u: Unit, owner: PlayerId, targets: Set<string>, attackers: Set<number>): string {
  const k = keywords(u.id);
  const power = unitPower(u);
  const health = unitHealth(u) - u.damage;
  const chips = [
    isGuardian(u) && 'Guardian', isSneaky(u) && 'Sneaky', k.fierce && 'Fierce', k.tough && `Tough ${k.tough}`,
    u.toy && `🧸 ${cardName(u.toy.id)}`,
  ].filter(Boolean);
  const key = `unit:${u.uid}`;
  const selected = selection?.options.some((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === u.uid);
  const cls = [
    'unit', u.exhausted && 'exhausted', targets.has(key) && 'targetable', selected && 'selected',
    owner === AI && !foeUnitsBefore.has(u.uid) && 'fresh',
    owner === AI && !renderedFoeUnits.has(u.uid) && 'arriving',
    owner === HUMAN && attackers.has(u.uid) && !selection && 'can-act',
  ].filter(Boolean).join(' ');
  return `
  <div class="${cls}" data-click="${key}" data-zoom="${cardUrl(u.id)}">
    <div class="art" style="background-image:url(${artUrl(u.id)})"></div>
    <div class="uname">${esc(cardName(u.id))}</div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(String(c))}</span>`).join('')}</div>` : ''}
    <div class="pow ${u.buffPower > 0 || (u.toy && power > (CARDS[u.id].power ?? 0)) ? 'buffed' : ''}">${power}</div>
    <div class="hp ${u.damage ? 'hurt' : ''}">${health}</div>
    ${u.exhausted ? '<div class="zzz">zzz</div>' : ''}
  </div>`;
}

function renderYard(s: GameState, p: PlayerId, targets: Set<string>, attackers: Set<number>): string {
  const yard = s.players[p].yard;
  return `<section class="yard ${p === HUMAN ? 'me' : 'foe'}">
    ${yard.length ? yard.map((u) => renderUnit(u, p, targets, attackers)).join('') : `<div class="empty-yard">${p === HUMAN ? 'Your' : 'Their'} Yard is empty</div>`}
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
      const cls = [
        'hand-card', (playable.has(c.uid) || multi || planting) && 'playable', picks.has(c.uid) && 'picked',
        selectedUid?.uid === c.uid && 'selected', c.uid === luckyUid && 'lucky',
      ].filter(Boolean).join(' ');
      return `<button class="${cls}" data-click="hand:${c.uid}" data-zoom="${cardUrl(c.id)}"><img src="${cardUrl(c.id)}" alt="${esc(CARDS[c.id].name)}" loading="lazy"></button>`;
    }).join('')}
  </section>`;
}

function renderMidbar(s: GameState, legal: Action[]): string {
  const prompt = humanPrompt();
  let text = '';
  let buttons = '';

  if (s.winner !== null) text = 'Game over.';
  else if (!prompt) text = `<span class="dots">Opponent is thinking</span>`;
  else if (selection) {
    text = `Choose a target for <b>${esc(selection.label)}</b>.`;
    buttons = '<button data-click="btn:cancel">Cancel</button>';
  } else {
    switch (prompt.kind) {
      case 'mulligan':
        text = `Mulligan: pick any cards to shuffle away and redraw (${picks.size} selected).`;
        buttons = `<button class="primary" data-click="btn:confirm">${picks.size ? `Replace ${picks.size}` : 'Keep hand'}</button>`;
        break;
      case 'setupPlant':
        text = `Plant <b>${prompt.count}</b> cards face-down as Treats (your resources). Pick cards you need least.`;
        buttons = `<button class="primary" data-click="btn:confirm" ${picks.size === prompt.count ? '' : 'disabled'}>Plant ${picks.size}/${prompt.count}</button>`;
        break;
      case 'discard':
        text = `Too many cards: discard <b>${prompt.count}</b>.`;
        buttons = `<button class="primary" data-click="btn:confirm" ${picks.size === prompt.count ? '' : 'disabled'}>Discard ${picks.size}/${prompt.count}</button>`;
        break;
      case 'plant':
        text = `<b>New round!</b> Click a card in your hand to plant it as a Treat, or skip.`;
        buttons = '<button data-click="btn:skip">Skip</button>';
        break;
      case 'action': {
        const hints = [];
        if (legal.some((a) => a.t === 'play')) hints.push('click or drag a glowing card to play it');
        if (legal.some((a) => a.t === 'attack')) hints.push('click or drag a ready unit onto an enemy to attack');
        text = `<b>Your action.</b> ${hints.length ? `You can ${hints.join(', or ')}.` : 'Nothing left to do — pass.'}`;
        buttons = `${legal.some((a) => a.t === 'takeYarn') ? '<button data-click="btn:yarn" title="Act first next round; you may only pass for the rest of this one">Take the Yarn 🧶</button>' : ''}
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
    <div class="round">Round ${s.round}</div>
    <div class="prompt">${notice ? `<div class="notice">✓ ${esc(notice)}</div>` : ''}${recapLine}${text}${flash ? `<div class="flash">${esc(flash)}</div>` : ''}</div>
    <div class="buttons">${buttons}</div>
  </section>`;
}

function renderGameOver(s: GameState): string {
  const won = s.winner === HUMAN;
  const heroP = won ? HUMAN : AI;
  return `<div class="overlay">
    <div class="game-over ${won ? 'won' : 'lost'}">
      <img src="${artUrl(`${s.players[heroP].hero.id}-bigcat`)}" alt="">
      <h2>${s.winner === 'draw' ? 'A draw!' : won ? 'You win!' : 'You lose!'}</h2>
      <p>${won ? 'Nine lives well spent.' : 'Every cat lands on its feet eventually.'} (${s.round} rounds)</p>
      <div class="buttons">
        <button class="primary" data-click="ui:again">Play again</button>
        <button data-click="ui:quit">Menu</button>
      </div>
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
      <p><b>How to play a card:</b> click it (or drag it onto the board). If it needs a target, the valid targets pulse pink — click one, or drop the card straight onto it. To attack, click or drag one of your ready units (yellow glow) onto an enemy.</p>
      <p><b>Pounce:</b> when your opponent plays a card or attacks, you may play one Pounce card first.</p>
      <p><b>Lives:</b> a lost Life goes into your hand. If it’s <b>Lucky</b>, you may play it for free.</p>
      <p><b>Grow Up:</b> when its condition is met, your Kitten becomes a Big Cat — stronger ability, and it can attack.</p>
      <p><a href="https://github.com/kcwalina/fruitcats/blob/main/docs/rulebook.md" target="_blank" rel="noopener">Full rulebook</a></p>
      <button class="primary" data-click="ui:rules">Got it</button>
    </div>
  </div>`;
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

app.addEventListener('click', (event) => {
  if (suppressClick) { suppressClick = false; return; }
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-click]');
  if (el && !(el as HTMLButtonElement).disabled) onClick(el.dataset.click!);
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selection) { selection = null; render(); }
});

// Dev-only hook for automated UI testing and debugging in the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    fruitcats: {
      get game() { return game; }, chooseAction, legalActions, apply, render,
      set fast(on: boolean) { aiDelayScale = on ? 0 : 1; },
    },
  });
}

render();
