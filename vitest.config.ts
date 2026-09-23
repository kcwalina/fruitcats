import { defineConfig } from 'vitest/config';

// `.claude/worktrees/` holds checkouts of other branches, so without this a test run in one worktree
// executes the half-finished tests of another.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
