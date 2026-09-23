// The click-through tutorial: speech balloons that point at the board and explain the game while
// you play a real (gentle) game against the AI.
//
// Two kinds of balloon:
//   • Steps — a fixed walkthrough in order. A step either has a Next button ("read this") or waits
//     for you to do something ("plant two Treats") and moves on when you have.
//   • Tips — shown once, the first time something new happens (a lost Life, a Pounce chance, ...).
// While a "read this" balloon is open the AI waits, so nothing happens behind your back.

import { cardName, isGuardian, legalActions, type Action, type GameState, type PlayerId } from '@fruitcats/engine';
import { count, note } from './progress';

const YARN_ICON = `<img class="yarn-ico" src="${import.meta.env.BASE_URL}ui/yarn.webp" alt="Yarn Ball">`;

type Text = string | ((s: GameState) => string);

interface Balloon {
  id: string;
  title: string;
  text: Text;
  /** CSS selector of what to point at; none = centred. */
  anchor?: string | ((s: GameState) => string | undefined);
  /** Only show once this holds (default: always). */
  when?: (s: GameState) => boolean;
  /** Steps only: advance after this human action. Omitted = a Next button. */
  doneWhen?: (a: Action, s: GameState) => boolean;
  /** Steps only: no Next button — you must do something that isn't a game action (e.g. open a card). */
  mustDo?: boolean;
  /** Steps only: the moment for this step has passed (e.g. you never played a unit), so skip it. */
  skipIf?: (s: GameState) => boolean;
  /** Steps only: waits for its moment without holding up the steps after it. */
  optional?: boolean;
  /** Prefer the balloon below its target (keeps what's above — e.g. enemy units — visible). */
  below?: boolean;
  /** Extra things to spotlight and keep uncovered, e.g. the button the step asks you to press. */
  also?: string[] | ((s: GameState) => string[]);
  /** Things the balloon must not cover, without spotlighting them (e.g. the enemy you're about to attack). */
  avoid?: string[];
}

const ME: PlayerId = 0;
const FOE: PlayerId = 1;

const myPrompt = (s: GameState, kind?: string) =>
  s.prompt?.player === ME && (kind === undefined || s.prompt.kind === kind);
const canPlay = (s: GameState) => myPrompt(s, 'action') && legalActions(s).some((a) => a.t === 'play');
const canAttack = (s: GameState) =>
  myPrompt(s, 'action') && legalActions(s).some((a) => a.t === 'attack' && a.attacker.kind === 'unit');
/** What you've picked and are now choosing a target for, if anything. */
const picked = () => host?.selection() ?? null;
/** Names of your units that can attack right now. */
const attackerNames = (s: GameState) => [...new Set(legalActions(s)
  .flatMap((a) => (a.t === 'attack' && a.attacker.kind === 'unit' ? [a.attacker.uid] : []))
  .map((uid) => cardName(s.players[ME].yard.find((u) => u.uid === uid)?.id ?? '')))].filter(Boolean);
const list = (names: string[]) => names.map((n) => `<b>${n}</b>`).join(names.length > 2 ? ', ' : ' and ');

const STEPS: Balloon[] = [
  {
    id: 'goal', title: 'How you win', anchor: '.player.foe .lives', below: true,
    text: 'Each cat has a row of <b>9 hearts</b>. Knock out all of the opponent’s hearts, up there, before they take yours.',
  },
  {
    // Reading a card teaches the price, the paw and the heart in one go — and you cannot play without it.
    id: 'card', title: 'Read a card 🔍', anchor: '.hand', mustDo: true,
    when: () => !!document.querySelector('.hand .hand-card'),
    text: 'Your cards are at the bottom, and they’re small. <b>Press and hold</b> one to open it full size — let go to close. '
      + '<br><b>Try it now: hold a card until it opens.</b>',
  },
  {
    id: 'treats', title: 'Treats are your money', anchor: '.hand', also: ['[data-click="btn:confirm"]'],
    when: (s) => myPrompt(s, 'setupPlant'),
    text: 'Cards cost <b>Treats</b> — the number in a card’s top-left corner. Planting a card face down turns it into '
      + '<b>1 Treat</b>, money rather than a cat, whatever it cost. '
      + '<b>Click the 2 cards with the biggest corner number, then press Plant.</b>',
    doneWhen: (a) => a.t === 'setupPlant',
  },
  {
    id: 'spend', title: 'Spend a Treat', anchor: '.hand', also: ['[data-click="btn:ability"]', '[data-click="btn:pass"]'],
    when: (s) => myPrompt(s, 'action'),
    // Never teach "press Pass" as the first thing you do. If nothing is affordable there is always a
    // real move: the Hero Cat's ability when it has a target, otherwise taking the Yarn Ball.
    text: (s) => {
      if (canPlay(s)) return 'A card with a bright ring is one you can afford. <b>Click one</b> to play it — it comes down on your side of the table.';
      const can = (t: Action['t']) => legalActions(s).some((a) => a.t === t);
      if (can('ability')) return 'Nothing you can afford yet — but your Hero Cat’s <b>ability</b> is free. <b>Press Use ability</b>; that’s your go.';
      if (can('takeYarn')) return 'Nothing you can afford yet, and that’s fine. <b>Press Take the Yarn</b> — you’ll get the first move next round.';
      return 'Nothing you can afford yet. <b>Press Pass</b> — next round you draw 2 cards and make another Treat.';
    },
    doneWhen: (a) => a.t === 'play' || a.t === 'ability' || a.t === 'pass' || a.t === 'takeYarn',
  },
  {
    id: 'rest', title: 'It’s having a nap', anchor: '.yard.me', below: true, optional: true, skipIf: (s) => s.round >= 4,
    when: (s) => s.players[ME].yard.length > 0 && myPrompt(s),
    text: (s) => {
      const napping = s.players[ME].yard.some((u) => u.exhausted);
      return napping
        ? 'A cat that just arrived is tilted and marked <b>new</b>: it naps this round and can attack from the next one. '
          + 'The paw is its power, the heart its health.'
        : 'Most cats nap the round they arrive — this one has <b>Zoomies</b>, so it can attack straight away. '
          + 'The paw is its power, the heart its health.';
    },
  },
  {
    id: 'turn', title: 'One thing each', anchor: '[data-click="btn:pass"]', when: (s) => myPrompt(s, 'action'),
    skipIf: (s) => myPrompt(s, 'plant'),
    text: 'You do <b>one thing</b>, then your opponent does one, back and forth. <b>Press Pass</b> when you have nothing left to do.',
    doneWhen: (a) => a.t === 'pass' || a.t === 'takeYarn',
  },
  {
    id: 'attack', title: 'Attack!', optional: true, below: true, skipIf: (s) => s.round >= 6,
    avoid: ['.player.foe', '.yard.foe'],
    // The text and highlights follow what you've picked (an attacker, or a card from your hand).
    when: canAttack,
    anchor: () => {
      const sel = picked();
      return !sel ? '.yard.me .unit.can-act' : sel.attack ? '.targetable' : '[data-click="btn:cancel"]';
    },
    also: () => {
      const sel = picked();
      return !sel ? ['.yard.me .unit.can-act'] : ['.targetable', '[data-click="btn:cancel"]'];
    },
    text: (s) => {
      const sel = picked();
      if (sel?.attack)
        return document.querySelector('.player.foe .hero.targetable')
          ? 'Now click a <b>pink target</b>: their cat, or their <b>Hero Cat</b> to knock out a heart.'
          : 'Now click the <b>pink target</b>. Their <b>Guardian</b> has to be dealt with before their Hero Cat.';
      if (sel)
        return `<b>${sel.label}</b> is a card in your hand — cards are <b>played</b>, not used to attack. `
          + 'Press <b>Cancel</b>, then click a cat with a <b>Ready!</b> tag.';
      const names = attackerNames(s);
      return `A cat with a <b>Ready!</b> tag can attack${names.length ? ` — ${list(names)}` : ''}. `
        + 'Click it, then click what it should hit.';
    },
    doneWhen: (a) => a.t === 'attack',
  },
  {
    id: 'hit', title: 'You’ve got it! 🎉', anchor: '.player.foe .lives', below: true,
    when: (s) => myPrompt(s) && (doneIds.has('attack') || s.round >= 6),
    text: 'A hit knocks out a heart — and that card goes into their <b>hand</b>, so whoever is behind gets more to play with. '
      + 'That’s everything: I’ll pop up when something new happens.',
  },
];

const TIPS: Balloon[] = [
  {
    // Demoted from a step: a beginner does not need the Yarn Ball to take their first turn.
    id: 'newRound', title: 'A new round', anchor: '.hand', also: ['[data-click="btn:skip"]'],
    when: (s) => myPrompt(s, 'plant'),
    text: 'Everything woke up and you drew 2 cards. You may plant <b>one more Treat</b> — or press <b>Skip</b> and keep '
      + 'the card to play instead.',
  },
  {
    id: 'yarnBall', title: 'The Yarn Ball', anchor: '[data-click="btn:yarn"]', also: ['.yarn'],
    when: (s) => myPrompt(s, 'action') && s.round >= 2 && !!document.querySelector('[data-click="btn:yarn"]'),
    text: `Whoever holds the <b>Yarn Ball</b> ${YARN_ICON} goes first each round, and it changes hands every round. `
      + '<b>Take the Yarn</b> grabs it for next round, but then you can only pass for the rest of this one.',
  },
  {
    id: 'ability', title: 'Your Hero Cat', anchor: '.player.me .hero', also: ['[data-click="btn:ability"]'],
    when: (s) => myPrompt(s, 'action') && legalActions(s).some((a) => a.t === 'ability'),
    text: 'Your Hero Cat never leaves the table. Once a round you can <b>use its ability</b> for free — and later it '
      + '<b>Grows Up</b> into something stronger.',
  },
  {
    id: 'zest', title: 'Zest! 🍋', anchor: '.hand-card.zest-on',
    when: (s) => myPrompt(s, 'action') && !!document.querySelector('.hand-card.zest-on'),
    text: 'Citrus cards have <b>Zest</b>: a bonus when it isn’t your first card this round. '
      + 'You’ve already played a card, so the glowing <b>Zest!</b> cards now get their bonus.',
  },
  {
    id: 'ripen', title: 'Ripen 🍎',
    anchor: (s) => { const u = s.players.flatMap((p) => p.yard).find((x) => (x.ripe ?? 0) > 0); return u ? `[data-click="unit:${u.uid}"]` : undefined; },
    when: (s) => myPrompt(s) && s.players.some((p) => p.yard.some((u) => (u.ripe ?? 0) > 0)),
    text: 'Orchard units <b>Ripen</b>: at the start of every round they get +1 Power and +1 Health, '
      + 'up to +2/+2. Deal with them early, before they grow!',
  },
  {
    id: 'lostLife', title: 'You lost a Life', anchor: '.player.me .lives', when: (s) => s.players[ME].lives.length < 9,
    text: 'Ouch! But the lost Life card went into your <b>hand</b> — getting hit gives you more cards to fight back with. '
      + 'If it’s <b>Lucky</b> 🍀, you may even play it for free.',
  },
  {
    id: 'pounce', title: 'Pounce!', anchor: '.midbar', when: (s) => myPrompt(s, 'pounce'),
    text: 'Your opponent is doing something and you hold a <b>Pounce</b> card, so you may react first: '
      + 'click the glowing card, or press <b>Let it happen</b>.',
  },
  {
    id: 'foePounce', title: 'They Pounced!', anchor: '.midbar',
    when: (s) => myPrompt(s) && s.log.some((e) => e.player === FOE && e.text.includes('POUNCES')),
    text: 'Your opponent reacted with a <b>Pounce</b> card before your move finished. Players get one quick reaction '
      + 'whenever the other plays a card or attacks — keep an eye on their unspent Treats!',
  },
  {
    id: 'lucky', title: 'Lucky! 🍀', anchor: '.midbar', when: (s) => myPrompt(s, 'lucky'),
    text: 'The Life you just lost is a <b>Lucky</b> card, so you can play it for free right now.',
  },
  {
    id: 'guardian', title: 'Guardians',
    anchor: (s) => { const g = s.players[FOE].yard.find(isGuardian); return g ? `[data-click="unit:${g.uid}"]` : undefined; },
    when: (s) => canAttack(s) && s.players[FOE].yard.some(isGuardian),
    text: 'A unit marked <b>Guardian</b> protects its team: your attackers must hit Guardians first, '
      + 'unless they are <b>Sneaky</b>.',
  },
  {
    id: 'foeYarn', title: 'The Yarn Ball', anchor: '.player.foe .yarn', when: (s) => s.yarnTaken === FOE,
    text: `Your opponent <b>took the Yarn Ball</b> ${YARN_ICON}: they will act first next round, but must pass for the rest of this one.`,
  },
  {
    id: 'grown', title: 'Grown up!', anchor: '.player.me .hero', when: (s) => s.players[ME].hero.grown,
    text: 'Sunny <b>Grew Up</b> into a Big Cat! She now has Power, can attack with the <b>Big Cat attack</b> button, '
      + 'and her ability is stronger.',
  },
];

// ── State ────────────────────────────────────────────────────────────────────────────────────────

export interface TutorialHost {
  game(): GameState | null;
  /** Re-render the page (the tutorial draws on top of it). */
  rerender(): void;
  /** Let the AI continue once a balloon is closed. */
  resumeAi(): void;
  /** What you've picked and are choosing a target for: an attacker (attack) or a card from your hand. */
  selection(): { label: string; attack: boolean } | null;
  /** The player chose to skip the walkthrough. */
  skipped?(): void;
}

let host: TutorialHost | null = null;
const doneIds = new Set<string>();
const seenTips = new Set<string>();
let tip: Balloon | null = null;
const layer = document.createElement('div');
layer.id = 'tutorial';
document.body.appendChild(layer);

export const tutorialActive = () => host !== null;

export function startTutorial(h: TutorialHost) {
  host = h;
  count('tutorials');
  doneIds.clear();
  seenTips.clear();
  tip = null;
}

export function stopTutorial() {
  host = null;
  tip = null;
  layer.innerHTML = '';
}

/** The balloon to show right now, if any. Tips jump the queue. */
/**
 * The first unfinished step whose moment has come. Optional steps that aren't ready yet are passed
 * over; any other step that isn't ready yet holds everything after it.
 */
function nextStep(s: GameState): Balloon | null {
  for (const step of STEPS) {
    if (doneIds.has(step.id)) continue;
    if (step.skipIf?.(s)) { doneIds.add(step.id); continue; }
    if (!step.when || step.when(s)) return step;
    if (!step.optional) return null;
  }
  return null;
}

function current(s: GameState): { b: Balloon; kind: 'step' | 'tip' } | null {
  // Steps come first while the walkthrough is running: a tip used to jump the queue and explain
  // Zest at the exact moment the walkthrough wanted to explain the cat you had just played.
  // Tips fill the gaps — and once the steps are done, every moment is a gap.
  if (!tip) {
    const step = nextStep(s);
    if (step) return { b: step, kind: 'step' };
    tip = TIPS.find((t) => !seenTips.has(t.id) && t.when?.(s)) ?? null;
  }
  if (tip) return { b: tip, kind: 'tip' };
  const step = nextStep(s);
  return step ? { b: step, kind: 'step' } : null;
}

/** While a "read this" balloon is open, the AI waits. */
export function tutorialBlocksAi(): boolean {
  const s = host?.game();
  if (!s || s.winner !== null) return false;
  const c = current(s);
  return !!c && (c.kind === 'tip' || !c.b.doneWhen || !!c.b.mustDo);
}

export function tutorialAfterAction(action: Action) {
  const s = host?.game();
  if (!s) return;
  // The step you were on (the first unfinished required one — it's usually no longer "showable" now
  // that you've acted, so it can't be looked up via current()), plus any optional step you've
  // already done on your own, are finished.
  // Finishing a step also finishes any "read this" balloons before it that you skipped past.
  let firstRequired = true;
  for (const [i, step] of STEPS.entries()) {
    if (doneIds.has(step.id)) continue;
    const matches = !!step.doneWhen?.(action, s);
    if (matches && (step.optional || firstRequired)) {
      doneIds.add(step.id);
      if (!step.optional) for (const earlier of STEPS.slice(0, i)) if (!earlier.doneWhen && !earlier.mustDo) doneIds.add(earlier.id);
    }
    if (!step.optional && step.doneWhen) firstRequired = false;
  }
}

/** Called when a card is opened full size: finishes the "Read any card" step. */
export function tutorialCardZoomed() {
  const s = host?.game();
  if (!s || current(s)?.b.id !== 'card') return;
  doneIds.add('card');
  zoomedJustNow = true;
}

/** The card preview that finished the "Read any card" step was just opened; draw the next step once it closes. */
let zoomedJustNow = false;
export function tutorialZoomClosed() {
  if (!zoomedJustNow) return;
  zoomedJustNow = false;
  host?.rerender();
  host?.resumeAi();
}

/** Which step is on screen and since when, to spot balloons that are closed before they are read. */
let shownId = '';
let shownAt = 0;

function next() {
  if (shownAt && Date.now() - shownAt < 1500) count('rushed');
  const s = host?.game();
  const shown = s ? current(s) : null;
  if (tip) { seenTips.add(tip.id); tip = null; }
  else if (shown) doneIds.add(shown.b.id);
  host?.rerender();
  host?.resumeAi();
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────

layer.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-tut]');
  if (!el) return;
  if (el.dataset.tut === 'next') next();
  if (el.dataset.tut === 'skip') {
    // One confirm: skipping used to be instant, permanent and silent.
    if (!window.confirm('Skip the walkthrough? Tips will still pop up when something new happens.')) return;
    count('skipped');
    const h = host;
    stopTutorial();
    h?.skipped?.();
    h?.rerender();
    h?.resumeAi();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && layer.querySelector('[data-tut="next"]')) { event.preventDefault(); next(); }
});

/**
 * Draw the current step. `hidden`: a panel (Rules, Settings) is open over the game, so the tutorial
 * steps aside until it closes. The tutorial's layer sits above the game screen, panels included, so
 * otherwise its balloon and shade would cover the panel and its buttons.
 */
export function renderTutorial(hidden = false) {
  const s = host?.game();
  if (hidden || !s || s.winner !== null) { layer.innerHTML = ''; return; }
  const c = current(s);
  if (!c) { layer.innerHTML = ''; return; }
  const { b, kind } = c;
  if (kind === 'step' && b.id !== shownId) { shownId = b.id; shownAt = Date.now(); note({ lastStep: b.id }); }
  const selector = typeof b.anchor === 'function' ? b.anchor(s) : b.anchor;
  const target = selector ? document.querySelector<HTMLElement>(selector) : null;
  const text = typeof b.text === 'function' ? b.text(s) : b.text;
  const waiting = kind === 'step' && (!!b.doneWhen || !!b.mustDo);
  const progress = kind === 'step' ? `<span class="tut-progress">${STEPS.indexOf(b) + 1}/${STEPS.length}</span>` : '<span class="tut-progress">Tip</span>';

  layer.innerHTML = `
    ${target ? '<svg class="tut-shade" aria-hidden="true"><path fill-rule="evenodd"></path></svg><div class="tut-rings"></div>' : '<div class="tut-dim"></div>'}
    <div class="tut-balloon ${target ? '' : 'centered'}" role="dialog" aria-label="${b.title}">
      <div class="tut-head"><b>${b.title}</b>${progress}</div>
      <div class="tut-text">${text}</div>
      <div class="tut-actions">
        <button class="tut-skip" data-tut="skip">Skip tutorial</button>
        ${waiting ? '<span class="tut-wait">👉 Do it to continue</span>' : '<button class="primary" data-tut="next">Next</button>'}
      </div>
      <i class="tut-arrow"></i>
    </div>`;

  const balloon = layer.querySelector<HTMLElement>('.tut-balloon')!;
  if (!target) return;
  const r = target.getBoundingClientRect();

  // Spotlight the target and any button the step asks you to press (e.g. "Plant"), with one shade
  // that has a hole per highlight. Clicks go straight through the shade to the game.
  const also = typeof b.also === 'function' ? b.also(s) : b.also ?? [];
  const extras = also.flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)]);
  const holes = [r, ...extras.map((e) => e.getBoundingClientRect())].filter((x) => x.width && x.height);
  const W = window.innerWidth, H = window.innerHeight, pad = 6;
  const rounded = (x: DOMRect) => {
    const l = x.left - pad, t = x.top - pad, w = x.width + pad * 2, h = x.height + pad * 2, k = 12;
    return `M${l + k},${t}h${w - 2 * k}a${k},${k} 0 0 1 ${k},${k}v${h - 2 * k}a${k},${k} 0 0 1 -${k},${k}h-${w - 2 * k}a${k},${k} 0 0 1 -${k},-${k}v-${h - 2 * k}a${k},${k} 0 0 1 ${k},-${k}z`;
  };
  layer.querySelector('.tut-shade path')!.setAttribute('d', `M0,0H${W}V${H}H0Z ${holes.map(rounded).join(' ')}`);
  layer.querySelector('.tut-rings')!.innerHTML = holes
    .map((x) => `<i style="left:${x.left - pad}px;top:${x.top - pad}px;width:${x.width + pad * 2}px;height:${x.height + pad * 2}px"></i>`).join('');

  // Place the balloon where it covers nothing you need: not the highlights, and not the prompt-bar
  // buttons (a phone playtester couldn't press "Plant" because the balloon sat on top of it).
  const keepClear = [...holes, ...[...document.querySelectorAll<HTMLElement>(['.midbar button', '.hero-actions button', ...(b.avoid ?? [])].join(','))]
    .map((e) => e.getBoundingClientRect())];
  const bw = balloon.offsetWidth, bh = balloon.offsetHeight, gap = 16, margin = 8;
  const left = Math.max(margin, Math.min(W - bw - margin, r.left + r.width / 2 - bw / 2));
  const candidates: { top: number; arrow: 'above' | 'below' | 'none' }[] = [
    ...(b.below ? [] : [{ top: r.top - bh - gap, arrow: 'above' as const }]),
    { top: r.bottom + gap, arrow: 'below' },
    ...(b.below ? [{ top: r.top - bh - gap, arrow: 'above' as const }] : []),
    { top: margin, arrow: 'none' },
    { top: H - bh - margin, arrow: 'none' },
  ];
  const overlap = (top: number) => keepClear.reduce((sum, k) => {
    const w = Math.min(left + bw, k.right) - Math.max(left, k.left);
    const h = Math.min(top + bh, k.bottom) - Math.max(top, k.top);
    return sum + (w > 0 && h > 0 ? w * h : 0);
  }, 0);
  const onScreen = candidates.filter((c) => c.top >= margin && c.top + bh <= H - margin);
  const pick = onScreen.find((c) => overlap(c.top) === 0)
    ?? [...(onScreen.length ? onScreen : candidates)].sort((a, z) => overlap(a.top) - overlap(z.top))[0];
  const top = Math.max(margin, Math.min(H - bh - margin, pick.top));
  Object.assign(balloon.style, { left: `${left}px`, top: `${top}px` });
  balloon.classList.add(pick.arrow === 'none' ? 'floating' : pick.arrow);
  const arrow = layer.querySelector<HTMLElement>('.tut-arrow')!;
  arrow.style.left = `${Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - left))}px`;
}

window.addEventListener('resize', () => renderTutorial());
