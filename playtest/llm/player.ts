// One game between an LLM and the bot, and the LLM's report on how it went.
//
// Each decision is one stateless request: the rules (a constant prefix, so providers cache it), the persona,
// then the table as the LLM's seat sees it and its numbered choices. Decisions with a single option are
// taken without asking. A reply that names no legal choice is sent back once with the reason; after that
// the bot decides for the LLM, and the game counts a fallback.

import {
  RULES_PRIMER, apply, chooseAction, createGame, describe, listChoices, choicesText, parseChoice, cardName,
  type DeckList, type GameState, type PlayerId,
} from '../lib/engine';
import { mulberry } from '../lib/rng';
import { ANSWER_FORMAT, ANSWER_REMINDER, type Persona } from './personas';
import { addUsage, noUsage, type ChatMessage, type Provider, type Usage } from './providers';

export interface GameReport {
  summary: string;
  unfair: string[];
  suspectCards: string[];
  confusing: string[];
  fun: number | null;
}

export interface LlmGame {
  deck: string;
  vs: string;
  seed: number;
  won: boolean | null;
  rounds: number;
  llmMoves: number;
  fallbacks: number;
  secondsPerMove: number;
  usage: Usage;
  report: GameReport | null;
  transcript: string;
}

const systemPrompt = (persona: Persona) => `${RULES_PRIMER}\n\nYOU\n${persona.style}\n\n${ANSWER_FORMAT}`;

/** Pulls a JSON object out of a reply that may wrap it in prose or a code fence. */
function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function playLlmGame(
  provider: Provider, persona: Persona, deck: DeckList, vs: DeckList, seed: number,
  budget: { remaining: () => number },
): Promise<LlmGame> {
  const seat: PlayerId = (seed % 2) as PlayerId;
  const decks: [DeckList, DeckList] = seat === 0 ? [deck, vs] : [vs, deck];
  const s: GameState = createGame({ decks, seed, names: seat === 0 ? ['LLM', 'Bot'] : ['Bot', 'LLM'] });
  const system = systemPrompt(persona);
  let usage = noUsage();
  let llmMoves = 0, fallbacks = 0, ms = 0;
  const lines: string[] = [`# ${persona.name}: ${deck.name} vs ${vs.name} (bot), seed ${seed}`, ''];

  while (s.winner === null) {
    const p = s.prompt!.player;
    if (p !== seat) { apply(s, chooseAction(s, { random: mulberry(seed ^ s.actions) })); continue; }
    const choices = listChoices(s);
    if (!choices.multi && choices.options.length === 1) { apply(s, choices.options[0].action); continue; }
    if (budget.remaining() <= 0) { apply(s, chooseAction(s, { random: mulberry(seed ^ s.actions) })); fallbacks++; continue; }

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${describe(s, seat)}\n\n${choicesText(s)}\n\n${ANSWER_REMINDER}` },
    ];
    let action = null;
    for (let attempt = 0; attempt < 2 && !action; attempt++) {
      const reply = await provider.chat(messages);
      usage = addUsage(usage, reply.usage);
      ms += reply.ms;
      const parsed = parseChoice(s, reply.text);
      if ('action' in parsed) {
        action = parsed.action;
        const hand = s.players[seat].hand;
        const picked = 'uids' in parsed.action
          ? parsed.action.uids.map((u) => cardName(hand.find((c) => c.uid === u)!.id)).join(', ') || 'none'
          : choices.options.find((o) => JSON.stringify(o.action) === JSON.stringify(parsed.action))?.label;
        // The reasoning is in the first reply even when the number came from the follow-up.
        const reason = (attempt ? messages[2].content : reply.text).replace(/\s*answer\s*[:=].*$/is, '').trim().replace(/\n+/g, ' ').slice(0, 400);
        lines.push(`**R${s.round}** ${choices.question} → ${picked}`, `> ${reason}`, '');
      } else {
        // Small models often explain a move without naming its number; asked for only the number, they give it.
        const ask = choices.multi ? 'Which hand cards is that? Reply with only the H numbers, or "none".' : 'Which of the numbered choices is that? Reply with only the number.';
        messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: /no choice \d/.test(parsed.error) ? `${parsed.error} ${ask}` : ask });
      }
    }
    llmMoves++;
    if (!action) { fallbacks++; action = chooseAction(s, { random: mulberry(seed ^ s.actions) }); lines.push(`**R${s.round}** (no legal answer; the bot chose)`, ''); }
    apply(s, action);
  }

  const won = s.winner === 'draw' ? null : s.winner === seat;
  lines.push(`**Result:** ${won === null ? 'draw' : won ? 'the LLM won' : 'the bot won'} after ${s.round} rounds.`, '');

  // The report: what the game felt like from the persona's chair.
  let report: GameReport | null = null;
  if (budget.remaining() > 0) {
    const log = s.log.map((e) => `R${e.round} ${e.text}`).join('\n');
    const reply = await provider.chat([
      { role: 'system', content: `${RULES_PRIMER}\n\nYOU\n${persona.style}` },
      {
        role: 'user',
        content: `The game is over: ${won === null ? 'a draw' : won ? 'you won' : 'you lost'} after ${s.round} rounds. You played ${deck.name} (you are "LLM" in the log) against ${vs.name}.\n\nGAME LOG\n${log}\n\n` +
          `As a playtester, report on ${persona.watch}. Reply with only a JSON object: {"summary": "two or three sentences", "unfair": ["…"], "suspectCards": ["exact card names"], "confusing": ["…"], "fun": 1-5}.`,
      },
    ], 1500);
    usage = addUsage(usage, reply.usage);
    const j = jsonIn(reply.text);
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
    report = j
      ? { summary: String(j.summary ?? ''), unfair: list(j.unfair), suspectCards: list(j.suspectCards), confusing: list(j.confusing), fun: typeof j.fun === 'number' ? j.fun : null }
      : { summary: reply.text.slice(0, 600), unfair: [], suspectCards: [], confusing: [], fun: null };
    lines.push('## Playtester report', '', report.summary, '');
    for (const [title, items] of [['Unfair', report.unfair], ['Suspect cards', report.suspectCards], ['Confusing', report.confusing]] as const) {
      if (items.length) lines.push(`**${title}:** ${items.join('; ')}`, '');
    }
  }
  return {
    deck: deck.name, vs: vs.name, seed, won, rounds: s.round, llmMoves, fallbacks,
    secondsPerMove: llmMoves ? ms / 1000 / llmMoves : 0, usage, report, transcript: lines.join('\n'),
  };
}

/** Card names a report mentions, matched to real cards (reports sometimes misspell or invent). */
export function knownCards(names: string[], all: string[]): string[] {
  const byName = new Map(all.map((id) => [cardName(id).toLowerCase(), cardName(id)]));
  return names.map((n) => byName.get(n.toLowerCase().trim()) ?? [...byName.entries()].find(([k]) => k.includes(n.toLowerCase().trim()))?.[1]).filter((x): x is string => !!x);
}
