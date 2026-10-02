# Domowiki (DW1): the first folklore deck

Fruitcats is being re-themed: each deck is a family of creatures from folk mythology somewhere in the world, and
comes with a little about the creature and the culture it's from. Domowiki are the first, and the starter deck
everyone has. The Starter Box's three fruit-cat decks were first kept in the Store, free; the owner removed the
Starter Box from the game completely on 2026-09-29.

Status: released (2026-10), data in `content/2026/10/domowiki/set.json`. Last updated 2026-09-26. How to make the
next deck like this one: [designing-good-deck.md](designing-good-deck.md).

**Folkborn 0.6 (2026-10-01) redid this family's cards for the auto-battler**: tiers, copies, its trait and abilities that happen in the fight ([folkborn-0.6-design.md](folkborn-0.6-design.md)). The names, art and lore below are current; the costs, stats and texts in the tables are the earlier game's. The cards as they are: `content/2026/10/domowiki/set.json`.

## The creature

A **Domowik** (Polish; plural Domowiki; Russian *domovoi*, Ukrainian *domovyk*, Czech *děd*) is the house spirit of
Slavic folklore: every home had one. The set's `lore` holds the facts the game can show with the deck:

- The name means 'the one of the house'. Every home had its own Domowik, often thought to be the family's first ancestor.
- He usually looks like a small old man with a grey beard and a coat of soft fur. Some said he could look like the head of the family, or take the shape of a cat.
- He lives behind or under the stove, or under the threshold, and looks after the family, the children and the animals.
- Families left him bread and salt, porridge or milk, and good behaviour: he hates quarrels, swearing and a messy home.
- An angry Domowik bangs pots, hides tools, pinches sleepers and tangles hair. A very unhappy one leaves, and the house loses its luck.
- Moving house, families carried embers from the old stove, or an old shoe, and asked him along: 'Grandfather, come with us to the new home.'
- He braids the manes of the horses he likes and tires out the ones he doesn't.
- A warm, furry hand touching you at night was a sign of good times ahead; a cold one, of trouble.
- He has relatives: the Dvorovoi of the yard, the Bannik of the bathhouse, the Ovinnik of the barn, and in some tales a wife, the Kikimora or Domowicha.

Source: [Wikipedia, Domovoy](https://en.wikipedia.org/wiki/Domovoy).

## How it plays

The deck was copied from Mango Tango, a deck of the Starter Box (removed 2026-09-29), card for card: the same costs,
stats and rules, re-themed. Mango Tango was the proven, balanced ramp deck (extra Treats early, big units late), and
feeding the house spirit is exactly that fantasy: offerings (Treats) now, and the big spirits wake once the house is **Well-Fed**.

- **Well-Fed** (the family's condition, like Mango Tango's Lush): while you have 7 or more Offerings. Badge: 🍞.
- **Sprout** (put cards from the top of your deck into your Offerings) came from the Starter Box. Since the Starter
  Box was removed, it is defined in this set's `mechanics`, and the set needs no other set.
- Gameplay that follows the folklore more closely (angry Domowiki, moving house, the warm or cold hand) can come
  later, as the deck is tuned; nothing here needs engine code.

## Hero: Dziadziuś, Heart of the House (DW1-H01, Legendary)

| Side | Name | Power | Text |
|---|---|---|---|
| Kitten | Dziadziuś, Heart of the House | – | Exhaust: Ready one of your Treats. Awaken: You have 8 or more Treats. |
| Big Cat | Dziadziuś, Master of the House | 4 | Fierce. Exhaust: Ready two of your Treats. |

*Dziadziuś* is the affectionate Polish word for grandpa: families called their house spirit "grandfather". The hero
is the cutest Domowik of all, painted like the rest of the deck (the owner's call, 2026-09-26: a grand, glowing
"forefather god" looked like a Santa Claus and lost what makes the deck captivating). What marks him as the leader is
the card, not a halo: Legendary (the crown mark) and the only gold frame in the deck.

The engine still calls the leader a Hero Cat, with Kitten and Big Cat sides; renaming those is part of the wider
re-theme (docs/retheme-proposal.md).

## Lore in the cards

The deck isn't only Domowiki: it's the whole household of Slavic spirits, and every card is a real belief (the owner's
rule, 2026-09-26: lore-based variety, like *Domowik in a Cat's Shape*).

- **Babunia, Lady of the Cellar**: the Domowik's wife, the Domovikha, who lives in the cellar. Some say she came first.
- **Ovinnik of the Drying Barn**: keeps the fire in the grain-drying barn; won't help until he's been given his due.
- **Kłobuk, the Soggy Chick**: a Polish spirit like a drenched chick on a fence; take it in and it brings things home.
- **The House Snake**: the Domowik in a snake's shape under the threshold; harm it and the family's luck goes.
- **Domowik in a Cat's Shape**, **Kikimora**, **Dvorovoi**, **Bannik**, **Moving-Day Domowik** (the old boot and the
  embers), **Mane-Braiding Domowik**, **Warm Hand in the Night**, **Knotted Mane**, **Bread-and-Salt Greeter**.

## The deck (50 cards)

| ID | Name | Type | Cost | P/H | Text | Qty | Was (Mango Tango) |
|---|---|---|---|---|---|---|---|
| DW1-D01 | Stove Keeper | Critter | 1 | 1/2 | Hello: Ready one of your Treats. | 3 | Banana Monkey |
| DW1-D02 | Moving-Day Domowik | Critter | 1 | 1/1 | Hello: Sprout 1. | 3 | Kiwi Bird |
| DW1-D03 | Mane-Braiding Domowik | Critter | 2 | 2/2 | Zoomies. | 3 | Passionfruit Parrot |
| DW1-D04 | Keeper of the Door | Critter | 3 | 2/6 | Guardian. | 3 | Pineapple Armadillo |
| DW1-D05 | Ovinnik of the Drying Barn | Critter | 2 | 2/3 | Can't attack unless you're Well-Fed. | 3 | Lychee Sloth |
| DW1-D06 | Bread-and-Salt Greeter | Critter | 4 | 3/5 | Hello: Heal 2 from each unit you control. | 3 | Guava Capybara |
| DW1-D07 | Kikimora, the Night Spinner | Critter | 5 | 5/5 | Hello: If you're Well-Fed, draw 2 cards. | 3 | Mangosteen Tapir |
| DW1-D08 | Dvorovoi, Lord of the Yard | Critter | 8 | 6/7 | Guardian. Fierce. | 2 | Jackfruit Elephant |
| DW1-D09 | Bowl of Kasha | Trick | 3 | – | Sprout 2. | 3 | Tropical Rain |
| DW1-D10 | A Domowik's Temper | Trick | 4 | – | Lucky. Deal 5 damage to a unit. | 2 | Coconut Drop |
| DW1-D11 | Saucer of Milk | Trick | 1 | – | Pounce. A unit you control gets +2 Power this round. Ready one of your Treats. | 3 | Mango Smoothie |
| DW1-D12 | Old Bast Shoe | Toy | 2 | – | Attached unit gets +2 Power and +2 Health. | 2 | Sun Hat |
| DW1-D13 | Domowik in a Cat's Shape | Cat | 3 | 2/4 | Hello: Sprout 1. | 1 | Papaya, Beach Bum |
| DW1-D14 | Babunia, Lady of the Cellar | Cat | 5 | 4/5 | Guardian. Hello: Ready one of your Offerings. | 1 | Coconut, Island Guardian |
| DW1-D15 | Bannik of the Bathhouse | Cat | 8 | 8/8 | Fierce. Sneaky. | 1 | Durian, the Mighty Stink |
| DW1-D16 | Hearth Cricket | Critter | 1 | 2/1 |  | 3 | Pocket Hamster |
| DW1-D17 | The House Snake | Critter | 2 | 1/4 | Guardian. Lucky. | 3 | Garden Snail |
| DW1-D18 | Kłobuk, the Soggy Chick | Critter | 3 | 2/3 | Hello: Draw a card. | 3 | Mail Duck |
| DW1-D19 | Warm Hand in the Night | Trick | 1 | – | Pounce. A unit you control gets +2 Power this round. | 3 | Catnip |
| DW1-D20 | Knotted Mane | Trick | 1 | – | Lucky. Exhaust an enemy unit. | 2 | Nap Time |

## Balance changes

**0.1.1 (2026-09-27).** The playtests flagged Dvorovoi (+24 points in the games it was played), Bowl of Kasha (+15)
and Babunia (+13). Making each card uncastable showed what the deck really leans on: Domowiki fell from 48% to 35%
without Dvorovoi and to 41% without Babunia, the most per copy of any card, while Bowl of Kasha was ordinary (its flag
mostly came from long games). Nerfing the two alone left Domowiki at 43%, so Keeper of the Door, the deck's other
load-bearing card, got stronger: **Dvorovoi 6/7** (was 7/8), **Babunia readies one Offering** (was two), **Keeper of
the Door 2/6** (was 2/5). At 1,800 games a pairing: Domowiki 47% → 47%, Pari 49% → 46%, Aluxes 55% → 56%; the only
flag left is Dvorovoi at +14. Tried and dropped: Dvorovoi at cost 9 or without Fierce, Bowl of Kasha at cost 4 or Sprout
1, a 3/3 Ovinnik, a 4-cost Kikimora, a 2/2 Hearth Cricket (none gave back what the nerfs took), and Dziadziuś Awakening
at 7 Offerings (Domowiki 55%, Pari 42%).

## Art

A naive oil painting, redrawn 2026-09-27 after the owner's reference: a 1999 painting of a white church with a
brick-red roof under a turquoise sky. Thick, scraped paint, simplified shapes, whitewash and earth browns, and clear
(not saturated) colour: turquoise skies and walls, brick-red roofs and caps. Serious rather than cute; the Domowik is a
small old man in a rust-red cap. (The first art, a violet night with glowing bokeh, read as a picture book.)

Direction and one scene per card in `art/prompts.json`; drawn with `tools/generate_art.py --set dw1 --model gpt-image-2
--quality high --fidelity high --reference <the church painting, frame cropped off>` and composed with
`tools/compose_cards.py`, since retired (tcg renders the cards now, from `games/folkborn/sets/<set>/<set>.alex`: `npm run cards`). What made it work: one reference at a time (three at once were averaged into a
blander style), a short lead that points at the reference instead of describing a style in words, and asking for its
colour outright (without that the model painted it nearly monochrome).

## The old decks, in the Store (until 2026-09-29)

Zest Rush, Orchard Guard and Mango Tango each had `"price": 0` in the Starter Box's set.json. The Store showed them
with a **Get · Free** button: no cart and no checkout, so it worked while buying was off. The API grants the cards
(`POST /v1/store/get`, order status `free`), and only for a deck whose price is 0. The owner removed the Starter Box,
and with it these decks, on 2026-09-29.
