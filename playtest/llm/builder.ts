// deck-build --goal <words…> [--hero SB1-H03] [--vs DECK[,DECK…]] [--candidates 3] [--rounds 2] [--games 40]
//            [--provider pc2024] [--model M] [--save] [--key KEY]
//
// An LLM builds a deck for a goal: "an aggressive Pepper deck", "beat Orchard Guard", "a fun deck for a
// beginner". It designs a few candidates under the real deckbuilding rules (checked with the deck builder's
// own deckProblems), the bots play each against the opponents (`--vs`, the starters by default), the LLM sees
// the numbers and builds better versions, and at the end it picks the one that fits the goal best (not always
// the strongest: a beginner's deck should be simple). `--save` puts the pick in the deck library, from a
// checkout; a run on PC2024 reports it with its deck code, and `npm run decks -- import` brings it home.

import { arg, flag, numArg, textArg } from '../lib/args';
import { CARDS, DECKS, cardName, deckCode, type DeckList } from '../lib/engine';
import { runJobs } from '../lib/pool';
import { seedFrom } from '../lib/rng';
import { finishRun, newRun, pct, reportProgress, type Problem, type RunSummary } from '../lib/runs';
import type { MatchJob } from '../balance/match';
import { canSaveLibrary, loadDecks, saveToLibrary } from '../decks/library';
import { cardPoolText, deckText, designDecks, JSON_FORMAT, RULES, starterText, type DesignedDeck } from './design';
import { addUsage, getProvider, noUsage, type ChatMessage, type Provider, type Usage } from './providers';

export interface BuildOptions {
  provider: Provider;
  goal: string;
  hero?: string;
  opponents: DeckList[];
  candidates: number;
  rounds: number;
  /** Bot games against each opponent, for each candidate. */
  games: number;
  onProgress?: (phase: string, done: number, total: number) => void;
}

export interface Tried extends DesignedDeck {
  round: number;
  winRate: number;
  vs: Record<string, number>;
  rounds: number;
}

export interface BuildResult {
  tried: Tried[];
  pick: Tried | null;
  why: string;
  rejected: string[];
  usage: Usage;
  games: number;
}

/** Bot games: every candidate against every opponent, seats alternating; a draw counts half. */
export async function scoreDecks(decks: DesignedDeck[], opponents: DeckList[], games: number, seedTag: string): Promise<{ winRate: number; vs: Record<string, number>; rounds: number }[]> {
  const jobs: MatchJob[] = decks.flatMap((d) => opponents.map((o) => ({
    a: { key: `me:${d.name}`, deck: d.deck }, b: { key: `them:${o.name}`, deck: o }, seed: seedFrom(`${seedTag}:${d.name}:${o.name}`), from: 0, to: games,
  })));
  const records = await runJobs(jobs);
  return decks.map((d, i) => {
    const vs: Record<string, number> = {};
    let score = 0, n = 0, rounds = 0;
    opponents.forEach((o, j) => {
      const recs = records[i * opponents.length + j];
      const s = recs.reduce((t, r) => t + (r.winner === 'draw' ? 0.5 : r.seats[r.winner] === `me:${d.name}` ? 1 : 0), 0);
      vs[o.name] = recs.length ? s / recs.length : 0;
      score += s; n += recs.length; rounds += recs.reduce((t, r) => t + r.rounds, 0);
    });
    return { winRate: n ? score / n : 0, vs, rounds: n ? rounds / n : 0 };
  });
}

const resultsText = (tried: Tried[]) => tried.map((t) =>
  `- ${t.name} (round ${t.round}): ${pct(t.winRate)} overall (${Object.entries(t.vs).map(([k, v]) => `${pct(v)} vs ${k}`).join(', ')}), games last ${t.rounds.toFixed(1)} rounds on average`).join('\n');

export async function buildDeck(o: BuildOptions): Promise<BuildResult> {
  const heroLine = o.hero ? `The deck's Hero Cat must be ${o.hero} (${cardName(o.hero)}).` : 'Choose the Hero Cat that suits the goal best.';
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an expert deckbuilder for a new card game, Fruitcats. You build decks that do exactly what they are asked to do, and you read playtest numbers honestly.' },
    {
      role: 'user',
      content: `${cardPoolText()}\n\n${RULES}\n\nTHE STARTER DECKS (for reference)\n${starterText()}\n\n` +
        `THE OPPONENTS the decks will be tested against in bot games\n${o.opponents.map(deckText).join('\n')}\n\n` +
        `THE GOAL: ${o.goal}\n${heroLine}\n\n` +
        `Build ${o.candidates} different decks for this goal, each taking a different approach. ${JSON_FORMAT}`,
    },
  ];
  let usage = noUsage();
  const tried: Tried[] = [];
  const rejected: string[] = [];
  let games = 0;
  const total = o.rounds + 1;
  for (let round = 1; round <= o.rounds; round++) {
    o.onProgress?.(`designing, round ${round}`, round - 1, total);
    if (round > 1) {
      messages.push({
        role: 'user',
        content: `Bot games against the opponents (the bot plays both sides at full strength):\n${resultsText(tried)}\n\n` +
          `Remember the goal: ${o.goal}\nBuild ${o.candidates} improved decks: keep what works, fix what the numbers say doesn't. Give each a new name. ${JSON_FORMAT}`,
      });
    }
    const got = await designDecks(o.provider, messages);
    usage = addUsage(usage, got.usage);
    rejected.push(...got.rejected);
    const fresh = got.decks.filter((d) => (!o.hero || d.deck.hero === o.hero) && !tried.some((t) => t.name === d.name));
    if (!fresh.length) continue;
    const scores = await scoreDecks(fresh, o.opponents, o.games, `build:${o.goal}:${round}`);
    games += fresh.length * o.opponents.length * o.games;
    fresh.forEach((d, i) => tried.push({ ...d, round, ...scores[i] }));
  }
  if (!tried.length) return { tried, pick: null, why: 'No legal deck was built.', rejected, usage, games };

  // The pick is the LLM's: the strongest deck isn't always the one that fits the goal.
  o.onProgress?.('choosing', o.rounds, total);
  messages.push({
    role: 'user',
    content: `All the decks you built, with their bot results:\n${resultsText(tried)}\n\nWhich one fits the goal best? The goal: ${o.goal}\n` +
      'Reply with only JSON: {"pick": "exact deck name", "why": "one or two sentences"}',
  });
  const choice = await o.provider.chat(messages, 2000);
  usage = addUsage(usage, choice.usage);
  let pick: Tried | undefined, why = '';
  try {
    const j = JSON.parse(choice.text.slice(choice.text.indexOf('{'), choice.text.lastIndexOf('}') + 1)) as { pick?: string; why?: string };
    pick = tried.find((t) => t.name === j.pick);
    why = j.why ?? '';
  } catch { /* the strongest, below */ }
  if (!pick) {
    pick = [...tried].sort((a, b) => b.winRate - a.winRate)[0];
    why = 'The model gave no clear pick, so this is the deck with the best bot results.';
  }
  return { tried, pick, why, rejected, usage, games };
}

const cardsText = (d: DeckList) => Object.entries(d.cards).sort(([a], [b]) => a.localeCompare(b)).map(([id, q]) => `${q}× ${cardName(id)}`).join(', ');

export async function runDeckBuild(o: BuildOptions & { save?: boolean; key?: string }): Promise<RunSummary> {
  const run = newRun('deck-build');
  const r = await buildDeck({ ...o, onProgress: (phase, done, total) => reportProgress(run, 'deck-build', phase, done, total) });
  const problems: Problem[] = [];
  if (!r.pick) problems.push({ level: 'warn', text: `The LLM built no legal deck for "${o.goal}".` });
  let saved: string | undefined;
  const allStarters = o.opponents.length === Object.keys(DECKS).length && o.opponents.every((d) => Object.values(DECKS).some((s) => s.name === d.name));
  if (r.pick && o.save && canSaveLibrary()) {
    saved = saveToLibrary({
      name: r.pick.name, hero: r.pick.deck.hero, cards: r.pick.deck.cards, source: 'built', goal: o.goal, about: r.pick.idea,
      ...(allStarters ? { vsStarters: r.pick.winRate } : {}), from: `${run.id} (${o.provider.model})`,
    }, o.key);
  }
  const md = [
    `# Deck build: ${o.goal}`, '',
    `${o.provider.name} ${o.provider.model} built ${r.tried.length} legal deck(s) in ${o.rounds} round(s)${r.rejected.length ? ` (${r.rejected.length} broke the rules)` : ''}; ` +
    `each played ${o.games} bot games against ${o.opponents.map((d) => d.name).join(', ')}.`, '',
    ...(r.pick ? [
      `## The pick: ${r.pick.name}, ${pct(r.pick.winRate)}`, '', r.why, '', `*${r.pick.idea}*`, '',
      `${cardName(r.pick.deck.hero)} (${CARDS[r.pick.deck.hero].family}): ${cardsText(r.pick.deck)}`, '',
      `Deck code: \`${deckCode(r.pick.deck)}\``, '',
      ...(saved ? [`Saved to the deck library as \`${saved}\`.`, ''] : []),
    ] : []),
    '## Every deck tried', '',
    '| Round | Deck | Hero Cat | Overall | ' + o.opponents.map((d) => `vs ${d.name}`).join(' | ') + ' | Rounds |',
    '|---|---|---|---|' + o.opponents.map(() => '---|').join('') + '---|',
    ...r.tried.map((t) => `| ${t.round} | ${t.name}${t === r.pick ? ' ✓' : ''} | ${cardName(t.deck.hero)} | ${pct(t.winRate)} | ${o.opponents.map((d) => pct(t.vs[d.name] ?? 0)).join(' | ')} | ${t.rounds.toFixed(1)} |`),
    '',
    ...(r.rejected.length ? ['## Rejected (broke the deckbuilding rules)', '', ...r.rejected.map((x) => `- ${x}`), ''] : []),
  ];
  return finishRun(run, 'deck-build', r.games, problems, {
    goal: o.goal, provider: o.provider.name, model: o.provider.model, usage: r.usage, costUsd: o.provider.cost(r.usage),
    opponents: o.opponents.map((d) => d.name), saved: saved ?? null, why: r.why,
    pick: r.pick ? { name: r.pick.name, idea: r.pick.idea, hero: r.pick.deck.hero, winRate: r.pick.winRate, vs: r.pick.vs, cards: r.pick.deck.cards, code: deckCode(r.pick.deck), vsStarters: allStarters ? r.pick.winRate : undefined } : null,
    decks: r.tried.map((t) => ({ name: t.name, idea: t.idea, round: t.round, hero: t.deck.hero, winRate: t.winRate, vs: t.vs, code: deckCode(t.deck) })),
    rejected: r.rejected,
  }, md.join('\n'));
}

export async function deckBuildCommand(): Promise<number> {
  const goal = textArg('goal');
  if (!goal) { console.error('deck-build --goal <what the deck is for> [--hero ID] [--vs DECK,…] [--candidates 3] [--rounds 2] [--games 40] [--save]'); return 1; }
  const hero = arg('hero');
  if (hero && CARDS[hero]?.type !== 'Hero Cat') { console.error(`${hero} is not a Hero Cat.`); return 1; }
  const summary = await runDeckBuild({
    provider: getProvider(arg('provider') ?? 'pc2024', arg('model')),
    goal, hero,
    opponents: loadDecks(arg('vs') ?? 'starters'),
    candidates: numArg('candidates') ?? 3,
    rounds: numArg('rounds') ?? 2,
    games: numArg('games') ?? 40,
    save: flag('save'),
    key: arg('key'),
  });
  const pick = summary.details.pick as { name: string; winRate: number; code: string } | null;
  console.log(`${summary.result.toUpperCase()}: ${pick ? `${pick.name}, ${pct(pick.winRate)} in bot games.\n${pick.code}` : 'no deck.'}${summary.details.saved ? `\nSaved to the library as ${summary.details.saved}.` : ''}\nReport: ${summary.id}`);
  return 0;
}
