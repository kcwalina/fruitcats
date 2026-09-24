// LLM providers: anything that speaks the OpenAI chat-completions API. That covers PC2024's model node, a
// local Ollama or LM Studio, Fireworks and Azure Foundry, so one client is enough. Providers are named in
// playtest.config.json; keys come from environment variables and never from the file.

import config from '../playtest.config.json';
import { playableHeroes, randomDeck } from '../balance/decks';
import { mulberry } from '../lib/rng';

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  /** Header the key goes in: 'Authorization' (as a Bearer token, the default) or e.g. 'api-key' (Azure). */
  apiKeyHeader?: string;
  /** Sent with every request, e.g. { "reasoning_effort": "low" } for gpt-oss. */
  extraBody?: Record<string, unknown>;
  pricesPerMillion?: { input: number; cachedInput?: number; output: number };
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface Usage { input: number; cachedInput: number; output: number }

export interface Reply { text: string; usage: Usage; ms: number }

export interface Provider {
  name: string;
  model: string;
  chat(messages: ChatMessage[], maxTokens?: number): Promise<Reply>;
  listModels(): Promise<string[]>;
  cost(usage: Usage): number | null;
}

const expand = (s: string) => s.replace(/\$\{(\w+)\}/g, (_m, v: string) => {
  const value = process.env[v];
  if (!value) throw new Error(`Environment variable ${v} is not set.`);
  return value.replace(/\/$/, '');
});

export function providerNames(): string[] {
  return Object.keys(config.providers);
}

/**
 * A stand-in that answers every question with a random legal choice, for trying the pipeline out without a
 * model or a bill: `--provider fake`.
 */
function fakeProvider(): Provider {
  let n = 0;
  return {
    name: 'fake',
    model: 'random',
    async chat(messages) {
      const prompt = messages[messages.length - 1].content;
      const rnd = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      let text: string;
      if (/Reply with only (a |the corrected )?JSON array/.test(prompt)) {
        const count = Number(/Design (\d+)/.exec(messages[1]?.content ?? '')?.[1] ?? 2);
        const decks = Array.from({ length: count }, (_, i) => {
          const hero = playableHeroes()[i % playableHeroes().length];
          const d = randomDeck(mulberry(i + 1), hero, undefined, `fake ${i + 1}`);
          return { name: `fake ${i + 1}`, idea: 'A random legal deck.', hero, cards: d.cards };
        });
        text = JSON.stringify(decks);
      } else if (/Reply with only a JSON object/.test(prompt)) {
        text = JSON.stringify({ summary: 'A fake playtester played at random.', unfair: [], suspectCards: [], confusing: [], fun: 3 });
      } else if (/list exactly (\d+) H numbers|discard exactly (\d+)/.test(prompt)) {
        const count = Number(/exactly (\d+)/.exec(prompt)![1]);
        text = `Answer: ${Array.from({ length: count }, (_, i) => `H${i + 1}`).join(' ')}`;
      } else if (/Mulligan:/.test(prompt)) {
        text = 'Answer: none';
      } else {
        const options = [...prompt.matchAll(/^ {2}(\d+)\. /gm)].map((m) => Number(m[1]));
        text = `Random pick.\nAnswer: ${options[Math.floor(rnd() * options.length)] ?? 1}`;
      }
      return { text, usage: { input: Math.ceil(prompt.length / 4), cachedInput: 0, output: 10 }, ms: 0 };
    },
    async listModels() { return ['random']; },
    cost() { return 0; },
  };
}

export function getProvider(name: string, model?: string): Provider {
  if (name === 'fake') return fakeProvider();
  const cfg = (config.providers as Record<string, ProviderConfig>)[name];
  if (!cfg) throw new Error(`No provider "${name}" in playtest.config.json (have: ${providerNames().join(', ')}).`);
  const baseUrl = expand(cfg.baseUrl).replace(/\/$/, '');
  const chosen = model ?? cfg.model;
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.apiKeyEnv) {
      const key = process.env[cfg.apiKeyEnv];
      if (!key) throw new Error(`Set ${cfg.apiKeyEnv} to use the ${name} provider.`);
      if (!cfg.apiKeyHeader || cfg.apiKeyHeader.toLowerCase() === 'authorization') h.authorization = `Bearer ${key}`;
      else h[cfg.apiKeyHeader] = key;
    }
    return h;
  };

  async function post(body: unknown, attempt = 1): Promise<Response> {
    const r = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
      .catch((e: Error) => { throw new Error(`${name}: ${e.message}`); });
    // Busy (a GPU lease being handed over, a rate limit): wait and try again a few times.
    if ((r.status === 429 || r.status === 503 || r.status === 502) && attempt < 6) {
      await new Promise((res) => setTimeout(res, 2000 * attempt));
      return post(body, attempt + 1);
    }
    return r;
  }

  return {
    name,
    model: chosen,
    async chat(messages, maxTokens = 1200) {
      const started = Date.now();
      const r = await post({ model: chosen, messages, max_tokens: maxTokens, temperature: 0.7, ...cfg.extraBody });
      if (!r.ok) throw new Error(`${name} ${chosen}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      const data = await r.json() as {
        choices: { message: { content: string | null; reasoning_content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const u = data.usage ?? {};
      return {
        text: data.choices[0]?.message?.content ?? '',
        usage: { input: u.prompt_tokens ?? 0, cachedInput: u.prompt_tokens_details?.cached_tokens ?? 0, output: u.completion_tokens ?? 0 },
        ms: Date.now() - started,
      };
    },
    async listModels() {
      const r = await fetch(`${baseUrl}/models`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status} listing models`);
      const data = await r.json() as { data?: { id: string }[] };
      return (data.data ?? []).map((m) => m.id);
    },
    cost(usage) {
      const p = cfg.pricesPerMillion;
      if (!p) return null;
      const fresh = usage.input - usage.cachedInput;
      return (fresh * p.input + usage.cachedInput * (p.cachedInput ?? p.input) + usage.output * p.output) / 1e6;
    },
  };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, cachedInput: a.cachedInput + b.cachedInput, output: a.output + b.output });
export const noUsage = (): Usage => ({ input: 0, cachedInput: 0, output: 0 });
export const nightlyConfig = () => config.nightly;
