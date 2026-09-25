// Showing what just happened. The engine resolves a whole action at once (an attack, the damage,
// the defeat, its Goodbye) and reports it as a list of GameEvents; this plays that list back as
// short animations over the board as it was before the action, so the player sees each thing happen
// and why, in order. Then the screen renders the result as usual.
//
// Playing a card shows it big in the middle, then parks it at the side while its effects fly from it.
// Every step has a one-line caption. Tapping anywhere skips to the end. Settings > Animations turns
// it all off (the game then jumps straight to the result, as it used to).

import { cardName, type GameEvent, type PlayerId, type Target, MECHANICS } from '@fruitcats/engine';
import { play as playSound } from './sound';
import { esc } from './ui';

const STORAGE_KEY = 'fruitcats-animations';
let enabled = (() => { try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; } })();

export const animationsEnabled = () => enabled;
export function setAnimations(on: boolean) {
  enabled = on;
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* private mode: not remembered */ }
}

export interface FxContext {
  human: PlayerId;
  /** The picture of a card being played (the opponent's hand is face-down, so it isn't on screen). */
  cardImage: (p: PlayerId, cardId: string) => string;
  /** 1 is normal; Settings > Speed: Fast plays everything quicker. */
  speed: number;
}

/** Events that show nothing by themselves: the tray and counters already tell these. */
const QUIET = new Set<GameEvent['t']>(['draw', 'win']);
export const hasBeats = (events: GameEvent[]) => events.some((e) => !QUIET.has(e.t));

let running = false;
let skipping = false;
let speed = 1;
let reduced = false;
const wakers = new Set<() => void>();
const anims: Animation[] = [];

/** True while events are playing (the tutorial video's recorder waits for it). */
export const isAnimating = () => running;

function wait(ms: number): Promise<void> {
  if (skipping) return Promise.resolve();
  return new Promise((done) => {
    const wake = () => { window.clearTimeout(timer); wakers.delete(wake); done(); };
    const timer = window.setTimeout(wake, ms * speed);
    wakers.add(wake);
  });
}

function animate(el: Element | null | undefined, frames: Keyframe[], ms: number, opts: KeyframeAnimationOptions = {}): Promise<void> {
  if (!el || skipping || !el.animate) return Promise.resolve();
  const a = el.animate(frames, { duration: ms * speed, easing: 'ease-out', fill: 'forwards', ...opts });
  anims.push(a);
  // A hidden tab doesn't run animations at all, so a timer backs up `finished`: the game never stalls.
  return Promise.race([a.finished.then(() => undefined, () => undefined), wait(ms + 60)]);
}

function skip() {
  if (skipping) return;
  skipping = true;
  for (const a of anims.splice(0)) a.cancel();
  for (const wake of [...wakers]) wake();
  floats().replaceChildren();
}

// ── The board as it is on screen ─────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const unitEl = (uid: number) => $(`.board [data-click="unit:${uid}"]`);
const heroEl = (p: PlayerId) => $(`.board [data-click="hero:${p}"]`);
const targetEl = (t: Target) => (t.kind === 'unit' ? unitEl(t.uid) : heroEl(t.player));
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

let ctx: FxContext;
let layer: HTMLElement;
let caption: HTMLElement;
/** Card ids and owners of the units involved (a defeated unit is gone from the state by now). */
const ids = new Map<number, string>();
const owners = new Map<number, PlayerId>();
/** The played card parked at the side, which its effects fly from. */
let parked: HTMLElement | null = null;

const who = (p: PlayerId) => (p === ctx.human ? 'You' : 'Opponent');
const whose = (p: PlayerId) => (p === ctx.human ? 'your' : 'their');
const Whose = (p: PlayerId) => (p === ctx.human ? 'Your' : 'Their');
const b = (text: string) => `<b>${esc(text)}</b>`;
const unitName = (uid: number) => cardName(ids.get(uid) ?? '') || 'a unit';
function targetName(t: Target): string {
  if (t.kind === 'hero') return `${whose(t.player)} ${b('Hero Cat')}`;
  const owner = owners.get(t.uid);
  return `${owner === undefined ? '' : `${whose(owner)} `}${b(unitName(t.uid))}`;
}
const attackerName = (t: Target) =>
  t.kind === 'hero' ? `${Whose(t.player)} ${b('Big Cat')}` : targetName(t).replace(/^(your|their)/, (w) => w[0].toUpperCase() + w.slice(1));

function say(html: string) {
  caption.innerHTML = html;
  caption.classList.remove('show');
  void caption.offsetWidth; // restart the fade-in
  caption.classList.add('show');
}

/** A word or number that floats up off a card and fades. */
function float(el: HTMLElement | null, text: string, kind: 'hurt' | 'heal' | 'buff' | 'info' | 'big') {
  if (!el || skipping) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = `fx-float ${kind}`;
  f.textContent = text;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top + r.height * 0.35}px`;
  f.style.animationDuration = `${1300 * speed}ms`;
  f.addEventListener('animationend', () => f.remove());
  window.setTimeout(() => f.remove(), 1300 * speed + 200); // in case the tab is hidden and it never runs
  floats().append(f);
}

/** Floating numbers outlive the playback, so the last ones finish over the new board. */
function floats(): HTMLElement {
  let el = $('#fx-floats');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-floats';
    document.body.append(el);
  }
  return el;
}

/** Change a Power or Health badge's number in place, with a pop. */
function bump(el: HTMLElement | null, badge: '.pow' | '.hp', delta: number, cls?: string) {
  const node = el?.querySelector<HTMLElement>(badge);
  if (!node) return;
  const now = Number.parseInt(node.textContent ?? '', 10);
  if (Number.isFinite(now)) node.textContent = String(Math.max(0, now + delta));
  if (cls) node.classList.add(cls);
  void animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.7)', offset: 0.35 }, { transform: 'scale(1)' }], 420, { fill: 'none' });
}

function shake(el: HTMLElement | null, strength = 7) {
  const s = reduced ? 2 : strength;
  return animate(el, [0, -s, s, -s * 0.7, s * 0.5, 0].map((x) => ({ translate: `${x}px 0` })), 360, { easing: 'linear', fill: 'none' });
}

function flash(el: HTMLElement | null, color: string) {
  if (!el || skipping) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'fx-flash';
  Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  f.style.setProperty('--fx', color);
  layer.append(f);
  void animate(f, [{ opacity: 0.9 }, { opacity: 0 }], 500).then(() => f.remove());
}

/** The attacker (or a Big Cat) jumps at its target, and back. Resolves at the moment of impact. */
async function lunge(from: HTMLElement | null, to: HTMLElement | null): Promise<void> {
  if (!from || !to) return;
  const a = center(from.getBoundingClientRect());
  const t = center(to.getBoundingClientRect());
  const dx = reduced ? 0 : (t.x - a.x) * 0.72;
  const dy = reduced ? 0 : (t.y - a.y) * 0.72;
  from.classList.add('fx-front');
  void animate(from, [
    { translate: '0 0', scale: '1' },
    { translate: `${-dx * 0.08}px ${-dy * 0.08}px`, scale: '1.08', offset: 0.3 },
    { translate: `${dx}px ${dy}px`, scale: '1.12', offset: 0.55, easing: 'ease-in' },
    { translate: '0 0', scale: '1' },
  ], 760, { easing: 'ease-in-out', fill: 'none' }).then(() => from.classList.remove('fx-front'));
  await wait(760 * 0.55);
}

/** A spark that flies from a card (or ability) to what it affects. */
async function bolt(from: HTMLElement | null, to: HTMLElement | null, kind: 'hurt' | 'heal' | 'buff') {
  if (!from || !to || skipping) return;
  const a = center(from.getBoundingClientRect());
  const t = center(to.getBoundingClientRect());
  const s = document.createElement('div');
  s.className = `fx-bolt ${kind}`;
  s.style.left = `${a.x}px`;
  s.style.top = `${a.y}px`;
  layer.append(s);
  await animate(s, [
    { translate: '-50% -50%', scale: '0.6', opacity: 0 },
    { opacity: 1, offset: 0.2 },
    { translate: `calc(-50% + ${t.x - a.x}px) calc(-50% + ${t.y - a.y}px)`, scale: '1.2', opacity: 1 },
  ], 340, { easing: 'ease-in' });
  s.remove();
}

// ── Played cards ─────────────────────────────────────────────────────────────────────────────────

async function unpark() {
  const card = parked;
  parked = null;
  if (!card) return;
  await animate(card, [{ opacity: 1 }, { opacity: 0 }], 240);
  card.remove();
}

/** How big a played card is while parked at the side, relative to its reveal. */
const PARKED = 0.42;

/** Show a card big in the middle of the board, then park it at the side for its effects. */
async function reveal(img: string, fromEl: HTMLElement | null, mine: boolean, tag = '') {
  await unpark();
  if (skipping) return;
  const board = $('.board')!.getBoundingClientRect();
  const card = document.createElement('div');
  card.className = `fx-reveal ${mine ? 'mine' : 'theirs'}`;
  card.innerHTML = `<img src="${img}" alt="">${tag ? `<span class="fx-tag">${esc(tag)}</span>` : ''}`;
  layer.append(card);
  const mid = { x: board.left + board.width / 2, y: board.top + board.height * 0.45 };
  card.style.left = `${mid.x}px`;
  card.style.top = `${mid.y}px`;
  const start = fromEl ? center(fromEl.getBoundingClientRect()) : { x: mid.x, y: mine ? board.bottom : board.top };
  if (fromEl) fromEl.style.visibility = 'hidden';
  await animate(card, [
    { translate: `calc(-50% + ${start.x - mid.x}px) calc(-50% + ${start.y - mid.y}px)`, scale: '0.25', opacity: 0.4 },
    { translate: '-50% -50%', scale: '1', opacity: 1 },
  ], 320, { easing: 'cubic-bezier(.2,.9,.3,1.15)' });
  // While it's big, the caption sits under the card and the board dims behind it.
  const r = card.getBoundingClientRect();
  const home = caption.style.top;
  caption.style.top = `${Math.min(r.bottom + 26, window.innerHeight - 30)}px`;
  layer.classList.add('dim');
  await wait(mine ? 650 : 1100);
  layer.classList.remove('dim');
  caption.style.top = home;
  // Park on the left edge, small, so the board is visible for what the card does.
  const dx = board.left + r.width * PARKED / 2 + 10 - mid.x;
  await animate(card, [
    { translate: '-50% -50%', scale: '1' },
    { translate: `calc(-50% + ${dx}px) -50%`, scale: String(PARKED) },
  ], 280, { easing: 'ease-in-out' });
  parked = card;
}

// ── One beat per event ───────────────────────────────────────────────────────────────────────────

async function beat(e: GameEvent) {
  switch (e.t) {
    case 'play': {
      ids.set(e.uid, e.cardId);
      owners.set(e.uid, e.p);
      const mine = e.p === ctx.human;
      const name = b(cardName(e.cardId));
      const on = e.target ? ` on ${targetName(e.target)}` : '';
      say(e.how === 'pounce' ? `${who(e.p)} ${mine ? 'POUNCE' : 'POUNCES'} with ${name}${on}!`
        : e.how === 'lucky' ? `Lucky! ${who(e.p)} ${mine ? 'play' : 'plays'} ${name} for free${on}.`
        : `${who(e.p)} ${mine ? 'play' : 'plays'} ${name}${on}.`);
      playSound('card');
      const hand = mine ? $(`.hand [data-click="hand:${e.uid}"]`) : $('.foe-hand .card-back:last-child');
      const img = (mine && hand?.dataset.zoom) || ctx.cardImage(e.p, e.cardId);
      if (e.target) targetEl(e.target)?.classList.add('fx-targeted');
      await reveal(img, hand, mine, e.how === 'pounce' ? 'Pounce!' : e.how === 'lucky' ? 'Lucky!' : '');
      return;
    }
    case 'ability': {
      const hero = heroEl(e.p);
      say(`${Whose(e.p)} ${b(cardName(e.heroId))} uses their ability${e.target ? ` on ${targetName(e.target)}` : ''}.`);
      playSound('ability');
      if (e.target) targetEl(e.target)?.classList.add('fx-targeted');
      hero?.classList.add('fx-glow');
      await reveal(hero?.dataset.zoom ?? ctx.cardImage(e.p, e.heroId), null, e.p === ctx.human, 'Ability');
      return;
    }
    case 'attack': {
      await unpark();
      say(`${attackerName(e.attacker)} attacks ${targetName(e.target)}!`);
      targetEl(e.attacker)?.classList.add('fx-attacker');
      targetEl(e.target)?.classList.add('fx-targeted');
      await wait(600);
      return;
    }
    case 'clash': {
      const a = targetEl(e.attacker);
      const t = unitEl(e.target);
      const hit = `${b(unitName(e.target))} takes ${e.dealt}`;
      say(e.attacker.kind === 'unit' ? `${hit}, ${b(unitName(e.attacker.uid))} takes ${e.taken}.` : `${hit}.`);
      await lunge(a, t);
      t?.classList.remove('fx-targeted');
      a?.classList.remove('fx-attacker');
      void shake(t, 9);
      flash(t, 'rgba(255, 60, 60, .55)');
      float(t, e.dealt ? `−${e.dealt}` : '0', 'hurt');
      bump(t, '.hp', -e.dealt, e.dealt ? 'hurt' : undefined);
      if (e.attacker.kind === 'unit') {
        void shake(a, 6);
        float(a, e.taken ? `−${e.taken}` : '0', 'hurt');
        bump(a, '.hp', -e.taken, e.taken ? 'hurt' : undefined);
        a?.classList.add('exhausted');
      }
      await wait(650);
      return;
    }
    case 'heroHit': {
      const a = targetEl(e.attacker);
      const hero = heroEl(e.p);
      say(`Hit! ${e.p === ctx.human ? 'You lose' : 'Opponent loses'} ${e.lives} ${e.lives > 1 ? 'Lives' : 'Life'}.`);
      await lunge(a, hero);
      hero?.classList.remove('fx-targeted');
      a?.classList.remove('fx-attacker');
      playSound(e.p === ctx.human ? 'hitBad' : 'hitGood');
      void shake(hero, 10);
      flash(hero, 'rgba(255, 40, 40, .6)');
      float(hero, e.lives > 1 ? `−${e.lives} Lives` : 'Hit!', 'big');
      if (e.attacker.kind === 'unit') a?.classList.add('exhausted');
      await wait(550);
      return;
    }
    case 'lifeLost': {
      const lives = $(`.player.${e.p === ctx.human ? 'me' : 'foe'} .lives`);
      const pip = lives ? [...lives.querySelectorAll<HTMLElement>('i.on')].pop() ?? null : null;
      const count = lives?.querySelector('b');
      if (count) count.textContent = String(e.left);
      float(pip, '−1', 'hurt');
      await animate(pip, [{ scale: '1' }, { scale: '2.2', opacity: 1, offset: 0.4 }, { scale: '0', opacity: 0 }], 460);
      pip?.classList.remove('on');
      if (pip) pip.getAnimations().forEach((a) => a.cancel());
      await wait(120);
      return;
    }
    case 'cancelled': {
      await unpark();
      const a = targetEl(e.attacker);
      say('The attack is cancelled!');
      playSound('fail');
      a?.classList.remove('fx-attacker');
      document.querySelectorAll('.fx-targeted').forEach((el) => el.classList.remove('fx-targeted'));
      float(a, 'Cancelled!', 'info');
      await wait(700);
      return;
    }
    case 'fizzled': {
      const el = parked ?? (e.attacker ? targetEl(e.attacker) : null);
      say(e.cardId ? `${b(cardName(e.cardId))} has no target left, and fizzles.` : 'Its target is gone, so the attack fizzles.');
      playSound('fail');
      float(el, 'Fizzles', 'info');
      await wait(700);
      return;
    }
    case 'damage': {
      const t = unitEl(e.uid);
      say(`${b(unitName(e.uid))} takes ${e.amount} damage.`);
      await bolt(parked ?? heroEl(e.p), t, 'hurt');
      void shake(t, 8);
      flash(t, 'rgba(255, 60, 60, .55)');
      float(t, e.amount ? `−${e.amount}` : '0', 'hurt');
      bump(t, '.hp', -e.amount, e.amount ? 'hurt' : undefined);
      await wait(450);
      return;
    }
    case 'heal': {
      const t = unitEl(e.uid);
      say(`${b(unitName(e.uid))} heals ${e.amount}.`);
      await bolt(parked ?? heroEl(owners.get(e.uid) ?? ctx.human), t, 'heal');
      flash(t, 'rgba(90, 220, 120, .55)');
      float(t, `+${e.amount}`, 'heal');
      bump(t, '.hp', e.amount);
      await wait(400);
      return;
    }
    case 'buff': {
      const t = unitEl(e.uid);
      const what = [e.power && `+${e.power} Power`, e.sneaky && 'Sneaky', e.guardian && 'Guardian'].filter(Boolean).join(' and ');
      say(`${b(unitName(e.uid))} gets ${esc(what)} this round.`);
      await bolt(parked ?? heroEl(owners.get(e.uid) ?? ctx.human), t, 'buff');
      flash(t, 'rgba(255, 210, 80, .55)');
      float(t, e.power ? `+${e.power} Power` : what, 'buff');
      if (e.power) bump(t, '.pow', e.power, 'buffed');
      await wait(400);
      return;
    }
    case 'exhaust':
    case 'ready': {
      const t = unitEl(e.uid);
      say(e.t === 'exhaust' ? `${b(unitName(e.uid))} is exhausted: it can't attack this round.` : `${b(unitName(e.uid))} is ready to act again.`);
      await bolt(parked, t, 'buff');
      t?.classList.toggle('exhausted', e.t === 'exhaust');
      float(t, e.t === 'exhaust' ? 'Exhausted' : 'Ready!', 'info');
      await wait(450);
      return;
    }
    case 'toy': {
      const t = unitEl(e.uid);
      say(`${b(cardName(e.cardId))} is attached to ${b(unitName(e.uid))}.`);
      await bolt(parked, t, 'buff');
      float(t, `🧸 ${cardName(e.cardId)}`, 'buff');
      await wait(400);
      return;
    }
    case 'defeated': {
      ids.set(e.uid, e.cardId);
      const t = unitEl(e.uid);
      say(`${Whose(e.owner)} ${b(cardName(e.cardId))} is defeated.`);
      float(t, 'Defeated', 'big');
      await animate(t, [
        { filter: 'none', scale: '1', rotate: '0deg', opacity: 1 },
        { filter: 'grayscale(1) brightness(.7)', scale: '1.05', rotate: '0deg', opacity: 1, offset: 0.35 },
        { filter: 'grayscale(1) brightness(.5)', scale: '0.5', rotate: e.owner === ctx.human ? '-14deg' : '14deg', opacity: 0 },
      ], 700, { easing: 'ease-in' });
      if (t) t.style.visibility = 'hidden';
      return;
    }
    case 'growUp': {
      const hero = heroEl(e.p);
      say(`${Whose(e.p)} Kitten Grows Up into a ${b('Big Cat')}!`);
      playSound('ability');
      float(hero, 'Grown up!', 'buff');
      await animate(hero, [
        { scale: '1', filter: 'brightness(1)' },
        { scale: '1.25', filter: 'brightness(1.8) drop-shadow(0 0 18px gold)', offset: 0.45 },
        { scale: '1', filter: 'brightness(1)' },
      ], 900, { fill: 'none' });
      const art = hero?.querySelector<HTMLElement>('.art');
      if (art) art.style.backgroundImage = art.style.backgroundImage.replace('-kitten', '-bigcat');
      await wait(250);
      return;
    }
    case 'counter': {
      // A mechanic's counter grew (Ripen's ripeness, Heat): the mechanic says what a point is worth.
      const t = unitEl(e.uid);
      const counter = Object.values(MECHANICS).find((m) => m.counter?.name === e.name)?.counter;
      const power = counter?.power ?? 0, health = counter?.health ?? 0;
      const line = counter?.log?.replace(/\{name\}/g, unitName(e.uid)).replace(/\{n\}/g, String(e.value));
      say(line ? line.replace(unitName(e.uid), b(unitName(e.uid))) : `${b(unitName(e.uid))}: ${e.name} +${e.value}.`);
      float(t, [power && `+${power}`, health && `+${health}`].filter(Boolean).join('/') || `+1 ${e.name}`, 'buff');
      if (power) bump(t, '.pow', power, 'buffed');
      if (health) bump(t, '.hp', health);
      await wait(450);
      return;
    }
    case 'round': {
      await unpark();
      say(`Round ${e.n}: everything is ready again.`);
      const banner = document.createElement('div');
      banner.className = 'fx-round';
      banner.innerHTML = `<small>Round</small>${e.n}`;
      layer.append(banner);
      await animate(banner, [
        { opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1', offset: 0.2 }, { opacity: 1, scale: '1', offset: 0.75 }, { opacity: 0, scale: '1.1' },
      ], 1100);
      banner.remove();
      return;
    }
    case 'draw':
    case 'win':
      return;
  }
}

/**
 * Play the events over the board on screen, one after another. Resolves when done (or skipped);
 * the caller then renders the new state, which replaces everything drawn here.
 */
export async function playEvents(events: GameEvent[], context: FxContext): Promise<void> {
  if (running || !hasBeats(events) || !$('.board')) return;
  ctx = context;
  running = true;
  skipping = false;
  speed = context.speed;
  reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  ids.clear();
  owners.clear();
  for (const el of document.querySelectorAll<HTMLElement>('.board [data-click^="unit:"]')) {
    const uid = Number(el.dataset.click!.split(':')[1]);
    ids.set(uid, el.dataset.zoomCard ?? '');
    owners.set(uid, el.closest('.yard.me') ? ctx.human : ((1 - ctx.human) as PlayerId));
  }
  // The board stops inviting clicks while it plays: no pulsing targets or glowing cards.
  for (const el of document.querySelectorAll('.board .targetable, .board .selected, .board .can-act, .board .playable'))
    el.classList.remove('targetable', 'selected', 'can-act', 'playable');
  document.querySelector('.board')?.classList.remove('targeting');

  layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.innerHTML = '<div class="fx-caption"></div><div class="fx-skip">Tap to skip</div>';
  caption = layer.querySelector('.fx-caption')!;
  const mid = $('.midbar')?.getBoundingClientRect();
  const board = $('.board')!.getBoundingClientRect();
  caption.style.left = `${board.left + board.width / 2}px`;
  caption.style.top = `${mid ? mid.top + mid.height / 2 : board.top + board.height / 2}px`;
  layer.addEventListener('pointerdown', (event) => { event.preventDefault(); skip(); });
  document.body.append(layer);
  document.body.classList.add('fx-playing');
  try {
    for (const e of events) {
      if (skipping) break;
      await beat(e);
    }
    await unpark();
    await wait(250);
  } finally {
    for (const a of anims.splice(0)) a.cancel();
    wakers.clear();
    layer.remove();
    document.body.classList.remove('fx-playing');
    parked = null;
    running = false;
    skipping = false;
  }
}
