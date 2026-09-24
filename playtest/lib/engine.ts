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
