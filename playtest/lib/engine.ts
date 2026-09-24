// The engine, imported by path rather than as '@fruitcats/engine'. In a git worktree the package name can
// resolve to the main checkout's copy, with that checkout's card data, and a playtest has to test the cards
// in front of it. (A deploy once shipped new card images with old card stats that way.)
export * from '../../packages/engine/src/index';
