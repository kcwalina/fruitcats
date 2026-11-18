# Fruitcats — Design Notes

Why the rules are the way they are, what we borrowed, and what the playtest engine should try to break first. Companion to [rulebook.md](rulebook.md) and [designing-good-deck.md](designing-good-deck.md).

## Folkborn 0.7: the cards designed again, with classes (2026-10-02)

The owner's playtest of 0.6: you couldn't tell what cards do (the abilities hid behind a long press, and a hundred
of them look alike), the trait chips went unnoticed, and you couldn't tell why a Clash was lost. The last was fixed
first: the Clash plays on the board, bout by bout, and ends with a summary. Then the cards: "everything is wrong about
the cards except maybe the art". The design, settled with the owner, is [folkborn-0.7-design.md](folkborn-0.7-design.md).

| Decision | Chosen | Why |
|---|---|---|
| Classes | Tank, Bruiser, Assassin, Marksman, Mage, Support (the owner's names): front, back, and how a unit fights | One word says how a unit fights, so you learn six classes rather than a hundred cards. They give no bonus (the owner). |
| Taunt | A card keyword, not the class's: some Tanks taunt, others have more Health or Tough | The trade-off between Tank cards, and the answer to Assassins (they go for the back unless a unit taunts). |
| Elusive, Lure, Sneaky, Guardian | Gone | The classes say it: the back replaces Elusive, Taunt replaces Lure, Assassin replaces Sneaky, Tank replaces Guardian. |
| Synergies | Families only (2, 4, 6) | The owner: synergies come from cards of the same family; a card from another family must be good on its own. |
| Mixing | Any card in any deck (the deck rule "one other family" went) | The rules and the engine allow every mix, future sets included; whether a mix is good is the player's call. |
| Core decks | 12 units at 5/4/3/2/1 copies, 6 Charms, 3 Talismans; 3★ at 5 copies | A TCG product: a family's core deck plays out of the box; physical copies, so the cards can be printed and played on a table. |
| Reading a unit | Its class as an icon; each ability as a line ("⟳ heal 1 · sides"); a trait column beside the lanes; shop cards show their class and what they add to a trait | The owner's first point: on the board you only saw Power and Health. |

Each unit's text now starts with its class ("Tank. Taunt."), so the printed cards show it with no change to their
layout. A Support never attacks; an Assassin strikes first and goes for the back; a Mage's spell is its ability.

Balance took eleven passes. What moved most: Aluxes started weak (its growth comes late, so its units got more
punch and its trait grows faster), a cheap Assassin is worth a lot (five copies of a 4-Power one that strikes first
put Hui Hai at 78%), and a deck that heals out-lasts one that chips (Jiaoren against Hui Hai). Three decks
settled into a loop (Pari beats Jiaoren's back row, Jiaoren out-heals Hui Hai, Hui Hai's Health walls off Pari); the
last passes narrowed it. The last full gate (3000 games): every starter between 47% and 53%; the closest pairings 31%.
The bot seems never to buy a Support whose ability is only healing (its forecast of a fight doesn't count heals):
worth a look before trusting the gate on Supports.

## Folkborn 0.6: cards made for the auto-battler (2026-10-01)

0.4 and 0.5 changed the game; 0.6 changes the cards to match it. The full proposal, as approved by the owner, is
[folkborn-0.6-design.md](folkborn-0.6-design.md). In short:

| Decision | Chosen | Why |
|---|---|---|
| Tiers | Every card has a tier, 1 to 5, which is its price; the Hero's Level sets the shop's odds per tier (Level 2: 75/25, … Level 6: 15/20/30/25/10) | Levelling up must buy better cards, not only a lane: TFT's level/roll/save choice. |
| Copies and stars | Up to 6 copies of a tier 1–2 card (4, 3, 1 for tiers 3–5); 3 copies make 2★, 6 make 3★; pips on the unit count them | Two copies for a star made stars cheap and left nothing to build toward. With no bench, a unit with pips is the bench. |
| Traits | Each family is a trait at 2/4/6 different units; each role (Guardian, Elusive, Sneaky, Lure) at 2/4. Only the highest tier reached is on; copies count once, tokens never | TFT's deck-building pull. The old signature mechanics live on as the families' traits (Hearth, Company of Doves, Rain-Fed, Pearl Tears, Stone for Stone). |
| In the fight | New triggers: Clash start, Each bout, Every second bout; "the enemy across" and "the units next to it" as targets | Of 69 units, 2 did anything in the fight; 23 only did something when bought. In an auto-battler the fight is where cards should matter. |
| Hellos | Dropped from the starter families | A Hello is a TCG "battlecry": in a shop game it is bought once and never seen again. |
| Selling | Back what was paid, its copies included, less 1 per star | Per copy would make a 3★ (6 copies) worth nothing to sell. |

Balance took twenty passes of the gauntlet. What moved most: Domowiki's money, Aluxes'
growth (Rain-Fed capped per tier), and a hard counter between Pari and Hui Hai (Hui Hai won 70-80%): Grandfather
Hui Hai now throws 1 damage back when hurt (was 2), with 1 more Health. Heroes
Awaken later than in 0.5: Dziadziuś at 15 Offerings, Zhu'er at 15 units down, Pebble at 22.
The last full gate (3000 games): every starter between 47% and 53%; the closest matchup Pari
against Hui Hai, 30%.

## Folkborn 0.5: the shop (2026-10-01)

Playing 0.4, the owner found the hand was the wrong half of TFT: it only grew (two draws a round, lost Candles into
it), the cards overlapped on the screen, and the choices got unwieldy. The deck is now TFT's pool, dealt as a shop:

| Decision | Chosen | Why |
|---|---|---|
| The hand | Gone: each round 6 cards are dealt face up from your own deck; what you don't buy goes back in, shuffled | TFT's shop: a small, fresh choice every round, and the deck still decides what can come (the collectible part). |
| Rolling | 1 Offering for a new shop; "draw a card" effects became free rolls | The reroll is TFT's way to dig, and it competes with saving for interest. |
| The bench | None: a new unit needs a lane; sell first. A copy merges even with every lane taken | A bench doesn't fit a phone screen beside six lanes and a shop. Merging into the board keeps "collect copies" alive, and a 1-star copy holding a lane while you wait for the next is the bench's tension, paid in fighting strength. |
| Selling | Back what you paid, less 1 per copy in the unit | Less than the price, so a Hello can't be bought and sold for free; less again for a merged unit, so a merge is a commitment. |
| The comeback | A losing streak, as in TFT: +1 Offering for 2 or 3 Clashes lost in a row, +2 for 4, +3 for 5 or more | Lost Candles going to the hand was the old comeback; with no hand, money is the comeback. |
| Candles | A count; Lucky retired | Nothing goes to a hand any more, so a Candle needs no card. |
| The mulligan | Gone | A bad shop is one roll away. |

A single "keep" slot (one card held across rounds, as a chip by the buttons, not a full card) is the idea to try if
holding cards for a merge turns out to be missed.

The first gauntlet of the shop put Domowiki at 72% and Jiaoren at 67%, Aluxes at 29% and Hui Hai at 27%. Offering any
spare card for 1 had evened out everyone's money; without it, the decks that make Offerings ran away, and a shop
deals a free body (a 1-cost "gain an Offering") every time one comes up. The pass: income 4, 5, 6 (was 3, 4, 5);
Stove Keeper, Pearl Oyster and Bowl of Kasha cost 2, Frost-White Silk 2, Dragon Silk 3; cheaper Aluxes (Clay Alux 2,
Slingshot Alux 3, Alux of the Ceiba Roots 5, Pots and Pans Flung 2) and Hui Hai (Yă Hui Hai 3, Moss-Mender 3, Old One
of the Waterfall 6, The Rock That Moved 7, Stones from Nowhere 3, The Forest Remembers 3), and Lookout on Mount Qāf
costs 3 (a 1/4 Guardian for 2 was the best card in the game once its Lucky was gone). Roll price made no
difference (the bots roll about twice a game).

## Folkborn 0.4: the Muster and the Clash (2026-09-30)

The owner turned Folkborn into a hybrid of a collectible card game and an auto-battler in the style of Teamfight
Tactics, without animations. What it keeps from each:

- **From the card game:** a collection, decks built from your own cards (your opponent plays only theirs), a hidden
  hand, Charms and Ambushes, card text as the design space, the Hero and Awaken, Candles that go to your hand.
- **From the auto-battler:** plan, then fight; the fight plays itself; the board persists and grows (Level, stars,
  Rain-Fed, Talismans as items); positioning; the economy (spend or save for interest, level or play, offer or keep);
  scouting the opponent's last board.

The decisions, with the owner:

| Decision | Chosen | Why |
|---|---|---|
| The build phase | Simultaneous and hidden; you see the other side as it was when the Muster began | TFT's scouting without an information race; nobody waits for anybody. |
| The economy | Offerings are money you keep, with interest (+1 per 5 saved, at most 3) | "Accelerate or not" is exactly spend-now versus save, and it needs a pool. Refreshing mana offered only a weak version. |
| Units that lose a fight | Stay on the board: everything stands up after the Clash | As in TFT, losing costs Candles and tempo, never the army; the board only grows. |
| Who hits whom | Printed roles (Guardian, plain, Elusive, Lure; Sneaky the other way), lanes as the tiebreak | One row of six fits a phone; roles are bought (tanks, carries, decoys, assassins), positions break ties. |
| Merging | A second Creature copy merges: 2 stars, twice the printed stats; Fabled never | The TFT feeling of upgrading a full board, through deck building (how many copies you run). |
| Players | 1v1 | With personal decks there's no shared pool to contest; the Match code is 1v1 already. |
| Transition | A clean cut: no classic mode kept | No dead code left behind once the classic game would have gone. |
| No animations | The Clash is a report, read bout by bout | "Combat is a proof, not a show": deterministic, and legible as state plus rules. |

The first gauntlet (about 100 games a pairing) put every starter between 48% and 53%. The changes it took are in the
commit "Folkborn 0.4: first balance pass": Aluxito grows Rain-Fed units for good, Parijan lends Power, Zhu'er gives
Pearl Tears only once Awakened, Pearl Tears and Stone for Stone happen once a round, Bowl of Kasha costs 1, The
Forest Remembers deals 3, Pari at the Pool is 3/3, and at most 2 Candles go out in one Clash. Heals became "+N Health
this round" (damage never outlasts a Clash), "ready an Offering" became "gain an Offering", and the Awaken conditions
that counted units in the Mist count units gone down in Clashes.

Most of what follows describes the turn-based game Folkborn was before 0.4: the history of why the cards are what
they are.

## Goals

1. **Easy to start** — teachable in 5 minutes, ≤ 2 lines of text per card, ~10 keywords.
2. **Scales to esports** — skill-rewarding, low feel-bad variance, readable for spectators, bounded match length (~10 min, Bo3 ≈ 30 min).
3. **Paper-playable, digital-first** — no hidden counters, no generated cards, no output randomness.
4. **Machine-playtestable** — deterministic effects, enumerable legal actions, every balance number isolated as data.

## What we borrowed, and why

| Mechanic | From | Problem it solves |
|---|---|---|
| Any card can be planted as a Treat, 1/round | Star Wars Unlimited, Lorcana, Flesh and Blood | Mana screw/flood — the #1 complaint about MTG. Every card has two uses, and *what to plant* is a real decision. |
| Alternating single actions | Star Wars Unlimited, Legends of Runeterra | Dead time and solitaire combo turns (Yu-Gi-Oh, Pokémon, Hearthstone). Both players are always engaged; great for streaming. |
| Yarn Ball: initiative you can *take*, otherwise alternates | SWU initiative + LoR attack token | First-player advantage. SWU's token stays put if untaken (snowballs); LoR's strictly alternates (no agency). We do both. |
| Pounce: exactly one reaction, no chains | LoR spell speeds, Yu-Gi-Oh hand traps, One Piece counters | MTG's stack is the deepest interaction system but the biggest new-player barrier; Hearthstone/Lorcana have none. Depth-1 reactions give bluffing and defence at near-zero rules cost. |
| Nine Lives → lost Life goes to hand; Lucky plays free | One Piece life/trigger, TES: Legends runes/prophecy | Snowballing (Pokémon prizes, Lorcana lore races). The most-loved comeback mechanic in the genre, and a visible score track for spectators. |
| Hero Cat always in play; Kitten → Big Cat | Flesh and Blood heroes, SWU leaders, LoR champion level-ups | LoR's own post-mortem blames weak champion identity. A guaranteed hero gives every deck a face, a per-round agency floor (Hearthstone hero power), and a mid-game arc to root for. |
| Exhaust Hero to attack *or* use ability | FAB / SWU | A small meaningful choice every round. |
| Cats as 1-copy champion units (max 6) | LoR champions, Hearthstone legendaries | Keeps cats special and the most powerful cards, caps cost-of-entry, increases game-to-game variety. |
| Attacker chooses target; Guardian redirects | Hearthstone, SWU | No blocker-declaration step; faster and simpler than MTG combat. |
| Input randomness only | Keith Burgun; Legends of Code and Magic; Artifact's failure | Output RNG makes wins and losses feel unearned, and adds noise to bot statistics. |
| Hall of Fame hero retirement | FAB Living Legend | Freshens the meta without invalidating collections (rotation) or runaway power creep (Yu-Gi-Oh). |
| Open decklists, chess clock, ladder rules = tournament rules | Lessons from Hearthstone Conquest & Snap Conquest | Pro play should be the game everyone plays. |

## Classes and signature mechanics (added after playtest feedback: "we need classes")

This section and its simulation notes are history: they describe the fruit families of the Starter Box, the game's
first set, which the owner removed on 2026-09-29. Today's families are folk-creature families, each with its own
mechanic (Domowiki: Sprout and Well-Fed; Pari: Company and Feather Coat; Aluxes: Rain-Fed; Jiaoren: Pearl Tears;
Hui Hai: Stone for Stone), listed in the [rulebook](rulebook.md#3-3-the-families-classes). Some of them play the part
of the old ones: Company that of Zest, Rain-Fed that of Ripen, Well-Fed that of Lush; Sprout itself moved to the
Domowiki.

The fruit families were always classes (they gate deckbuilding), but players didn't *feel* them, because
all families shared the same keywords in different amounts. Each family now has one mechanic of its own,
chosen to express its personality — the Hearthstone lesson that a class should have things nobody else does:

| Family | Mechanic | Rule | Why it fits |
|---|---|---|---|
| Citrus | **Zest** | Bonus if you've already played another card this round | Fast and flashy: rewards chaining, and pairs with cheap Zoomies openers |
| Orchard | **Ripen** | +1/+1 at each Start Phase, up to +2/+2 | Patient: fruit that grows on the tree; rewards protecting units with Guardians and heals |
| Tropical | **Sprout N** / **Lush** | Put N deck cards into the Pantry as Treats / bonus at 7+ Treats | Ramp: grow the resource pile, then cash in |
| Berry *(planned)* | **Bunch** | e.g. +1 Power for each other Berry Critter you control | Swarm |
| Melon *(planned)* | **Rind X** | e.g. prevent the first X damage dealt to this unit each round | Tough control |

Simulation notes (100 games per pairing, AI vs AI): the AI initially played Zest cards as the *first* card
of a round 54% of the time, wasting the bonus; it now opens with a cheaper card when it can afford both
(31%), raising Zest triggers from 1.6 to 2.5 per game. First-pass Ripen on Pear Hedgehog (a Guardian)
pushed Orchard Guard to 73% overall, so Ripen moved off Guardians and Plum Mole went from 3/4 to 2/3.
Zest Rush then won only ~26% overall and 14% vs Orchard Guard, and a playtester found the matchup
unwinnable. Guardian-only fixes (Sneaky on Sunny's Kitten ability, Hiss! at cost 2) moved it by 2–3 points:
Zest was also losing to Mango (37%), ending games with ~11 cards it couldn't afford, and even 9-Power Zest
units didn't help while the Guardians stayed as tough. What moved it: Grapefruit Ferret gains Sneaky, Lime
Gecko costs 1, Apple Badger is 4/3 instead of 4/4, and Orchard Guard plays a third Quince Tortoise, Fig Bear
and Nap Time instead of three Garden Snails. At 500 games per pairing: Zest vs Orchard 14% → 39%; overall
Zest 26% → 41%, Orchard 66% → 52%, Mango 58% → 57%.

Mango Tango was then the strongest deck. Mango won 77% of the games in which it played Jackfruit Elephant
and 63% of those in which Mochi Grew Up (34% when she didn't). Every Mango nerf also lifts Orchard, which
Mango had been keeping in check; Mochi Growing Up at 9 Treats or a single Elephant overshot (Orchard 57–58%).
Jackfruit Elephant now costs 8 (was 7) and Coconut, Island Guardian is 4/5 (was 4/6). At 600 games per
pairing: Zest 40% → 44%, Orchard 52% → 53%, Mango 58% → 53%. **Open issue:** Zest is still the weakest deck.

2026-09-25, from the nightly playtest: Zest 44%, Orchard 58%, and Zest won only 37% against Orchard (the LLM
players lost all 54 of their Zest-vs-Orchard games). Cheap Guardian walls were the reason, not Falling Apple
(at 0 damage Orchard still won 63% of that matchup). Pear Hedgehog is now 2/2 (was 2/3) and Sour Spray
costs 1 (was 2). At 400 games per pairing: Zest 45% → 50%, Orchard 58% → 53%, Mango 48% → 48%; Zest vs
Orchard 35% → 45%. Tried and dropped: Jackfruit Elephant at cost 9 or without Fierce (it carries Mango Tango
against Orchard: uncastable, Mango fell to 24% in that matchup), Mango Smoothie without its Treat, Sanguine at
cost 4 (barely moves Zest; she wants a new ability, not a lower cost).

## What we deliberately left out

- **Lanes/arenas** (SWU, TES:L, Artifact): extra depth, but hurts readability and onboarding. Revisit as a set mechanic.
- **Stakes doubling** (Marvel Snap cube): brilliant for ladder, produces non-binary results that don't fit brackets. Possible optional ladder mode later.
- **Deck-as-life / pitch-to-bottom** (FAB): elegant but heavy for beginners.
- **Blocking from hand** (One Piece counters): Pounce + Guardian already cover defence; two defensive systems is one too many.

## Known risks — first hypotheses for the playtest engine

1. **Nine Lives may over-feed the defender.** One Piece uses 4–5 life cards; we give 9 extra cards. Watch: average hand size of the losing player, comeback rate, whether aggro is viable. Knobs: Lives count, or only odd-numbered Lives go to hand.
2. **Every hit is worth 1 Life regardless of Power**, so cheap units are the most efficient face damage. Natural brakes: planting + cheap units drains the hand, every hit gives the opponent a card, Yard cap of 6, Guardians. Watch: swarm decks' win rates, average cost of units that deal hits. Knobs: Fierce availability, Yard cap, a "Power ≥ N to hit" rule.
3. **Big Cat attacks are risk-free** (no damage back). Watch: share of Lives removed by Hero attacks; games decided purely by who Grows Up first.
4. **Hiss! / cheap Pounce cancels** might make attacking feel bad. Watch: attacks cancelled per game, LLM-tester sentiment.
5. **Taking the Yarn early** then still Pouncing could be too cheap. Watch: how often the Yarn is taken, first-actor win rate per round. Knob: no Pounce after Taking the Yarn.
6. **First-actor advantage in round 1.** Target: 48–52% win rate for the starting Yarn holder. Knob: non-holder plants a 3rd Treat, or draws 1 extra.
7. **Grow Up conditions that may never fire** (Pippin, a Starter Box Hero, vs. a passive opponent). Watch: % of games in which each Hero Grows Up, and the round it happens (target: 80%+, rounds 4–6).
8. **Game length.** Target: 6–9 rounds, ≤ 60 total actions, ~10 minutes human time.
9. **Stat budget** (`2×cost + 1`, keyword prices) is a guess. Use win-rate-when-drawn / when-played deltas per card to correct it.

## Metrics the harness should report

Win rate per deck and matchup matrix · starting-Yarn-holder win rate · game length (rounds, actions) · per-card win rate when drawn / played / planted · plant rate per card (cards that are *always* planted are dead designs) · Lucky trigger frequency and swing · comeback rate (winner was behind on Lives at round 4) · Grow Up rate and timing · Pounce usage and "Treats left ready" bluff rate · decisions per action and branching factor · skill differentiation (strong bot vs. weak bot margin) · LLM-persona qualitative reports (confusing rules, unfun moments, dominant lines).

Built in `playtest/` (see its README): the matchup matrix, starting-Yarn rate, game length, per-card win
rate when played, Grow Up rate and timing, cards left in hand, the strong-vs-weak bot margin, random and
mutated decks against the starters, LLM-persona reports and LLM-designed decks. Still to do: per-card
drawn/planted rates, Lucky swing, comeback rate, Pounce and bluff rates, branching factor.

The same work replaced the bot's fixed planting rule (plant to 5 Treats, or 8 for Mochi) with a general
one: plant to the priciest card, plus one spare when that costs 6 or more, plus whatever the Hero Cat's
Grow Up counts in Treats. In bot-vs-bot duels the spare Treat was worth +8 points to Orchard Guard (a Starter Box
deck, since removed) and nothing to the others, so with a better bot Orchard Guard measures about 58% overall rather than 53%.

## Research sources

- Mark Rosewater, *Twenty Years, Twenty Lessons* and *Lenticular Design* (magic.wizards.com)
- Keith Burgun, *Randomness and Game Design* (input vs. output randomness)
- Ben Brode, *Designing MARVEL SNAP* (GDC 2023)
- *Why Artifact Failed* (gamedeveloper.com)
- TheGamer: Riftbound producer on why Legends of Runeterra struggled (champion identity)
- FABREC, *The Genius of Flesh and Blood's Pitch System*; TCGplayer on Living Legend
- TCGplayer, *The Inkwell: Evaluating the Resource System of Disney Lorcana*
- The Fifth Trooper, *Star Wars Unlimited: Initiative and Actions*
- Kowalski & Miernik, *Summarizing Strategy Card Game AI Competition* (arXiv:2305.11814)
- de Mesentier Silva et al., *Evolving the Hearthstone Meta* (arXiv:1907.01623)
- *Can Large Language Models Master Complex Card Games?* (arXiv:2509.01328); Cardiverse (arXiv:2502.07128); RuleSmith (arXiv:2602.06232)
