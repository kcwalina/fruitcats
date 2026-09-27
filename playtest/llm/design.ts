// What an LLM needs to design decks, and the loop that gets legal ones out of it: the card pool and rules as
// text, a JSON reply, the deck builder's own rule check, and one round of repairs with the problems sent back.
// The deck hunt (decks meant to break the game) and the deck builder (a deck for a goal) both use it.

import { CARDS, DECKS, DECK_RULES, FAMILIES, STRATEGY_PRIMER, TERMS, cardName, isNeutralFamily, rulesPrimer, type DeckList } from '../lib/engine';
import { assembleDeck, findCard, playableHeroes, type Assembled } from '../balance/decks';
import { mulberry, seedFrom } from '../lib/rng';
import { addUsage, noUsage, type ChatMessage, type Provider, type Usage } from './providers';

// The model reads the game's rules primer, which uses the players' words (packages/engine/src/terms.json): so does
// everything here. The code's own names ('Hero Cat', 'Critter', kitten, bigCat) never reach a prompt.
const TYPE = TERMS.types as Record<string, string>;
const TYPES = TERMS.typesPlural as Record<string, string>;
const familyWord = (f: string) => (TERMS.families as Record<string, string>)[f] ?? f;
/** Families any deck may use (Wildfolk in the Starter Box), by their players' names. */
const neutralFamilies = () => Object.keys(FAMILIES).filter((f) => isNeutralFamily(f)).map(familyWord);

export function cardPoolText(): string {
  const heroes = playableHeroes().map((id) => {
    const h = CARDS[id];
    return `${id} ${h.name} (${TYPE['Hero Cat']}, ${familyWord(h.family)}). ${h.kitten?.text.replace(/\n/g, ' ')} ${TERMS.grewUp} (Power ${h.bigCat?.power ?? 0}): ${h.bigCat?.text.replace(/\n/g, ' ')}`;
  });
  const cards = Object.values(CARDS)
    .filter((c) => c.type !== 'Hero Cat' && !c.preview && !c.token)
    .map((c) => `${c.id} ${c.name} [${familyWord(c.family)}] ${TYPE[c.type] ?? c.type}, cost ${c.cost ?? 0}${c.power !== undefined ? `, ${c.power}/${c.health}` : ''}${c.text ? `: ${c.text}` : ''}`);
  return `${TYPES['Hero Cat'].toUpperCase()}\n${heroes.join('\n')}\n\nCARDS\n${cards.join('\n')}`;
}

export const RULES = ((): string => {
  const hero = TYPE['Hero Cat'], fabled = TYPE.Cat, neutral = neutralFamilies();
  return `DECKBUILDING RULES: exactly ${DECK_RULES.size} cards plus a ${hero} (the ${hero} is not one of the ${DECK_RULES.size}). ` +
    `Cards from the ${hero}'s family${neutral.length ? ` and ${neutral.join(' and ')} cards` : ''}, plus at most ONE other family. ` +
    `At most ${DECK_RULES.copies} copies of a card; ${fabled} cards are one of a kind (1 copy) and at most ${DECK_RULES.maxCats} per deck.`;
})();

export const deckText = (d: DeckList): string => `${d.name} (${cardName(d.hero)}, ${d.hero}): ${Object.entries(d.cards).map(([id, q]) => `${q} ${id}`).join(', ')}`;

const KINDS = ['Critter', 'Cat', 'Trick', 'Toy'];
function shapeOf(d: DeckList): { types: Record<string, number>; curve: number[]; families: Set<string> } {
  const types: Record<string, number> = {};
  const curve = [0, 0, 0, 0, 0, 0];
  const families = new Set<string>();
  for (const [id, q] of Object.entries(d.cards)) {
    const c = CARDS[id];
    if (!c) continue;
    types[c.type] = (types[c.type] ?? 0) + q;
    curve[Math.min(Math.max(c.cost ?? 0, 1), 6) - 1] += q;
    families.add(familyWord(c.family));
  }
  return { types, curve, families };
}

/** A deck's shape in one line: card types, the cost curve and its families. What a deckbuilder checks first. */
export function deckShape(d: DeckList): string {
  const { types, curve, families } = shapeOf(d);
  const t = KINDS.map((k) => `${types[k] ?? 0} ${TYPES[k]}`).join(', ');
  return `${t}; by cost ${curve.map((n, i) => `${i === 5 ? '6+' : i + 1}:${n}`).join(' ')}; families ${[...families].join(' + ')}`;
}

export const starterText = (): string => Object.values(DECKS).map((d) => `${deckText(d)}\n  shape: ${deckShape(d)}`).join('\n');

/**
 * How the game plays, so decks are built for this game and not a generic one: the rules primer the LLM players get,
 * the strategy primer, and what the starter decks' shapes have in common (from the starter decks being played, so it
 * follows the sets in play).
 */
export function gameText(): string {
  const shapes = Object.values(DECKS).map(shapeOf);
  const range = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? `${xs[0]}` : `${Math.min(...xs)}-${Math.max(...xs)}`);
  const types = KINDS.filter((k) => shapes.some((s) => s.types[k])).map((k) => `${range(shapes.map((s) => s.types[k] ?? 0))} ${TYPES[k]}`).join(', ');
  const curve = [0, 1, 2].map((i) => `${range(shapes.map((s) => s.curve[i]))} costing ${i + 1}`).join(', ');
  const top = range(shapes.map((s) => s.curve.slice(3).reduce((a, b) => a + b, 0)));
  return `${rulesPrimer()}\n\n${STRATEGY_PRIMER}\n\nDECK SHAPE: the starter decks each run ${types}, with ${curve} and ${top} costing 4 and up. ` +
    `${TYPES.Critter} win games: a deck with too few cheap ones falls behind on the board, and a deck full of expensive cards is stuck with a hand it cannot play. ` +
    'Depart from this shape only on purpose, and say why in the idea.';
}

export const JSON_FORMAT = 'Reply with only a JSON array: [{"name": "short name", "idea": "one or two sentences: how the deck wins", ' +
  `"hero": "${TYPE['Hero Cat']} name or id", "cards": {"card name or id": copies, ...}}]. Aim for 50 cards (the ${TYPE['Hero Cat']} is not one of them); ` +
  'a few too many or too few is fixed for you, but choose the cards yourself: that is the deck.';

export interface DesignedDeck { name: string; idea: string; deck: DeckList }

interface Raw { name?: string; idea?: string; hero?: string; cards?: Record<string, number> }

function parseDecks(text: string): Raw[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const list = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(list) ? list.filter((d) => d && typeof d === 'object') : [];
  } catch { return []; }
}

/** Below this many of its own cards (of 50), a deck is more the filler's than the LLM's, and is rejected. */
export const MIN_CHOSEN = 30;

export interface DesignOptions {
  /** Prefix for deck names ('hunt: '). */
  prefix?: string;
  /** Families the goal names: a deck must use one of them (as its Hero Cat's family or its partner). */
  families?: string[];
}

/** The families a goal names ("an aggressive Pepper deck" names Pepper). */
export function familiesIn(goal: string): string[] {
  const all = new Set(Object.values(CARDS).map((c) => c.family));
  return [...all].filter((f) => new RegExp(`\b${f}\b`, 'i').test(goal));
}

function assess(r: Raw, i: number, o: DesignOptions): { raw: Raw; name: string; made: Assembled | null; problem: string } {
  const name = `${o.prefix ?? ''}${String(r.name ?? `idea ${i + 1}`).slice(0, 40)}`;
  if (!r.hero || !findCard(String(r.hero), true)) return { raw: r, name, made: null, problem: `"${r.hero ?? ''}" is not a ${TYPE['Hero Cat']} you can use: pick one from the ${TYPES['Hero Cat'].toUpperCase()} list.` };
  const made = assembleDeck(name, String(r.hero), r.cards ?? {}, mulberry(seedFrom(name)));
  if (!made) return { raw: r, name, made, problem: 'it could not be made into a legal deck.' };
  if (made.chosen < MIN_CHOSEN) {
    return { raw: r, name, made, problem: `only ${made.chosen} of its cards could be used (${made.notes.join('; ')}). Use card names or ids from the CARDS list, from the ${TYPE['Hero Cat']}'s family${neutralFamilies().length ? `, ${neutralFamilies().join(', ')}` : ''} and at most one other family.` };
  }
  if (o.families?.length) {
    const used = new Set([CARDS[made.deck.hero].family, ...Object.keys(made.deck.cards).map((id) => CARDS[id].family)]);
    if (!o.families.some((f) => used.has(f))) return { raw: r, name, made, problem: `the goal asks for ${o.families.join(' or ')}, and this deck has no ${o.families.join(' or ')} cards.` };
  }
  return { raw: r, name, made, problem: '' };
}

/**
 * Asks for decks with the conversation so far (the last message says what to design) and makes each a legal
 * deck with assembleDeck. A deck with no usable Hero Cat, too few usable cards, or none of the families the
 * goal names goes back to the LLM once with the reason. `messages` keeps the whole exchange, so a caller can
 * ask for better versions afterwards.
 */
export async function designDecks(provider: Provider, messages: ChatMessage[], o: DesignOptions = {}): Promise<{ decks: DesignedDeck[]; rejected: string[]; usage: Usage }> {
  let usage = noUsage();
  const first = await provider.chat(messages, 8000);
  usage = addUsage(usage, first.usage);
  messages.push({ role: 'assistant', content: first.text });
  let raw = parseDecks(first.text);
  let checked = raw.map((r, i) => assess(r, i, o));
  const broken = checked.filter((c) => c.problem);
  if (broken.length || !raw.length) {
    messages.push({
      role: 'user',
      content: raw.length
        ? `These decks can't be used yet:\n${broken.map((b) => `- ${b.name}: ${b.problem}`).join('\n')}\nReply with only the corrected JSON array of all ${raw.length} decks.`
        : `That was not a JSON array of decks. ${JSON_FORMAT}`,
    });
    const second = await provider.chat(messages, 8000);
    usage = addUsage(usage, second.usage);
    messages.push({ role: 'assistant', content: second.text });
    const fixed = parseDecks(second.text);
    if (fixed.length) { raw = fixed; checked = raw.map((r, i) => assess(r, i, o)); }
  }
  const seen = new Set<string>();
  const good = checked.filter((c) => !c.problem && c.made && !seen.has(c.name) && seen.add(c.name));
  return {
    decks: good.map((c) => ({
      name: c.name,
      idea: `${c.raw.idea ?? ''}${c.made!.notes.length ? ` (Adjusted: ${c.made!.notes.join('; ')}.)` : ''}`.trim(),
      deck: c.made!.deck,
    })),
    rejected: checked.filter((c) => c.problem).map((c) => `${c.name}: ${c.problem}`),
    usage,
  };
}
