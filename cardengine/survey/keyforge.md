# Survey: KeyForge (Call of the Archons base rules, 2-player)

Simplifications, called out inline: expansion-only keywords (Skirmish, Poison, Omni, Alpha/Omega,
Enrage) are mentioned but not fully wired into the five cards. A creature's printed "Power" is
KeyForge's only stat — it is both what it deals and what destroys it — modeled here as
`power == health`, which is a real simplification of the schema, not of the game. The chain rule
is given in its original (2018 core rules) form: a permanent penalty removed only by card effects,
not the more recent optional-removal wording. The Archives may be looked at by their own owner
(current rules), so it is `visible = owner`, not `none`.

## 1. Game document

```
keyforge = Game

name = 'KeyForge'
rulebook = 'https://darkfire-live.s3-us-west-2.amazonaws.com/uploads/documents/rules/keyforge-comprehensive-rules.pdf'
core = '1'
players = Players { min = 2, max = 2 }
sets = [@keyforge-survey]

// Card types. There is no Hero: KeyForge never damages a player and no card represents a player.
type Creature : UnitCard {}
type Action : SpellCard {}
type Upgrade : AttachmentCard { per-unit = 1 }        // fits: attaches to one friendly creature
type Artifact : AttachmentCard {}
  // MISSING: forced into AttachmentCard's shape. Real Artifacts attach to *nothing* — they are
  // independent permanents with their own bay in a shared artifact row, most with no `Grant` at
  // all (they act through a repeatable "Action:" ability, not a stat bonus). See gap list.

types = [
  Creature = CardType { name = nameof(Creature) }
  Action = CardType { name = nameof(Action) }
  Upgrade = CardType { name = nameof(Upgrade) }
  Artifact = CardType { name = nameof(Artifact) }
]

// Zones.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Discard = Zone { name = nameof(Discard), shape = pile, visible = all }
  Battleline = Zone { name = nameof(Battleline), shape = row, visible = all }   // creature bays
  Artifacts = Zone { name = nameof(Artifacts), shape = set, visible = all }
  Archives = Zone { name = nameof(Archives), shape = pile, visible = owner }
]

// Keywords. Taunt and Armor map cleanly; Elusive does not.
keywords = [
  Taunt = BuiltinKeyword { name = nameof(Taunt), is = must-be-attacked-first }
  Armor = BuiltinKeyword { name = nameof(Armor), is = damage-reduction }   // Applied{@Armor, n}, as
                                                                            // Folkborn does with Tough
  Elusive = BuiltinKeyword { name = nameof(Elusive), is = evades-unless-sole-target }
    // MISSING: no such Builtin. Sneaky/`ignores-guardian` is attacker-side ("I ignore Taunt");
    // Elusive is defender-side ("you may only fight me if I'm the only creature you could fight").
    // Opposite direction, not expressible by negating an existing Builtin.
]
randomness = [shuffle, coin]              // opening coin flip decides who goes first
on-loss = game-ends
win = first-to                            // first to 3 Keys; see `state-check` below

// Deckbuilding. KeyForge decks are algorithmically pre-generated and never player-built, so these
// rules would validate a generator's output, not gate a player action at the table.
deck-rules = [
  DeckSize { n = 36 }
  GroupCount { of = 'house', n = 3 }
    // MISSING: no DeckRule expresses "exactly K disjoint named groups", only flat totals/copies.
  CardsPerGroup { of = 'house', n = 12 }
    // MISSING: same gap, for "exactly N cards from each of those groups".
]

// Setup. No mulligan in the base rules; both players draw a flat 6.
setup = [
  OpeningHand { n = 6 }
  RandomInitiative {}                     // coin flip, not a token — no Lantern-like object
]

// Life. KeyForge has no player life or health of any kind.
life = []
  // MISSING: `extension Game.life` has no `= empty` default, so a non-empty list is required even
  // though this game has nothing to put in it. The real alternate loss condition ("forced to draw
  // with an empty deck and empty discard") lives under `state-check` below instead, because it is
  // triggered by a failed action, not by a counter reaching zero.

// Resources. Cards are always free; nothing is spent to play them.
resources = empty
cost-resource = nic
  // MISSING: `UnitCard`/`SpellCard`/`AttachmentCard` all require a `cost: Cost` field with no
  // default and no way to opt out when `cost-resource` is `nic`. Every KeyForge card below carries
  // a vestigial `cost = 0` purely to satisfy the schema.

// Turns. Full sequential turns (not Folkborn's shared-round alternation).
turns = [
  FullTurns { first = random }
  ChooseActiveHouse {}
    // MISSING: no TurnRule for "the acting player names one of the three houses their deck holds;
    // that name is recorded as this turn's restriction". Buildable on the existing `player-fields.
    // flags` (a set of text) plus the existing `set-flag` operation, clearing the other two house
    // flags first — but there is no reusable "exactly one of N, for the scope of this turn" shape
    // in the catalog; a game author would hand-roll the mutual exclusion in three hook calls.
  RestrictToActiveHouse { actions = [play, reap, fight, activate] }
    // MISSING: same idea as Folkborn's `GuardiansFirst`/`SneakyIgnoresGuardians` (a filter-actions
    // hook), but scoped by a per-turn player flag rather than a fixed keyword. `play`/`reap`/
    // `fight`/`activate` are also MISSING `Action` enum members — see below.
  RoundStart {
    steps = [
      ReadyAll {}
      Triggers { of = round-start }
      DrawTo { hand = 6 }
        // MISSING: no Step draws *up to* a hand size; `Draw { count }` is always a fixed number.
        // Chains would further reduce this to `6 - chains` (minimum 1); simplified/omitted here —
        // see the gap list for the missing "reduce a Step's count by a counter" shape.
    ]
  }
  Actions { allowed = [play, reap, fight, activate, forge-key, pass] }
    // MISSING: `reap`, `fight` (KeyForge's "fight" is creature-vs-creature, unlike Folkborn's
    // `attack`, which is already the framework's name for that shape and is reused in `combat`
    // below under a different label), `activate` (a card's own "Action:" ability, not a Hero
    // Face's `exhaust`), and `forge-key` are all missing from the `Action` enum.
  RoundEnd { steps = [Triggers { of = round-end }] }   // no hand-size cap, no forced discard
]

initiative = []    // no shared token; the coin flip plus strict FullTurns alternation is all there is

// Combat ("fighting"). One-way damage is the load-bearing difference from Folkborn.
combat = [
  AttackerChooses { targets = [unit] }        // never a player; nothing analogous to `hero`/`life`
  AttackerMustBeReady {}
  GuardiansFirst {}                           // Taunt, reused directly
  OneWayDamage {}
    // MISSING: only the declared attacker deals damage; the defender does not automatically deal
    // damage back (Folkborn's `SimultaneousDamage` is the opposite policy and does not apply).
  DamagePersists {}                           // matches: damage stays marked until healed or the
                                               // creature leaves play (no automatic end-of-round heal)
]
// Creatures are never listed under `UnitsEnterExhausted`, so per the "a rule not listed does not
// apply" principle they enter the Battleline ready — matching KeyForge's "no summoning sickness".
// No core or framework change needed for that; it falls out of the catalog's own absence-of-default
// rule for free.

responses = []
  // Omni (a keyword letting a card's `activate` be used on either player's turn) is a further gap
  // not covered by the five cards below: no ResponseRule lets a non-acting player interleave an
  // activated ability with no triggering event, only in reaction to one. Flagged, not modeled.

triggers = [ActingPlayerFirst {}]
state-check = [
  DefeatAtHealth {}                           // a creature's damage counter reaching its power
  LoseOnFailedDraw {}
    // MISSING: no StateCheckRule for "if this player must draw and both their Deck and Discard are
    // empty, they lose immediately" (with an implicit "reshuffle Discard into Deck first" step when
    // only the Deck is empty). Buildable from the existing `move`/`shuffle` operations plus
    // `eliminate`/`end-game`, just never catalogued.
  KeysToWin { n = 3, cost = 6, counter = 'aember', progress = 'keys' }
    // MISSING: no StateCheckRule ties a spend-a-counter action to a win threshold. This one entry
    // also stands in for the `forge-key` Action's meaning: spend `cost` of `counter` (at most once
    // per turn unless a card says otherwise), gain 1 `progress`; `provide-game-over` returns a win
    // for the first player whose `progress` counter reaches `n`. Everything it needs (`adjust`,
    // `provide-game-over`, `end-game`) already exists in core-operations.alex.
]

hero = []                                     // no heroes at all

objects = [
  ZoneChangeResets { what = [damage, attachments, counters] }   // damage/Armor/Upgrades clear on exit
  TokensVanishOffBoard {}                     // some creatures spawn tokens; these do not persist
]
```

## 2. Five representative cards

House choice and the Key/Æmber win condition, in one place: a card's house is modeled as a
`Family` (the same record Folkborn uses for Citrus/Orchard/Tropical), with `neutral` always
`false` — unlike Folkborn, KeyForge has no neutral cards. `ChooseActiveHouse`/
`RestrictToActiveHouse` (section 1) turn that family into a per-turn legality filter the same way
`GuardiansFirst` turns a keyword into one; nothing below needed for the cards themselves changes.
Æmber and Keys are ordinary player counters (`player-fields.counters`, already generic at the core
level — the field comment even names "aember" as an example); `reap` and `capture` are new verbs
that call the existing `adjust` operation, and `KeysToWin` (section 1) is the only new rule that
reads them for a win check. None of this needed a core change — only new framework vocabulary.

```
keyforge-survey = Set

id = 'KF-SURVEY'
name = 'KeyForge Survey Cards'
core = '1'
version = '0.1.0'
status = prototype

families = [
  Brobnar = Family { name = nameof(Brobnar), colors = ['#8C2F2F', '#3A1414'] }
  Logos   = Family { name = nameof(Logos), colors = ['#2F6F8C', '#14343A'] }
  Shadows = Family { name = nameof(Shadows), colors = ['#3A3A3A', '#161616'] }
]

cards = [
  // 1. Vanilla creature. No keywords, no text.
  frostbite-grunt = Creature {
    name = 'Frostbite Grunt', family = @Brobnar
    cost = 0, power = 5, health = 5             // health mirrors power; see file header
    flavor = 'Simplified/representative card, not a verbatim reprint.'
  }

  // 2. Play and Reap on the same creature.
  whisper-adept = Creature {
    name = 'Whisper Adept', family = @Shadows
    cost = 0, power = 3, health = 3
    flavor = 'Play: Deal 1 damage to target enemy creature. Reap: Draw a card, then discard a card.'
  }

  // 3. Action that steals Æmber.
  amber-heist = Action {
    name = 'Amber Heist', family = @Shadows
    cost = 0
    flavor = 'Play: Capture 2 Æmber.'
  }

  // 4. Artifact with an Action ability.
  key-charge = Artifact {
    name = 'Key Charge', family = @Logos
    cost = 0
    attached = Grant {}      // MISSING/vestigial: nothing is granted; see the type-level note above
    flavor = 'Action: Discard a card. If you do, capture 1 Æmber.'
  }

  // 5. Effect depends on neighbours.
  bay-sentinel = Creature {
    name = 'Bay Sentinel', family = @Brobnar
    cost = 0, power = 4, health = 4
    flavor = 'Reap: Bay Sentinel gets +1 power (until end of turn) for each creature in an
      adjacent bay.'
  }
]
```

```
keyforge-survey-rules = Rules
for = @keyforge-survey

// 1. Frostbite Grunt needs no wiring at all — the existing vocabulary already covers "vanilla".

// 2. Whisper Adept.
effect whisper-play {
  target = choose(opponents)      // existing vocabulary: no gap for a plain single-target hit
  target.damage(1)
}
effect whisper-reap {
  draw(1)
  discard(choose(own, hand))
    // MISSING: no `discard` verb (a thin wrapper over the existing `move` operation, to Discard).
    // MISSING: `choose`'s only `from` is `players`, always scoped to the battlefield; there is no
    // selector that reaches into a player's own Hand at all, so "discard a card" cannot be written
    // today even before the missing verb.
}
@whisper-adept.on-enter = whisper-play
@whisper-adept.on-reap = whisper-reap
  // MISSING: `on-reap` does not exist. `UnitCard`'s trigger set (on-enter, on-defeated,
  // on-defeats-in-combat, on-round-start, on-you-heal) has nothing for "when this creature reaps".

// 3. Amber Heist.
effect capture-two { capture(2, from: opponent) }
  // MISSING: no `capture`/steal verb. Needs to read the opponent's `aember` counter, subtract
  // min(2, their current value), and add that same amount to the caster's `aember` — two
  // coordinated calls to the existing `adjust` operation, never exposed as a rules-layer verb.
@amber-heist.on-play = capture-two

// 4. Key Charge.
effect key-charge-action {
  if discard(choose(own, hand)) { capture(1, from: opponent) }
    // MISSING: same `discard`/hand-selector gap as card 2, plus an "if this verb succeeded" idiom
    // (a card is only in hand to discard if the hand isn't empty; today a condition can only test
    // `@name { ... }` boolean expressions over properties, not the outcome of a verb call).
}
@key-charge.activate = key-charge-action
  // MISSING: no `activate` trigger exists anywhere in the framework. The only activated-ability
  // mechanism today is `Face.exhaust`, and it only attaches to a Hero's face — there is nothing
  // for a repeatable player-activated ability on a Creature or (as here) a non-attaching Artifact.

// 5. Bay Sentinel.
effect bay-sentinel-reap {
  this.buff(power: +neighbours(this).count, until: this-round)
    // MISSING: no `neighbours` selector. It would read `object-fields.position` and `zone` (both
    // already exist) to return the objects at `position - 1` and `position + 1` in the same row —
    // fully computable from existing core fields, just never exposed as a framework `Selector`.
}
@bay-sentinel.on-reap = bay-sentinel-reap   // same on-reap gap as card 2
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| Per-turn "pick one of N named groups; everything you do must belong to it" (houses) | framework (new `TurnRule`s) | rare (house-based deckbuilding is unusual) | `ChooseActiveHouse : TurnRule {}` plus `RestrictToActiveHouse : TurnRule { actions: [Action] }`, built on the existing `player-fields.flags`/`set-flag` |
| Reap/fight/activate/forge-key as base player actions | framework (`Action` enum) | most games need at least one activated-ability action beyond `ability` | Append `reap`, `fight`, `activate`, `forge-key` to the `Action` enum |
| Activated ability on a Creature or Artifact, not just a Hero's Face | framework (`Trigger`) | most games with tap-abilities | `activate = Trigger { on = ['UnitCard', 'ArtifactCard'], event = @none }` |
| "When this creature reaps" trigger | framework (`Trigger`) | rare outside this genre | `on-reap = Trigger { on = ['UnitCard'], event = @none }` |
| Independent permanent that attaches to nothing (Artifact) | framework (card record) | most games have some non-unit, non-attached permanent | `type ArtifactCard : Card { cost: Cost }`, sibling of `AttachmentCard`/`UnitCard`, with its own `on-play`/`activate` extension members |
| Steal/capture a counter from an opponent, clamped to what they have | framework verb | common wherever two players share a contested resource | `capture = Verb { on = player, params = [counter = text, amount = int, from = player] }` |
| Discard verb, and selecting from a player's own Hand at all | framework (verb + selector) | every game with hand disruption or a discard cost | `discard = Verb { on = units }` (wraps the existing `move` op); `hand = Selector { yields = units, params = [of = player] }` |
| Neighbour/adjacency selector for a row-shaped zone | framework selector | rare (needs `row`/`lanes` shape) | `neighbours = Selector { yields = units, params = [of = unit] }`, reading the existing `position` field ± 1 |
| Draw *up to* a hand size, vs. a fixed count | framework (`Step`) | most games have some hand-size step (Folkborn only has discard-to) | `DrawTo : Step { hand: int }` |
| A `Step`'s count reduced by a per-player penalty counter (chains) | framework (`Step` params) | rare | Add `minus: text?` to `Draw`, or a dedicated `DrawMinusCounter : Step { counter: text, minimum: int }` |
| One-way (non-mutual) fight damage | framework (`CombatRule`) | rare in the reference framework, common enough elsewhere | `type OneWayDamage : CombatRule {}` — only the declared attacker deals damage |
| Defender-side "can't be targeted unless it's the only legal choice" (Elusive) | framework (`Builtin` enum) | rare variant of evasion | Append `evades-unless-sole-target` to `Builtin` |
| Deck construction as "exactly K disjoint groups of exactly N cards" | framework (`DeckRule`) | rare (only matters to a deck generator here, never to a player) | `GroupCount : DeckRule { of: text, n: int }`, `CardsPerGroup : DeckRule { of: text, n: int }` |
| Alternate loss on a failed mandatory draw (deck and discard both empty) | framework (`StateCheckRule`) | most games have *some* empty-deck rule, this exact shape is less common | `LoseOnFailedDraw : StateCheckRule {}`, using the existing `move`/`shuffle`/`eliminate` operations |
| Spend a counter for progress toward a threshold win (Æmber → Keys) | framework (`StateCheckRule`) | rare (most win conditions are life-loss or deck-out) | `KeysToWin : StateCheckRule { n: int, cost: int, counter: text, progress: text }`, feeding `provide-game-over` |
| `life` required non-empty; `cost` required on every card, even with no economy | framework (`extension Game.life`, card record fields) | rare (most games have life or a cost economy) | Give `life` a `= empty` default like `combat`/`responses`; give `Cost`-bearing fields a `= 0` default or make them `Cost?` |

## 4. Verdict

Every gap above is a framework catalog addition (a new `Rule`/`Verb`/`Selector`/`Trigger`/card
record); nothing needs a change to core.alex or core-operations.alex — the generic per-player
counters, flags, `adjust`/`move`/`shuffle` operations, and `provide-game-over`/`filter-actions`
hooks the core already exposes turn out to be exactly enough to build houses, Æmber, Keys, reaping,
and one-way fighting on top of. The single largest obstacle is the active-house restriction: it is
the one piece that touches deckbuilding, turn structure, and every verb a card can call all at
once, and nothing in the catalog models "a per-turn, mutually-exclusive choice that gates legality"
today. Rough estimate: maybe 55% of the published pool — plain-stat creatures, and Play/Reap/Action
abilities built from damage/heal/draw/buff/ready once `discard`, `capture`, `activate`, and
`on-reap` exist — already fits; artifacts (roughly a sixth of any pool), hand-attack effects,
Elusive/Poison/Omni keyword text, and neighbour-based cards need the further additions above before
they parse.
