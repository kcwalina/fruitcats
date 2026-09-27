import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SITE_BUDGET_BYTES, siteSize, sizeProblem } from '../deploy/size-guard';

// A deploy uploads the whole site in one zip inside Azure's 2-minute window; a site too big for it failed deploys for
// hours with only "exit code 1". The deploy refuses such a site before pushing, and says what's big.
describe('deploy size guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'size-guard-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'cards'));
  writeFileSync(join(dir, 'cards', 'a.webp'), Buffer.alloc(3000));
  writeFileSync(join(dir, 'cards', 'b.webp'), Buffer.alloc(2000));
  writeFileSync(join(dir, 'index.html'), Buffer.alloc(500));

  it('measures the site and its biggest folders', () => {
    const size = siteSize(dir);
    expect(size.bytes).toBe(5500);
    expect(size.files).toBe(3);
    expect(size.folders[0]).toEqual(['cards', 5000]);
  });

  it('lets a site within the budget through', () => {
    expect(sizeProblem(siteSize(dir), 10_000)).toBeNull();
  });

  it('refuses a site over the budget, naming the biggest folder', () => {
    const problem = sizeProblem(siteSize(dir), 4000);
    expect(problem).toMatch(/over the/);
    expect(problem).toMatch(/cards/);
  });

  it('keeps the budget inside what uploads in Azure\'s 2-minute window', () => {
    expect(SITE_BUDGET_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});
