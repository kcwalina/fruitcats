// llm-playtest [--provider pc2024] [--model M] [--persona exploit|aggro|newcomer|all] [--games N]
//              [--deck DECK[,DECK…]] [--vs DECK[,DECK…]] [--parallel 4] [--hours H] [--budget TOKENS]
//              [--player plain|informed|memory|agent] [--effort low|medium|high] [--seeds TAG]
// llm-compare --players plain,informed,memory,agent [--games N] [--persona aggro] [--seeds TAG] [--parallel 8]
// llm-playtest --bench [--provider pc2024] [--models a,b,c]
// llm-playtest --bench --concurrency 1,2,4,8 [--seconds 60] [--provider pc2024] [--model M]   (games per day)
//
// A DECK is a starter's key, a prototype deck's key, a library deck's key (npm run decks -- list), a deck code,
// a DeckList file, `starters` or `library` (every deck of either).
//
// LLM players against the bot. Without --deck/--vs the games cycle through every pairing of starter decks,
// and with --persona all through every persona. Each game gets a transcript (every choice with the LLM's
// reason) and a playtester report; the run's summary counts which cards the reports call suspect.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag, numArg } from '../lib/args';
import { CARDS, DECKS, apply, deckCode, rulesPrimer, choicesText, chooseAction, createGame, describe, type DeckList } from '../lib/engine';
import { mulberry, seedFrom } from '../lib/rng';
import { finishRun, newRun, pct, reportProgress, type Problem, type RunSummary } from '../lib/runs';
import { loadDecks } from '../decks/library';
import { PERSONAS, ANSWER_FORMAT, ANSWER_REMINDER, type Persona } from './personas';
import { knownCards, playLlmGame, type LlmGame } from './player';
import { playerSpec, type PlayerSpec } from './players';
import { addUsage, getProvider, noUsage, type Provider, type Usage } from './providers';

export interface LlmRunOptions {
  provider: Provider;
  personas: Persona[];
  games: number;
  pairs?: [DeckList, DeckList][];
  parallel?: number;
  hours?: number;
  maxTokens?: number;
  quiet?: boolean;
  player: PlayerSpec;
  /** The same tag gives the same deals, so variants can be compared game for game. */
  seedTag?: string;
  /** Custom decks in these games (not starters): listed in the report with their deck codes. */
  customDecks?: DeckList[];
}

/** The decks in these pairs that aren't starter decks. */
const customIn = (pairs: [DeckList, DeckList][]): DeckList[] => {
  const starters = new Set(Object.values(DECKS).map((d) => d.name));
  const seen = new Map<string, DeckList>();
  for (const d of pairs.flat()) if (!starters.has(d.name)) seen.set(d.name, d);
  return [...seen.values()];
};

export async function runLlmPlaytest(o: LlmRunOptions): Promise<RunSummary> {
  const run = newRun('llm-playtest');
  const keys = Object.keys(DECKS);
  const pairs = o.pairs ?? keys.flatMap((a) => keys.filter((b) => b !== a).map((b): [DeckList, DeckList] => [DECKS[a], DECKS[b]]));
  const deadline = o.hours ? Date.now() + o.hours * 3600_000 : Infinity;
  let usage: Usage = noUsage();
  const budget = { remaining: () => (o.maxTokens ?? Infinity) - (usage.input + usage.output) };
  const results: (LlmGame & { persona: string })[] = [];
  const errors: string[] = [];
  let next = 0;
  // With a time limit instead of a game count (the nightly run), the total is how many games fit.
  const total = () => (Number.isFinite(deadline) && o.games > 1000 ? results.length + errors.length + (o.parallel ?? 1) : o.games);
  reportProgress(run, 'llm-playtest', 'LLM games', 0, Math.min(o.games, 1000));

  const worker = async () => {
    while (next < o.games && Date.now() < deadline && budget.remaining() > 0) {
      const i = next++;
      const persona = o.personas[i % o.personas.length];
      const [deck, vs] = pairs[Math.floor(i / o.personas.length) % pairs.length];
      const seed = seedFrom(`${o.seedTag ?? run.id}:${i}`);
      try {
        const g = await playLlmGame(o.provider, persona, deck, vs, seed, budget, o.player);
        usage = addUsage(usage, g.usage);
        results.push({ ...g, persona: persona.key });
        reportProgress(run, 'llm-playtest', 'LLM games', results.length + errors.length, total());
        writeFileSync(join(run.dir, `game-${String(i + 1).padStart(3, '0')}.md`), g.transcript);
        if (!o.quiet) console.log(`  game ${i + 1}: ${persona.name}, ${deck.name} vs ${vs.name}: ${g.won === null ? 'draw' : g.won ? 'LLM won' : 'bot won'} in ${g.rounds} rounds, ${g.llmMoves} moves at ${g.secondsPerMove.toFixed(1)} s, ${g.fallbacks} fallbacks`);
      } catch (e) {
        errors.push(`game ${i + 1}: ${(e as Error).message}`);
        if (!o.quiet) console.log(`  game ${i + 1} failed: ${(e as Error).message}`);
        if (errors.length >= 3 && results.length === 0) throw new Error(`The provider keeps failing:\n${errors.join('\n')}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.parallel ?? 1) }, worker));

  // What the playtesters agree on is what's worth a look.
  const allIds = Object.keys(CARDS);
  const suspects = new Map<string, number>();
  for (const g of results) for (const c of new Set(knownCards(g.report?.suspectCards ?? [], allIds))) suspects.set(c, (suspects.get(c) ?? 0) + 1);
  const suspectList = [...suspects.entries()].sort((a, b) => b[1] - a[1]).map(([name, games]) => ({ name, games }));
  const moves = results.reduce((n, g) => n + g.llmMoves, 0);
  const fallbacks = results.reduce((n, g) => n + g.fallbacks, 0);
  const winRate = results.length ? results.filter((g) => g.won).length / results.length : 0;
  // Against the bot's own judgment of each position (see judge() in player.ts).
  const j = results.reduce((a, g) => ({
    moves: a.moves + g.judgement.moves, agreed: a.agreed + g.judgement.agreed, regret: a.regret + g.judgement.regret,
    yarnWithMovesLeft: a.yarnWithMovesLeft + g.judgement.yarnWithMovesLeft, passWithMovesLeft: a.passWithMovesLeft + g.judgement.passWithMovesLeft,
  }), { moves: 0, agreed: 0, regret: 0, yarnWithMovesLeft: 0, passWithMovesLeft: 0 });
  const callsPerMove = moves ? results.reduce((t, g) => t + g.callsPerMove * g.llmMoves, 0) / moves : 0;
  const toolCalls: Record<string, number> = {};
  for (const g of results) for (const [k, v] of Object.entries(g.toolCalls)) toolCalls[k] = (toolCalls[k] ?? 0) + v;
  const judgement = {
    judgedMoves: j.moves, agreeWithBot: j.moves ? j.agreed / j.moves : 0, regretPerMove: j.moves ? j.regret / j.moves : 0,
    yarnWithMovesLeftPerGame: results.length ? j.yarnWithMovesLeft / results.length : 0,
    passWithMovesLeftPerGame: results.length ? j.passWithMovesLeft / results.length : 0,
  };
  const cost = o.provider.cost(usage);
  const problems: Problem[] = [];
  for (const s of suspectList.filter((s) => s.games >= Math.max(2, results.length * 0.2))) {
    problems.push({ level: 'warn', text: `${s.name} was called suspect in ${s.games} of ${results.length} LLM playtest reports.` });
  }
  if (moves && fallbacks / moves > 0.1) problems.push({ level: 'warn', text: `${pct(fallbacks / moves)} of the LLM's moves fell back to the bot: the model struggles with the format.` });
  if (errors.length) problems.push({ level: 'warn', text: `${errors.length} game(s) failed: ${errors[0]}` });

  // How the LLM did with each deck it played: what a custom deck's playtest is for.
  const byDeck = [...new Set(results.map((g) => g.deck))].map((deck) => {
    const games = results.filter((g) => g.deck === deck);
    return { deck, games: games.length, won: games.filter((g) => g.won).length };
  });
  const custom = o.customDecks ?? customIn(pairs);
  const md: string[] = [
    `# LLM playtest: ${o.provider.name} ${o.provider.model}`, '',
    ...(custom.length ? ['## Custom decks', '', ...custom.map((d) => {
      const b = byDeck.find((x) => x.deck === d.name);
      return `- **${d.name}** (${CARDS[d.hero]?.name.split(',')[0] ?? d.hero})${b ? `: the LLM won ${b.won} of ${b.games}` : ': no games'}. \`${deckCode(d)}\``;
    }), ''] : []),
    `Player: **${o.player.name}**, ${o.player.about}. ${callsPerMove.toFixed(1)} model calls a move${Object.keys(toolCalls).length ? ` (tools: ${Object.entries(toolCalls).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}.`, '',
    `Against the bot's judgment: agrees with its choice on ${pct(judgement.agreeWithBot)} of ${judgement.judgedMoves} moves, gives up ${judgement.regretPerMove.toFixed(2)} points a move; per game it takes the Yarn ${judgement.yarnWithMovesLeftPerGame.toFixed(1)} times and passes ${judgement.passWithMovesLeftPerGame.toFixed(1)} times with a useful move left.`, '',
    `${results.length} games, LLM won ${pct(winRate)}. ${moves} LLM moves, ${fallbacks} fell back to the bot. ` +
    `Tokens: ${usage.input.toLocaleString()} in (${usage.cachedInput.toLocaleString()} cached), ${usage.output.toLocaleString()} out${cost !== null ? `, $${cost.toFixed(2)}` : ''}.`, '',
    '## Problems', '', ...(problems.length ? problems.map((p) => `- **${p.level}**: ${p.text}`) : ['None.']), '',
    '## Cards the playtesters called suspect', '', ...(suspectList.length ? suspectList.map((s) => `- ${s.name}: ${s.games} report(s)`) : ['None.']), '',
    '## Games', '', '| # | Persona | Deck | Against | Result | Rounds | Moves | s/move | Report |', '|---|---|---|---|---|---|---|---|---|',
    ...results.map((g, i) => `| ${i + 1} | ${g.persona} | ${g.deck} | ${g.vs} | ${g.won === null ? 'draw' : g.won ? 'won' : 'lost'} | ${g.rounds} | ${g.llmMoves} | ${g.secondsPerMove.toFixed(1)} | ${(g.report?.summary ?? '').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
  ];
  const confusing = results.flatMap((g) => g.report?.confusing ?? []);
  if (confusing.length) md.push('## What confused the playtesters', '', ...confusing.slice(0, 30).map((c) => `- ${c}`), '');
  const unfair = results.flatMap((g) => g.report?.unfair ?? []);
  if (unfair.length) md.push('## What felt unfair', '', ...unfair.slice(0, 30).map((c) => `- ${c}`), '');

  return finishRun(run, 'llm-playtest', results.length, problems, {
    provider: o.provider.name, model: o.provider.model, personas: o.personas.map((p) => p.key),
    llmWinRate: winRate, moves, fallbacks, usage, costUsd: cost, player: o.player.name, callsPerMove, toolCalls, judgement,
    secondsPerMove: moves ? results.reduce((t, g) => t + g.secondsPerMove * g.llmMoves, 0) / moves : 0,
    suspectCards: suspectList, confusing: confusing.slice(0, 20), unfair: unfair.slice(0, 20), byDeck,
    customDecks: (o.customDecks ?? customIn(pairs)).map((d) => ({ name: d.name, hero: d.hero, code: deckCode(d) })),
    games: results.map((g) => ({ persona: g.persona, deck: g.deck, vs: g.vs, won: g.won, rounds: g.rounds, moves: g.llmMoves, fallbacks: g.fallbacks, summary: g.report?.summary ?? '' })),
  }, md.join('\n'));
}

/** Times a few real decisions per model, so a long run is planned from measurements. */
async function bench(providerName: string, models: string[] | undefined): Promise<number> {
  const base = getProvider(providerName);
  const ids = models ?? (await base.listModels());
  console.log(`${providerName}: ${ids.length} model(s): ${ids.join(', ')}\n`);
  // A mid-game decision with real choices in it.
  const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 11 });
  while (!(s.prompt?.kind === 'action' && s.round >= 3 && s.prompt.player === 0)) apply(s, chooseAction(s, { random: mulberry(s.actions) }));
  const persona = PERSONAS.exploit;
  const messages = [
    { role: 'system' as const, content: `${rulesPrimer()}\n\nYOU\n${persona.style}\n\n${ANSWER_FORMAT}` },
    { role: 'user' as const, content: `${describe(s, 0)}\n\n${choicesText(s)}\n\n${ANSWER_REMINDER}` },
  ];
  console.log('| Model | s/move | tokens in / out | est. minutes per game (50 moves) | answered |');
  console.log('|---|---|---|---|---|');
  for (const id of ids) {
    const p = getProvider(providerName, id);
    let ms = 0, ok = 0, n = 0, u = noUsage();
    try {
      for (let i = 0; i < 4; i++) {
        const r = await p.chat(messages);
        n++; ms += r.ms; u = addUsage(u, r.usage);
        if (/answer\s*[:=]\s*\d+/i.test(r.text)) ok++;
      }
      console.log(`| ${id} | ${(ms / n / 1000).toFixed(1)} | ${Math.round(u.input / n)} / ${Math.round(u.output / n)} | ${((ms / n / 1000) * 50 / 60).toFixed(1)} | ${ok}/${n} |`);
    } catch (e) {
      console.log(`| ${id} | failed: ${(e as Error).message.slice(0, 80)} | | | |`);
    }
  }
  return 0;
}

/** LLM moves in a real game (about 34 on gpt-oss-20b, measured on PC2024) plus the end-of-game report. */
const CALLS_PER_GAME = 35;

/**
 * How many games a day the provider can play, at each level of concurrency: every worker keeps sending real
 * decisions (16 different mid-game positions, so a cached prompt can't flatter the numbers) for `seconds`,
 * and the answered moves per minute become games per day.
 */
async function throughput(providerName: string, model: string | undefined, levels: number[], seconds: number): Promise<number> {
  const p = getProvider(providerName, model);
  const persona = PERSONAS.exploit;
  const system = `${rulesPrimer()}\n\nYOU\n${persona.style}\n\n${ANSWER_FORMAT}`;
  const positions: string[] = [];
  for (let seed = 1; positions.length < 16; seed++) {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard', 'mango-tango'].slice(seed % 2, seed % 2 + 2) as [string, string], seed });
    while (!(s.prompt?.kind === 'action' && s.round >= 2 + (seed % 4)) && s.winner === null) apply(s, chooseAction(s, { random: mulberry(s.actions) }));
    if (s.winner === null) positions.push(`${describe(s, s.prompt!.player)}\n\n${choicesText(s)}\n\n${ANSWER_REMINDER}`);
  }
  console.log(`${p.name} ${p.model}: ${seconds} s at each level\n`);
  console.log('| Games at once | Moves per minute | Seconds per move (each game) | Answered | Games per day |');
  console.log('|---|---|---|---|---|');
  for (const n of levels) {
    const until = Date.now() + seconds * 1000;
    let moves = 0, answered = 0, ms = 0, next = 0;
    const started = Date.now();
    await Promise.all(Array.from({ length: n }, async () => {
      while (Date.now() < until) {
        const r = await p.chat([{ role: 'system', content: system }, { role: 'user', content: positions[next++ % positions.length] }]);
        moves++; ms += r.ms;
        if (/answer\s*[:=]\s*\d+/i.test(r.text)) answered++;
      }
    }));
    const minutes = (Date.now() - started) / 60000;
    const perMinute = moves / minutes;
    console.log(`| ${n} | ${perMinute.toFixed(1)} | ${(ms / moves / 1000).toFixed(1)} | ${answered}/${moves} | ${Math.round((perMinute * 60 * 24) / CALLS_PER_GAME)} |`);
  }
  return 0;
}

/** Request fields that set gpt-oss's reasoning effort, through Ollama or llama-server. */
const effortBody = (effort?: string): Record<string, unknown> =>
  (effort ? { reasoning: { effort }, chat_template_kwargs: { reasoning_effort: effort } } : {});

/**
 * Plays the same deals with each player and compares them: the way a better LLM player is found. The bot
 * referees every move (agreement, value given up), so a comparison means something even when all the players
 * lose most games.
 */
export async function llmCompareCommand(): Promise<number> {
  const providerName = arg('provider') ?? 'pc2024';
  const players = (arg('players') ?? 'plain,informed,memory,agent').split(',').map(playerSpec);
  const persona = PERSONAS[arg('persona') ?? 'aggro'];
  if (!persona) throw new Error(`Unknown persona ${arg('persona')}.`);
  const games = numArg('games') ?? 16;
  const seedTag = arg('seeds') ?? `compare-${Date.now()}`;
  const run = newRun('llm-compare');
  const rows: { player: PlayerSpec; summary: RunSummary }[] = [];
  for (const [i, player] of players.entries()) {
    reportProgress(run, 'llm-compare', `player ${player.name}`, i, players.length);
    const summary = await runLlmPlaytest({
      provider: getProvider(providerName, arg('model'), effortBody(arg('effort') ?? player.effort)),
      personas: [persona], games, parallel: numArg('parallel') ?? 8, player, seedTag, quiet: true,
    });
    rows.push({ player, summary });
    console.log(`  ${player.name}: ${pct((summary.details as { llmWinRate: number }).llmWinRate)} won (${summary.id})`);
  }
  type D = { llmWinRate: number; secondsPerMove: number; callsPerMove: number; moves: number; fallbacks: number; judgement: { agreeWithBot: number; regretPerMove: number; yarnWithMovesLeftPerGame: number; passWithMovesLeftPerGame: number } };
  const table = rows.map(({ player, summary }) => ({ player: player.name, about: player.about, run: summary.id, games: summary.games, ...(summary.details as D) }));
  const best = [...table].sort((a, b) => b.judgement.agreeWithBot - a.judgement.agreeWithBot || b.llmWinRate - a.llmWinRate)[0];
  const md = [
    '# LLM player comparison', '',
    `${games} games each, the same deals (seeds "${seedTag}"), ${persona.name.toLowerCase()} persona, against the bot. In these seats the bot itself would win about half.`, '',
    '| Player | Won | Agrees with the bot | Value given up a move | Yarn taken with moves left (a game) | Passed with moves left (a game) | Calls a move | Seconds a move | Fallbacks |',
    '|---|---|---|---|---|---|---|---|---|',
    ...table.map((t) => `| ${t.player} | ${pct(t.llmWinRate)} | ${pct(t.judgement.agreeWithBot)} | ${t.judgement.regretPerMove.toFixed(2)} | ${t.judgement.yarnWithMovesLeftPerGame.toFixed(1)} | ${t.judgement.passWithMovesLeftPerGame.toFixed(1)} | ${t.callsPerMove.toFixed(1)} | ${t.secondsPerMove.toFixed(1)} | ${t.fallbacks} |`),
    '', `Plays most like the bot: **${best?.player}**.`, '',
    ...table.map((t) => `- **${t.player}**: ${t.about}. Report: ${t.run}`), '',
  ];
  const summary = finishRun(run, 'llm-compare', table.reduce((n, t) => n + t.games, 0), [], { seedTag, persona: persona.key, players: table, best: best?.player }, md.join('\n'));
  console.log(`\n${md.join('\n')}\nReport: ${summary.id}`);
  return 0;
}

/** Every deck against every opponent, except itself. */
export function deckPairs(decks: DeckList[], opponents: DeckList[]): [DeckList, DeckList][] {
  const pairs = decks.flatMap((d) => opponents.filter((o) => o.name !== d.name).map((o): [DeckList, DeckList] => [d, o]));
  if (!pairs.length) throw new Error('No games to play: every deck would face itself.');
  return pairs;
}

export async function llmPlaytestCommand(): Promise<number> {
  const providerName = arg('provider') ?? 'pc2024';
  if (flag('bench') && arg('concurrency')) {
    return throughput(providerName, arg('model'), arg('concurrency')!.split(',').map(Number), numArg('seconds') ?? 60);
  }
  if (flag('bench')) return bench(providerName, arg('models')?.split(','));
  const personaArg = arg('persona') ?? 'all';
  const personas = personaArg === 'all' ? Object.values(PERSONAS) : personaArg.split(',').map((k) => {
    const p = PERSONAS[k];
    if (!p) throw new Error(`Unknown persona ${k} (have: ${Object.keys(PERSONAS).join(', ')}).`);
    return p;
  });
  const deck = arg('deck'), vs = arg('vs');
  const player = playerSpec(arg('player') ?? 'plain');
  const summary = await runLlmPlaytest({
    provider: getProvider(providerName, arg('model'), effortBody(arg('effort') ?? player.effort)),
    player,
    seedTag: arg('seeds'),
    personas,
    games: numArg('games') ?? 3,
    pairs: deck || vs ? deckPairs(loadDecks(deck ?? 'zest-rush'), loadDecks(vs ?? 'orchard-guard')) : undefined,
    parallel: numArg('parallel'),
    hours: numArg('hours'),
    maxTokens: numArg('budget'),
  });
  console.log(`\n${summary.result.toUpperCase()}: ${summary.games} games in ${summary.durationSec}s. Report: ${summary.id}`);
  for (const p of summary.problems) console.log(`  ${p.level}: ${p.text}`);
  return 0;
}
