// deck-hunt [--provider pc2024] [--model M] [--ideas 6] [--scale 1]
//
// The LLM is good at ideas and the bots are good at numbers: the LLM designs decks meant to break the game
// (from the whole card pool, under the real deckbuilding rules), each deck is checked with the deck
// builder's own rules, and the bots play every legal one against the starters. A deck that beats them is
// written up with its list, the LLM's idea behind it, and its win rate.

import { arg, numArg } from '../lib/args';
import { CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, cardName, deckProblems, type DeckList } from '../lib/engine';
import { finishRun, newRun, pct, reportProgress, type Problem, type RunSummary } from '../lib/runs';
import { runBalance } from '../balance/gauntlet';
import { playableHeroes } from '../balance/decks';
import { addUsage, getProvider, noUsage, type ChatMessage, type Provider } from './providers';

function cardPoolText(): string {
  const heroes = playableHeroes().map((id) => {
    const h = CARDS[id];
    return `${id} ${h.name} (Hero Cat, ${h.family}). Kitten: ${h.kitten?.text.replace(/\n/g, ' ')} Big Cat (Power ${h.bigCat?.power ?? 0}): ${h.bigCat?.text.replace(/\n/g, ' ')}`;
  });
  const cards = Object.values(CARDS)
    .filter((c) => c.type !== 'Hero Cat' && !c.preview)
    .map((c) => `${c.id} ${c.name} [${c.family}] ${c.type}, cost ${c.cost ?? 0}${c.power !== undefined ? `, ${c.power}/${c.health}` : ''}${c.text ? `: ${c.text}` : ''}`);
  return `HERO CATS\n${heroes.join('\n')}\n\nCARDS\n${cards.join('\n')}`;
}

const RULES = `DECKBUILDING RULES: exactly ${DECK_RULES.size} cards plus a Hero Cat (the Hero Cat is not one of the ${DECK_RULES.size}). ` +
  `Cards from the Hero Cat's family and ${NEUTRAL_FAMILY} cards, plus at most ONE other family. At most ${DECK_RULES.copies} copies of a card; ` +
  `Cats (type Cat) are one of a kind (1 copy) and at most ${DECK_RULES.maxCats} per deck.`;

function starterText(): string {
  return Object.values(DECKS).map((d) => `${d.name} (${cardName(d.hero)}): ${Object.entries(d.cards).map(([id, q]) => `${q} ${id}`).join(', ')}`).join('\n');
}

interface Idea { name: string; idea: string; deck: DeckList }

function parseDecks(text: string): { name?: string; idea?: string; hero?: string; cards?: Record<string, number> }[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return []; }
}

export async function huntDecks(provider: Provider, ideas: number): Promise<{ ideas: Idea[]; rejected: string[]; usage: ReturnType<typeof noUsage> }> {
  let usage = noUsage();
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a world-class competitive card game deckbuilder and a game designer\'s playtester. Your job is to find decks that break the game.' },
    {
      role: 'user',
      content: `${cardPoolText()}\n\n${RULES}\n\nTHE STARTER DECKS (what a new deck has to beat)\n${starterText()}\n\n` +
        `Design ${ideas} different decks, each built around a specific idea for beating the starter decks: a combo, an overlooked card, a family pairing, a curve. ` +
        `Reply with only a JSON array: [{"name": "short name", "idea": "one sentence", "hero": "SB1-H..", "cards": {"SB1-..": 3, ...}}]. Use card ids exactly as listed.`,
    },
  ];
  const first = await provider.chat(messages, 6000);
  usage = addUsage(usage, first.usage);
  let raw = parseDecks(first.text);
  const check = (list: typeof raw) => list.map((d, i) => {
    const deck: DeckList = { name: `hunt: ${d.name ?? `idea ${i + 1}`}`, hero: d.hero ?? '', cards: d.cards ?? {} };
    return { d, deck, problems: deckProblems(deck) };
  });
  let checked = check(raw);
  // One round of repairs: send the rule problems back.
  const broken = checked.filter((c) => c.problems.length);
  if (broken.length) {
    messages.push({ role: 'assistant', content: first.text }, {
      role: 'user',
      content: `These decks break the rules:\n${broken.map((b) => `- ${b.d.name}: ${b.problems.join(' ')}`).join('\n')}\nReply with only the corrected JSON array of all ${raw.length} decks.`,
    });
    const second = await provider.chat(messages, 6000);
    usage = addUsage(usage, second.usage);
    const fixed = parseDecks(second.text);
    if (fixed.length) { raw = fixed; checked = check(raw); }
  }
  const seen = new Set<string>();
  const good = checked.filter((c) => !c.problems.length && !seen.has(c.deck.name) && seen.add(c.deck.name));
  return {
    ideas: good.map((c) => ({ name: c.deck.name, idea: c.d.idea ?? '', deck: c.deck })),
    rejected: checked.filter((c) => c.problems.length).map((c) => `${c.d.name}: ${c.problems[0]}`),
    usage,
  };
}

export async function runDeckHunt(provider: Provider, ideas: number, scale: number): Promise<RunSummary> {
  const run = newRun('deck-hunt');
  reportProgress(run, 'deck-hunt', 'designing decks', 0, 2);
  const hunt = await huntDecks(provider, ideas);
  reportProgress(run, 'deck-hunt', 'bot games', 1, 2);
  const balance = hunt.ideas.length ? await runBalance({ quick: true, extraDecks: hunt.ideas.map((i) => i.deck), scale, quiet: true }) : null;
  const rates = new Map(((balance?.details.extraDecks ?? []) as { name: string; vsStarters: number }[]).map((d) => [d.name, d.vsStarters]));
  const problems: Problem[] = [];
  const decks = hunt.ideas.map((i) => ({ ...i, vsStarters: rates.get(i.name) ?? 0 })).sort((a, b) => b.vsStarters - a.vsStarters);
  for (const d of decks.filter((d) => d.vsStarters > 0.6)) problems.push({ level: 'warn', text: `LLM-designed deck "${d.name}" beats the starters ${pct(d.vsStarters)} of the time: ${d.idea}` });
  const md = [
    `# Deck hunt: ${provider.name} ${provider.model}`, '',
    `${hunt.ideas.length} legal deck(s) of ${hunt.ideas.length + hunt.rejected.length}; each played the starters in bot games.`, '',
    ...decks.flatMap((d) => [`## ${d.name}: ${pct(d.vsStarters)} against the starters`, '', d.idea, '',
      `${cardName(d.deck.hero)}: ${Object.entries(d.deck.cards).map(([id, q]) => `${q}× ${cardName(id)}`).join(', ')}`, '']),
    ...(hunt.rejected.length ? ['## Rejected (broke the deckbuilding rules)', '', ...hunt.rejected.map((r) => `- ${r}`), ''] : []),
  ];
  return finishRun(run, 'deck-hunt', balance?.games ?? 0, problems, {
    provider: provider.name, model: provider.model, usage: hunt.usage, costUsd: provider.cost(hunt.usage),
    decks: decks.map((d) => ({ name: d.name, idea: d.idea, hero: d.deck.hero, vsStarters: d.vsStarters, cards: d.deck.cards })),
    rejected: hunt.rejected, balanceRun: balance?.id ?? null,
  }, md.join('\n'));
}

export async function deckHuntCommand(): Promise<number> {
  const summary = await runDeckHunt(getProvider(arg('provider') ?? 'pc2024', arg('model')), numArg('ideas') ?? 6, numArg('scale') ?? 1);
  console.log(`${summary.result.toUpperCase()}: ${(summary.details.decks as unknown[]).length} deck(s) tested. Report: ${summary.id}`);
  for (const p of summary.problems) console.log(`  ${p.level}: ${p.text}`);
  return 0;
}
