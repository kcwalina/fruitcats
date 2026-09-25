// The Starter Box's plugin: what its data can't say. It imports only types from the engine, so the
// engine runs without it and the set is the only thing that knows it exists.

import type { AiContext, Plugin } from '../../../../packages/engine/src/cards';
import type { Action } from '../../../../packages/engine/src/types';

/**
 * Citrus's Zest pays off only if another card was played earlier in the round, which the bot's one-step
 * lookahead can't see. So if its favourite move is a Zest card played as the first card of the round,
 * play a worthwhile cheaper card first when there are enough Treats left for the Zest card after it.
 */
function zestFirst(ctx: AiContext): Action | null {
  const { s, p, chosen, candidates, passScore } = ctx;
  if (chosen.t !== 'play' || (s.players[p].playedThisRound ?? 0) > 0) return null;
  const me = s.players[p];
  const isZest = (id: string) => ctx.usesCondition(id, 'Zest');
  const zestCard = me.hand.find((c) => c.uid === chosen.uid);
  if (!zestCard || !isZest(zestCard.id)) return null;
  const cost = (id: string) => ctx.cardCost(id);
  const ready = me.pantry.filter((t) => !t.exhausted).length;
  const budget = ready - cost(zestCard.id);
  const openers = candidates.filter((a) => {
    if (a.t !== 'play' || a.uid === chosen.uid) return false;
    const card = me.hand.find((c) => c.uid === a.uid);
    return !!card && !isZest(card.id) && cost(card.id) <= budget;
  });
  if (!openers.length) return null;
  const opener = ctx.best(openers);
  return opener.score > passScore + 0.3 ? opener.action : null;
}

const plugin: Plugin = {
  id: 'starter-box',
  ai: { refineAction: zestFirst },
};
export default plugin;
