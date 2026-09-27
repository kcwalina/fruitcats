# Jiaoren (JR1): prototype deck

A deck of the jiaoren, the sea people of Chinese folklore (see [folk-creatures.md](folk-creatures.md#jiaoren)). The
owner picked them on 2026-09-27, after putting the Hedgehog Immortals on hold.

Status: prototype. Four cards so far, to judge the look before the full deck is designed. The data is in
`content/2026/12/jiaoren/set.json`; the game shows prototype cards only with `?prototypes`. Last updated 2026-09-27.

## The creature

A **jiaoren** (鮫人, *jiāorén*) lives in the South Sea. The old books agree on a few specific beliefs, and the set's
`lore` holds them:

- Jiaoren live in the water like fish and never stop weaving (*Soushen Ji* 12, *Shuyi Ji*).
- When a jiaoren weeps, the tears turn into pearls (same).
- They weave in the Dragon-Silk Palace under the South Sea; some of their silk is as white as frost (*Shuyi Ji*).
- Their silk, "dragon silk", cost more than a hundred pieces of gold, and clothes made of it go into water and come
  out dry (*Shuyi Ji*).
- They are also called *quanke*, "spring guests" (*Shuyi Ji*).
- A jiaoren once came out of the sea and stayed at a person's house for some days, selling silk. On leaving she asked
  for a plate, wept into it, and gave it to her host full of pearls (*Bowu Zhi*).
- Li Shangyin's Tang poem "The Ornamented Zither" speaks of the moonlit sea where the pearls have tears.

Left out on purpose: the story that the lamps in the First Emperor's tomb burned "mermaid oil", and the modern web
novel romance version.

## The four cards

| Card | Type | Rules (first sketch) | Belief |
|---|---|---|---|
| Zhu'er, the Littlest Jiaoren / Pearl of the Moonlit Sea (JR1-H01) | Hero, Legendary, gold frame | Exhaust: Ready one of your Offerings. Awaken: 8 or more Offerings. Awakened (3 Power): Exhaust: Ready two. | Tears that turn into pearls; the moonlit sea of Li Shangyin's poem |
| The Spring Guest (JR1-D01) | Creature, 3 cost, 2/3 | Goodbye: Ready two of your Offerings. | The guest who wept a plate of pearls for her host when she left |
| Weaver of the Sea Hall (JR1-D02) | Creature, 2 cost, 1/3 | Hello: Draw a card. | Jiaoren who never stop weaving, in the Dragon-Silk Palace |
| Dragon Silk (JR1-D03) | Talisman, 2 cost | Attached unit gets +3 Health and Guardian. | Silk that goes into water and comes out dry |

*Zhu'er* (珠儿) is "Little Pearl", an affectionate Chinese name. She is the cutest jiaoren, a small girl who laughs
pearls, as the hero rules ask ([designing-good-deck.md](designing-good-deck.md)).

The rules are a first sketch from existing abilities: pearls are Offerings. The hero borrows the Domowiki hero's
rules. The full deck needs its own play style (all three Starter Box decks are already used by the Domowiki, the Pari
and the Aluxes), to be designed once the owner likes the look.

## Art

The owner's style reference (2026-09-27) is a contemporary Chinese gongbi-style painting of a mermaid on a pale
jade-green ground, with coral and teal silks and scattered silver blossoms. It shows a bare-chested figure, so the
prompt uses only its style and every card is fully clothed. Jiaoren are drawn with a human upper body and a turquoise
fish tail, in coral and teal Chinese silk robes. Family colour: coral (#D9735F).

Drawn with `python tools/generate_art.py --set jr1 --model gpt-image-2 --quality high --jobs 1 --reference <image>`.
The reference itself belongs to its painter and is not in the repo.

## Cousins for the full deck

- The Muke, the hidden mountain folk who "trade with the jiaoren", per a Tang poem
  ([folk-creatures.md](folk-creatures.md#muke)).
- More from the lore: the Dragon-Silk Palace itself, the silk market where "jiao cloth" was sold beside pearls, a
  plate of pearls, frost-white silk.
