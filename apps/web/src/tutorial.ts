// The click-through tutorial: speech balloons that point at the board and explain the game while
// you play a real (gentle) game against the AI.
//
// Two kinds of balloon:
//   • Steps — a fixed walkthrough in order. A step either has a Next button ("read this") or waits
//     for you to do something ("plant two Treats") and moves on when you have.
//   • Tips — shown once, the first time something new happens (a lost Life, a Pounce chance, ...).
// While a "read this" balloon is open the AI waits, so nothing happens behind your back.

import { isGuardian, legalActions, type Action, type GameState, type PlayerId } from '@fruitcats/engine';

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
  /** Steps only: the moment for this step has passed (e.g. you never played a unit), so skip it. */
  skipIf?: (s: GameState) => boolean;
  /** Steps only: waits for its moment without holding up the steps after it. */
  optional?: boolean;
  /** Prefer the balloon below its target (keeps what's above — e.g. enemy units — visible). */
  below?: boolean;
}

const ME: PlayerId = 0;
const FOE: PlayerId = 1;

const myPrompt = (s: GameState, kind?: string) =>
  s.prompt?.player === ME && (kind === undefined || s.prompt.kind === kind);
const canPlay = (s: GameState) => myPrompt(s, 'action') && legalActions(s).some((a) => a.t === 'play');
const canAttack = (s: GameState) =>
  myPrompt(s, 'action') && legalActions(s).some((a) => a.t === 'attack' && a.attacker.kind === 'unit');

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
    text: 'Sunny starts as a <b>Kitten</b> with an ability you can use once per round — hover her picture to read it. '
      + 'When the <b>Grow Up</b> condition comes true, she becomes a <b>Big Cat</b>: stronger, and able to attack.',
  },
  {
    id: 'mulligan', title: 'Your opening hand', anchor: '.midbar', when: (s) => myPrompt(s, 'mulligan'),
    text: 'Your cards are at the bottom. <b>Press and hold any card</b> to read it full size — let go to shrink it '
      + 'back (right-click works too). You may swap cards you don’t like, but for your first game just press <b>Keep hand</b>.',
    doneWhen: (a) => a.t === 'mulligan',
  },
  {
    id: 'plant', title: 'Plant 2 Treats', anchor: '.hand', when: (s) => myPrompt(s, 'setupPlant'),
    text: '<b>Treats</b> are your resources. Each card costs Treats — the number in its top-left corner. '
      + 'Any card can be planted face-down as a Treat — a planted card is <b>not played</b>, it only pays for others — so pick the ones you want least, like expensive cards. '
      + '<b>Click 2 cards, then press Plant.</b>',
    doneWhen: (a) => a.t === 'setupPlant',
  },
  {
    id: 'pantry', title: 'Your Treats', anchor: '.player.me .pantry',
    text: 'Here are your Treats. Playing a card spends them — spent Treats turn sideways. '
      + 'They all come back at the start of every round, and you can plant one more each round.',
  },
  {
    id: 'turns', title: 'One thing at a time', anchor: '.midbar', when: (s) => myPrompt(s, 'action'),
    text: 'Players take turns doing <b>one thing</b> at a time: play a card, attack, or use your ability. '
      + 'This bar always says what’s going on and what you can do.',
  },
  {
    id: 'play', title: 'Play a card', anchor: '.hand', when: (s) => myPrompt(s, 'action'),
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
    id: 'attack', title: 'Attack!', anchor: '.yard.me .unit.can-act', when: canAttack, optional: true, below: true, skipIf: (s) => s.round >= 5,
    text: 'Units with a <b>yellow glow</b> can attack. Click one (or drag it) onto a target: an enemy unit — '
      + 'they damage each other — or the enemy <b>Hero Cat</b> to knock out a Life.',
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
    id: 'newRound', title: 'A new round!', anchor: '.hand', when: (s) => myPrompt(s, 'plant'),
    text: 'Everything got ready again and you drew 2 cards. You may plant <b>one more Treat</b> — more Treats means bigger cards. '
      + 'Click a card to plant it, or press Skip.',
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
    id: 'foeYarn', title: 'The Yarn Ball 🧶', anchor: '.player.foe .yarn', when: (s) => s.yarnTaken === FOE,
    text: 'Your opponent <b>took the Yarn Ball</b>: they will act first next round, but must pass for the rest of this one.',
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
  return !!c && (c.kind === 'tip' || !c.b.doneWhen);
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
      if (!step.optional) for (const earlier of STEPS.slice(0, i)) if (!earlier.doneWhen) doneIds.add(earlier.id);
    }
    if (!step.optional && step.doneWhen) firstRequired = false;
  }
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
  const waiting = kind === 'step' && !!b.doneWhen;
  const progress = kind === 'step' ? `<span class="tut-progress">${STEPS.indexOf(b) + 1}/${STEPS.length}</span>` : '<span class="tut-progress">Tip</span>';

  layer.innerHTML = `
    ${target ? '<div class="tut-spot"></div>' : '<div class="tut-dim"></div>'}
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
  const spot = layer.querySelector<HTMLElement>('.tut-spot')!;
  Object.assign(spot.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });

  // Put the balloon above the target if it fits, otherwise below; keep it on screen.
  const bw = balloon.offsetWidth, bh = balloon.offsetHeight, gap = 16;
  const fitsBelow = r.bottom + gap + bh < window.innerHeight - 8;
  const above = b.below && fitsBelow ? false : r.top - bh - gap > 8;
  const top = above ? r.top - bh - gap : Math.min(window.innerHeight - bh - 8, r.bottom + gap);
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
  Object.assign(balloon.style, { left: `${left}px`, top: `${top}px` });
  balloon.classList.add(above ? 'above' : 'below');
  const arrow = layer.querySelector<HTMLElement>('.tut-arrow')!;
  arrow.style.left = `${Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - left))}px`;
}

window.addEventListener('resize', () => renderTutorial());
