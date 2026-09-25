// Rules text from a card's abilities, in the house style ("Hello: Deal 1 damage to a unit."). check-set
// uses it two ways: to suggest text for a card that has none yet, and to check that the numbers a card's
// abilities use are the numbers its written text says, so the text can't drift from what the card does.

import type { Ability, CardDef, Condition, TargetSel } from '../packages/engine/src/types';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => WORDS[n] ?? String(n);

function target(t: TargetSel | undefined, self: string): string {
  if (t === undefined) return '';
  if (t === 'self') return self;
  if (t === 'attack') return 'an attack';
  const f = typeof t === 'object' ? t.filter : undefined;
  const adj = f?.exhausted ? 'exhausted ' : f?.damaged ? 'damaged ' : '';
  if ('unit' in t) {
    if (t.unit === 'own') return t.other ? 'another unit you control' : `a ${adj}unit you control`;
    if (t.unit === 'enemy') return `an ${adj ? adj : ''}enemy unit`.replace('an exhausted', 'an exhausted').replace('an damaged', 'a damaged');
    return adj ? `${adj === 'exhausted ' ? 'an' : 'a'} ${adj}unit` : 'a unit';
  }
  if (t.each === 'own') return 'each unit you control';
  if (t.each === 'enemy') return 'each enemy unit';
  if (t.each === 'allOther') return 'each other unit';
  return 'each unit';
}

function condition(c: Condition | undefined): string {
  if (c === undefined) return '';
  if (typeof c === 'string') return c === 'targetIsYours' ? "it's yours" : `you're ${c}`;
  if ('not' in c) return `you're not ${typeof c.not === 'string' ? c.not : 'that'}`;
  if ('treats' in c) return `you have ${c.treats.atLeast} or more Treats`;
  if ('lives' in c) return `you have ${c.lives.atMost} or fewer Lives`;
  if ('opponentLives' in c) return `your opponent has ${c.opponentLives.atMost} or fewer Lives`;
  if ('yardHas' in c) return `you control a ${c.yardHas.keyword}`;
  if ('unitsInComposts' in c) return `${c.unitsInComposts.atLeast} or more Cats and Critters are in the Composts`;
  if ('controlUnits' in c) return `you control ${c.controlUnits.atLeast} or more units`;
  if ('compost' in c) return `you have ${c.compost.atLeast} or more cards in your Compost`;
  if ('unitHasCounter' in c) return `a unit you control has +${c.unitHasCounter.atLeast} ${c.unitHasCounter.name}`;
  if ('playedThisRound' in c) return `you've played ${c.playedThisRound.atLeast - 1} other card(s) this round`;
  return '';
}

function acts(a: Ability, self: string): string {
  const on = target(a.target, self);
  const parts = (a.do ?? []).map((act) => {
    const [name, v] = Object.entries(act)[0] ?? [];
    const n = v as number;
    switch (name) {
      case 'damage': return `deal ${n} damage to ${on}`;
      case 'heal': return `heal ${n} from ${on}`;
      case 'buff': {
        const b = v as { power?: number; keywords?: string[] };
        const gets = [b.power && `+${b.power} Power`, ...(b.keywords ?? [])].filter(Boolean).join(' and ');
        return `${on || 'it'} gets ${gets} this round`;
      }
      case 'counter': return `${on} gets a ${(v as { name: string }).name} counter`;
      case 'draw': return n === 1 ? 'draw a card' : `draw ${n} cards`;
      case 'exhaust': return `exhaust ${on}`;
      case 'ready': return `ready ${on}`;
      case 'readyTreats': return `ready ${count(n)} of your Treats`;
      case 'sprout': return `Sprout ${n}`;
      case 'summon': return `summon a ${String(v)}`;
      case 'cancelAttack': return 'cancel an attack';
      case 'fight': return `${on} and ${target(a.target2, self)} deal damage equal to their Power to each other`;
      default: return name ?? '';
    }
  });
  return parts.join('. ');
}

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) + (s.endsWith('.') ? '' : '.') : '');

/** Text for one ability, as the house style writes it. */
export function abilityText(a: Ability, card: CardDef): string {
  const self = card.name.split(',')[0];
  if (a.static) {
    const g = a.static.grant;
    const grants = g ? [g.power && `+${g.power} Power`, g.health && `+${g.health} Health`, ...(g.keywords ?? [])].filter(Boolean).join(' and ') : '';
    if (a.static.cantAttack) return sentence(`can't attack${a.static.while ? ` unless ${condition(a.static.while).replace("you're not", "you're")}` : ''}`);
    if (a.static.to === 'attached') return sentence(`attached unit gets ${grants}`);
    if (a.static.to === 'self' || !a.static.to) return sentence(`while ${condition(a.static.while)}, ${self} has ${grants}`);
    return sentence(`${target({ each: a.static.to.each, filter: a.static.to.filter } as TargetSel, self).replace('each', 'your').replace(/unit(s)? you control/, 'units')} get ${grants}`);
  }
  let body = acts(a, self);
  if (a.optional) body = `you may ${body}`;
  const mechanicIf = typeof a.if === 'string' && a.if !== 'targetIsYours';
  if (a.if !== undefined && !mechanicIf) body = `if ${condition(a.if)}, ${body}`;
  if (a.instead) {
    const better = acts({ ...a, do: a.instead.do }, self).replace(/^deal (\d+) damage to .*/, 'deal $1 instead');
    body += `. ${typeof a.instead.if === 'string' ? `${a.instead.if}: ${better}` : `If ${condition(a.instead.if)}, ${better}`}`;
  }
  const label = ({ hello: 'Hello: ', goodbye: 'Goodbye: ', exhaust: 'Exhaust: ' } as Record<string, string>)[a.when ?? ''] ?? '';
  const lead =
    a.when === 'roundStart' ? 'At the start of each round, ' :
    a.when === 'damagedAndSurvives' ? `After ${self} survives damage, ` :
    a.when === 'defeatsInCombat' ? `${a.oncePerRound ? 'Once per round, a' : 'A'}fter ${self} defeats a unit in combat, ` :
    a.when === 'youHeal' ? `${a.oncePerRound ? 'Once per round, w' : 'W'}hen you heal 1 or more damage from a unit, ` : '';
  const zest = mechanicIf ? `${a.if}: ` : '';
  return `${label}${zest}${lead ? lead + body : sentence(body).replace(/\.$/, '')}.`.replace(/\.\./g, '.');
}

/** A suggested rules text for a card: its keywords, then each ability. */
export function suggestText(card: CardDef): string {
  const keywords = (card.keywords ?? []).map((k) => `${k}.`);
  const lines = (card.abilities ?? []).map((a) => abilityText(a, card));
  return [...keywords, ...lines].join(' ').trim();
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
