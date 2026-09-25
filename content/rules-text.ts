// Rules text from a card's data, in the house style. A card's text isn't written by hand: it's generated
// from its keywords and abilities (`npm run write-text` puts it in each set.json, where the art tools and
// the game read it), and check-set fails if a set's text differs from what its data says. So the text on
// a card can never drift from what the card does.
//
// The house style, as the Starter Box set it:
//   keywords first ("Guardian. Heat."), then each ability on its own line, a Kitten's Grow Up last;
//   "Hello:", "Goodbye:" and "Exhaust:" as labels; a unit already named is "it" after that;
//   a mechanic written as a label ("Zest: …") or as a condition ("If you're Lush, …").

import type { Ability, Act, CardDef, Condition, HeroSide, TargetSel, UnitFilter } from '../packages/engine/src/types';
import { CONTENT } from './index';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// What the text needs to know beyond the card: the sets' mechanics and tokens.
interface MechanicInfo { counter?: { name: string; noun?: string; full?: { name: string; at: number } }; label?: boolean }
const MECHANICS: Record<string, MechanicInfo> = {};
const TOKENS: Record<string, CardDef> = {};
const PLUGIN_TEXTS: Record<string, (value: unknown, on: string, self: string) => string> = {};
for (const c of CONTENT) {
  Object.assign(MECHANICS, c.data.mechanics as Record<string, MechanicInfo> | undefined);
  for (const t of c.data.tokens ?? []) TOKENS[t.id] = t;
  Object.assign(PLUGIN_TEXTS, c.plugin?.texts);
}
/** A counter's mechanic, by the counter's name ('heat' → Heat). */
const mechanicOfCounter = (name: string) => Object.entries(MECHANICS).find(([, m]) => m.counter?.name === name)?.[0] ?? name;
const counterDef = (name: string) => Object.values(MECHANICS).find((m) => m.counter?.name === name)?.counter;
/** "a Crumb", "2 Crumbs". */
const counters = (noun: string, n: number) => (n === 1 ? `${article(noun)} ${noun}` : `${n} ${noun}s`);
/** A unit holding counters, as words around "unit": a Full unit, a unit that has a Crumb, a unit at +3 Heat. */
function counterWords(c: { name: string; atLeast: number }): { adj: string; tail: string } {
  const def = counterDef(c.name);
  if (def?.full && c.atLeast >= def.full.at) return { adj: `${def.full.name} `, tail: '' };
  if (def?.noun) return { adj: '', tail: ` that has ${counters(def.noun, c.atLeast)}` };
  return { adj: '', tail: ` at +${c.atLeast} ${mechanicOfCounter(c.name)}` };
}

// ── Targets ────────────────────────────────────────────────────────────────────────────────────────

function filterWords(f: UnitFilter | undefined): { adj: string; tail: string } {
  if (!f) return { adj: '', tail: '' };
  const adj = f.exhausted ? 'exhausted ' : f.damaged ? 'damaged ' : '';
  if (f.counter) { const w = counterWords(f.counter); return { adj: adj + w.adj, tail: w.tail }; }
  return { adj, tail: f.keyword ? ` with ${f.keyword}` : '' };
}

/** "a" or "an", by sound: an enemy, an exhausted unit, a unit, a 2/2 token ("an 8/8" is spelled out by its number). */
const article = (word: string) => (/^(8|11|18|[aeio]|u(?!n[aeiou]))/i.test(word) ? 'an' : 'a');

/** A target as a noun phrase: "a unit you control", "an exhausted unit", "each enemy unit". */
function noun(t: TargetSel | undefined, self: string): string {
  if (t === undefined) return '';
  if (t === 'self') return self;
  if (t === 'attack') return 'an attack';
  const { adj, tail } = filterWords(t.filter);
  if ('unit' in t) {
    if (t.unit === 'own') return t.other ? `another ${adj}unit you control${tail}` : `${article(adj || 'unit')} ${adj}unit you control${tail}`;
    if (t.unit === 'enemy') return `${article(adj || 'enemy')} ${adj}enemy unit${tail}`;
    return `${article(adj || 'unit')} ${adj}unit${tail}`;
  }
  if (t.each === 'own') return `each ${t.other ? 'other ' : ''}${adj}unit you control${tail}`;
  if (t.each === 'enemy') return `each ${adj}enemy unit${tail}`;
  if (t.each === 'allOther') return `each other ${adj}unit${tail}`;
  return `each ${adj}unit${tail}`;
}

/** Units an aura reaches, as the subject of a sentence: "Your other units with Heat". */
function auraSubject(to: { each: string; other?: boolean; filter?: UnitFilter }): string {
  const { adj, tail } = filterWords(to.filter);
  const whose = to.each === 'own' ? 'Your' : to.each === 'enemy' ? 'Enemy' : 'All';
  return `${whose} ${to.other ? 'other ' : ''}${adj}units${tail}`;
}

// ── Conditions ─────────────────────────────────────────────────────────────────────────────────────

/** A condition as a clause: "you have 8 or more Treats", "you're Lush". */
function clause(c: Condition): string {
  if (typeof c === 'string') return c === 'targetIsYours' ? "it's yours" : `you're ${c}`;
  if ('not' in c) return typeof c.not === 'string' ? `you're not ${c.not}` : `not: ${clause(c.not)}`;
  if ('treats' in c) return `you have ${c.treats.atLeast} or more Treats`;
  if ('lives' in c) return `you have ${c.lives.atMost} or fewer Lives`;
  if ('opponentLives' in c) return `your opponent has ${c.opponentLives.atMost} or fewer Lives`;
  if ('yardHas' in c) return `you control ${article(c.yardHas.keyword)} ${c.yardHas.keyword}`;
  if ('unitsInComposts' in c) return `${c.unitsInComposts.atLeast} or more Cats and Critters are in the Composts`;
  if ('controlUnits' in c) return `you control ${c.controlUnits.atLeast} or more units`;
  if ('compost' in c) return `you have ${c.compost.atLeast} or more cards in your Compost`;
  if ('unitHasCounter' in c) {
    const who = c.unitHasCounter.whose === 'enemy' ? 'an enemy unit' : c.unitHasCounter.whose === 'any' ? 'a unit' : 'a unit you control';
    const def = counterDef(c.unitHasCounter.name);
    if (def?.full && c.unitHasCounter.atLeast >= def.full.at) return `${who} is ${def.full.name}`;
    if (def?.noun) return `${who} has ${counters(def.noun, c.unitHasCounter.atLeast)}`;
    return `${who} has +${c.unitHasCounter.atLeast} ${mechanicOfCounter(c.unitHasCounter.name)}`;
  }
  if ('playedThisRound' in c) return `you've played ${c.playedThisRound.atLeast - 1} other card(s) this round`;
  return '';
}

/** A mechanic written as a label ("Zest: …") rather than a condition ("If you're Lush, …"). */
const isLabel = (c: Condition | undefined): c is string => typeof c === 'string' && !!MECHANICS[c]?.label;

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────

/**
 * One action as a clause. `on` is its target as a noun ("a unit you control"), or "it" once named;
 * `subjectless` drops the subject of "gets …" (a unit's own Zest bonus: "Zest: gets +1 Power").
 */
function actClause(act: Act, on: string, a: Ability, self: string, subjectless: boolean): string {
  const [name, v] = Object.entries(act)[0] ?? [];
  const n = v as number;
  switch (name) {
    case 'damage': return `deal ${n} damage to ${on}`;
    case 'heal': return `heal ${n} from ${on}`;
    case 'buff': {
      const b = v as { power?: number; keywords?: string[] };
      // Every unit of a side, as the subject: "your units get" (not "each unit you control gets").
      const each = typeof a.target === 'object' && 'each' in a.target && on !== 'it' ? auraSubject(a.target).toLowerCase() : '';
      const subject = subjectless ? '' : `${each || on} `;
      if (!b.power && b.keywords?.length) return `${subject}${each ? 'gain' : 'gains'} ${b.keywords.join(' and ')} this round`;
      return `${subject}${each ? 'get' : 'gets'} ${[b.power && `+${b.power} Power`, ...(b.keywords ?? [])].filter(Boolean).join(' and ')} this round`;
    }
    case 'counter': {
      const c = v as { name: string; add: number };
      const def = counterDef(c.name);
      if (def?.noun) return `put ${counters(def.noun, c.add)} on ${on}`;
      return `${on} gets +${c.add} ${mechanicOfCounter(c.name)}`;
    }
    case 'draw': return n === 1 ? 'draw a card' : `draw ${n} cards`;
    case 'exhaust': return `exhaust ${on}`;
    case 'ready': return a.when === 'hello' && a.target === 'self' ? 'enters ready' : `ready ${on}`;
    case 'readyTreats': return `ready ${count(n)} of your Treats`;
    case 'sprout': return `Sprout ${n}`;
    case 'summon': {
      const t = TOKENS[String(v)];
      if (!t) return `summon ${String(v)}`;
      if (t.brief) return `summon ${article(t.name)} ${t.name}`;
      const kws = t.keywords?.length ? ` with ${t.keywords.join(' and ')}` : '';
      return `summon ${article(String(t.power))} ${t.power}/${t.health} ${t.name}${kws}`;
    }
    case 'cancelAttack': return 'cancel an attack';
    case 'fight': return `${on} and ${noun(a.target2, self)} deal damage equal to their Power to each other`;
    default: return name && PLUGIN_TEXTS[name] ? PLUGIN_TEXTS[name](v, on, self) : name ?? '';
  }
}

/** Clauses for a list of actions: the first names the target, later ones call it "it". */
function actClauses(acts: Act[], a: Ability, self: string, subjectless: boolean, named = false): string[] {
  const on = noun(a.target, self);
  const singular = typeof a.target === 'object' && 'unit' in a.target;
  let mentioned = named;
  // The same token twice reads as one: "summon two Ants".
  const merged: Act[] = [];
  const times: number[] = [];
  for (const act of acts) {
    const last = merged[merged.length - 1];
    if (last && 'summon' in act && JSON.stringify(last) === JSON.stringify(act) && TOKENS[String(act.summon)]?.brief) times[times.length - 1]++;
    else { merged.push(act); times.push(1); }
  }
  return merged.map((act, i) => {
    if (times[i] > 1) { const t = TOKENS[String((act as { summon: string }).summon)]; return `summon ${count(times[i])} ${t.name}s`; }
    const needsTarget = !['draw', 'readyTreats', 'sprout', 'summon', 'cancelAttack'].includes(Object.keys(act)[0]);
    const target = mentioned && singular ? 'it' : on;
    const text = actClause(act, target, a, self, subjectless);
    if (needsTarget) mentioned = true;
    return text;
  });
}

const sentences = (clauses: string[]) => clauses.filter(Boolean).map((c) => `${cap(c)}.`).join(' ');

// ── Abilities ──────────────────────────────────────────────────────────────────────────────────────

/** The text of one ability. `self` is how the card calls itself (its name, or its pronoun once named). */
export function abilityText(a: Ability, card: CardDef): string {
  const name = card.name.split(',')[0];
  const self = card.pronoun ?? name;
  const note = a.note ? ` (${a.note})` : '';

  if (a.static) {
    const st = a.static;
    const g = st.grant;
    const grants = g ? [g.power && `+${g.power} Power`, g.health && `+${g.health} Health`, ...(g.keywords ?? [])].filter(Boolean).join(' and ') : '';
    const onlyKeywords = !!g && !g.power && !g.health;
    if (st.cantAttack) return `Can't attack${st.while ? ` unless ${clause(typeof st.while === 'object' && 'not' in st.while ? st.while.not : st.while)}` : ''}.${note}`;
    if (st.to === 'attached') return `Attached unit gets ${grants}.${note}`;
    if (st.to === 'self' || st.to === undefined) return `${st.while ? `While ${clause(st.while)}, ` : ''}${name} ${onlyKeywords ? 'has' : 'gets'} ${grants}.${note}`;
    return `${auraSubject(st.to)} ${onlyKeywords ? 'have' : 'get'} ${grants}.${note}`;
  }

  const label = ({ hello: 'Hello: ', goodbye: 'Goodbye: ', exhaust: 'Exhaust: ' } as Record<string, string>)[a.when ?? ''] ?? '';
  const lead =
    a.when === 'roundStart' ? 'At the start of each round, ' :
    a.when === 'damagedAndSurvives' ? `After ${name} survives damage, ` :
    a.when === 'defeatsInCombat' ? `${a.oncePerRound ? 'Once per round, after' : 'After'} ${name} defeats a unit in combat, ` :
    a.when === 'youHeal' ? `${a.oncePerRound ? 'Once per round, when' : 'When'} you heal 1 or more damage from a unit, ` : '';

  // A unit's own bonus under a label mechanic, on arrival: "Zest: gets +1 Power this round." (no "Hello:").
  const ownLabelBonus = a.when === 'hello' && a.target === 'self' && isLabel(a.if);
  let clauses = actClauses(a.do ?? [], a, self, ownLabelBonus);
  if (a.optional) clauses = clauses.map((c, i) => (i === 0 ? `you may ${c}` : c));

  let body: string;
  if (lead) body = lead + clauses.join('. ') + '.';
  else if (a.if !== undefined && !isLabel(a.if)) body = `If ${clause(a.if)}, ${clauses.join('. ')}.`;
  // A unit's own label bonus runs on from its label, lower case: "Zest: gets +1 Power this round."
  else body = ownLabelBonus ? clauses.map((c) => `${c}.`).join(' ') : sentences(clauses);

  if (a.instead) {
    const base = a.do ?? [];
    const extends_ = base.every((x, i) => JSON.stringify(x) === JSON.stringify(a.instead!.do[i]));
    let better: string;
    if (extends_) {
      // The better version adds to the first ("If it's yours, it gets +2 Power this round.").
      better = actClauses(a.instead.do.slice(base.length), a, self, false, true).join('. ');
    } else {
      const [k, v] = Object.entries(a.instead.do[0] ?? {})[0] ?? [];
      better = k === 'damage' ? `deal ${v} instead` : actClauses(a.instead.do, a, self, false).join('. ');
    }
    body += isLabel(a.instead.if) ? ` ${a.instead.if}: ${better}.` : ` If ${clause(a.instead.if)}, ${better}.`;
  }
  // A label mechanic joins a trigger's label: "Hello, Zest: …".
  if (isLabel(a.if)) return `${label && !ownLabelBonus ? `${label.slice(0, -2)}, ` : ''}${a.if}: ${body}${note}`;
  return `${label}${body}${note}`;
}

/** The text of a card face: keywords, then its abilities one per line, then its Grow Up. */
function faceText(keywords: string[] | undefined, abilities: Ability[] | undefined, card: CardDef, growUp?: HeroSide['growUp']): string {
  const lines = (abilities ?? []).map((a) => abilityText(a, card));
  const kw = (keywords ?? []).map((k) => `${k}.`).join(' ');
  if (kw) lines[0] = lines.length ? `${kw} ${lines[0]}` : kw;
  if (growUp) lines.push(`Grow Up: ${cap(clause(growUp.if))}.`);
  return lines.join('\n');
}

/** A card's rules text (for a Hero Cat, use heroTexts). */
export function suggestText(card: CardDef): string {
  return faceText(card.keywords, card.abilities, card);
}

/** A Hero Cat's two faces' texts. */
export function heroTexts(card: CardDef): { kitten: string; bigCat: string } {
  return {
    kitten: faceText(card.kitten?.keywords, card.kitten?.abilities, card, card.kitten?.growUp),
    bigCat: faceText(card.bigCat?.keywords, card.bigCat?.abilities, card),
  };
}

/** Every text a card shows, with where it goes: [label, written, generated]. Previews aren't playable: none. */
export function cardTexts(card: CardDef): [string, string, string][] {
  if (card.preview) return [];
  if (card.type === 'Hero Cat') {
    const g = heroTexts(card);
    return [['Kitten', card.kitten?.text ?? '', g.kitten], ['Big Cat', card.bigCat?.text ?? '', g.bigCat]];
  }
  return [['', card.text ?? '', suggestText(card)]];
}

/** The numbers a card's abilities use (damage, heal, draws, buffs…), which its written text must show. */
export function abilityNumbers(abilities: Ability[] = []): number[] {
  const nums = new Set<number>();
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'number' && !['index', 'max', 'add'].includes(key) && v > 1) nums.add(v);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const a of abilities) walk({ do: a.do, instead: a.instead?.do, grant: a.static?.grant });
  return [...nums];
}

/** Numbers the abilities use that the written text doesn't mention (as a digit or a word). */
export function missingNumbers(abilities: Ability[] | undefined, text: string): number[] {
  return abilityNumbers(abilities).filter((n) => !new RegExp(`(\\b|\\+)${n}\\b`).test(text) && !new RegExp(`\\b${WORDS[n]}\\b`, 'i').test(text));
}
