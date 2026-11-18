# Folkborn 0.7: cards designed for the auto-battler (design)

Status: approved by the owner and built, 2026-10-02 (Folkborn 0.7). Class names chosen by the owner: Tank, Bruiser,
Assassin, Marksman, Mage, Support. Numbers moved in balancing: where this and the game differ, the rulebook and the sets
(content/*/set.json) are right. Bruiser's icon is 👊 (⚔ is Power).

## Why

Playtest feedback from the owner (2026-10-02), on 0.6:

1. **You can't tell what a card does.** On the board you see Power and Health. The abilities hide behind a long
   press, there are a hundred different ones, and the cards look alike. In TFT you know a champion at a glance.
2. **The synergies aren't visible.** The trait chips were there, but they were easy to miss.
3. **You can't tell why you lost.** Fixed on 2026-10-02: the Clash now plays on the board and ends with a summary.

The owner's verdict: the cards started as TCG cards and were patched twice; *"everything is wrong about the cards
except maybe the art"*. 0.7 designs them again, from the auto-battler, keeping the names, the art and the lore.

## What stays (the owner's decisions)

- **A TCG as a product.** You buy a family's **core deck** (one art style) and it plays well out of the box. Booster
  packs and single cards let you change it.
- **Physical copies.** A deck is real cards, printable, playable on a table. So the fight must stay something two
  people can work out by hand: few rules, a fixed order, no hidden randomness.
- **Any card in any deck.** The rules and the engine allow every mix, and cards from future sets must mix too.
  Whether a mix is good is the player's call. The deck rule "your Hero's family plus one other" goes.
- **Synergies come from families.** Cards of the same family make each other stronger. A card from another family
  has to be worth its place on its own. Special cross-family synergies may come later, to reward variety.
- **Classes are a shortcut, not a synergy.** Tank, assassin, support and so on tell you how a unit fights: who it
  hits, who hits it, and when it acts. Having three Supports gives no bonus.
- **Kept from 0.4–0.6:** Heroes (with Level and Awaken), Charms (one-shot), Talismans (items), the Muster and the
  Clash, the shop dealt from your deck, tiers and shop odds by Level, merging copies into stars, lanes.
- **iPad and computer first**, the phone later.

## 1. Classes: how a unit fights

Every unit has exactly one class, shown as an icon in a corner of the card and on the board. The class says
everything about **targeting and timing**; the card adds at most one ability.

| Class | Icon | Where it fights | Whom it hits | When | Typical card |
|---|---|---|---|---|---|
| **Tank** | 🛡 | Front: hit first | The enemy across, else the nearest | Each bout | Low Power, high Health |
| **Bruiser** | 👊 | Front: hit after Tanks | The enemy across, else the nearest | Each bout | Balanced |
| **Assassin** | 🗡 | Front | The enemy's back first (Marksmen, Mages, Supports) | First, in each bout (Swift) | High Power, low Health |
| **Marksman** | 🏹 | Back: hit after the front | The enemy across, else the nearest | Each bout | Good Power, low Health |
| **Mage** | ✨ | Back | Weak hit; its spell (the card's ability) | Spell every second bout | Low stats, a strong ability |
| **Support** | 💠 | Back | Doesn't attack | Its ability, each bout: a heal, a shield, a rally… for the units next to it | Health, a helpful ability |

- **Front and back** replace the four ranks of 0.4 (Guardian, plain, Elusive, Lure): enemies hit your Tanks
  first, then your Bruisers and Assassins, then the back. The lanes still break ties (across first, then nearest).
- **Taunt is a card's choice, not the class's** (the owner, 2026-10-02). A unit with **Taunt** is hit first by every
  enemy, Assassins included, while it stands. Some Tanks taunt; others don't, and have more Health or armor
  (**Tough**: each hit deals 1 less) instead. That is the trade-off between Tank cards, and Taunt is the answer to
  Assassins.
- The 0.4 role keywords go: **Elusive** (the carry, hit late) is now "back", and **Lure** (the decoy that Sneaky
  units had to hit first) is now Taunt.
- One row of six lanes, as now. A rough guide for a core deck is two or three front units to every back one.

## 2. Abilities: a small vocabulary with icons

Each ability is one **timing** and one **effect**, from short lists, so it fits as two icons and a number on the
unit (for example "⟳ 💚1 ↔": each bout, heal 1 to the units next to it). The card says it in words, generated from
the data as now.

**Timings:** ⚡ Clash start · ⟳ each bout · ⟳² every second bout (Mages' spells) · ✝ when it goes down · 🛡 when
it is hit and survives (once a bout) · 🏆 after it knocks a unit down.

**Effects:**

| Effect | Icon | Example |
|---|---|---|
| Damage | 💥 | 2 damage to the enemy across |
| Volley | 💥↔ | 1 damage to the enemy across and the ones next to it |
| Heal | 💚 | heal 1 to the units next to it |
| Rally | ⬆ | +1 Power to the units next to it, this Clash |
| Weaken | ⬇ | −2 Power to the enemy across, this Clash |
| Shield | 🔰 | Tough 1 to the units next to it, this Clash |
| Stun | 💤 | the enemy across deals no damage next bout |
| Summon | 🥚 | a token in the nearest free lane |
| Grow | 🌱 | +1/+1 for good, at most +3/+3 |
| Offering | 🪙 | gain an Offering |

**Keywords** (always on, no timing): **Taunt** (every enemy hits it first while it stands) · **Tough N** (each hit
deals N less) · **Swift** (strikes with the Assassins, first in the bout) · **Fierce** (worth 2 Candles when it is
still standing at the end).

That's six timings, ten effects and four keywords. Families use different parts of the list, which gives each one its character.

## 3. Families: core decks and their synergies

A family's synergy turns on with **2, 4 or 6 different units** of that family on the board, as 0.6's traits do. The
trait panel moves out of the plaque into a **column beside the board** (TFT's trait tracker): each trait with its
breakpoints, the active one lit. On the board and in the shop, every card shows its family and class, and a shop
card says what it would add ("+1 Hearth: 3/4").

| Family | Plays like | Synergy (2 / 4 / 6) | Classes in the core deck |
|---|---|---|---|
| **Domowiki** | The house: tough, patient, rich | **Hearth**: Offerings every round; Health for the family; at 6, Well-Fed makes everyone stronger | Tank, Support, Bruiser, Mage |
| **Pari** | Many, light, never alone | **Company of Doves**: a Dove for each Pari that falls; stronger, Swift Doves | Assassin, Marksman, Bruiser, Support |
| **Aluxes** | The cornfield: grows every round | **Rain-Fed**: the family grows +1/+1 a round, up to more at 4 and 6 | Tank, Bruiser, Marksman, Mage |
| **Jiaoren** | The sea: heals, endures, pays | **Pearl Tears**: Offerings when hurt; heals each bout | Support, Mage, Tank, Marksman |
| **Hui Hai** | The forest's stones: hits back | **Stone for Stone**: damage back when hurt; more at 4 and 6 | Tank, Bruiser, Assassin, Mage |

**Mixing.** The owner wants almost any card to be good in another deck, depending on that deck. So a card's
ability never needs its own family to work ("your Domowiki get…" belongs to the family's synergy, not to a card);
every unit's stats follow a budget for its tier, so a unit is fair in any deck; and the family synergy is a bonus on
top. A Pari Assassin in an Aluxes deck is a good Assassin without the Doves. Each family also has two or three
**"travelling" cards** designed to be strongest away from home (an ability that helps whatever stands next to it).
Those are the obvious first cards to mix in, and the reason to buy a booster of another family. Later sets can add
cross-family synergies ("a Pari and a Jiaoren together…").

**Abilities are per card.** A unit may have one ability or none: plain units (class and stats only) are a design
choice, easy to read, and they let the units that do something stand out.

## 4. A core deck

Fifty cards and a Hero, as now. A proposal for its shape:

| | Units | Copies each | Cards |
|---|---|---|---|
| Tier 1 | 3 | 5 | 15 |
| Tier 2 | 3 | 4 | 12 |
| Tier 3 | 3 | 3 | 9 |
| Tier 4 | 2 | 2 | 4 |
| Tier 5 (Fabled) | 1 | 1 | 1 |
| Charms | 3 | 2 | 6 |
| Talismans | 2 | 1–2 | 3 |
| **Total** | 12 units, 5 others | | **50** |

- **Stars:** 3 copies make 2★. Proposal: 5 copies make 3★, which only the tier 1 units can reach, with every copy
  you have (TFT's "reroll" plan). The copy limits follow the deck: 5, 4, 3, 2, 1 by tier.
- **Twelve different units** cover the family's four classes, three each. Each family has 13–14 unit pictures
  today, so every core deck can use its own art, with one or two spare for boosters.
- **Charms** stay one-shot: an effect aimed at an enemy lane for the next Clash, or a boost to your own unit, and
  Ambush to set one face down. **Talismans** stay items, attached to a unit for good.
- **The Hero** keeps its Muster ability and its Awaken condition, redone to fit the family's synergy.

## 5. On the table

The fight as a printed rule, short enough for a rules card:

1. Clash start: aimed Charms, Ambushes, Heroes' strikes, ⚡ abilities (the Lantern holder's first).
2. Each bout: ⟳ abilities (⟳² in bouts 2, 4, 6, 8); Assassins strike; everyone else strikes; units at 0 Health go
   down; ✝ abilities.
3. When a side has nobody standing, or after 8 bouts, the side still standing wins: the loser loses a Candle for
   each of the winner's units still standing (at most 2).

Damage is kept with dice or counters on the cards. Every number on the table is on a card.

## 6. What this changes in the code

- Card data: every unit gets a `class`; the targeting rules move from keywords (Guardian/Sneaky/Elusive/Lure) to
  classes; abilities are rebuilt from the vocabulary above; deck lists are rebuilt.
- The deck rule about families goes; copy limits follow the tiers above.
- The board: a class icon and an ability line on each unit; the trait column; family and class on shop cards.
- Collections: cards keep their ids, so what a player owns stays theirs; the decks change around them.
- Docs: the rulebook, how-to-play, the per-family set docs, card text, the printed (Kardix) copies, the packs.
- Balance: the gate as for 0.6 (every starter 40–60%, each pairing at least 30%).

## Settled with the owner (2026-10-02)

- Classes: Tank, Bruiser, Assassin, Marksman, Mage, Support. Elusive and Lure go; Taunt is a card keyword.
- Assassins and Tanks: per card (a Tank with Taunt draws them; a Tank without has more Health or armor).
- The core deck: 12 units at 5/4/3/2/1 copies, to start with; 3★ at 5 copies.
- Abilities: per card; some units are plain.
- Cards good in other decks: almost all of them, and two or three "travelling" cards per family especially.

## Appendix: the Domowiki core deck (draft, a sample to agree on the style)

The art and names are today's. Stats are first guesses for the balance gate. "Next to it" means your units in the
lanes beside it; "across" means the enemy in the facing lane.

| # | Card | Class | Tier | Copies | Power/Health | Ability |
|---|---|---|---|---|---|---|
| 1 | Hearth Cricket | Bruiser ⚔ | 1 | 5 | 3/3 | (plain) |
| 2 | Stove Keeper | Support 💠 | 1 | 5 | 0/4 | ⟳ 💚 Each bout: heal 1 to the units next to it. |
| 3 | The House Snake | Tank 🛡 | 1 | 5 | 1/4 | **Tough 1** |
| 4 | Keeper of the Door | Tank 🛡 | 2 | 4 | 2/6 | **Taunt** |
| 5 | Mane-Braiding Domowik | Bruiser ⚔ | 2 | 4 | 3/4 | **Swift** |
| 6 | Kłobuk, the Soggy Chick | Support 💠 | 2 | 4 | 0/5 | ⚡ 🪙 Clash start: gain an Offering. *(travelling)* |
| 7 | Ovinnik of the Drying Barn | Bruiser ⚔ | 3 | 3 | 4/6 | 🏆 ⬆ After it knocks a unit down: +2 Power this Clash. |
| 8 | Bread-and-Salt Greeter | Support 💠 | 3 | 3 | 1/7 | ⚡ 🔰 Clash start: the units next to it get Tough 1 this Clash. *(travelling)* |
| 9 | Kikimora, the Night Spinner | Mage ✨ | 3 | 3 | 2/5 | ⟳² ⬇ Every second bout: the enemy across and the ones next to it get −2 Power. |
| 10 | Dvorovoi, Lord of the Yard | Tank 🛡 | 4 | 2 | 4/11 | **Taunt** |
| 11 | Bannik of the Bathhouse | Assassin 🗡 | 4 | 2 | 7/6 | 🏆 ⬆ After it knocks a unit down: +2 Power this Clash. |
| 12 | Babunia, Lady of the Cellar | Support 💠, Fabled | 5 | 1 | 2/12 | ⟳ 💚 Each bout: heal 2 to each of your units. |
| | **Charms** | | | | | |
| 13 | A Domowik's Temper | Charm | 2 | 2 | | 💥 4 damage to the enemy unit in a lane you choose, at Clash start. |
| 14 | Knotted Mane | Charm | 2 | 2 | | 💤 The enemy unit in a lane you choose deals no damage in bouts 1 and 2. |
| 15 | Bowl of Kasha | Charm | 2 | 1 | | 🪙 Gain 3 Offerings. |
| 16 | Warm Hand in the Night | Charm, Ambush | 1 | 1 | | 🔰 Your unit in this lane gets Tough 2 this Clash. |
| | **Talisman** | | | | | |
| 17 | Old Bast Shoe | Talisman | 2 | 3 | | +2 Power and +2 Health, for good. |
| | **Hero** | | | | | |
| | Dziadziuś, Heart of the House | Hero | | 1 | | Exhaust: gain an Offering. Awaken: you have 15 or more Offerings (then he strikes for 4 at Clash start). |

**Hearth** (the family's synergy): **2** Domowiki: gain an Offering at the start of each round. **4**: also, your
Domowiki get +2 Health. **6**: gain 2 Offerings instead, and all your units get +1 Power and +2 Health.

The classes: 3 Tanks (one Taunt, one Tough, one big Taunt), 4 Supports, 3 Bruisers, 1 Mage, 1 Assassin: a sturdy
front that wins long fights and makes money, weak at the back. Spare art for boosters and later sets: Moving-Day
Domowik, Domowik in a Cat's Shape, Saucer of Milk.
