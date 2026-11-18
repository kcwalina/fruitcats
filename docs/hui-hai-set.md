# Hui Hai (HH1): the second deck in the Store

A deck of the Hui Hai, the tiny, invisible forest folk of the Ba Na (Bahnar) of Vietnam's Central Highlands (see
[folk-creatures.md](folk-creatures.md#hui-hai)). The owner picked them from the Vietnam research on 2026-09-27, chose
their style (the Hàng Trống "White Tiger"), and on 2026-09-28 asked for the full deck in the Store at $9.99.

Status: released (2027-01), not a starter: players get it from the Store. The data is in
`content/2027/01/hui-hai/set.json`; the deck's price is `"price": 999` on the deck, and the live API lists the set
in `STORE_SETS` (JR1 and HH1; SB1, the Starter Box, was listed too until the owner removed it on 2026-09-29).
Buying itself is still off everywhere (`BUYING` in `apps/web/src/flags.ts`), so the
Store shows the deck and its price, and "Add to cart" says "Coming soon". The prototype history (four cards, five art
passes) is in [vietnam-prototypes.md](vietnam-prototypes.md).

**Folkborn 0.6 (2026-10-01) and 0.7 (2026-10-02) redid this family's cards for the auto-battler**: tiers, copies, its trait, abilities in the fight, and in 0.7 a class for every unit and a new core deck ([folkborn-0.7-design.md](folkborn-0.7-design.md)). The names, art and lore below are current; the costs, stats and texts in the tables are the earlier game's. The cards as they are: `content/2027/01/hui-hai/set.json`.

## The creature

From Trần et al., on Bahnar forest animism (citing Guilleminet's Bahnar–French dictionary, 1959):

- The Hui Hai are invisible people of miniature size. The men are Hui Hai, the women Yă Hui Hai.
- They live in the forests and the streams.
- They are very small, but very strong.
- They throw stones at people who behave badly in the forest.
- From the same source: the Gơhlŏu, "an imaginary thing that lives in trees and smells good".

That is all the lore there is, from one source; the owner went ahead on it. The rest of the deck (the spring, the
bamboo, the waterfall, the hidden village, the rock that moved in the night) is the forest world those lines imply,
not further belief. Check the Guilleminet entry before adding lore. The Hui Hai are drawn as tiny spirits in leaf
clothes, never as a picture of the Ba Na people.

The tale on the deck's Collection page (`lore.story`) retells only those lines. Its banner (`HH1-banner`) is the forest
they live in, a stream over pebbles among ferns and bamboo, with no figures (`tools/draw_banners.py`, then
`tools/bleed_colour.py`).

## How it plays

**Stone for stone.** The family keyword is **Stone for Stone** (🪨): *when this unit is damaged and survives, deal 1
damage to an enemy unit.* Hurt a Hui Hai and a pebble comes back from nowhere. Many small Hello pings and a few
Guardians with Stone for Stone; tiny units with more Power than Health. Data only, no engine code.

Balance (balance:check, bots, 300 games a pair, 2026-09-28): 55% overall; Domowiki 41%, Pari 65%, Aluxes 61%, Jiaoren
52% (the Hui Hai side's win rate in each). The first version won 64%, and 89% against Pari, whose fragile flyers die to
one-point pings: Pebble's first side lost its every-round ping and her Stone for Stone aura, and Stones from Nowhere
went to cost 4 and two copies.

**0.1.2 (2026-09-28): Pebble Awakens at 5 or more in the Mist (was 4).** The first nightly run with all five folk
decks had Hui Hai at 57% overall, Pari at 34% and Aluxes at 37% against it. Pebble Awakened in 96% of games, by
round 4.5, and her Awakened side (every unit +1 Health and Stone for Stone) walls off Pari's and Aluxes' small
attackers. At 900 games a pairing: Hui Hai 56% → 52%, Pari against it 35% → 42%, Aluxes 38% → 42%, Jiaoren 47% →
50%, Domowiki 57% → 60%. Tried and dropped: her Awakened ping at 1 damage, Stones from Nowhere at cost 5, Hui Hai of
the Stream as a 1/1, The Hidden Village at cost 5, Old One of the Waterfall as a 5/6 (none moved the Pari or Aluxes
matchup by more than a point or two).

## Hero: Pebble (HH1-H01, Legendary, gold frame)

| Side | Name | Power | Text |
|---|---|---|---|
| first | Pebble, the Littlest Hui Hai | – | Exhaust: A unit you control gets +1 Power this round. Awaken: 5 or more Fabled and Creatures are in the Mist. |
| Awakened | Pebble, Keeper of the Stream | 3 | Your units get +1 Health and Stone for Stone. Exhaust: Deal 2 damage to an enemy unit. |

## The cards

| Card | Type | Idea |
|---|---|---|
| Hui Hai of the Stream | Creature 2, 1/2, Hello: 1 damage | A ripple where there is no fish |
| Yă Hui Hai, Lady of the Ferns | Fabled 4, 3/4, Guardian, Hello: 2 damage | The women are Yă Hui Hai |
| A Pebble at Your Feet | Charm 1, Ambush, 2 damage | They throw stones at those who behave badly |
| Hui Hai in the Ferns | Creature 1, 1/2, Stone for Stone | Invisible: the fern moved, there was no wind |
| Pebble-Thrower | Creature 1, 2/1 | Tiny but strong |
| Hui Hai at the Spring | Creature 2, 1/3, Guardian, Stone for Stone | They live in the streams |
| Boulder-Pusher | Creature 3, 4/2 | Tiny but strong |
| Hui Hai in the Bamboo | Creature 2, 2/2, Swift | The forest |
| Keeper of the Old Forest | Creature 3, 2/4, Guardian, Stone for Stone | They keep the forest |
| Gơhlŏu, the Sweet-Smelling | Creature 3, 2/3, Hello: draw | The imaginary thing in the trees that smells good |
| Moss-Mender Yă Hui Hai | Creature 4, 3/5, Hello: heal 2 from each | — |
| Old One of the Waterfall | Creature 7, 6/6, Guardian, Fierce, Stone for Stone | They live in the streams |
| Stones from Nowhere | Charm 4, 1 damage to each enemy | Stones, and nobody threw them |
| The Forest Remembers | Charm 4, Lucky, 4 damage | Behave badly in the forest |
| Nobody Threw It | Charm 1, Lucky, exhaust an enemy | Invisible throwers |
| A Pouch of River Pebbles | Talisman 1, +1 Power and Stone for Stone | Their stones |
| Grandfather Hui Hai, Mover of Rocks | Fabled 5, 4/5, Guardian, Stone for Stone, Hello: 2 damage | Very strong |
| The Hidden Village | Fabled 4, 3/3, Hello: 1 damage to each enemy | A whole folk you cannot see |
| The Rock That Moved in the Night | Fabled 8, 8/8, Fierce, Stone for Stone | Very strong |
| Small but Strong | Charm 1, Ambush, +2 Power | Very small, but very strong |

The deck is 50 cards: three of most, two of A Pebble at Your Feet and Stones from Nowhere, one of each Fabled.

## Art

Style: the Hàng Trống folk painting "White Tiger" (Bạch hổ), Hanoi, a traditional design, public domain
([Commons](https://commons.wikimedia.org/wiki/File:White_tiger_Hang_Trong.jpg)). The owner's bar, reached over five
passes (see [vietnam-prototypes.md](vietnam-prototypes.md)): a real hand-coloured folk painting in the tiger's own
bright gouache; figures mostly cream-white with small splotches of green and red and surprising accents (green eyes,
lilac-grey hair); colour spilling over the lines; folk faces of a few strokes; never cute game art. Family colour:
leaf green (#4E9A3A).

Drawn with `python tools/generate_art.py --set hh1 --model gpt-image-2 --quality high --jobs 2 --reference <the tiger>`,
then `python tools/bleed_colour.py` on each new picture, then `tools/compose_cards.py` (since retired: tcg renders the cards now, from `games/folkborn/sets/<set>/<set>.alex`: `npm run cards`). Each picture
was compared with the tiger (cream about a third, green a few percent, mean brightness near 189) and redrawn if not.
