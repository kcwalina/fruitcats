import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// This checkout's own packages, always. A worktree without its own node_modules would otherwise find them through the
// main checkout's, and @fruitcats/store would load a second engine that has none of the cards (an empty Store).
const own = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// `.claude/worktrees/` holds checkouts of other branches, so without this a test run in one worktree
// executes the half-finished tests of another.
export default defineConfig({
  resolve: {
    alias: {
      '@fruitcats/engine': own('./packages/engine/src/index.ts'),
      '@fruitcats/store': own('./packages/store/src/index.ts'),
      '@fruitcats/match': own('./packages/match/src/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // The engine has no cards of its own: load the content sets before any test.
    setupFiles: ['./packages/engine/test/setup.ts'],
  },
});
