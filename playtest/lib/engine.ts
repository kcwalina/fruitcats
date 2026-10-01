// The engine, imported by path rather than as '@fruitcats/engine'. In a git worktree the package name can
// resolve to the main checkout's copy, with that checkout's card data, and a playtest has to test the cards
// in front of it. (A deploy once shipped new card images with old card stats that way.)
export * from '../../packages/engine/src/index';

// The engine has no cards of its own: load the sets playtests play (playtest.config.json `sets.play`) and no
// others, so a retired set's decks are never played and its cards never turn up in a generated or LLM-built deck.
// A released set's decks are the starter decks (the balance gate tests them all); a prototype set's cards are loaded
// but its decks aren't: play one by passing it as an extra deck (prototypeDecks()).
import { clearCatalog, registerSet } from '../../packages/engine/src/index';
import { CONTENT, type ContentSet } from '../../content';
import playtestConfig from '../playtest.config.json';

const PLAYED = new Set((playtestConfig as unknown as { sets: { play: string[] } }).sets.play);
/** The sets playtests play, in release order (a set that builds on another is registered after it). */
export const playedSets: ContentSet[] = CONTENT.filter((c) => PLAYED.has(c.data.set));
for (const code of PLAYED) if (!playedSets.some((c) => c.data.set === code)) throw new Error(`playtest.config.json sets.play: no set ${code} in content/`);
// Tests load every set first (packages/engine/test/setup.ts); a playtest sees only its own, there as here.
clearCatalog();
for (const c of playedSets) registerSet(c.data.status === 'released' ? c.data : { ...c.data, decks: {} }, c.plugin);

/** The decks of the played prototype sets, by key: to playtest them against the starter decks. */
export function prototypeDecks(): Record<string, NonNullable<ContentSet['data']['decks']>[string]> {
  return Object.assign({}, ...playedSets.filter((c) => c.data.status !== 'released').map((c) => c.data.decks ?? {}));
}

// What-if balance experiments: PLAYTEST_CARD_MODS='{"DW1-D08":{"cost":9}}' changes cards for this process and
// every worker it starts (they share the environment), so `npm run balance` can measure a proposed card change
// before anyone edits a set. Never set on PC2024 or in a deploy.
import { CARDS as ALL_CARDS, type Rules } from '../../packages/engine/src/index';

// What-if rule experiments, the same way: PLAYTEST_RULES_MODS='{"clashCandleCap":2}' plays every game of this process and
// its workers with other numbers for the rules (packages/engine/src/rules.ts). Never set on PC2024 or in a deploy.
export const RULE_MODS: Partial<Rules> = process.env.PLAYTEST_RULES_MODS ? JSON.parse(process.env.PLAYTEST_RULES_MODS) : {};
if (process.env.PLAYTEST_CARD_MODS) {
  for (const [id, change] of Object.entries(JSON.parse(process.env.PLAYTEST_CARD_MODS) as Record<string, object>)) {
    if (!ALL_CARDS[id]) throw new Error(`PLAYTEST_CARD_MODS: no card ${id}`);
    Object.assign(ALL_CARDS[id], change);
  }
}
