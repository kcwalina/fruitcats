// nightly [--provider pc2024] [--hours 6] [--scale 3] [--no-llm]
//
// The unattended run PC2024's playtester starts every night:
//   1. the full bot gauntlet (starters, random and mutated decks, card impact, bot check)
//   2. an LLM deck hunt: decks designed to break the game, played by the bots
//   3. LLM playtest games against the bot until the time is up
//   4. what changed since the last run
// Each part writes its own report; the nightly report links them and says what needs a look.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { arg, flag, numArg } from '../lib/args';
import { DECKS } from '../lib/engine';
import { finishRun, newRun, pct, reportsRoot, type Problem, type RunSummary } from '../lib/runs';
import { runBalance } from '../balance/gauntlet';
import { runLlmPlaytest } from '../llm/command';
import { runDeckHunt } from '../llm/hunt';
import { PERSONAS } from '../llm/personas';
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
  const balance = await runBalance({ quick: false, scale: numArg('scale') ?? cfg.balanceScale, quiet: true });
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
      log(`Deck hunt with ${provider.name} ${provider.model}…`);
      try {
        const hunt = await runDeckHunt(provider, cfg.deckIdeas, 1);
        parts.deckHunt = hunt.id;
        problems.push(...hunt.problems);
        md.push('## Deck hunt', '', `${(hunt.details.decks as unknown[]).length} LLM-designed decks tested. Report: ${hunt.id}`, '');
      } catch (e) {
        problems.push({ level: 'warn', text: `The deck hunt failed: ${(e as Error).message}` });
      }
      const left = hours - (Date.now() - started) / 3600_000;
      if (left > 0.1) {
        log(`LLM games for ${left.toFixed(1)} hours…`);
        const llm = await runLlmPlaytest({
          provider, personas: cfg.personas.map((k) => PERSONAS[k]).filter(Boolean), games: 100_000,
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
  const summary = finishRun(run, 'nightly', 0, problems, { parts, starters: overall }, md.join('\n'));
  log(`Done: ${summary.result.toUpperCase()}. Report: ${summary.id}`);
  return 0;
}
