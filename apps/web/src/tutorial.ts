// The click-through tutorial: speech balloons that point at the board and explain the game while
// you play a real (gentle) game against the AI.
//
// Two kinds of balloon:
//   • Steps — a fixed walkthrough in order. A step either has a Next button ("read this") or waits
//     for you to do something ("plant two Treats") and moves on when you have.
//   • Tips — shown once, the first time something new happens (a lost Life, a Pounce chance, ...).
// While a "read this" balloon is open the AI waits, so nothing happens behind your back.

import { cardName, isGuardian, legalActions, type Action, type GameState, type PlayerId } from '@fruitcats/engine';

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
    id: 'welcome', title: 'Welcome to Fruitcats! 🐱',
    text: 'You lead <b>Sunny, the Lemon Lynx</b>. Knock out all <b>9 Lives</b> of the rival Hero Cat to win. '
      + 'I’ll walk you through your first game — the opponent will wait while you read.',
  },
  {
    id: 'lives', title: 'Your Lives', anchor: '.player.me .lives',
    text: 'These pink dots are your <b>9 Lives</b>; the opponent’s are at the top. '
      + 'Every hit on a Hero Cat knocks one out.',
  },
  {
    id: 'hero', title: 'Your Hero Cat', anchor: '.player.me .hero',
    text: 'Sunny starts as a <b>Kitten</b> with an ability you can use once per round. '
      + 'When the <b>Grow Up</b> condition comes true, she becomes a <b>Big Cat</b>: stronger, and able to attack.',
  },
  {
    // Shown while you have cards in hand (not just at the mulligan), so it can't be skipped past.
    id: 'zoom', title: 'Read any card 🔍', anchor: '.hand', when: () => !!document.querySelector('.hand .hand-card'), mustDo: true,
    // You can't play without reading your cards, so this one must be done: it moves on once you've
    // opened a card (see tutorialCardZoomed).
    text: 'These are your cards. They’re small, so to read one, <b>press and hold it</b> — it opens full size. '
      + '<b>Let go</b> and it shrinks back. This works on <b>every card</b>: in your hand, in the Yards, and the Hero Cats. '
      + '(With a mouse you can also <b>right-click</b> a card.)<br><b>Try it now: press and hold any card until it opens.</b>',
  },
  {
    id: 'mulligan', title: 'Your opening hand', anchor: '.midbar', also: ['[data-click="btn:confirm"]'], when: (s) => myPrompt(s, 'mulligan'),
    text: 'You may swap cards you don’t like for new ones, but for your first game just press <b>Keep hand</b>.',
    doneWhen: (a) => a.t === 'mulligan',
  },
  {
    id: 'plant', title: 'Plant 2 Treats', anchor: '.hand', also: ['[data-click="btn:confirm"]'], when: (s) => myPrompt(s, 'setupPlant'),
    text: '<b>Treats</b> are your resources: a card costs the number of Treats in its top-left corner. '
      + 'Any card can be planted face-down, and <b>every planted card is worth exactly 1 Treat</b>, however much it costs. '
      + 'A planted card is <b>not played</b>, so plant the ones you need least right now — at the start, often a card '
      + 'too expensive to play soon. <b>Click 2 cards, then press Plant.</b>',
    doneWhen: (a) => a.t === 'setupPlant',
  },
  {
    id: 'pantry', title: 'Your Treats', anchor: '.yard.me .pantry',
    text: 'Your Treats live in this tray next to your Yard. Playing a card spends them — spent Treats turn sideways. '
      + 'They all come back at the start of every round, and you can plant one more each round.',
  },
  {
    id: 'turns', title: 'One thing at a time', anchor: '.midbar', when: (s) => myPrompt(s, 'action'),
    text: 'Players take turns doing <b>one thing</b> at a time: play a card, attack, or use your ability. '
      + 'This bar always says what’s going on and what you can do.',
  },
  {
    id: 'yarnBall', title: 'The Yarn Ball', anchor: '[data-click="btn:yarn"]', also: ['.yarn'], optional: true,
    when: (s) => myPrompt(s, 'action') && !!document.querySelector('[data-click="btn:yarn"]'),
    skipIf: (s) => s.round >= 3,
    text: `Whoever holds the <b>Yarn Ball</b> ${YARN_ICON} acts <b>first</b> each round — you have it now (see the ball on your Hero Cat’s picture). `
      + 'It passes to the other player at the end of each round, <b>unless</b> someone presses <b>Take the Yarn</b>: '
      + 'then they go first next round, but must pass for the rest of this one. Take it when you have nothing better to do!',
  },
  {
    id: 'play', title: 'Play a card', anchor: '.hand', also: ['[data-click="btn:pass"]'], when: (s) => myPrompt(s, 'action'),
    text: (s) => canPlay(s)
      ? 'Cards that <b>glow yellow</b> are playable right now. <b>Click one</b> (or drag it onto the board) to play it. '
        + 'If it needs a target, the targets light up pink — click one.'
      : 'None of your cards is affordable right now, so press <b>Pass</b>.',
    doneWhen: (a) => a.t === 'play' || a.t === 'pass' || a.t === 'takeYarn',
  },
  {
    id: 'yard', title: 'Your Yard', anchor: '.yard.me', below: true, when: (s) => s.players[ME].yard.length > 0 && myPrompt(s),
    optional: true, skipIf: (s) => s.round >= 4,
    text: 'Units you play go into your <b>Yard</b>. New units are tired — tilted, with “zzz” — and can’t attack '
      + 'until next round, unless they have <b>Zoomies</b>. The number on the left is Power, the heart is Health.',
  },
  {
    id: 'attack', title: 'Attack!', optional: true, below: true, skipIf: (s) => s.round >= 5,
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
          ? 'Now click a <b>pink target</b>: an enemy unit — they damage each other — or the enemy <b>Hero Cat</b> '
            + 'to knock out a Life. (Changed your mind? Press <b>Cancel</b>.)'
          : 'Now click the <b>pink target</b>. Their <b>Guardian</b> protects the Hero Cat, so it must be attacked first; '
            + 'your units damage each other. (Changed your mind? Press <b>Cancel</b>.)';
      if (sel)
        return `<b>${sel.label}</b> is a card from your hand. Cards in your hand are <b>played</b>, not used to attack — `
          + 'you can still play it by clicking a pink target. To <b>attack</b>, press <b>Cancel</b>, then click a unit '
          + 'with a <b>Ready!</b> tag in your Yard.';
      const names = attackerNames(s);
      return `Units in your <b>Yard</b> with a glowing <b>Ready!</b> tag can attack${names.length ? ` — right now: ${list(names)}` : ''}. `
        + 'Click one (or drag it) onto a target: an enemy unit, or the enemy <b>Hero Cat</b> to knock out a Life. '
        + '<i>Cards in your hand don’t attack — they’re played.</i>';
    },
    doneWhen: (a) => a.t === 'attack',
  },
  {
    id: 'pass', title: 'Pass when you’re done', anchor: '[data-click="btn:pass"]', when: (s) => myPrompt(s, 'action'),
    skipIf: (s) => myPrompt(s, 'plant'),
    text: 'When you have nothing more to do, press <b>Pass</b>. You can still act later if your opponent does something. '
      + 'The round ends when you both pass in a row.',
    doneWhen: (a) => a.t === 'pass' || a.t === 'takeYarn',
  },
  {
    id: 'newRound', title: 'A new round!', anchor: '.hand', also: ['[data-click="btn:skip"]'], when: (s) => myPrompt(s, 'plant'),
    text: 'Everything got ready again and you drew 2 cards. You may plant <b>one more card as 1 Treat</b> — more Treats let you '
      + 'play bigger cards, but every card you plant is one you can’t play. Plant your least useful card, or press Skip.',
    doneWhen: (a) => a.t === 'plant' || a.t === 'skipPlant',
  },
  {
    id: 'done', title: 'You’ve got it! 🎉', when: (s) => myPrompt(s) && (doneIds.has('attack') || s.round >= 5),
    text: 'That’s the basics. Keep going and knock out all 9 Lives! I’ll pop up with a tip when something new happens. '
      + 'The <b>Rules</b> button has a summary any time.',
  },
];

const TIPS: Balloon[] = [
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
function current(s: GameState): { b: Balloon; kind: 'step' | 'tip' } | null {
  if (!tip) {
    tip = TIPS.find((t) => !seenTips.has(t.id) && t.when?.(s)) ?? null;
  }
  if (tip) return { b: tip, kind: 'tip' };
  // The first unfinished step whose moment has come. Optional steps that aren't ready yet are
  // passed over; any other step that isn't ready yet holds everything after it.
  for (const step of STEPS) {
    if (doneIds.has(step.id)) continue;
    if (step.skipIf?.(s)) { doneIds.add(step.id); continue; }
    if (!step.when || step.when(s)) return { b: step, kind: 'step' };
    if (!step.optional) return null;
  }
  return null;
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
  if (!s || current(s)?.b.id !== 'zoom') return;
  doneIds.add('zoom');
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

function next() {
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
    const h = host;
    stopTutorial();
    h?.rerender();
    h?.resumeAi();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && layer.querySelector('[data-tut="next"]')) { event.preventDefault(); next(); }
});

export function renderTutorial() {
  const s = host?.game();
  if (!s || s.winner !== null) { layer.innerHTML = ''; return; }
  const c = current(s);
  if (!c) { layer.innerHTML = ''; return; }
  const { b, kind } = c;
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
