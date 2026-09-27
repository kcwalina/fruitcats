# Folkborn — Starter Box Card List

**Set code:** `SB1` · **Version 0.3 (playtest draft)** · Rules: see the [Rulebook](rulebook.md)

The Starter Box contains three ready-to-play 50-card decks built to teach the game and to be a fair fight against each other:

- **Zest Rush** — led by *Sunny, the Lemon Lynx* (Citrus). Fast and aggressive: hit early, hit often, finish before the opponent stabilises.
- **Orchard Guard** — led by *Pippin, the Apple Ragdoll* (Orchard). Patient and sturdy: wall up with Guardians, heal, punish attackers, win the long game.
- **Mango Tango** — led by *Tango, the Mango Bengal* (Tropical), the mightiest Hero. Laid-back, then enormous: gather extra Offerings early, then drop giants nobody else can afford.

All three decks share the same neutral **Wildfolk** core (14 cards; Orchard Guard trades its Garden Snails for more Orchard muscle), so new players learn one common core.

**Totals:** 3 Heroes · 9 Fabled · 36 family cards · 5 Wildfolk cards = **53 unique cards**, 150 deck cards.

### Classes and signature mechanics

Each family is a class with its own signature mechanic (rulebook §3.3 and §850):

- **Citrus — Zest:** "Zest:" bonuses apply if you've already played another card this round. Open with a cheap card, then follow up.
- **Orchard — Ripen:** at the start of each round a Ripen unit gets +1/+1, up to +2/+2. The longer it survives, the bigger it gets.
- **Tropical — Sprout N & Lush:** Sprout turns the top N cards of your deck into extra Offerings; Lush cards get their bonus while you have 7+ Offerings.

### How to read the tables

`Cost` = Offerings to play · `P/H` = Power / Health · `Qty` = copies in the starter deck. Keywords are defined in the rulebook, section 10.

### Rarity

Every card carries a rarity mark on its type line, next to its number. Rarity is cosmetic: it never changes the rules or deck building.

| Mark | Rarity | In the Starter Box |
|---|---|---|
| bronze circle | Common | Creatures that cost 3 or less (19) |
| silver diamond | Uncommon | Creatures that cost 4 or more, every Charm and Talisman (22) |
| gold star | Rare | the Fabled cards (9) |
| crown | Legendary | the Heroes (5) |

A card's rarity is set in its set's data (`content/2026/09/starter-box/set.json`). How a particular copy is printed is its *finish*, which belongs to the copy, not the card. Every card exists in each finish, and the finish is the card's chrome: its frame, the art's border, the edges of its name banner and type line, and its cost ring.

| Finish | Chrome | In the app |
|---|---|---|
| Standard | the family's colours | — |
| Foil | holographic silver | a rainbow sheen that follows your finger |
| Gold | polished gold | a warm light sweeping across |
| Prismatic | a rainbow, all the way round | a stronger sheen, twinkles, and a glow that runs through every colour |

### Design budget (used to stat every card)

A plain Creature of cost *N* gets **Power + Health = 2N + 1**. Keywords and effects are paid for out of that budget: Guardian ≈ 1, Swift ≈ 1, Sneaky ≈ 2, Fierce ≈ 2, Tough 1 ≈ 2, "draw a card" ≈ 2, "deal 1 damage" ≈ 1. **Fabled cards get +2 to +3 extra budget** — they are meant to be the strongest cards, balanced by the one-copy rule. These are first-pass numbers for the playtest engine to challenge.

---

## Heroes

### SB1-H01 — Sunny, the Lemon Lynx *(Citrus)*

| Side | Power | Text |
|---|---|---|
| **First side** — *Sunny, Zesty Kit* | — | **Exhaust:** A unit you control gets +1 Power this round.<br>**Awaken:** Your opponent has 5 or fewer Candles. |
| **Awakened** — *Sunny, Sour Streak* | 3 | **Exhaust:** A unit you control gets +2 Power and Sneaky this round. |

*Bright, impatient, and already halfway across the yard.*

### SB1-H02 — Pippin, the Apple Ragdoll *(Orchard)*

| Side | Power | Text |
|---|---|---|
| **First side** — *Pippin, Windfall Kit* | — | **Exhaust:** Heal 2 from a unit you control.<br>**Awaken:** You have 6 or fewer Candles. |
| **Awakened** — *Pippin, Orchard Keeper* | 3 | **Exhaust:** Heal 3 from a unit you control. It gains Guardian this round. |

*Flops over anywhere. Gets back up every time.*

### SB1-H03 — Tango, the Mango Bengal *(Tropical)*

*The mightiest of the Heroes: the only Awakened side with 4 Power and Fierce.*

| Side | Power | Text |
|---|---|---|
| **First side** — *Tango, Sunbeam Kit* | — | **Exhaust:** Ready one of your Offerings.<br>**Awaken:** You have 8 or more Offerings. |
| **Awakened** — *Tango, Jungle Monarch* | 4 | Fierce. **Exhaust:** Ready two of your Offerings. |

*Lazes all morning. Rules all afternoon.*

---

## Deck 1 — Zest Rush (Citrus)

### Fabled (1 copy each)

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-C13 | Clementine, Alley Sprinter | 3 | 3/3 | Swift. **Hello:** Ready another unit you control. | 1 |
| SB1-C14 | Bergamot, the Whirlwind | 4 | 3/4 | **Hello:** Deal 1 damage to each enemy unit. | 1 |
| SB1-C15 | Sanguine, Blood Orange Panther | 5 | 5/5 | Fierce. Once per round, after Sanguine defeats a unit in combat, ready her. | 1 |

### Creatures

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-C01 | Zest Mouse | 1 | 1/1 | Swift. **Zest:** gets +1 Power this round. | 3 |
| SB1-C02 | Tangerine Chick | 1 | 1/1 | **Goodbye:** Deal 1 damage to a unit. | 3 |
| SB1-C03 | Lime Gecko | 1 | 2/1 | Sneaky. **Zest:** gets +1 Power this round. | 3 |
| SB1-C04 | Orange Corgi | 2 | 3/2 | **Zest:** enters ready. | 3 |
| SB1-C05 | Grapefruit Ferret | 3 | 3/2 | Swift. Sneaky. **Zest:** gets +1 Power this round. | 3 |
| SB1-C06 | Citron Fox | 3 | 3/3 | **Hello:** Deal 1 damage to a unit. **Zest:** deal 2 instead. | 3 |
| SB1-C07 | Pomelo Ram | 4 | 4/3 | Fierce. | 3 |
| SB1-C08 | Yuzu Hawk | 5 | 4/4 | Swift. Sneaky. | 2 |

### Charms

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-C09 | Sour Spray | 1 | Ambush. Lucky. Deal 2 damage to a unit. | 3 |
| SB1-C10 | Zest Burst | 3 | Deal 3 damage to a unit. **Zest:** deal 5 instead. | 2 |
| SB1-C11 | Peel Out | 2 | Ready a unit you control. | 2 |

### Talismans

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-C12 | Citrus Zester | 1 | Attached unit gets +2 Power. | 3 |

### Wildfolk cards — 14 (see the Wildfolk section below)

**Deck total:** Fabled 3 · Creatures 23 · Charms 7 · Talismans 3 · Wildfolk 14 = **50**

**Cost curve (incl. Wildfolk):** 1-cost: 20 · 2-cost: 11 · 3-cost: 12 · 4-cost: 4 · 5-cost: 3 · Lucky cards: 8

**How to play it:** Every offered card is worth 1 Offering, whatever it costs. You rarely need more than 5 Offerings, so offer cards you won't want soon (often your 5-costs early on) and stop offering once you have enough. Spend the first rounds filling your Yard, then go for the enemy Hero every round. Save *Sour Spray* and *Catnip* for the Ambush window when a Guardian blocks your way. Once the opponent drops to 5 Candles, Sunny Awakens and her Sneaky boost lets your biggest unit slip past the wall for the final hits. Remember every hit hands your opponent a card, so don't wait around.

---

## Deck 2 — Orchard Guard (Orchard)

### Fabled (1 copy each)

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-O13 | Sakura, Cherry Blossom Siamese | 3 | 2/4 | Once per round, when you heal 1 or more damage from a unit, draw a card. | 1 |
| SB1-O14 | Granny Smith, Orchard Matron | 4 | 3/5 | Guardian. At the start of each round, heal 1 from each unit you control. | 1 |
| SB1-O15 | Honeycrisp, the Gentle Giant | 6 | 6/7 | Guardian. Tough 1. | 1 |

### Creatures

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-O01 | Peach Bunny | 1 | 1/2 | **Hello:** Heal 2 from a unit. | 3 |
| SB1-O02 | Pear Hedgehog | 2 | 2/2 | Guardian. | 3 |
| SB1-O03 | Cherry Robin | 2 | 2/2 | Ripen. **Hello:** If you control a Guardian, draw a card. | 3 |
| SB1-O04 | Plum Mole | 3 | 2/3 | Ripen. | 3 |
| SB1-O05 | Apricot Owl | 3 | 2/3 | **Hello:** Exhaust an enemy unit. | 3 |
| SB1-O06 | Apple Badger | 4 | 4/3 | Guardian. | 3 |
| SB1-O07 | Quince Tortoise | 4 | 2/5 | Guardian. Tough 1. | 3 |
| SB1-O08 | Fig Bear | 6 | 5/6 | Guardian. Fierce. | 3 |

### Charms

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-O09 | Hiss! | 1 | Ambush. Cancel an attack. *(The attacker stays exhausted.)* | 3 |
| SB1-O10 | Warm Cider | 2 | Lucky. Heal 3 from a unit you control. Draw a card. | 3 |
| SB1-O11 | Falling Apple | 3 | Deal 4 damage to an exhausted unit. | 3 |

### Talismans

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-O12 | Apple Crate | 2 | Attached unit gets +3 Health and Guardian. | 2 |

### Wildfolk cards — 12 (see below: no Garden Snail, a third Nap Time)

**Deck total:** Fabled 3 · Creatures 24 · Charms 9 · Talismans 2 · Wildfolk 12 = **50**

**Cost curve (incl. Wildfolk):** 1-cost: 15 · 2-cost: 11 · 3-cost: 13 · 4-cost: 7 · 6-cost: 4 · Lucky cards: 6

**How to play it:** Keep offering: your best cards cost 4 to 6. Always try to have a Guardian in the Yard so attackers must trade into your sturdy units instead of hitting Pippin. Enemy units exhaust when they attack, which is exactly when *Falling Apple* can squash them. Keep 1 Offering ready for *Hiss!* whenever you can; even when you don't have it, your opponent has to respect it. Losing Candles isn't a disaster: it feeds your hand and Awakens Pippin. Turn the corner around round 5–6 and start hitting back with Fig Bear and Honeycrisp.

---

## Deck 3 — Mango Tango (Tropical)

### Fabled (1 copy each)

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-T13 | Papaya, Beach Bum | 3 | 2/4 | **Hello:** Sprout 1. | 1 |
| SB1-T14 | Coconut, Island Guardian | 5 | 4/5 | Guardian. **Hello:** Ready two of your Offerings. | 1 |
| SB1-T15 | Durian, the Mighty Stink | 8 | 8/8 | Fierce. Sneaky. | 1 |

### Creatures

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| SB1-T01 | Banana Monkey | 1 | 1/2 | **Hello:** Ready one of your Offerings. | 3 |
| SB1-T02 | Kiwi Bird | 1 | 1/1 | **Hello:** Sprout 1. | 3 |
| SB1-T03 | Passionfruit Parrot | 2 | 2/2 | Swift. | 3 |
| SB1-T04 | Pineapple Armadillo | 3 | 2/5 | Guardian. | 3 |
| SB1-T05 | Lychee Sloth | 2 | 2/3 | Can't attack unless you're Lush. | 3 |
| SB1-T06 | Guava Capybara | 4 | 3/5 | **Hello:** Heal 2 from each unit you control. | 3 |
| SB1-T07 | Mangosteen Tapir | 5 | 5/5 | **Hello:** If you're Lush, draw 2 cards. | 3 |
| SB1-T08 | Jackfruit Elephant | 8 | 7/8 | Guardian. Fierce. | 2 |

### Charms

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-T09 | Tropical Rain | 3 | Sprout 2. | 3 |
| SB1-T10 | Coconut Drop | 4 | Lucky. Deal 5 damage to a unit. | 2 |
| SB1-T11 | Mango Smoothie | 1 | Ambush. A unit you control gets +2 Power this round. Ready one of your Offerings. | 3 |

### Talismans

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| SB1-T12 | Sun Hat | 2 | Attached unit gets +2 Power and +2 Health. | 2 |

### Wildfolk cards — 14

**Deck total:** Fabled 3 · Creatures 23 · Charms 8 · Talismans 2 · Wildfolk 14 = **50**

**How to play it:** Offer a card every round and play your "Sprout" cards (Kiwi Bird, Papaya, Tropical Rain) early: every extra Offering brings your giants a round closer. Wall up with Pineapple Armadillos while you grow, and let Lychee Sloths soak up hits until you reach 6 Offerings. At 8 Offerings, Tango Awakens. From then on its ability readies two Offerings every round, which is what pays for Jackfruit Elephant and Durian on the same turn. Keep a Mango Smoothie for the Ambush window; it refunds its own Offering.

---

## Wildfolk Cards (neutral, 14 in Zest Rush and Mango Tango, 12 in Orchard Guard)

| ID | Name | Type | Cost | P/H | Text | Qty per deck |
|---|---|---|---|---|---|---|
| SB1-G01 | Pocket Hamster | Creature | 1 | 2/1 | — | 3 |
| SB1-G02 | Garden Snail | Creature | 2 | 1/4 | Guardian. Lucky. | 3 (none in Orchard Guard) |
| SB1-G03 | Mail Duck | Creature | 3 | 2/3 | **Hello:** Draw a card. | 3 |
| SB1-G04 | Catnip | Charm | 1 | — | Ambush. A unit you control gets +2 Power this round. | 3 |
| SB1-G05 | Nap Time | Charm | 1 | — | Lucky. Exhaust an enemy unit. | 2 (3 in Orchard Guard) |

---

## Rules notes for specific cards

- **Hiss!** can cancel any attack, including one aimed at a unit and one made by an Awakened Hero. It can only be played in the Ambush window of an attack (played as a normal action it has nothing to cancel, so it can't be played — rule 400.5).
- **Catnip / Sunny's ability** change Power immediately; combat uses a unit's Power at the moment damage is dealt (rule 600.4).
- **Sunny, Sour Streak:** Sneaky matters only when an attack is declared, so use the ability *before* attacking.
- **Tangerine Chick:** the Goodbye may target any unit, including your own, and resolves after combat damage (rule 800.2).
- **Bergamot** deals her damage to all enemy units at once; Tough 1 units take 0.
- **Sanguine** readies only when the unit she fought is defeated by that combat's damage, whether she attacked or was attacked.
- **Sakura** does not trigger if a heal effect removes no damage.
- **Garden Snail (Lucky):** if your Yard already has 6 units, you can't play it for free; it stays in your hand.
- **Falling Apple** checks that the target is exhausted when played *and* when it resolves.
- **Apple Crate / Citrus Zester / Sun Hat:** one Talisman per unit (rule 200.6).
- **Sprouting** (Kiwi Bird, Papaya, Tropical Rain) turns cards from the top of your deck into exhausted Offerings. It never costs a Candle: with an empty deck, nothing happens.
- **Readying Offerings** (Tango, Banana Monkey, Coconut, Mango Smoothie) turns exhausted Offerings upright so you can spend them again this round. It never creates new Offerings.
- **Lychee Sloth** counts all your Offerings, ready or exhausted, when checking whether it can attack.
- **Tango** Awakens the moment you have 8 Offerings, even mid-round from a Sprout effect.
