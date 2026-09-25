# Heat Wave (HW1): the Five Alarm deck and three single cards

A design draft: none of it is playtested yet. It is the first set written in the data format from
[card-data-architecture.md](card-data-architecture.md), and all of its data is in `content/2026/09/heat-wave/set.json`. It's a **prototype** set: bots, playtests and
simulations can play it; the public game doesn't show it.

Last updated 2026-09-24.

## What it's for

The Starter Box leans cute: sunbeams, hugs, beach days. Heat Wave is for **teenage boys**, and still fits
a game for ages 8 and up:

- **Theme: chili peppers.** Peppers are fruits, so they fit Fruitcats. Heat is also a teen thing: the hot
  sauce challenge, "too hot to handle", the Scoville scale as bragging rights. A card's cost roughly follows
  its pepper's heat, from a mild Pepperoncini to the Carolina Reaper, which is the most expensive card.
- **Characters with attitude:** a ninja, a brawl boss, a molten tiger, a honey badger, a Komodo dragon, a
  rhino, a bull. They smirk instead of smile, and their eyes are narrowed, not sparkly.
- **Play that feels tough:** your units **get stronger when they're hurt**, and the deck gets hurt on
  purpose. It's the brawler fantasy, and one that the Starter Box families don't have.
- **Kid-safe:** fire, smoke and attitude, but no blood, no weapons and nothing scary.

## The new family: Pepper

| Family | Personality | Plays like | Signature mechanic |
|---|---|---|---|
| **Pepper** | Fiery, fearless, hot-headed | Brawlers that get stronger when they're hurt; trading blows | **Heat** |

> **Heat** *(Pepper)*: Whenever this unit is dealt damage and survives, it gets +1 Power and +1 Health, up to +3.

- The bonus stays until the unit leaves the Yard, like Ripen. It shows on the unit as a flame with its number.
- Damage that Tough reduces to 0 doesn't count. Healing doesn't remove Heat, so Pepper plus Orchard, with heals
  that keep a Heat unit alive, is a natural second family.
- How it differs: Citrus wants to *chain cards*, Orchard wants to *wait*, Tropical wants to *build Treats*.
  Pepper wants to *fight*. Every trade that doesn't kill a Heat unit makes it better.
- Frame colours: chili red `#D7261E`, charred crimson `#5A0E0A`, ember cream `#FFD6C2`.
- Art background: *a volcanic canyon at dusk, dark basalt rocks, glowing embers drifting up, a smoky
  red-orange sky.*

## Hero Cat: Blaze, the Chili Bombay (HW1-H01, Legendary)

A Bombay is the black cat that looks like a small panther. Blaze wears a glossy red chili hood with a green
stem, and embers drift off it.

| Side | Power | Text |
|---|---|---|
| **Kitten**: *Blaze, Ember Kit* | — | **Exhaust:** Deal 1 damage to a unit you control. It gets +1 Power this round.<br>**Grow Up:** 4 or more Cats and Critters are in the Composts. |
| **Big Cat**: *Blaze, Wildfire* | 3 | **Exhaust:** Deal 1 damage to a unit. If it's yours, it gets +2 Power this round. |

*Hot-headed. Cool-hearted.*

- The Kitten heats up your own units: 1 damage on a Heat unit means +1 Power for good, and +1 more this round.
- **Grow Up counts both Composts,** so Blaze grows up once the fighting starts, whoever is winning it. Target
  round: 5–6 (the design notes' 4–6 window). This is the first number to tune.
- The Big Cat can hit either side: 1 damage to an enemy, or the bigger bonus on your own unit.

## Deck: Five Alarm (Pepper)

### Cats (1 copy each, Rare)

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| HW1-P13 | Jolokia, Ghost Pepper Ninja | 3 | 3/3 | Sneaky. Heat. | 1 |
| HW1-P14 | Ancho, Brawl Boss | 4 | 3/5 | Heat. Your other units with Heat get +1 Power. | 1 |
| HW1-P15 | Naga, the Molten Tiger | 6 | 5/6 | Fierce. Heat. After Naga survives damage, deal 1 damage to each enemy unit. | 1 |

### Critters

| ID | Name | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|
| HW1-P01 | Pepperoncini Bat | 1 | 1/3 | Heat. | 3 |
| HW1-P02 | Chili Chihuahua | 1 | 2/1 | Zoomies. **Hello:** You may deal 1 damage to another unit you control. | 3 |
| HW1-P03 | Jalapeño Honey Badger | 2 | 2/4 | Heat. | 3 |
| HW1-P04 | Serrano Wolf | 3 | 3/4 | Heat. **Hello:** Deal 2 damage to an enemy unit. | 3 |
| HW1-P05 | Chipotle Raccoon | 3 | 2/4 | Guardian. Heat. | 3 |
| HW1-P06 | Habanero Bull | 4 | 4/5 | Heat. | 3 |
| HW1-P07 | Scotch Bonnet Rhino | 5 | 4/5 | Fierce. Heat. | 3 |
| HW1-P08 | Dragon's Breath Komodo | 6 | 5/6 | Heat. **Hello:** Deal 1 damage to each other unit. | 2 |

Common: Critters that cost 3 or less. Uncommon: Critters that cost 4 or more, and every Trick and Toy. These
are the Starter Box's rules.

### Tricks

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| HW1-P09 | Hot Sauce | 1 | Pounce. Deal 1 damage to a unit you control. It gets +3 Power this round. | 3 |
| HW1-P10 | Showdown | 2 | A unit you control and an enemy unit deal damage equal to their Power to each other. | 2 |
| HW1-P11 | Ring of Fire | 3 | Lucky. Deal 1 damage to each unit. | 2 |

### Toys

| ID | Name | Cost | Text | Qty |
|---|---|---|---|---|
| HW1-P12 | Spiked Collar | 1 | Attached unit gets +1 Power and Heat. | 3 |

### Garden cards: 14, the same as Zest Rush and Mango Tango

Pocket Hamster ×3, Garden Snail ×3, Mail Duck ×3, Catnip ×3, Nap Time ×2.

**Deck total:** Cats 3 · Critters 23 · Tricks 7 · Toys 3 · Garden 14 = **50**

**Cost curve (incl. Garden):** 1-cost: 20 · 2-cost: 8 · 3-cost: 12 · 4-cost: 4 · 5-cost: 3 · 6-cost: 3 · Lucky cards: 7

**Budget check** (`2 × cost + 1`, Heat priced at 1): Bull, Rhino and Komodo are on budget. The cheap Heat
Critters are +1 over, as Pear Hedgehog, Citron Fox and Pineapple Armadillo are, because a Heat unit is only
worth its keyword if it survives a hit. The Cats are +2 to +3, the usual extra for a Cat.

**How to play it:** Fill the Yard with sturdy Heat units early (Badger, Raccoon, Bat), then *pick fights*.
Attack their units rather than their Hero Cat while your units are small. Every trade your unit survives makes
it stronger, and every unit that dies moves Blaze closer to Growing Up. Use Chihuahua, Blaze's Kitten and Hot
Sauce to heat up your own units on purpose. Hot Sauce in the Pounce window turns a block into a win. Ring of
Fire and the Komodo hurt your side too, which suits you: your Heat units get stronger and theirs just die.
Once Ancho is out and two or three units are at +2 or +3, turn on the Hero Cat with Rhinos and Naga.

**Rules notes:**

- **Heat and lethal damage:** a unit dealt damage equal to its Health is defeated and gets no Heat.
- **Ring of Fire / Komodo:** every unit takes its damage at once, then each survivor with Heat gets +1.
- **Showdown** is not an attack: no Pounce window opens for an attack, Guardian doesn't matter, and a Big
  Cat can't be chosen.
- **Naga** triggers on any damage she survives, including from your own Hot Sauce.
- **Spiked Collar** gives Heat to a unit that didn't have it. Heat it already got stays if the Collar leaves.

## The three single cards

Three cards sold on their own, not in the deck. Each costs more than the one before, and each has a different
theme. The most expensive one leads the new deck.

| # | Card | Rarity | Price | Theme | Who buys it |
|---|---|---|---|---|---|
| 1 | Jack, the Pumpkin Knight | Rare, Foil print | **$1.49** | Halloween knight | anyone: it's Garden, so it fits every deck |
| 2 | Nova, the Starfruit Voyager | Legendary, Gold print | **$4.99** | space explorer | Mango Tango players |
| 3 | Reaper, the Carolina Sphynx | Legendary Hero Cat, Signature print | **$19.99** | the hottest pepper on Earth | Five Alarm players: a second leader |

### 1. Jack, the Pumpkin Knight (HW1-X01, Rare, Garden Cat)

| Cost | P/H | Text |
|---|---|---|
| 4 | 3/4 | Guardian. **Goodbye:** Summon a 2/2 Jack-o'-Lantern with Guardian. |

*Knock him down and his lantern keeps the watch.*

A pumpkin-hooded cat in dented knight's armour, holding a glowing jack-o'-lantern up like a shield. It's the
first Garden Cat, so every deck can use it. It's a good first purchase, and it can have a seasonal Gold print
each October, announced in advance.

### 2. Nova, the Starfruit Voyager (HW1-X02, Legendary, Tropical Cat)

| Cost | P/H | Text |
|---|---|---|
| 5 | 4/4 | **Hello:** Sprout 1.<br>While you're Lush, Nova has Sneaky and Fierce. |

*Went up for a look around. Came back with a star.*

A cat in a star-shaped starfruit helmet and a little spacesuit, floating in front of a starry sky. She
helps the ramp plan early, and once you're Lush she flies past Guardians and takes 2 Lives a hit.

This is the first Legendary that isn't a Hero Cat. **Legendary** then means "Hero Cats and the mightiest
Cats". A Legendary Cat is still one copy, and still counts as one of the six Cats.

### 3. Reaper, the Carolina Sphynx (HW1-X03, Legendary Hero Cat, Pepper)

The most expensive card, and it plays in Five Alarm. A Sphynx is the hairless cat with the big ears and the
stare. Her hood is the wrinkled, scorpion-tailed Carolina Reaper pepper, and she's surrounded by heat haze.

| Side | Power | Text |
|---|---|---|
| **Kitten**: *Reaper, Smolder Kit* | — | **Exhaust:** Deal 1 damage to a damaged unit.<br>**Grow Up:** A unit you control has +3 Heat. |
| **Big Cat**: *Reaper, Final Heat* | 3 | Your units at +3 Heat have Fierce.<br>**Exhaust:** Deal 2 damage to a damaged unit. |

*The hottest cat alive. Ask anyone who's met her.*

- **Blaze or Reaper?** Blaze is the engine: he heats up your whole Yard and Grows Up from any fighting.
  Reaper is the finisher. She picks off anything already hurt, can top up a damaged unit of your own, and
  when she Grows Up your fully heated units take 2 Lives a hit. It's the same deck with a different plan,
  and that is worth paying for without being a stronger version of Blaze.
- Reaper hits only damaged units, so she doesn't beat 1-Health swarms on her own. She needs another card to
  do the first damage.

### Pricing notes

- **Every paid single comes in a premium print that climbs with the price:** Jack in Foil, Nova in Gold,
  Reaper in the Signature print. A card someone paid for should look like something to display, never like a
  deck card. The art is drawn to the same standard: a heroic pose, the cat's face visible, dramatic light.
- The prices follow the Store plan: Rare $1.49, Legendary Cat $4.99, and a Signature Hero Cat at $19.99. (It was $49.99; for the first paid set, the jump from $4.99 was
  too big. Signature cards may cost more later, once players know them.)
- **Reaper is sold only as a Signature print:** a finish no other card has (molten: a black frame with glowing
  cracks and an ember shimmer in the app), the Signature mark, and First Edition for launch buyers. It's
  exclusive because of how it looks and what it costs, not because of a countdown or a limited stock. It must
  measure no stronger than Blaze in playtests, so the $19.99 buys something special, not a better win rate.
- **The Five Alarm deck: $9.99**, with Blaze included. Everyone already owns its 14 Garden cards. Its 36 new
  cards bought one by one would cost about $30 (15 Commons, 18 Uncommons and 3 Rares), before counting Blaze.

## Art direction for this set

The set keeps the house style (the shared style line in the Starter Box's `art/prompts.json`: bold outlines, cel shading,
plush fruit-hooded cats) and adds a per-set tone, which goes in the set's `art.json`:

> Cool, not cute: confident smirks, narrowed eyes, dynamic action poses, low camera angles. A darker palette
> (charcoal, crimson, ember orange) with flames, sparks and smoke as accents. Streetwear, ninja scarves and
> armour are fine; no weapons, blood or scary faces.

This needs one change to the pipeline: `generate_art.py` reads the style from the set, not from a single global
string. That is part of step 6 of the architecture plan.

## Balance risks to test first

**First bot numbers (2026-09-24, 100 games per pairing, `npm run sim`):** Five Alarm wins **19%** overall:
16% against Zest Rush, 24% against Orchard Guard and 17% against Mango Tango. Blaze Grows Up in 80% of its
games. Before tuning the cards, check how much of that is the bot. It judges one move ahead, so it may not
yet pick fights and heat its own units the way the deck wants.

**It wasn't only the bot (2026-09-24).** An LLM playtester (gpt-oss-20b) lost all 23 of its games with Five
Alarm, and the same player wins 31% with the starters. Two causes, found by swapping Hero Cats between decks:
the cards cost about 20 points (Five Alarm's cards lose just as badly under Sunny or Mochi), and Blaze about 6
(Zest Rush's cards win 39% under Blaze). Heat rarely fired: attacks mostly go at the Hero Cat, so a Pepper unit
seldom takes a hit and lives, and the 1-Health Pepper units died to the hit instead of heating up.

**First rebalance (1,000 bot games per pairing):** 19% → **47%** overall: 43% against Zest Rush, 51% against
Orchard Guard, 48% against Mango Tango. The changes, each measured on its own first:

| Change | Why |
|---|---|
| Heat gives +1 Power **and +1 Health** per point, up to +3 | the biggest single gain (+12 points): a heated unit survives the next hit and keeps heating |
| +1 Health on Pepperoncini Bat (1/3), Jalapeño Honey Badger (2/4), Serrano Wolf (3/4), Habanero Bull (4/5), Scotch Bonnet Rhino (4/5) | Heat needs a unit that survives damage |
| Serrano Wolf: Hello deals **2** damage to an **enemy** unit (was 1 to any unit) | the deck had almost no removal against the starters' early units |
| Chili Chihuahua gains **Zoomies** | an early threat that attacks the turn it lands, like Citrus's openers |
| Blaze Grows Up at **4** Cats and Critters in the Composts (was 5) | Blaze Grew Up late (round 4.7) and her Kitten ability is weak |

`npm run check-set` now reports the Bat and the Badger 2 over the stat budget. That is on purpose: the budget
prices Heat like a full keyword, but it only pays off once the unit has survived a hit.

1. **Pepper vs Zest Rush.** Citrus deals damage 1 point at a time, which is exactly what Heat feeds on, and
   Ring of Fire wipes Citrus's 1-Health openers. Zest Rush is already the weakest deck (44%). If Five Alarm beats
   it by a lot, the knobs are: Heat only from combat damage, a +2 cap, or Ring of Fire at cost 4.
2. **Blaze's Grow Up timing.** "5 units in Composts" could come too early against swarms, or never come
   against Orchard's healing. Target: 80% of games, rounds 4–6.
3. **Reaper's Grow Up.** Getting a unit to +3 Heat without Blaze may be too slow. The knob: +2 Heat.
4. **Ancho's aura with Spiked Collars** could make one Yard far too strong. Watch Ancho's win rate when played.
5. **Nova in Mango Tango.** Mango had to be toned down once already. Watch Mango's overall rate with Nova in it.

## What it needs built

Following [card-data-architecture.md](card-data-architecture.md), the only engine work this set needs is:

- the **`damagedAndSurvives`** trigger (Heat, Naga)
- **`fight`** and two-target Tricks (Showdown)
- **counters and static grants** on units (Heat, Spiked Collar, Ancho, Reaper's Big Cat), which replace
  Ripen's `ripe` field anyway
- the **`unitsInComposts`** and **`unitHasCounter`** conditions (the two Grow Ups)

Everything else is data: the Pepper family, the Heat mechanic, 19 cards, one token and one deck. Art: 22
illustrations (four Hero Cat faces, 15 Pepper cards, Jack, Nova and the Jack-o'-Lantern token), all drawn,
plus every finish. Reaper also has the Signature print (`compose_cards.py` makes it for cards with
`"signature": true`: charred black stone with glowing lava cracks, code **S**). The app's shimmer for Signature
copies (finish.css, collection.ts) comes with the Store work.
