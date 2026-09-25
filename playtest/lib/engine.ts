// The engine, imported by path rather than as '@fruitcats/engine'. In a git worktree the package name can
// resolve to the main checkout's copy, with that checkout's card data, and a playtest has to test the cards
// in front of it. (A deploy once shipped new card images with old card stats that way.)
export * from '../../packages/engine/src/index';

// The engine has no cards of its own: load every set. Prototype sets' cards are loaded too, but not their
// decks: the balance gate treats every registered deck as a starter deck. Play a prototype deck by passing
// it as an extra deck (prototypeDecks()).
import { registerSet } from '../../packages/engine/src/index';
import { loadContent } from '../../content';
export { prototypeDecks } from '../../content';
loadContent(registerSet, { prototypes: true, prototypeDecks: false });

// What-if balance experiments: PLAYTEST_CARD_MODS='{"SB1-T08":{"cost":9}}' changes cards for this process and
// every worker it starts (they share the environment), so `npm run balance` can measure a proposed card change
// before anyone edits a set. Never set on PC2024 or in a deploy.
import { CARDS as ALL_CARDS } from '../../packages/engine/src/index';
if (process.env.PLAYTEST_CARD_MODS) {
  for (const [id, change] of Object.entries(JSON.parse(process.env.PLAYTEST_CARD_MODS) as Record<string, object>)) {
    if (!ALL_CARDS[id]) throw new Error(`PLAYTEST_CARD_MODS: no card ${id}`);
    Object.assign(ALL_CARDS[id], change);
  }
}
