// One game between an LLM player and the bot, and the LLM's report on how it went.
//
// How the LLM decides depends on its player spec (players.ts). Every spec gets the rules (a constant prefix,
// so providers cache it), the persona, and the table as its seat sees it with numbered choices. On top:
//   - detail/tips: choices with stats and predicted results, and a basic-strategy section
//   - plan: each reply ends with a one-line plan that comes back on the next move
//   - tools: an agent loop; the player may preview a choice in the real engine, look up cards and the log,
//     and keep notes, then chooses with the `choose` tool
// Decisions with a single option are taken without asking. A reply that names no legal choice is asked again;
// after that the bot decides for the LLM, and the game counts a fallback. The bot also judges every choice
// (judge()), which is how players are compared.

import {
  CARDS, STRATEGY_PRIMER, rulesPrimer, apply, cardName, chooseAction, choicesText, createGame, describe, determinize,
  listChoices, parseChoice, scoreActions,
  type Action, type Choices, type DeckList, type GameState, type PlayerId,
} from '../lib/engine';
import { mulberry } from '../lib/rng';
import { ANSWER_FORMAT, ANSWER_REMINDER, type Persona } from './personas';
import type { PlayerSpec, ToolName } from './players';
import { addUsage, noUsage, type ChatMessage, type Provider, type Reply, type ToolSpec, type Usage } from './providers';

export interface GameReport {
  summary: string;
  unfair: string[];
  suspectCards: string[];
  confusing: string[];
  fun: number | null;
}

/**
 * How the LLM's choices compare with the bot's own judgment of the same position: the bot scores every option
 * one step ahead (the same way it picks its moves). `agreed` counts choices the bot would have made too,
 * `regret` adds up how much value the choice gave up against the bot's best, and the named mistakes count
 * habits seen in transcripts.
 */
export interface Judgement { moves: number; agreed: number; regret: number; yarnWithMovesLeft: number; passWithMovesLeft: number }
const noJudgement = (): Judgement => ({ moves: 0, agreed: 0, regret: 0, yarnWithMovesLeft: 0, passWithMovesLeft: 0 });

function judge(s: GameState, chosen: Action, j: Judgement, seed: number): void {
  const scored = scoreActions(s, mulberry(seed ^ s.actions ^ 0x5bd1));
  if (scored.length < 2) return;
  const key = JSON.stringify(chosen);
  const mine = scored.find((x) => JSON.stringify(x.action) === key)?.score ?? -Infinity;
  const best = Math.max(...scored.map((x) => x.score));
  j.moves++;
  if (mine >= best - 0.01) j.agreed++;
  if (Number.isFinite(mine)) j.regret += Math.min(20, best - mine);
  // A real move was on the table (worth clearly more than doing nothing) and the LLM stopped instead.
  const stop = scored.find((x) => x.action.t === 'pass')?.score ?? -Infinity;
  const moveLeft = scored.some((x) => (x.action.t === 'play' || x.action.t === 'attack' || x.action.t === 'ability') && x.score > stop + 0.5);
  if (moveLeft && chosen.t === 'takeYarn') j.yarnWithMovesLeft++;
  if (moveLeft && chosen.t === 'pass') j.passWithMovesLeft++;
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
  /** Model calls per LLM move (1 for a single-call player; more for an agent that uses tools). */
  callsPerMove: number;
  toolCalls: Record<string, number>;
  usage: Usage;
  report: GameReport | null;
  transcript: string;
  judgement: Judgement;
}

const PLAN_FORMAT = 'Reply with one or two short sentences of reasoning, then a line "Plan: <your plan for the next few moves, in one line>", then a last line "Answer: <number>" (for a pick-several choice: "Answer: H2 H5", or "Answer: none").';

function systemPrompt(persona: Persona, spec: PlayerSpec): string {
  const tools = spec.tools.length
    ? `\n\nTOOLS\nBefore choosing you may look things up, up to ${spec.maxToolCalls} times a move:${spec.tools.includes('preview') ? '\n- preview(choice): exactly what happens after a choice, from the real rules (assuming your opponent doesn\'t Pounce; cards you would draw are random). Preview the moves you are unsure about, especially attacks and taking the Yarn.' : ''}${spec.tools.includes('card') ? '\n- card(name): a card\'s full text.' : ''}${spec.tools.includes('log') ? '\n- log(count): the last events of the game.' : ''}${spec.tools.includes('note') ? '\n- note(text): keep a short note (a plan, what the opponent holds back); your notes are shown to you on every later move.' : ''}\nThen call choose(choice, reason) with the number of your choice. For a pick-several choice (mulligan, planting), reply in text instead.`
    : '';
  return `${rulesPrimer()}${spec.tips ? `\n\n${STRATEGY_PRIMER}` : ''}\n\nYOU\n${persona.style}${tools}\n\n${spec.plan ? PLAN_FORMAT : ANSWER_FORMAT}`;
}

const TOOL_SPECS: Record<ToolName | 'choose', ToolSpec> = {
  preview: { name: 'preview', description: 'What happens if you make this choice: the table right after it, from the real rules.', parameters: { type: 'object', properties: { choice: { type: 'integer', description: 'The number of a choice.' } }, required: ['choice'] } },
  card: { name: 'card', description: "A card's full text, cost, type and stats.", parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  log: { name: 'log', description: 'The last events of the game, newest last.', parameters: { type: 'object', properties: { count: { type: 'integer', description: 'How many events (1-40).' } }, required: ['count'] } },
  note: { name: 'note', description: 'Keep a short note for later moves (a plan, a threat to remember).', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  choose: { name: 'choose', description: 'Make your choice. Call this once, to finish the move.', parameters: { type: 'object', properties: { choice: { type: 'integer' }, reason: { type: 'string', description: 'One sentence.' } }, required: ['choice'] } },
};

/** The table after a choice, from a copy of the game in which only what this seat may know is real. */
function previewChoice(s: GameState, seat: PlayerId, action: Action, seed: number): string {
  const w = determinize(s, seat, mulberry(seed ^ s.actions ^ 0x77));
  const before = w.log.length;
  try { apply(w, action); } catch (e) { return `That choice can't be previewed: ${(e as Error).message}`; }
  for (let i = 0; i < 30 && w.winner === null && w.prompt && w.prompt.player !== seat && w.prompt.kind === 'pounce'; i++) apply(w, { t: 'decline' });
  const end = w.winner === null ? '' : w.winner === seat ? 'YOU WOULD WIN.\n' : 'YOU WOULD LOSE.\n';
  return `IF YOU CHOOSE THIS (assuming your opponent doesn't Pounce; cards you would draw are random):\n${end}${describe(w, seat, Math.max(1, w.log.length - before))}`;
}

function cardText(name: string): string {
  const q = name.toLowerCase().trim();
  const c = Object.values(CARDS).find((x) => x.name.toLowerCase() === q) ?? Object.values(CARDS).find((x) => x.name.toLowerCase().includes(q));
  if (!c) return `No card called "${name}".`;
  const sides = c.kitten ? ` Kitten: ${c.kitten.text.replace(/\n/g, ' ')} Big Cat${c.bigCat?.power ? ` (Power ${c.bigCat.power})` : ''}: ${c.bigCat?.text.replace(/\n/g, ' ')}` : '';
  return `${c.name}: ${c.type}, ${c.family}${c.cost !== undefined ? `, cost ${c.cost}` : ''}${c.power !== undefined ? `, ${c.power}/${c.health}` : ''}.${c.text ? ` ${c.text}` : ''}${sides}`;
}

/** Pulls a JSON object out of a reply that may wrap it in prose or a code fence. */
function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

interface Decision { action: Action | null; reason: string; calls: number; replies: Reply[] }

/** A single-call player: one request, asked once more for just the number if the reply names none. */
async function decideByText(provider: Provider, messages: ChatMessage[], s: GameState, choices: Choices): Promise<Decision> {
  const replies: Reply[] = [];
  let first = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await provider.chat(messages);
    replies.push(reply);
    if (!attempt) first = reply.text;
    const parsed = parseChoice(s, reply.text);
    if ('action' in parsed) return { action: parsed.action, reason: first, calls: replies.length, replies };
    // Small models often explain a move without naming its number; asked for only the number, they give it.
    const ask = choices.multi ? 'Which hand cards is that? Reply with only the H numbers, or "none".' : 'Which of the numbered choices is that? Reply with only the number.';
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: /no choice \d/.test(parsed.error) ? `${parsed.error} ${ask}` : ask });
  }
  return { action: null, reason: first, calls: replies.length, replies };
}

/** The agent loop: tool calls until the player chooses, within its budget. */
async function decideByTools(
  provider: Provider, spec: PlayerSpec, messages: ChatMessage[], s: GameState, seat: PlayerId, choices: Choices,
  seed: number, notes: string[], used: Record<string, number>,
): Promise<Decision> {
  const tools = [...spec.tools.map((t) => TOOL_SPECS[t]), TOOL_SPECS.choose];
  const replies: Reply[] = [];
  let looked = 0;
  for (let round = 0; round < spec.maxToolCalls + 3; round++) {
    const reply = await provider.chat(messages, 1200, tools);
    replies.push(reply);
    if (!reply.toolCalls.length) {
      const parsed = parseChoice(s, reply.text);
      if ('action' in parsed) return { action: parsed.action, reason: reply.text, calls: replies.length, replies };
      messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: 'Call choose(choice, reason) with the number of your choice.' });
      continue;
    }
    messages.push({ role: 'assistant', content: reply.text ?? '', tool_calls: reply.wire });
    let chosen: Decision | null = null;
    for (const call of reply.toolCalls) {
      used[call.name] = (used[call.name] ?? 0) + 1;
      let result: string;
      const n = Number(call.args.choice);
      const option = choices.options.find((o) => o.n === n);
      if (call.name === 'choose') {
        if (option && !chosen) chosen = { action: option.action, reason: String(call.args.reason ?? ''), calls: replies.length, replies };
        result = option ? 'Chosen.' : `There is no choice ${call.args.choice}; choose a number from 1 to ${choices.options.length}.`;
      } else if (looked >= spec.maxToolCalls) {
        result = 'No more look-ups this move: call choose now.';
      } else {
        looked++;
        if (call.name === 'preview') result = option ? previewChoice(s, seat, option.action, seed) : `There is no choice ${call.args.choice}.`;
        else if (call.name === 'card') result = cardText(String(call.args.name ?? ''));
        else if (call.name === 'log') result = s.log.slice(-Math.min(40, Math.max(1, Number(call.args.count) || 8))).map((e) => `R${e.round} ${e.text}`).join('\n') + '\n(You are "LLM" in the log.)';
        else if (call.name === 'note') { notes.push(String(call.args.text ?? '').slice(0, 200)); if (notes.length > 6) notes.shift(); result = 'Noted.'; }
        else result = `There is no tool called ${call.name}.`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    if (chosen) return chosen;
    if (looked >= spec.maxToolCalls) messages.push({ role: 'user', content: 'That was your last look-up for this move: call choose(choice, reason) now.' });
  }
  return { action: null, reason: '', calls: replies.length, replies };
}

export async function playLlmGame(
  provider: Provider, persona: Persona, deck: DeckList, vs: DeckList, seed: number,
  budget: { remaining: () => number }, spec: PlayerSpec,
): Promise<LlmGame> {
  const seat: PlayerId = (seed % 2) as PlayerId;
  const decks: [DeckList, DeckList] = seat === 0 ? [deck, vs] : [vs, deck];
  const s: GameState = createGame({ decks, seed, names: seat === 0 ? ['LLM', 'Bot'] : ['Bot', 'LLM'] });
  const system = systemPrompt(persona, spec);
  const judgement = noJudgement();
  const notes: string[] = [];
  const toolCalls: Record<string, number> = {};
  let plan = '';
  let usage = noUsage();
  let llmMoves = 0, fallbacks = 0, ms = 0, calls = 0;
  const lines: string[] = [`# ${persona.name} (${spec.name} player): ${deck.name} vs ${vs.name} (bot), seed ${seed}`, ''];

  while (s.winner === null) {
    const p = s.prompt!.player;
    if (p !== seat) { apply(s, chooseAction(s, { random: mulberry(seed ^ s.actions) })); continue; }
    const choices = listChoices(s, { detail: spec.detail });
    if (!choices.multi && choices.options.length === 1) { apply(s, choices.options[0].action); continue; }
    if (budget.remaining() <= 0) { apply(s, chooseAction(s, { random: mulberry(seed ^ s.actions) })); fallbacks++; continue; }

    const memory = [
      spec.plan && plan ? `YOUR PLAN FROM YOUR LAST MOVE: ${plan}` : '',
      notes.length ? `YOUR NOTES:\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${describe(s, seat)}${memory ? `\n\n${memory}` : ''}\n\n${choicesText(s, { detail: spec.detail })}\n\n${spec.tools.length && !choices.multi ? 'Look up what you need, then call choose.' : ANSWER_REMINDER}` },
    ];
    const d = spec.tools.length && !choices.multi
      ? await decideByTools(provider, spec, messages, s, seat, choices, seed, notes, toolCalls)
      : await decideByText(provider, messages, s, choices);
    for (const r of d.replies) { usage = addUsage(usage, r.usage); ms += r.ms; }
    calls += d.calls;
    llmMoves++;
    if (spec.plan) plan = /^\s*plan\s*[:=]\s*(.+)$/im.exec(d.reason)?.[1]?.trim().slice(0, 200) ?? plan;

    let action = d.action;
    if (!action) {
      fallbacks++;
      action = chooseAction(s, { random: mulberry(seed ^ s.actions) });
      lines.push(`**R${s.round}** (no legal answer; the bot chose)`, '');
    } else {
      if (!choices.multi) judge(s, action, judgement, seed);
      const hand = s.players[seat].hand;
      const picked = 'uids' in action
        ? action.uids.map((u) => cardName(hand.find((c) => c.uid === u)!.id)).join(', ') || 'none'
        : choices.options.find((o) => JSON.stringify(o.action) === JSON.stringify(action))?.label;
      const reason = d.reason.replace(/\s*answer\s*[:=].*$/is, '').trim().replace(/\n+/g, ' ').slice(0, 400);
      const looked = d.calls > 1 && spec.tools.length ? ` _(${d.calls - 1} look-up${d.calls > 2 ? 's' : ''})_` : '';
      lines.push(`**R${s.round}** ${choices.question} → ${picked}${looked}`, `> ${reason}`, '');
    }
    apply(s, action);
  }

  const won = s.winner === 'draw' ? null : s.winner === seat;
  lines.push(`**Result:** ${won === null ? 'draw' : won ? 'the LLM won' : 'the bot won'} after ${s.round} rounds.`, '');

  // The report: what the game felt like from the persona's chair.
  let report: GameReport | null = null;
  if (budget.remaining() > 0) {
    const log = s.log.map((e) => `R${e.round} ${e.text}`).join('\n');
    const reply = await provider.chat([
      { role: 'system', content: `${rulesPrimer()}\n\nYOU\n${persona.style}` },
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
    secondsPerMove: llmMoves ? ms / 1000 / llmMoves : 0, callsPerMove: llmMoves ? calls / llmMoves : 0, toolCalls,
    usage, report, transcript: lines.join('\n'), judgement,
  };
}

/** Card names a report mentions, matched to real cards (reports sometimes misspell or invent). */
export function knownCards(names: string[], all: string[]): string[] {
  const byName = new Map(all.map((id) => [cardName(id).toLowerCase(), cardName(id)]));
  return names.map((n) => byName.get(n.toLowerCase().trim()) ?? [...byName.entries()].find(([k]) => k.includes(n.toLowerCase().trim()))?.[1]).filter((x): x is string => !!x);
}
