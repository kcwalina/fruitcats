# Jiaoren (JR1): the first deck in the Store

A deck of the jiaoren, the sea people of Chinese folklore (see [folk-creatures.md](folk-creatures.md#jiaoren)). The
owner picked them on 2026-09-27, after putting the Hedgehog Immortals on hold, liked the first four cards, and asked
for the full deck in the Store at $9.99.

Status: released (2026-12), not a starter: players get it from the Store. The data is in
`content/2026/12/jiaoren/set.json`; the deck's price is `"price": 999` on the deck, and the live API lists the set
with `STORE_SETS=SB1,JR1`. Buying itself is still off everywhere (`BUYING` in `apps/web/src/flags.ts`), so the Store
shows the deck and its price, and "Add to cart" says "Coming soon". Last updated 2026-09-27.

## The creature

A **jiaoren** (鮫人, *jiāorén*) lives in the South Sea. The set's `lore` holds the facts; in short:

- Jiaoren live in the water like fish and never stop weaving (*Soushen Ji* 12, *Shuyi Ji*).
- When a jiaoren weeps, the tears turn into pearls (same).
- They weave in the Dragon-Silk Palace under the South Sea; some of their silk is as white as frost (*Shuyi Ji*).
- Their silk, "dragon silk", cost more than a hundred pieces of gold, and clothes made of it go into water and come
  out dry (*Shuyi Ji*).
- They are also called *quanke*, "spring guests", and *quanxian* (*Shuyi Ji*). Zuo Si's *Wu Capital Rhapsody* (3rd
  century) calls them the guests of the deep, who are moved and weep pearls.
- A jiaoren once came out of the sea and stayed at a person's house for some days, selling silk. On leaving she asked
  for a plate, wept into it, and gave it to her host full of pearls (*Bowu Zhi*).
- Li Shangyin's Tang poem "The Ornamented Zither" speaks of the moonlit sea where the pearls have tears.
- Neighbours from other old books: pearl oysters that are full when the moon is full; the ice silkworm of Mount
  Yuanqiao, whose cloth won't wet or burn (*Shiyi Ji* 10); and the Muke, the hidden "wood guests" of the southern
  mountains, who trade timber unseen and write poems. Liu Yuxi's Tang poem "Song of the Mo Yao" says the mountain
  people "trade with the jiaoren and marry the Muke".

Left out on purpose: the story that the lamps in the First Emperor's tomb burned "mermaid oil", and the modern web
novel romance version. The Muke are drawn as small spirits seen from behind, never as a picture of a real people
(some scholars read the old accounts as Han descriptions of the region's first inhabitants).

## How it plays

**Every tear is a pearl.** The family keyword is **Pearl Tears** (💧): *when this unit is damaged and survives, ready
one of your Offerings.* A jiaoren who takes a hit hands you an Offering back in the same round, so you can answer at
once. Sturdy Guardians with Pearl Tears soak up attacks and pay for your next card; Goodbye cards (the Spring Guest,
the Muke Poet) leave something behind when they go. Defined in the set's `mechanics`; no engine code.

Balance (check-set, bots, 60 games per matchup, 2026-09-27): 47% overall; Zest Rush 47%, Orchard Guard 52%, Mango
Tango 43%, Domowiki 43%, Pari 47%, Aluxes 52%.

## Hero: Zhu'er (JR1-H01, Legendary, gold frame)

| Side | Name | Power | Text |
|---|---|---|---|
| first | Zhu'er, the Littlest Jiaoren | – | Your units have Pearl Tears. Exhaust: Heal 2 from a unit you control. Awaken: 4 or more Fabled and Creatures are in the Mist. |
| Awakened | Zhu'er, Pearl of the Moonlit Sea | 3 | Your units get +1 Health and Pearl Tears. Exhaust: Ready two of your Offerings. |

*Zhu'er* (珠儿) is "Little Pearl", an affectionate Chinese name. She is the cutest jiaoren, a girl of about six who
laughs so hard her tears come out as pearls. While she leads, every unit you have weeps pearls, and her healing lets
them be hurt again. She Awakens once the sea has taken its share (four units in the Mist, either side's), and rises
under the full moon of Li Shangyin's poem, pearls drifting around her.

## Lore in the cards

| Card | Type | Belief |
|---|---|---|
| The Spring Guest | Creature 3, 2/3, Goodbye: ready two Offerings | The guest who wept a plate of pearls for her host |
| Weaver of the Sea Hall | Creature 3, 2/3, Hello: draw | Jiaoren never stop weaving |
| Dragon Silk | Talisman 2, +3 Health and Guardian | Silk that goes into water and comes out dry |
| Pearl Oyster | Creature 1, 1/2, Hello: ready an Offering | Oysters are full when the moon is full |
| Jiaoren of the Tide Pools | Creature 1, 1/2, Pearl Tears | They live in the water like fish; their tears are pearls |
| Ice Silkworm | Creature 1, 2/1 | The ice silkworm of Mount Yuanqiao |
| Jiaoren Children at Play | Creature 2, 2/2, Swift | Life in the Dragon-Silk Palace |
| Guest from the Deep | Creature 2, 1/3, Guardian, Pearl Tears | Zuo Si's guests of the deep who weep pearls |
| Keeper of the Dragon-Silk Palace | Creature 3, 2/4, Guardian, Pearl Tears | The palace and its frost-white silk |
| Jiaoren Pearl-Healer | Creature 4, 3/5, Hello: heal 2 from each of your units | Pearl powder in Chinese medicine |
| Muke, the Wood Guests | Creature 5, 5/5, Hello: draw | The Muke's unseen, honest trade |
| Elder of the South Sea | Creature 8, 7/7, Guardian, Fierce, Pearl Tears | Jiaoren live beyond the South Sea |
| A Plate of Pearls | Charm 1, Ambush, +2 Power and ready an Offering | The guest's thank-you plate |
| The Sea Turns Rough | Charm 4, Lucky, 5 damage | The South Sea's storms |
| Moonlit Sea, Pearls with Tears | Charm 1, Lucky, exhaust an enemy | Li Shangyin's line |
| Frost-White Silk | Talisman 1, +2 Health and Pearl Tears | Silk as white as frost |
| Quanxian, First of the Springs | Fabled 5, 4/5, Guardian, Pearl Tears, Hello: ready two Offerings | *Quanxian*, a name for the jiaoren |
| The Muke Poet | Fabled 4, 3/4, Goodbye: draw two | A Muke's poem: "back to the mountain, to play with the moon" |
| The Oldest Weaver | Fabled 8, 8/8, Fierce, Pearl Tears | Jiaoren never stop weaving |
| Tears of Gratitude | Charm 1, Ambush, +2 Power | Pearls wept in thanks for a kindness |

The deck is 50 cards: three of each Common and most Uncommons, one of each Fabled.

## Art

The owner's style reference (2026-09-27) is a contemporary Chinese gongbi-style painting of a mermaid on a pale
jade-green ground, with coral and teal silks and scattered silver blossoms. It shows a bare-chested figure, so the
prompt uses only its style and every card is fully clothed. Jiaoren are drawn with a human upper body and a turquoise
fish tail, in coral and teal Chinese silk robes; the Muke cards move to a misty pine forest in the same palette.
Family colour: coral (#D9735F).

Drawn with `python tools/generate_art.py --set jr1 --model gpt-image-2 --quality high --jobs 1 --reference <image>`.
The reference itself belongs to its painter and is not in the repo.
