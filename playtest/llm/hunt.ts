// deck-hunt [--provider pc2024] [--model M] [--ideas 6] [--scale 1]
//
// The LLM is good at ideas and the bots are good at numbers: the LLM designs decks meant to break the game
// (from the whole card pool, under the real deckbuilding rules), each deck is checked with the deck
// builder's own rules, and the bots play every legal one against the starters. A deck that beats them is
// written up with its list, the LLM's idea behind it, and its win rate.

import { arg, numArg } from '../lib/args';
import { cardName, deckCode } from '../lib/engine';
import { finishRun, newRun, pct, reportProgress, type Problem, type RunSummary } from '../lib/runs';
import { runBalance } from '../balance/gauntlet';
import { cardPoolText, designDecks, JSON_FORMAT, RULES, starterText, type DesignedDeck } from './design';
import { getProvider, type ChatMessage, type Provider, type Usage } from './providers';

export async function huntDecks(provider: Provider, ideas: number): Promise<{ ideas: DesignedDeck[]; rejected: string[]; usage: Usage }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a world-class competitive card game deckbuilder and a game designer\'s playtester. Your job is to find decks that break the game.' },
    {
      role: 'user',
      content: `${cardPoolText()}\n\n${RULES}\n\nTHE STARTER DECKS (what a new deck has to beat)\n${starterText()}\n\n` +
        `Design ${ideas} different decks, each built around a specific idea for beating the starter decks: a combo, an overlooked card, a family pairing, a curve. ${JSON_FORMAT}`,
    },
  ];
  const got = await designDecks(provider, messages, 'hunt: ');
  return { ideas: got.decks, rejected: got.rejected, usage: got.usage };
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
      `${cardName(d.deck.hero)}: ${Object.entries(d.deck.cards).map(([id, q]) => `${q}× ${cardName(id)}`).join(', ')}`, '',
      `Deck code: \`${deckCode(d.deck)}\``, '']),
    ...(hunt.rejected.length ? ['## Rejected (broke the deckbuilding rules)', '', ...hunt.rejected.map((r) => `- ${r}`), ''] : []),
  ];
  return finishRun(run, 'deck-hunt', balance?.games ?? 0, problems, {
    provider: provider.name, model: provider.model, usage: hunt.usage, costUsd: provider.cost(hunt.usage),
    decks: decks.map((d) => ({ name: d.name, idea: d.idea, hero: d.deck.hero, vsStarters: d.vsStarters, cards: d.deck.cards, code: deckCode(d.deck) })),
    rejected: hunt.rejected, balanceRun: balance?.id ?? null,
  }, md.join('\n'));
}

export async function deckHuntCommand(): Promise<number> {
  const summary = await runDeckHunt(getProvider(arg('provider') ?? 'pc2024', arg('model')), numArg('ideas') ?? 6, numArg('scale') ?? 1);
  console.log(`${summary.result.toUpperCase()}: ${(summary.details.decks as unknown[]).length} deck(s) tested. Report: ${summary.id}`);
  for (const p of summary.problems) console.log(`  ${p.level}: ${p.text}`);
  return 0;
}
