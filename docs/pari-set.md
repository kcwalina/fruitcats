# Pari (PR1): the second folklore deck

The second deck of the folklore re-theme ([folk-creatures.md](folk-creatures.md)), after the Domowiki
([domowiki-set.md](domowiki-set.md)). It is a family of pari, the winged beings of Persian tales, and of the
people, animals and places in their stories.

Status: released (2026-10), a starter deck: every player has it, next to the Domowiki. The data is in
`content/2026/10/pari/set.json`. Last updated 2026-09-26.

**Folkborn 0.6 (2026-10-01) and 0.7 (2026-10-02) redid this family's cards for the auto-battler**: tiers, copies, its trait, abilities in the fight, and in 0.7 a class for every unit and a new core deck ([folkborn-0.7-design.md](folkborn-0.7-design.md)). The names, art and lore below are current; the costs, stats and texts in the tables are the earlier game's. The cards as they are: `content/2026/10/pari/set.json`.

## The creature

A **pari** (plural pari; English *peri*) is a winged being of Persian folklore. The tales spread across Turkey,
Kurdistan, Central Asia, Afghanistan, Pakistan and India. The set's `lore` holds the facts the game can show with
the deck. In short:

- In the oldest Persian books, the pairikas were shooting stars, and not kind at all. Over the centuries the
  pari became the most beautiful and kindest beings in the tales. Persians called them "those who are better
  than we", and *pari* is still a word for a lovely person.
- They live in Paristan, around Mount Qāf, a mountain of emerald that rings the world.
- They come in companies of three, seven or forty, and can take the shape of doves.
- People usually met them bathing. A pari could put on a coat of feathers and fly away as a bird.
- The divs, the hairy giants of the tales, hung captured pari in iron cages on the highest trees, and their
  friends brought them sweet scents. This comes to us through English writers of the 1700s and 1800s, and the
  lore says so.
- Many named pari and pari tales: Manar al-Sana, the bird-maiden of the Thousand and One Nights; Pari Banu and
  her tiny brother Schaibar; Asman Pari, queen of Qāf in the Hamzanama; the Turkish Orange-Peris; the pari who
  carried the sleeping Zin to Mem in the Kurdish tale.
- In the mountains of Chitral, fairies own the wild goats and ibex, help hunters, and help with household chores.

Sources: in the set's `lore.sources`. The main ones are [Wikipedia, Parī](https://en.wikipedia.org/wiki/Par%C4%AB)
and [Encyclopaedia Iranica, PAIRIKĀ](https://www.iranicaonline.org/articles/pairika/).

Left out on purpose:

- The *parikhon* healers and pari possession: a living practice in Central Asia.
- The early "rat sorceress" and succubus pairikas: dark.
- The Zoroastrian feast for the daughter of the fairy king: a living rite.
- The Middle Persian origin stories: dark.

## How it plays

The owner asked for gameplay that comes from the mythology, not a reskinned deck. So the rules follow the tales:

- **Company** (the family condition, badge 🕊️): while you control 3 or more units, Company bonuses are on.
  Pari come in companies. Company works as a label, like the Starter Box's Zest did: "Company: enters ready."
- **Feather Coat** (a keyword): "Goodbye: Summon a 1/1 Dove." The pari puts on her feather coat and flies off as
  a dove. The Dove (PR1-K01) is a token.
- **Flying is Sneaky.** Many pari fly over Guardians. *Pari* may come from the word for "wing".
- **The Orange-Peri** wilts (takes 1 damage, and has 1 Health) unless she is the third card you play in a round.
  In the Turkish tale, only the third Orange-Peri is given water in time.
- **The hero Awakens when her company has gathered**: when you control 3 or more units.

So the Pari are a fast, wide, flying deck: weak one at a time, strong together, and hard to pin down. The Domowiki
are the opposite, a slow deck that feeds the house and wakes the big spirits.

Everything is card data. No engine or plugin code was needed; it uses `controlUnits`, `playedThisRound`,
`summon` and a keyword mechanic with a `goodbye` ability. The costs, stats and copy counts started from Zest
Rush's curve, the proven fast deck of the Starter Box (removed from the game on 2026-09-29), and were tuned from
there.

**Balance** (2026-09-26, bots, 500 games per matchup; Zest Rush, Orchard Guard and Mango Tango were the Starter Box
decks, since removed):

| Against | Zest Rush | Orchard Guard | Mango Tango | Domowiki |
|---|---|---|---|---|
| Pari wins | 47% | 41% | 55% | 55% |

The deploy's `balance:check` gives Pari 49% against the starter decks. The tuning:

- Awakening at 4 units was too slow (43% overall, 35% against Zest Rush).
- Awakening at 3 units with an Awakened Power of 3 was too strong (55%, 60% against the ramp decks).
- Awakening at 3 units with an Awakened Power of 2 is the version shipped here.

The Orange-Peri shows below its deck's rate in bot games (38%), because the bots hold it back.

## Hero: Parijan (PR1-H01, Legendary)

| Side | Name | Power | Text |
|---|---|---|---|
| First | Parijan, the Littlest Pari | – | Exhaust: A unit you control gains Sneaky this round. Awaken: You control 3 or more units. |
| Awakened | Parijan, Wings over Qāf | 2 | Exhaust: A unit you control gets +2 Power and Sneaky this round. |

*-jan* ("dear") is the everyday Persian word of affection, so Parijan means "dear pari". She is the littlest pari,
with wings too big for her. On her first side she sits on an almond branch, smelling a narcissus. Awakened, she
flies high over Mount Qāf with the doves. The gold frame and Legendary mark her as the hero, not a halo.

## Lore in the cards

| ID | Name | Type | Cost | P/H | Text | Qty | From the lore |
|---|---|---|---|---|---|---|---|
| PR1-D01 | Dove-Shaped Pari | Critter | 1 | 1/1 | Feather Coat. | 3 | Pari take the shape of doves |
| PR1-D02 | Orange-Peri | Critter | 1 | 3/1 | Hello: Unless you've played 2 other cards this round, deal 1 damage to Orange-Peri. | 3 | Turkish tale: only the third is given water |
| PR1-D03 | Murghatipi, the Bird Fairy | Critter | 1 | 2/1 | Sneaky. | 3 | A Chitrali fairy name meaning "bird fairy" |
| PR1-D04 | Pari at the Pool | Critter | 2 | 3/2 | Company: enters ready. | 3 | People met pari bathing; her sisters call |
| PR1-D05 | Gale-Bringer of the High Lakes | Critter | 3 | 3/2 | Zoomies. Sneaky. | 3 | Unseen pari of the mountain lakes bring gales |
| PR1-D06 | Súči of the Hunt | Critter | 3 | 3/3 | Hello: Deal 1 damage to a unit. Company: deal 2 instead. | 3 | Kalasha mountain fairies help hunters |
| PR1-D07 | Markhor of the Mothers | Critter | 4 | 4/3 | Fierce. | 3 | The fairies own the wild goats |
| PR1-D08 | Pari on a Wonder-Camel | Critter | 5 | 4/4 | Zoomies. Sneaky. | 2 | Miniatures of pari on composite camels |
| PR1-D09 | Ibex Kid | Critter | 1 | 2/1 | | 3 | The mountain pari's herds |
| PR1-D10 | Lookout on Mount Qāf | Critter | 2 | 1/4 | Guardian. Lucky. | 3 | The emerald mountain around the world |
| PR1-D11 | Khangi, the Helpful One | Critter | 3 | 2/3 | Hello: Draw a card. | 3 | Chitral's household fairies |
| PR1-D12 | Falling Star | Trick | 1 | – | Pounce. Lucky. Deal 2 damage to a unit. | 3 | The oldest books: pairikas are shooting stars |
| PR1-D13 | Mountain Gale | Trick | 3 | – | Deal 3 damage to a unit. Company: deal 5 instead. | 2 | Pari bring the gales |
| PR1-D14 | Choicest Odours | Trick | 2 | – | Ready an exhausted unit you control. Heal 2 from it. | 2 | Friends bring sweet scents to caged pari |
| PR1-D15 | Zangwar, the Marching Tune | Trick | 1 | – | Pounce. A unit you control gets +2 Power this round. | 3 | Chitral: people and fairies march to one tune |
| PR1-D16 | Carried Off Asleep | Trick | 1 | – | Lucky. Exhaust an enemy unit. | 2 | Mem and Zin: pari carry the sleeping Zin |
| PR1-D17 | Pari Banu's Pocket Tent | Toy | 1 | – | Attached unit gets +3 Health. | 3 | Her tent fits in a hand and shelters an army |
| PR1-D18 | Manar al-Sana, the Bird-Maiden | Fabled | 3 | 3/3 | Zoomies. Feather Coat. Hello: Ready another unit you control. | 1 | She finds her feather robe and flies home |
| PR1-D19 | Asman Pari, Queen of Qāf | Fabled | 4 | 3/4 | Hello: Deal 1 damage to each enemy unit. | 1 | *Asman* is "sky"; queen of Qāf in the Hamzanama |
| PR1-D20 | Schaibar, Pari Banu's Brother | Fabled | 5 | 5/5 | Fierce. Once per round, after Schaibar defeats a unit in combat, ready him. | 1 | A foot and a half tall, with a 30-foot beard and an iron bar |
| PR1-K01 | Dove | token | – | 1/1 | | – | Feather Coat |

## Art

The art is a flat Persian folk painting in gouache on a saffron-gold ground with small gold dots, following the
owner's reference image (2026-09-26). It has many-coloured layered wings, red robes with white blossoms, long
lapis-blue sashes, flowering branches and small blue birds.

The frame is lapis blue, so the saffron pictures stand out and the hero's gold frame stays hers alone.

How it was drawn:

- Direction and one subject per card are in `art/prompts.json`.
- The pictures were drawn with `tools/generate_art.py --set pr1 --model gpt-image-2 --quality high --jobs 1
  --reference <the owner's image>`. Every picture is drawn from the reference, never from a description alone.
- The cards were composed with `tools/compose_cards.py`, since retired: tcg renders the cards now, from `games/folkborn/sets/<set>/<set>.alex`: `npm run cards`.
- The reference image isn't in the repo.

## Released

The owner approved the deck on 2026-09-26. It is `released` and `starter`, so every player has both the Pari
and the Domowiki. Parijan comes in the gold finish, like Dziadziuś (`apps/web/src/collection.ts`).
