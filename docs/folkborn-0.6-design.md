# Folkborn 0.6: cards made for the auto-battler (design)

Status: approved by the owner and built, 2026-10-01 (Folkborn 0.6). Numbers moved in balancing: where this and the game differ, the rulebook and the sets are right, and [design-notes.md](design-notes.md) says what moved.

## Why

Folkborn became a TCG/auto-battler hybrid in 0.4 and got a TFT shop in 0.5, but its cards are still the turn-based
TCG's, patched (Lucky removed, draws became free rolls, heals became "+Health this round", roles added, prices moved).
Measured on the five released families:

- **The Clash is mostly stats against stats.** Of 69 units, 2 have an ability that happens in the fight (a Goodbye,
  "after a win"); 23 only do something when bought (a Hello), and 24 are plain stats. In TFT, what units do in the
  fight is the game.
- **Prices are a TCG mana curve** (1 to 8, most units 1–3), and the Hero's Level only opens lanes: an 8-cost card
  comes up as often in round 1 as in round 10. In TFT the level decides what the shop offers.
- **No team bonuses.** TFT's deck-building pull is traits; Folkborn has one such effect (Pari's Company).
- **Three copies for a 3-star** makes stars cheap and leaves no room to build around one unit.

What stays: each card's **name and art**, the families and their flavour, the Heroes, Charms (the owner: "a super
important part of TCG"), Talismans (already TFT's items), the Muster and the Clash, the shop, lanes and roles.

## 1. Tiers and the shop

Every card gets a **tier, 1 to 5, which is also its price** (as in TFT). Charms and Talismans have tiers too.

The shop still deals from your own deck, but **your Level decides which tiers it deals**: for each of the 6 slots
the game picks a tier by the odds below, then deals the next card of that tier from your shuffled deck (none left
of that tier: the next tier down, then up).

| Level | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---|---|---|---|---|---|
| 2 | 75% | 25% | — | — | — |
| 3 | 55% | 30% | 15% | — | — |
| 4 | 35% | 35% | 25% | 5% | — |
| 5 | 20% | 30% | 33% | 15% | 2% |
| 6 | 15% | 20% | 30% | 25% | 10% |

So levelling up is a real choice again: more lanes *and* better cards, against saving for interest or rolling.

## 2. Copies and stars

- **Copy limits by tier:** tier 1 and 2: **6** copies; tier 3: **4**; tier 4: **3**; tier 5: **1**. Fabled stay one of
  a kind (and are tier 4 or 5). Deck size stays 50.
- **Stars, as in TFT:** a copy you buy of a unit you have goes onto it (it shows pips: ●●○). **3 copies make it
  2★** (twice its printed Power and Health), **6 copies make it 3★** (three times). Only tiers 1 and 2 can reach 3★.
- With no bench, the unit itself is where you collect copies: a 1★ unit with two pips holds a lane while you wait for
  the third. That is the bench's tension, paid in lanes.

Why these numbers: a deck running 6 copies of a tier-1 unit sees about two-thirds of a copy per shop at low Level,
so a focused player reaches 2★ around round 4–5 and 3★ around round 9: TFT's "reroll" plan, possible but costly.

## 3. Traits: families and roles

Each unit has a **family** (its origin) and at most one **role** (its class). Traits count **different units** on
your board (copies merged into one count once), and turn on at thresholds. Shown in a trait tracker beside the board.

**Family traits (2 / 4 / 6):**

| Family | Trait | 2 | 4 | 6 |
|---|---|---|---|---|
| Domowiki | Hearth | +1 Offering at each Start | +2, and Domowiki get +1/+1 per 5 Offerings saved (up to +3/+3) | +3, and that bonus reaches all your units |
| Pari | Company of Doves | A Pari that goes down leaves a 1/1 Dove (a Lure) in its lane | Doves are 2/2 and Swift; Pari get +1 Power | Doves are 3/3; your units get +2 Power |
| Aluxes | Rain-Fed | Aluxes grow +1/+1 each round, up to +2/+2 | up to +4/+4 | all your units grow, up to +5/+5 |
| Jiaoren | Pearl Tears | The first time each Jiaoren is hit in a Clash and survives, gain 1 Offering | and Jiaoren heal 2 at each bout | your units heal 3 at each bout; tears pay 2 |
| Hui Hai | Stone for Stone | A Hui Hai hit and still standing hits back for 1 | for 2 | all your units hit back for 2 |

**Role traits (2 / 4):**

| Role | Targeting (as today) | 2 | 4 |
|---|---|---|---|
| Guardian (tank) | hit first | Guardians +3 Health | +6 Health and Tough 1 |
| Elusive (carry) | hit late | Elusive units +2 Power | +4 Power and Swift |
| Sneaky (assassin) | hits the back line first | Sneaky units deal +3 on their first hit each Clash | +6 |
| Lure (decoy) | hit last; Sneaky hit it first | Lures +3 Health | when a Lure goes down, your units get +1 Power this Clash |

A deck is its Hero's family plus one other family (unchanged), so a typical board runs 4 of one family and 2 of
another, plus two roles: the TFT puzzle, from a collection.

## 4. Abilities happen in the fight

**Hello effects go** (an effect when you buy a unit, like Hearthstone's Battlecry; TFT has none). What units do,
they do in the Clash. The ability triggers:

| Trigger | When | Example |
|---|---|---|
| **Clash start:** | once, before the first bout | "Deal 2 damage to the enemy across." |
| **Each bout:** | at the start of every bout | "Heal 1 the unit next to it with the least Health." |
| **Every 2nd bout:** | bouts 2, 4, 6, 8 | "Hit every enemy for 1." |
| **When hit:** | it takes damage and is still standing (today's "damaged and survives") | "Gain 1 Offering, once a Clash." |
| **Goodbye:** | it goes down (today's) | "The units next to it get +2 Power this Clash." |
| **After a win:** | it knocks a unit down (today's) | "+2 Power this Clash." |

New targets: the units **next to** it (lanes ±1), the **enemy across**, the enemy with the **least Health**, **each
enemy**. Still no randomness: every Clash plays the same for the same boards.

## 5. Charms, Talismans, Heroes

- **Charms** (tier 1–3) are bought in the Muster and work **this Clash**: a buff on your unit, an enemy lane that
  deals no damage for two bouts, damage to a lane when the Clash starts. Ambush stays.
- **Talismans** (tier 2–3) stay as they are: TFT's items.
- **Heroes** keep their once-a-round ability and Awaken; their numbers get checked in the balance pass.

## 6. Worked example: the Domowiki (same names and art)

| Card | Tier | Stats | Role | Ability |
|---|---|---|---|---|
| Hearth Cricket | 1 | 3/2 | — | — |
| Moving-Day Domowik | 1 | 1/3 | Lure | Goodbye: gain 1 Offering. |
| Mane-Braiding Domowik | 1 | 2/2 | — | Swift. |
| Stove Keeper | 1 | 1/3 | — | Each bout: heal 1 the unit next to it with the least Health. |
| The House Snake | 2 | 1/5 | Guardian | When hit: gain 1 Offering, once a Clash. |
| Ovinnik of the Drying Barn | 2 | 3/3 | — | +2 Power while you're Well-Fed (7 or more Offerings saved). |
| Kłobuk, the Soggy Chick | 2 | 2/4 | — | After a win: gain 1 Offering, once a Clash. |
| Keeper of the Door | 3 | 2/7 | Guardian | Clash start: the units next to it get +2 Health this Clash. |
| Bread-and-Salt Greeter | 3 | 3/5 | — | Clash start: your units get +1 Health this Clash. |
| Domowik in a Cat's Shape *(Fabled)* | 3 | 4/4 | Sneaky | After a win: +2 Power this Clash. |
| Kikimora, the Night Spinner | 4 | 5/5 | Elusive | Clash start: the enemy across deals no damage in the first bout. |
| Babunia, Lady of the Cellar *(Fabled)* | 4 | 4/8 | Guardian | Each bout: the units next to her heal 1. Goodbye: gain 2 Offerings. |
| Dvorovoi, Lord of the Yard | 5 | 7/8 | Guardian | Fierce. Clash start: 2 damage to the enemy across and the ones next to it. |
| Bannik of the Bathhouse *(Fabled)* | 5 | 8/7 | Sneaky | Fierce. After a win: +2 Power this Clash. |
| Saucer of Milk *(Charm)* | 1 | | | Ambush. A unit you control gets +2 Power this Clash. Gain 1 Offering. |
| Warm Hand in the Night *(Charm)* | 1 | | | Ambush. A unit you control gets Tough 1 this Clash. |
| Knotted Mane *(Charm)* | 1 | | | The enemy in a lane deals no damage in the first two bouts. |
| Bowl of Kasha *(Charm)* | 2 | | | Gain 2 Offerings and a free roll. |
| A Domowik's Temper *(Charm)* | 3 | | | Clash start: 4 damage to the enemy in a lane. |
| Old Bast Shoe *(Talisman)* | 2 | | | Attached unit gets +2 Power and +2 Health. |

The other four families get the same treatment, each leaning on its trait: Pari wide boards of cheap Swift and Sneaky
units and Doves; Aluxes slow-growing Guardians; Jiaoren sustain and money from being hit; Hui Hai punishment for
hitting them.

## 7. Things the owner should know

- **The collection.** Copy limits up to 6 mean players need more copies of their cards: the starter grants (today
  "every card of the starter decks", up to 3 each) and the Store's quantities follow. The owner's call; the game
  works either way, but starters need 6 copies of a few cards to play as designed.
- **Card images** are re-rendered for the new text and published (no new art).
- **Kardix's Folkborn rule files** (`games/folkborn/*-rules.alex`) still describe the old turn-based game; this is the
  moment to decide whether they follow (see docs/tcg/runtime-design.md and the Alan plan).

## 8. How it gets built and checked

1. Engine: tiers and shop odds; copies, pips and the new star thresholds; copy limits by tier; traits as set data
   (thresholds and grants); the new triggers and targets. Hello stays in the engine but no card uses it.
2. Card data for the five families (and the Mochi and Flower-Souls prototypes), rules text, the printed cards, the
   draw lists, the card images.
3. Screen: trait tracker, pips on units, tier on the shop strip.
4. Bot: values traits and tiers.
5. New starter decks, then the balance gate (every starter 40–60%) until it passes, then the tutorial, the rulebook
   and How to play.
6. Played to the end on the site, then deployed, as every change so far.
