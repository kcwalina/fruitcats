# Domowiki (DW1): the first folklore deck

Fruitcats is being re-themed: each deck is a family of creatures from folk mythology somewhere in the world, and
comes with a little about the creature and the culture it's from. Domowiki are the first, and the starter deck
everyone has. The Starter Box's three fruit-cat decks stay in the game data, but are no longer in anyone's
collection: they're in the Store, free, for anyone who wants them.

Status: released (2026-10), data in `content/2026/10/domowiki/set.json`. Last updated 2026-09-26.

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

The deck is the Mango Tango deck, card for card: the same costs, stats and rules, re-themed. Mango Tango is the
proven, balanced ramp deck (extra Treats early, big units late), and feeding the house spirit is exactly that
fantasy: offerings (Treats) now, and the big spirits wake once the house is **Well-Fed**.

- **Well-Fed** (the family's condition, like Lush): while you have 7 or more Treats. Badge: 🍞.
- **Sprout** is the Starter Box's action (put cards from the top of your deck into your Treats), so the set
  `requires` SB1.
- Gameplay that follows the folklore more closely (angry Domowiki, moving house, the warm or cold hand) can come
  later, as the deck is tuned; nothing here needs engine code.

## Hero: Praszczur, the First Forefather (DW1-H01, Legendary)

| Side | Name | Power | Text |
|---|---|---|---|
| Kitten | Praszczur, the First Forefather | – | Exhaust: Ready one of your Treats. Grow Up: You have 8 or more Treats. |
| Big Cat | Praszczur, Father of All Houses | 4 | Fierce. Exhaust: Ready two of your Treats. |

A deck's hero must read as more exalted than every other card in it (the owner's rule, 2026-09-26). Folklore has no
king of the Domowiki, but it has something higher: folklorists describe each Domowik as the household's own piece of
**Rod**, the god of kin and ancestors, and the Polish **praszczur** ("the first forefather") shares its root with
**Chur**, the ancestor god who guarded the hearth. So the hero is the forefather every Domowik descends from:
enthroned and crowned with wheat as the Kitten, and as the Big Cat a radiant spirit over a whole village, blessing
every house's hearth. It is Legendary (the crown mark) and the only card in the deck with a gold frame.

The engine still calls the leader a Hero Cat, with Kitten and Big Cat sides; renaming those is part of the wider
re-theme (docs/retheme-proposal.md).

## The deck (50 cards)

| ID | Name | Type | Cost | P/H | Text | Qty | Was |
|---|---|---|---|---|---|---|---|
| DW1-D01 | Stove Keeper | Critter | 1 | 1/2 | Hello: Ready one of your Treats. | 3 | Banana Monkey |
| DW1-D02 | Moving-Day Domowik | Critter | 1 | 1/1 | Hello: Sprout 1. | 3 | Kiwi Bird |
| DW1-D03 | Mane-Braiding Domowik | Critter | 2 | 2/2 | Zoomies. | 3 | Passionfruit Parrot |
| DW1-D04 | Grandfather Domowik | Critter | 3 | 2/5 | Guardian. | 3 | Pineapple Armadillo |
| DW1-D05 | Sleepy Stove-Napper | Critter | 2 | 2/3 | Can't attack unless you're Well-Fed. | 3 | Lychee Sloth |
| DW1-D06 | Bread-and-Salt Greeter | Critter | 4 | 3/5 | Hello: Heal 2 from each unit you control. | 3 | Guava Capybara |
| DW1-D07 | Kikimora, the Night Spinner | Critter | 5 | 5/5 | Hello: If you're Well-Fed, draw 2 cards. | 3 | Mangosteen Tapir |
| DW1-D08 | Dvorovoi, Lord of the Yard | Critter | 8 | 7/8 | Guardian. Fierce. | 2 | Jackfruit Elephant |
| DW1-D09 | Kasha for Grandfather | Trick | 3 | – | Sprout 2. | 3 | Tropical Rain |
| DW1-D10 | Grandfather's Temper | Trick | 4 | – | Lucky. Deal 5 damage to a unit. | 2 | Coconut Drop |
| DW1-D11 | Saucer of Milk | Trick | 1 | – | Pounce. A unit you control gets +2 Power this round. Ready one of your Treats. | 3 | Mango Smoothie |
| DW1-D12 | Old Bast Shoe | Toy | 2 | – | Attached unit gets +2 Power and +2 Health. | 2 | Sun Hat |
| DW1-D13 | Domowik in a Cat's Shape | Cat | 3 | 2/4 | Hello: Sprout 1. | 1 | Papaya, Beach Bum |
| DW1-D14 | First Master of the House | Cat | 5 | 4/5 | Guardian. Hello: Ready two of your Treats. | 1 | Coconut, Island Guardian |
| DW1-D15 | Bannik of the Bathhouse | Cat | 8 | 8/8 | Fierce. Sneaky. | 1 | Durian, the Mighty Stink |
| DW1-D16 | Hearth Cricket | Critter | 1 | 2/1 |  | 3 | Pocket Hamster |
| DW1-D17 | Threshold Hedgehog | Critter | 2 | 1/4 | Guardian. Lucky. | 3 | Garden Snail |
| DW1-D18 | Whispering Domowik | Critter | 3 | 2/3 | Hello: Draw a card. | 3 | Mail Duck |
| DW1-D19 | Warm Hand in the Night | Trick | 1 | – | Pounce. A unit you control gets +2 Power this round. | 3 | Catnip |
| DW1-D20 | Knotted Mane | Trick | 1 | – | Lucky. Exhaust an enemy unit. | 2 | Nap Time |

## Art

Painterly oil-painting folk tale: deep violet night, glowing bokeh, warm ember light, as in the owner's prototype
cards (2026-09-26). Direction and one subject per card in `art/prompts.json`; drawn with `tools/generate_art.py
--set dw1 --model gpt-image-2 --reference <the prototype art>` and composed with `tools/compose_cards.py --set dw1`.

## The old decks, in the Store

Zest Rush, Orchard Guard and Mango Tango each have `"price": 0` in the Starter Box's set.json. The Store shows them
with a **Get · Free** button: no cart and no checkout, so it works while buying is off. The API grants the cards
(`POST /v1/store/get`, order status `free`), and only for a deck whose price is 0.
