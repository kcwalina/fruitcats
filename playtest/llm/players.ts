// The LLM players, as specs: what each one is shown, which tools it may use, and how it remembers. A new
// idea for a better player is a new entry here; `npm run llm-compare` plays the entries on the same deals and
// scores them against the bot (win rate, how often it agrees with the bot, value given up per move), and the
// best one becomes the default. Keep old entries: they are the baseline a new one has to beat.

export type ToolName = 'preview' | 'card' | 'note' | 'log';

export interface PlayerSpec {
  name: string;
  /** One line for reports. */
  about: string;
  /** Choices carry stats, what a play does and each attack's predicted result. */
  detail: boolean;
  /** The basic-strategy section follows the rules. */
  tips: boolean;
  /** Each reply ends with a one-line plan, shown to the player on its next move. */
  plan: boolean;
  /** Tools the player may call before choosing (then it chooses with the `choose` tool). */
  tools: ToolName[];
  /** Tool calls allowed per move before it must choose. */
  maxToolCalls: number;
  /** Reasoning effort, where the model takes one (gpt-oss: low, medium, high). */
  effort?: string;
}

export const PLAYERS: Record<string, PlayerSpec> = {
  plain: {
    name: 'plain', about: 'the rules, the table and bare choices; one call a move (the first player, 2026-09-24)',
    detail: false, tips: false, plan: false, tools: [], maxToolCalls: 0,
  },
  informed: {
    name: 'informed', about: 'adds stats and predicted results to each choice, and basic strategy',
    detail: true, tips: true, plan: false, tools: [], maxToolCalls: 0,
  },
  memory: {
    name: 'memory', about: 'informed, and it carries a one-line plan from move to move',
    detail: true, tips: true, plan: true, tools: [], maxToolCalls: 0,
  },
  agent: {
    name: 'agent', about: 'informed, with tools: preview a choice in the real engine, look up cards and the log, keep notes',
    detail: true, tips: true, plan: false, tools: ['preview', 'card', 'note', 'log'], maxToolCalls: 4,
  },
};

export function playerSpec(name: string): PlayerSpec {
  const spec = PLAYERS[name];
  if (!spec) throw new Error(`Unknown player ${name} (have: ${Object.keys(PLAYERS).join(', ')}).`);
  return spec;
}
