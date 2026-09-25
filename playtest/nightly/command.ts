// nightly [--provider pc2024] [--hours 6] [--scale 3] [--no-llm]
//
// The unattended run PC2024's playtester starts every night:
//   1. the full bot gauntlet (starters, random and mutated decks, the deck library, card impact, bot check)
//   2. an LLM deck hunt (only with nightly.huntProvider set: PC2024's model can't design decks)
//   3. LLM playtest games with custom decks (customShare of the time left): tonight's best hunted decks,
//      two library decks, a random deck and a starter with cards swapped, each against the starters
//   4. LLM playtest games with the starter decks until the time is up
//   5. what changed since the last run
// Each part writes its own report; the nightly report links them and says what needs a look.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag, numArg } from '../lib/args';
import { DECKS, deckCode, type DeckList } from '../lib/engine';
import { mulberry, pick, seedFrom } from '../lib/rng';
import { mutateDeck, playableHeroes, randomDeck } from '../balance/decks';
import { libraryDecks } from '../decks/library';
import { deckPairs } from '../llm/command';
import { finishRun, newRun, pct, reportProgress, reportsRoot, type Problem, type RunSummary } from '../lib/runs';
import { runBalance } from '../balance/gauntlet';
import { runLlmPlaytest } from '../llm/command';
import { runDeckHunt } from '../llm/hunt';
import { PERSONAS } from '../llm/personas';
import { playerSpec } from '../llm/players';
import { getProvider, nightlyConfig } from '../llm/providers';

/** The most recent earlier run of a kind, to compare against. */
function previous(kind: string, before: string): RunSummary | null {
  const root = reportsRoot();
  if (!existsSync(root)) return null;
  const ids = readdirSync(root).filter((d) => d.startsWith(`${kind}-`) && d < before).sort();
  for (const id of ids.reverse()) {
    const f = join(root, id, 'summary.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  }
  return null;
}

/**
 * Tonight's custom decks for LLM players: the deck hunt's two best, the library's newest deck (built on the
 * laptop the evening before) and one more library deck (a different one each night), a random deck for a random
 * Hero Cat and a starter with 8 cards swapped. Each is a deck a player could build.
 */
function customDecks(runId: string, hunted: DeckList[], library: (DeckList & { addedAt?: string })[]): DeckList[] {
  const rng = mulberry(seedFrom(runId));
  const newest = [...library].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))[0];
  const fromLibrary = newest ? [newest, ...library.filter((d) => d !== newest).sort(() => rng() - 0.5).slice(0, 1)] : [];
  const base = pick(rng, Object.values(DECKS));
  return [
    ...hunted,
    ...fromLibrary,
    randomDeck(rng, pick(rng, playableHeroes()), undefined, 'random deck'),
    mutateDeck(rng, base, 8, `${base.name} with 8 cards swapped`),
  ].map((d) => ({ name: d.name.replace(/^hunt: /, 'Hunted: '), hero: d.hero, cards: d.cards }));
}

export async function nightlyCommand(): Promise<number> {
  const cfg = nightlyConfig();
  const run = newRun('nightly');
  const started = Date.now();
  const hours = numArg('hours') ?? cfg.hours;
  const log = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
  const problems: Problem[] = [];
  const parts: Record<string, string> = {};
  const md: string[] = ['# Nightly playtest', ''];

  log('Bot gauntlet…');
  reportProgress(run, 'nightly', 'bot gauntlet', 0, 4);
  const library = Object.values(libraryDecks()).map((d) => ({ name: d.name, hero: d.hero, cards: d.cards, addedAt: d.addedAt }));
  const balance = await runBalance({ quick: false, scale: numArg('scale') ?? cfg.balanceScale, quiet: true, extraDecks: library });
  parts.balance = balance.id;
  problems.push(...balance.problems);
  const overall = (balance.details.starters as { overall: Record<string, number> }).overall;
  md.push('## Bot gauntlet', '', `${balance.games} games: ${balance.result}. Report: ${balance.id}`, '');
  md.push(...Object.entries(overall).map(([k, r]) => `- ${DECKS[k]?.name ?? k}: ${pct(r)} overall`), '');

  const last = previous('balance', balance.id);
  if (last) {
    const before = (last.details.starters as { overall: Record<string, number> }).overall;
    const moved = Object.keys(overall).filter((k) => before[k] !== undefined && Math.abs(overall[k] - before[k]) >= 0.04);
    md.push('## Since the last run', '', last.cardsHash === balance.cardsHash ? 'The cards have not changed.' : 'The cards changed since the last run.', '');
    md.push(...(moved.length ? moved.map((k) => `- ${DECKS[k]?.name ?? k}: ${pct(before[k])} → ${pct(overall[k])}`) : ['- No starter deck moved by 4 points or more.']), '');
    for (const k of moved) problems.push({ level: 'warn', text: `${DECKS[k]?.name ?? k} moved from ${pct(before[k])} to ${pct(overall[k])} since the last run.` });
  }

  if (!flag('no-llm')) {
    const provider = getProvider(arg('provider') ?? cfg.provider, arg('model'));
    let reachable = true;
    try { await provider.listModels(); } catch (e) {
      reachable = false;
      problems.push({ level: 'warn', text: `The LLM provider ${provider.name} was not reachable, so no LLM playtests ran: ${(e as Error).message}` });
    }
    if (reachable) {
      let hunted: DeckList[] = [];
      // PC2024's gpt-oss can't design legal decks (it invents Hero Cats and card ids; 0 of 6 on 2026-09-25), so
      // the nightly hunts only with a model that can, named in nightly.huntProvider. Hunts with Kimi K3 run on
      // the laptop, which has its key: `npm run deck-hunt -- --provider fireworks-k3`.
      const huntProvider = (cfg as { huntProvider?: string }).huntProvider;
      if (!huntProvider) {
        md.push('## Deck hunt', '', 'Off: PC2024\'s model can\'t design legal decks. Custom decks tonight come from the deck library.', '');
      } else try {
        reportProgress(run, 'nightly', 'deck hunt', 1, 4);
        log(`Deck hunt with ${huntProvider}…`);
        const hunt = await runDeckHunt(getProvider(huntProvider), cfg.deckIdeas, 1);
        parts.deckHunt = hunt.id;
        hunted = (hunt.details.decks as { name: string; hero: string; cards: Record<string, number> }[]).slice(0, 2).map((d) => ({ name: d.name, hero: d.hero, cards: d.cards }));
        problems.push(...hunt.problems);
        md.push('## Deck hunt', '', `${(hunt.details.decks as unknown[]).length} LLM-designed decks tested. Report: ${hunt.id}`, '');
      } catch (e) {
        problems.push({ level: 'warn', text: `The deck hunt failed: ${(e as Error).message}` });
      }
      const custom = customDecks(run.id, hunted, library);
      const customHours = (hours - (Date.now() - started) / 3600_000) * (cfg.customShare ?? 0);
      if (custom.length && customHours > 0.1) {
        reportProgress(run, 'nightly', 'LLM games, custom decks', 2, 4);
        log(`LLM games with ${custom.length} custom decks for ${customHours.toFixed(1)} hours…`);
        const llm = await runLlmPlaytest({
          provider, personas: cfg.personas.map((k) => PERSONAS[k]).filter(Boolean), games: 100_000, player: playerSpec(cfg.player),
          parallel: cfg.parallel, hours: customHours, maxTokens: cfg.maxTokens, quiet: true,
          pairs: deckPairs(custom, Object.values(DECKS)), customDecks: custom,
        });
        parts.llmCustom = llm.id;
        problems.push(...llm.problems);
        const d = llm.details as { llmWinRate: number; byDeck?: { deck: string; games: number; won: number }[] };
        md.push('## LLM playtests with custom decks', '', `${llm.games} games, the LLM won ${pct(d.llmWinRate)}. Report: ${llm.id}`, '',
          ...(d.byDeck ?? []).map((b) => `- ${b.deck}: won ${b.won} of ${b.games}`), '');
      }
      const left = hours - (Date.now() - started) / 3600_000;
      if (left > 0.1) {
        reportProgress(run, 'nightly', 'LLM games', 3, 4);
        log(`LLM games for ${left.toFixed(1)} hours…`);
        const llm = await runLlmPlaytest({
          provider, personas: cfg.personas.map((k) => PERSONAS[k]).filter(Boolean), games: 100_000, player: playerSpec(cfg.player),
          parallel: cfg.parallel, hours: left, maxTokens: cfg.maxTokens, quiet: true,
        });
        parts.llm = llm.id;
        problems.push(...llm.problems);
        const d = llm.details as { llmWinRate: number; secondsPerMove: number; suspectCards: { name: string; games: number }[] };
        md.push('## LLM playtests', '', `${llm.games} games, the LLM won ${pct(d.llmWinRate)}, ${d.secondsPerMove.toFixed(1)} s a move. Report: ${llm.id}`, '');
        if (d.suspectCards.length) md.push(`Most often called suspect: ${d.suspectCards.slice(0, 5).map((s) => `${s.name} (${s.games})`).join(', ')}`, '');
      }
    }
  }

  md.splice(2, 0, '## Needs a look', '', ...(problems.length ? problems.map((p) => `- **${p.level}**: ${p.text}`) : ['Nothing: every check passed.']), '');
  const summary = finishRun(run, 'nightly', 0, problems, { parts, starters: overall, library: library.map((d) => ({ name: d.name, code: deckCode(d) })) }, md.join('\n'));
  log(`Done: ${summary.result.toUpperCase()}. Report: ${summary.id}`);
  return 0;
}
