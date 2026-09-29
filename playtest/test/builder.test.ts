import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECKS, resolveDeck } from '../lib/engine';
import { runDeckBuild } from '../llm/builder';
import type { Provider } from '../llm/providers';

describe('deck build', () => {
  it('a build whose model call fails writes a summary that says why, not a run left to look abandoned', async () => {
    const reports = mkdtempSync(join(tmpdir(), 'fruitcats-build-'));
    process.env.PLAYTEST_REPORTS = reports;
    const failing: Provider = {
      name: 'fireworks-k3', model: 'kimi-k3',
      chat: async () => { throw new Error('Set FIREWORKS_API_KEY to use the fireworks-k3 provider.'); },
      listModels: async () => [], cost: () => 0,
    };
    await expect(runDeckBuild({ provider: failing, goal: 'a test deck', opponents: [resolveDeck(Object.keys(DECKS)[0])], candidates: 1, rounds: 1, games: 1 }))
      .rejects.toThrow('FIREWORKS_API_KEY');
    const [dir] = readdirSync(reports);
    expect(existsSync(join(reports, dir, 'summary.json'))).toBe(true);
    const summary = JSON.parse(readFileSync(join(reports, dir, 'summary.json'), 'utf8'));
    expect(summary.result).toBe('block');
    expect(summary.problems[0].text).toContain('FIREWORKS_API_KEY');
    delete process.env.PLAYTEST_REPORTS;
  });
});
