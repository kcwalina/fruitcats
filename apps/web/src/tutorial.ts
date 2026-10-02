// The click-through tutorial: speech balloons that point at the board and explain the game while
// you play a real (gentle) game against the AI.
//
// Two kinds of balloon:
//   • Steps — a fixed walkthrough in order. A step either has a Next button ("read this") or waits
//     for you to do something ("play a unit into a lane") and moves on when you have.
//   • Tips — shown once, the first time something new happens (a lost Candle, a copy to merge, ...).

import { CARDS, isUnitCard, keywords, legalActions, mayAct, targetRank, traitsOf, type Action, type GameState, type PlayerId } from '@fruitcats/engine';
import { count, note } from './progress';

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
  /** Steps only: the moment for this step has passed, so skip it. */
  skipIf?: (s: GameState) => boolean;
  /** Steps only: waits for its moment without holding up the steps after it. */
  optional?: boolean;
  /** Prefer the balloon below its target (keeps what's above visible). */
  below?: boolean;
  /** Extra things to spotlight and keep uncovered, e.g. the button the step asks you to press. */
  also?: string[] | ((s: GameState) => string[]);
  /** Things the balloon must not cover, without spotlighting them. */
  avoid?: string[];
}

const ME: PlayerId = 0;
const FOE: PlayerId = 1;

/** The Muster is waiting on you (not the last Clash, still on the board). */
// While the last Clash is on the board (playing, or its summary), the Muster waits.
const mustering = (s: GameState) => mayAct(s, ME) && s.prompt?.kind === 'muster' && !document.querySelector('.board.replaying');
const canFieldUnit = (s: GameState) => legalActions(s, ME).some((a) => a.t === 'play' && isUnitCard(s.players[ME].shop.find((c) => c.uid === a.uid)?.id ?? ''));

const STEPS: Balloon[] = [
  {
    id: 'goal', title: 'How you win', anchor: '.player.foe .lives', below: true,
    text: 'Each Hero has <b>9 Candles</b>. Blow out all of the opponent’s Candles, up there, before they blow out yours.',
  },
  {
    // Reading a card teaches the price, the paw and the heart in one go — and you cannot play without it.
    id: 'card', title: 'Your shop 🔍', anchor: '.hand', mustDo: true,
    when: () => !!document.querySelector('.hand .hand-card'),
    text: 'At the bottom is your <b>shop</b>: cards dealt from your own deck. <b>Press and hold</b> one to open it full size — let go to close. '
      + '<br><b>Try it now: hold a card until it opens.</b>',
  },
  {
    id: 'muster', title: 'The Muster', anchor: '.midbar', when: mustering,
    text: 'Each round starts with the <b>Muster</b>: you and your opponent build your sides <b>at the same time, in secret</b>. '
      + 'You see their board as it was when the Muster began. Your <b>Offerings</b> are your money: a card costs the number in its corner.',
  },
  {
    id: 'play', title: 'Buy a creature', anchor: '.hand', also: ['.yard.me'], when: (s) => mustering(s) && canFieldUnit(s),
    skipIf: (s) => s.round >= 4,
    text: 'A card with a bright ring is one you can afford. <b>Tap a creature, then tap one of your lanes</b> (the dashed spaces; the grey ones are locked until you level up) to buy it and put it there.',
    doneWhen: (a) => a.t === 'play',
  },
  {
    id: 'lanes', title: 'Lanes and classes', anchor: '.yard.me', below: true, when: (s) => mustering(s) && s.players[ME].yard.length > 0,
    text: 'In the Clash each unit hits the enemy <b>across from it</b> first, then the nearest. But the classes come first (the icon in a card’s corner): '
      + '🛡 <b>Tanks</b> are hit before anyone else, then 👊 Bruisers, and the back (🏹 Marksmen, ✨ Mages, 💠 Supports) last. A unit with <b>Taunt</b> is hit first of all.',
  },
  {
    id: 'ready', title: 'Ready!', anchor: '[data-click="btn:ready"]', when: mustering,
    text: 'Done building? <b>Press Ready.</b> When you’re both ready, the <b>Clash</b> plays itself: nobody decides anything in it.',
    doneWhen: (a) => a.t === 'ready',
  },
  {
    id: 'report', title: 'The Clash', anchor: '.clash-report', when: () => !!document.querySelector('.clash-report'),
    text: 'That was the Clash: here is who dealt and took what, and who fell when. <b>Watch again</b> to see it once more. '
      + 'When one side has nobody standing, it loses a <b>Candle</b> for each enemy still standing. '
      + 'Then every unit stands up again: <b>nothing on your board is ever lost in a Clash</b>. Your army only grows.',
  },
  {
    id: 'money', title: 'Spend or save', anchor: '.player.me .purse', when: (s) => mustering(s) && s.round >= 2,
    text: 'Each round you get more Offerings and a new shop. What you don’t spend is <b>kept</b>, and every 5 saved earn <b>1 more</b> next round. '
      + '<b>Roll</b> for a new shop, <b>level up</b> your Hero to field more units, or save for a big one: it’s your call.',
  },
  {
    id: 'done', title: 'You’ve got it! 🎉', anchor: '.player.foe .lives', below: true, when: (s) => mustering(s) && s.round >= 3,
    text: 'That’s the game: build in secret, watch the Clash, grow your army. I’ll pop up when something new happens.',
  },
];

const TIPS: Balloon[] = [
  {
    id: 'level', title: 'Level up', anchor: '[data-click="btn:level"]',
    when: (s) => mustering(s) && legalActions(s, ME).some((a) => a.t === 'levelUp') && s.players[ME].yard.length >= s.players[ME].hero.level,
    text: 'Your open lanes are full. Your Hero’s <b>Level</b> opens lanes from the left: <b>Level up</b> to open one more, at a price in Offerings.',
  },
  {
    id: 'merge', title: 'Copies merge', anchor: '.hand',
    when: (s) => mustering(s) && s.players[ME].shop.some((c) => CARDS[c.id]?.type === 'Critter' && s.players[ME].yard.some((u) => u.id === c.id)),
    text: 'Your shop has another copy of a creature on your board. Buy it and it <b>merges</b> into that unit, even when your lanes are full; the dots on the unit count the copies. <b>3 copies make 2 stars</b>, twice as strong; 6 make 3 stars.',
  },
  {
    id: 'sell', title: 'Make room', anchor: '.yard.me',
    when: (s) => mustering(s) && s.round >= 3 && s.players[ME].yard.length >= s.players[ME].hero.level,
    text: 'Your lanes are full. To make room for something better, <b>tap one of your units and sell it</b>: you get back what you paid, less 1.',
  },
  {
    id: 'ambush', title: 'Ambush cards', anchor: '.hand',
    when: (s) => mustering(s) && s.players[ME].shop.some((c) => keywords(c.id).pounce),
    text: 'An <b>Ambush</b> card can be set <b>face-down in one of your lanes</b>: it happens when the Clash begins, if its lane holds what it needs. Your opponent only sees a face-down card.',
  },
  {
    id: 'lostLife', title: 'You lost a Candle', anchor: '.player.me .lives', when: (s) => s.players[ME].lives < 9,
    text: 'Ouch! But losing Clashes in a row earns you extra <b>Offerings</b> at the start of the next rounds: +1 after two, up to +3 after five. Use them to catch up.',
  },
  {
    id: 'traits', title: 'A trait is on', anchor: '.player.me .traits',
    when: (s) => mustering(s) && traitsOf(s, ME).some((t) => t.tier >= 0),
    text: 'Two different units of one family turn on its <b>trait</b>: a bonus for your team, stronger at 4 and 6. '
      + 'It lights up, and its number says how many more the next bonus needs. Tap it to read it.',
  },
  {
    id: 'roles', title: 'Their classes', anchor: '.yard.foe',
    when: (s) => mustering(s) && s.players[FOE].yard.some((u) => targetRank(u, s) !== 2),
    text: 'Look at their units’ classes: your units must get through their 🛡 <b>Tanks</b> first, and their back comes last. '
      + 'A 🗡 <b>Assassin</b> of yours goes straight for their back, unless one of theirs has <b>Taunt</b>.',
  },
  {
    id: 'grown', title: 'Awakened!', anchor: '.player.me .hero', when: (s) => s.players[ME].hero.grown,
    text: 'Your Hero <b>Awakened</b>! Its ability is stronger, and it strikes when the Clash begins, unless you used its ability that round.',
  },
];

// ── State ────────────────────────────────────────────────────────────────────────────────────────

export interface TutorialHost {
  game(): GameState | null;
  /** Re-render the page (the tutorial draws on top of it). */
  rerender(): void;
  /** Let the AI continue once a balloon is closed. */
  resumeAi(): void;
  /** What you've picked and are choosing a target for: an attacker (attack) or a card from your shop. */
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
  // a mechanic at the exact moment the walkthrough wanted to explain the unit you had just played.
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

  // Spotlight the target and any button the step asks you to press (e.g. "Ready"), with one shade
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
  // buttons (a phone playtester couldn't press "Offer" because the balloon sat on top of it).
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
