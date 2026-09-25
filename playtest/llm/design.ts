// What an LLM needs to design decks, and the loop that gets legal ones out of it: the card pool and rules as
// text, a JSON reply, the deck builder's own rule check, and one round of repairs with the problems sent back.
// The deck hunt (decks meant to break the game) and the deck builder (a deck for a goal) both use it.

import { CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, cardName, deckProblems, type DeckList } from '../lib/engine';
import { fitToSize, playableHeroes } from '../balance/decks';
import { mulberry, seedFrom } from '../lib/rng';
import { addUsage, noUsage, type ChatMessage, type Provider, type Usage } from './providers';

export function cardPoolText(): string {
  const heroes = playableHeroes().map((id) => {
    const h = CARDS[id];
    return `${id} ${h.name} (Hero Cat, ${h.family}). Kitten: ${h.kitten?.text.replace(/\n/g, ' ')} Big Cat (Power ${h.bigCat?.power ?? 0}): ${h.bigCat?.text.replace(/\n/g, ' ')}`;
  });
  const cards = Object.values(CARDS)
    .filter((c) => c.type !== 'Hero Cat' && !c.preview)
    .map((c) => `${c.id} ${c.name} [${c.family}] ${c.type}, cost ${c.cost ?? 0}${c.power !== undefined ? `, ${c.power}/${c.health}` : ''}${c.text ? `: ${c.text}` : ''}`);
  return `HERO CATS\n${heroes.join('\n')}\n\nCARDS\n${cards.join('\n')}`;
}

export const RULES = `DECKBUILDING RULES: exactly ${DECK_RULES.size} cards plus a Hero Cat (the Hero Cat is not one of the ${DECK_RULES.size}). ` +
  `Cards from the Hero Cat's family and ${NEUTRAL_FAMILY} cards, plus at most ONE other family. At most ${DECK_RULES.copies} copies of a card; ` +
  `Cats (type Cat) are one of a kind (1 copy) and at most ${DECK_RULES.maxCats} per deck.`;

export const deckText = (d: DeckList): string => `${d.name} (${cardName(d.hero)}, ${d.hero}): ${Object.entries(d.cards).map(([id, q]) => `${q} ${id}`).join(', ')}`;

export const starterText = (): string => Object.values(DECKS).map(deckText).join('\n');

export const JSON_FORMAT = 'Reply with only a JSON array: [{"name": "short name", "idea": "one sentence", "hero": "SB1-H..", "cards": {"SB1-..": 3, ...}}]. Use card ids exactly as listed.';

export interface DesignedDeck { name: string; idea: string; deck: DeckList }

function parseDecks(text: string): { name?: string; idea?: string; hero?: string; cards?: Record<string, number> }[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const list = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/**
 * Asks for decks with the conversation so far (the last message says what to design), checks each with the
 * deck builder's rules and sends the problems back once. `messages` keeps the whole exchange, so a caller can
 * ask for better versions afterwards. Deck names get `prefix`.
 */
export async function designDecks(provider: Provider, messages: ChatMessage[], prefix = ''): Promise<{ decks: DesignedDeck[]; rejected: string[]; usage: Usage }> {
  let usage = noUsage();
  const first = await provider.chat(messages, 6000);
  usage = addUsage(usage, first.usage);
  messages.push({ role: 'assistant', content: first.text });
  let raw = parseDecks(first.text);
  const check = (list: typeof raw) => list.map((d, i) => {
    const deck: DeckList = { name: `${prefix}${(d.name ?? `idea ${i + 1}`).slice(0, 40)}`, hero: d.hero ?? '', cards: d.cards ?? {} };
    return { d, deck, problems: deckProblems(deck) };
  });
  let checked = check(raw);
  const broken = checked.filter((c) => c.problems.length);
  if (broken.length || !raw.length) {
    messages.push({
      role: 'user',
      content: raw.length
        ? `These decks break the rules:\n${broken.map((b) => `- ${b.d.name}: ${b.problems.join(' ')}`).join('\n')}\nReply with only the corrected JSON array of all ${raw.length} decks.`
        : `That was not a JSON array of decks. ${JSON_FORMAT}`,
    });
    const second = await provider.chat(messages, 6000);
    usage = addUsage(usage, second.usage);
    messages.push({ role: 'assistant', content: second.text });
    const fixed = parseDecks(second.text);
    if (fixed.length) { raw = fixed; checked = check(raw); }
  }
  // Still the wrong size after the repair (models miscount to 50): trim or top up by rule, and say so.
  for (const c of checked.filter((x) => x.problems.length)) {
    const fitted = fitToSize(c.deck, mulberry(seedFrom(c.deck.name)));
    if (!fitted) continue;
    c.deck = fitted.deck;
    c.problems = [];
    c.d = { ...c.d, idea: `${c.d.idea ?? ''} (${fitted.changed} card${fitted.changed === 1 ? '' : 's'} adjusted to make 50.)`.trim() };
  }
  const seen = new Set<string>();
  const good = checked.filter((c) => !c.problems.length && !seen.has(c.deck.name) && seen.add(c.deck.name));
  return {
    decks: good.map((c) => ({ name: c.deck.name, idea: c.d.idea ?? '', deck: c.deck })),
    rejected: checked.filter((c) => c.problems.length).map((c) => `${c.d.name}: ${c.problems[0]}`),
    usage,
  };
}
