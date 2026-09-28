# Yu-Gi-Oh! surveyed against cardengine

Baseline: the current Master Rules (TCG/OCG, 2020-2024 revisions), 8000 starting Life Points, no
resource system, Normal/Tribute Summons, five Monster Zones, five Spell & Trap Zones, one Field
Zone, two shared Extra Monster Zones, an Extra Deck, Attack/Defense position, face-down Sets,
chains with spell speeds 1-3, Xyz materials, Link Arrows. Pendulum Summoning is not modeled: it
adds a Pendulum Zone pair, a Scale-based mass-Summon action, and a monster that is simultaneously
a Monster and a Spell depending on zone, all just for a subset of the card pool released 2014-2020;
the survey treats it as a variant on top of the same gaps already found below, not a new one. Ritual
Summoning, banlist/format legality, and Speed Duels are likewise out of scope. Several rules below
are simplified from the real rulebook; each simplification is called out where it happens.

## 1. Game document

```
// Yu-Gi-Oh!, as a selection from the battle framework's catalogue, with MISSING/CORE notes where
// the catalogue has no matching rule. A rule not listed here does not apply.
yugioh = Game

name = 'Yu-Gi-Oh! Trading Card Game'
rulebook = nic                        // no machine-readable rulebook; Konami's rulebook + ruling DB
core = '1'
players = Players { min = 2, max = 2 }
sets = [@yugioh-survey]               // the five-card fragment in part 2

// Card types. MISSING: the framework has one UnitCard shape (power + health); a Monster needs a
// second, defensive stat that only matters while it faces the other way, plus Level/Rank/Link,
// none of which UnitCard has. Added here as plain fields, which the language allows on a subtype.
type Monster : UnitCard {
  defense: int
  attribute: text                     // DARK, LIGHT, EARTH, WATER, FIRE, WIND, DIVINE
  race: text                          // Dragon, Spellcaster, Machine, ... (flavor-only here)
  level: int? = nic                   // Normal/Effect/Ritual/Synchro monsters
  rank: int? = nic                    // Xyz monsters count Xyz Materials instead of a Level
  link: int? = nic                    // Link monsters: Link Rating
}
type Normal : Monster {}              // vanilla; no effect
type EffectMonster : Monster {}
type Ritual : Monster {}
type Fusion : Monster {}
type Synchro : Monster {}
type XyzMonster : Monster {}
// Link monsters have no DEF and no Defense Position at all -- `defense: int` above is required,
// so every sample Link card in part 2 has to write a defense value that does not exist in the
// real game. MISSING: a subtype cannot drop a required field it inherits.
type LinkMonster : Monster {}

type Spell : SpellCard {}
type QuickPlay : SpellCard {}
type FieldSpell : SpellCard {}
type RitualSpell : SpellCard {}
// An Equip Spell is drawn, discarded and destroyed like a Spell (SpellCard's shape) but attaches
// to a monster and grants it stats (AttachmentCard's shape). Picking one loses the other's rules;
// modeled here as a SpellCard whose own effect calls the core `attach` operation by hand.
type Equip : SpellCard {}             // MISSING: no card record has both shapes at once
// CORE/framework: there is no Trap card record. A Trap is its own pool (can't be Normal-Summoned
// or hard-cast; must be Set a full turn before it can activate; Counter Traps are spell speed 3).
// Modeled as SpellCard subtypes, which silently drops the Set-a-turn-early timing rule.
type NormalTrap : SpellCard {}
type ContinuousTrap : SpellCard {}
type CounterTrap : SpellCard {}

types = [
  Normal = CardType { name = nameof(Normal) }
  EffectMonster = CardType { name = 'Effect Monster' }
  Ritual = CardType { name = nameof(Ritual) }
  Fusion = CardType { name = nameof(Fusion) }
  Synchro = CardType { name = nameof(Synchro) }
  XyzMonster = CardType { name = 'Xyz' }
  LinkMonster = CardType { name = 'Link' }
  Spell = CardType { name = nameof(Spell) }
  QuickPlay = CardType { name = 'Quick-Play Spell' }
  FieldSpell = CardType { name = 'Field Spell' }
  RitualSpell = CardType { name = 'Ritual Spell' }
  Equip = CardType { name = 'Equip Spell' }
  NormalTrap = CardType { name = 'Normal Trap' }
  ContinuousTrap = CardType { name = 'Continuous Trap' }
  CounterTrap = CardType { name = 'Counter Trap' }
]

// Zones. CORE: `Zone` has no field for how many discrete slots a `slots` zone has -- five
// Monster Zones, five Spell & Trap Zones and two Extra Monster Zones all need a fixed count that
// the schema cannot record. CORE: the two Extra Monster Zones are shared, contested, and each is
// usable by a player only if one of their Link Monsters points a Link Arrow at it (or, under an
// older ruling, if they control a Pendulum Summoned monster) -- there is no concept anywhere in
// the core of one zone slot pointing at another zone slot; see the gap list.
zones = [
  Deck             = Zone { name = 'Main Deck', shape = pile, visible = none, count-public = true }
  Hand             = Zone { name = nameof(Hand), shape = set, visible = owner }
  MonsterZone      = Zone { name = 'Monster Zone', shape = slots, visible = all }       // 5 slots
  SpellTrapZone    = Zone { name = 'Spell & Trap Zone', shape = slots, visible = all }  // 5 slots
  ExtraMonsterZone = Zone {                                       // 2 slots, shared, arrow-gated
    name = 'Extra Monster Zone', shape = slots, visible = all, shared = true
  }
  FieldZone = Zone { name = 'Field Zone', shape = slot, visible = all }
  ExtraDeck = Zone { name = 'Extra Deck', shape = pile, visible = owner, count-public = true }
  Graveyard = Zone { name = nameof(Graveyard), shape = row, visible = all }
  Banished  = Zone { name = 'Banished Zone', shape = row, visible = all }   // some cards face-down
]

// Keywords. Attack/Defense position and face-up/face-down are per-object battle state, not tags
// on a card (see combat, below), so there is little here for the framework's Keyword/Builtin
// vocabulary to hold. Left empty; the sample cards' own text carries what a keyword normally would.
keywords = empty

// §Deckbuilding. Main Deck is a range, not one fixed size, and there are two more card pools the
// framework's deck-rules catalogue has no room for at all.
deck-rules = [
  DeckSizeRange { min = 40, max = 60 }             // MISSING: DeckSize only takes one fixed `n`
  CopiesMax { n = 3 }                              // matches as written: 3 copies by card name
  ExtraDeckSize { max = 15 }                       // MISSING: no rule for a second, Extra Deck pool
  SideDeckSize { max = 15 }                        // MISSING: a third pool, swapped in between duels
]

// §Setup. Real rule: each duelist draws 5, decides turn order, and the player going first skips
// their own first Draw Phase. That last part is a turn-one, first-player-only step exception;
// simplified away here since no rule in the catalogue can say it.
setup = [
  OpeningHand { n = 5 }
  // MISSING: "the first turn's Draw Phase is skipped for the first player only" -- RoundStart's
  // `skip-round` is round-scoped for both players together, not a single player's single turn.
]

// Life. A flat counter reaching zero ends it; this matches the framework exactly.
life = [ LifeCounter { name = 'Life Points', start = 8000, lose-at = 0 } ]

// Resources. None: the prompt's "no resource system" is literal here. A card is never cast from
// a pool; a Monster's only "cost" is the summoning procedure itself (see turns, below), and a
// Spell or Trap has no cost beyond already being in play. `UnitCard.cost`/`SpellCard.cost` are
// still required fields, so every card in part 2 sets `cost = 0` and pays nothing.
resources = empty
cost-resource = nic

// Turns: full turns split into phases, which the framework already models well.
turns = [
  FullTurns { first = random, cites = 'coin toss or rock-paper-scissors; loser of last is not used' }
  Phases {
    phases = [
      Phase { name = 'Draw Phase', steps = [Draw { count = 1 }] }
      // MISSING TriggerTime members: `standby` and `end-phase` don't exist; the enum only has
      // round/turn start and end.
      Phase { name = 'Standby Phase', steps = [Triggers { of = standby }] }
      Phase { name = 'Main Phase 1', steps = [] }                // free play; see responses, below
      Phase {
        name = 'Battle Phase'
        // MISSING Step members: none of these four exist in the Step catalogue.
        steps = [BattleStart {}, BattleStep {}, DamageStep {}, BattleEnd {}]
      }
      Phase { name = 'Main Phase 2', steps = [] }
      Phase { name = 'End Phase', steps = [Triggers { of = end-phase }, DiscardTo { hand = 6 }] }
    ]
  }
  NormalSummonPerTurn { n = 1 }          // MISSING: no once-per-turn-per-action-kind governor exists
  Actions {
    // MISSING Action members: `normal-summon`, `set-monster`, `set-spell-trap`, `activate`,
    // `change-position` don't exist; the enum only has play/attack/ability/take-initiative/pass.
    allowed = [normal-summon, set-monster, set-spell-trap, activate, attack, change-position, pass]
  }
]

initiative = empty     // no token; `turns.FullTurns.first` already covers who starts

// §Battle.
combat = [
  AttackerChooses { targets = [unit, hero] }
  // MISSING: a direct attack (targeting the player, `hero`) is legal only while the defending
  // player controls no monsters; there is no guard condition on a combat target.
  AttackerMustBeReady {}                 // a monster that already attacked this turn can't again
  UnitsEnterExhausted {}                 // summoning-sickness analogue: can't attack the turn it drops
  NoRetarget {}
  // MISSING: none of the next three exist. Yu-Gi-Oh has no persistent per-monster damage at all
  // (no wound counters survive a fight); a monster is destroyed outright or not, decided by
  // comparing whichever stat the position calls for, and only the loser's controller's monster is
  // destroyed (a tie destroys neither). `LifeDamage { n }`'s flat amount cannot express this.
  PositionBased {}                       // Attack Position uses power; Defense Position uses defense
  BattleDamageByStatDifference {}        // damage to a player = the losing side's stat deficit
  DestroyOnLowerStat {}                  // the monster with the lower stat is destroyed; a tie destroys neither
]

// §Chains. This is the framework's largest mismatch with this game; see the gap list and verdict.
responses = [
  Stack {}                               // LIFO resolution is right...
  // ...but `NoNesting {}` is deliberately NOT listed: Yu-Gi-Oh chains nest to arbitrary depth,
  // both players adding links in turn, which is exactly what NoNesting forbids. Omitting it only
  // means nesting isn't disallowed by this game; it does not give the engine a way to nest.
  // MISSING, all three: a chain link may only be added if its spell speed is >= the speed of the
  // link on top (speed 1 can't be chained onto at all); a response window opens after literally
  // any action, not just the fixed `WindowAfter` list (play-cost-paid, attack-declared,
  // ability-declared); and a Set Spell/Trap may not activate the turn it was Set.
  SpellSpeedGating {}
  PriorityAfterEveryAction {}
  SetBeforeActivating {}
]

triggers = [
  ActingPlayerFirst { cites = 'simultaneous triggers: turn player chains theirs last (LIFO order)' }
  TriggersAfterStateCheck {}
  // MISSING: the opposite of `TriggersOpenNoWindow` -- Yu-Gi-Oh trigger effects go on the chain
  // and can be responded to before they resolve; deliberately not using TriggersOpenNoWindow here.
  TriggersOpenWindow {}
]

// LP <= 0 is already handled by `life`'s LifeCounter through the core's `provide-game-over` hook;
// nothing else in this game polls continuously the way Folkborn's health/Awaken/loss checks do.
state-check = empty

hero = empty          // no hero mechanic

objects = [
  TokensVanishOffBoard { cites = 'a Token that leaves the field ceases to exist' }
  ZoneChangeResets { what = [attachments, this-round] }   // `damage` is unused: see combat, above
]
```

## 2. Five representative cards

```
// A Set fragment: five cards chosen to stress the vocabulary (a normal monster, an ignition
// effect, a quick-play spell, a continuous trap, and a Link monster).
yugioh-survey = Set

id = 'SURVEY'
name = 'Survey Sample'
core = '1'
version = '0.1.0'
status = prototype

cards = [
  celtic-guardian = Normal {
    name = 'Celtic Guardian', cost = 0, power = 1400, defense = 1200
    level = 4, attribute = 'EARTH', race = 'Warrior'
    flavor = 'An elf swordsman, elegant and precise.'
  }
  exiled-force = EffectMonster {
    name = 'Exiled Force', cost = 0, power = 1000, defense = 1000
    level = 4, attribute = 'EARTH', race = 'Warrior'
    flavor = 'You can Tribute this card; destroy 1 monster your opponent controls.'
  }
  mst = QuickPlay {
    name = 'Mystical Space Typhoon', cost = 0
    flavor = 'Target 1 Spell/Trap Card on the field; destroy it.'
  }
  gravity-bind = ContinuousTrap {
    name = 'Gravity Bind', cost = 0
    flavor = 'Monsters with Level 4 or higher cannot attack.'
  }
  decode-talker = LinkMonster {
    name = 'Decode Talker', cost = 0, power = 2300
    defense = 0   // MISSING: Link monsters have no DEF; `Monster.defense` can't be dropped
    link = 3, attribute = 'DARK', race = 'Cyberse'
    flavor = '2+ Effect Monsters. Link Arrows: Bottom-Left, Bottom, Bottom-Right.'
    // MISSING: Link Arrows aren't data anywhere in the framework; spelled out in flavor text only.
  }
]
```

```
// The wiring: effects, statics and the assignments that attach them to the cards above.
yugioh-survey-rules = Rules
for = @yugioh-survey

// Exiled Force: an ignition effect, paid for by Tributing itself.
// MISSING: no Trigger exists for a player-activated ability on a Monster; only a Hero's Face has
// an activatable member (`exhaust`) in the whole catalogue. `activate` is invented below.
// MISSING verbs: `sacrifice` (pay a cost by removing the source from play) and `destroy` (the
// core has a `destroy` *operation*, but no rules-layer verb calls it).
effect exiled-force-effect {
  sacrifice(this)
  target = choose(opponents, units)          // MISSING: `units`/`choose` only ever yield `unit`
  target.destroy()
}
@exiled-force.activate = exiled-force-effect  // MISSING: no `activate` trigger kind exists

// Mystical Space Typhoon.
// MISSING: no selector exists for "a Spell/Trap Card on the field" -- `choose`/`units` are typed
// to yield `unit` (a UnitCard-shaped object); a Spell/Trap on the field is a SpellCard-shaped
// object. `permanents`, yielding a general `object`, is invented below.
effect mst-effect {
  target = choose(all, permanents)
  target.destroy()
}
@mst.on-play = mst-effect

// Gravity Bind: continuous while face-up on the field.
// MISSING: `level-at-least` -- core's `Filter { on: Verb? }` takes no parameters at all, unlike
// `Selector`, so a numeric threshold ("Level 4 or higher") cannot be expressed as a filter.
// MISSING: `static` is only an extension member of UnitCard, not of SpellCard, so a Trap's own
// continuous effect has nowhere to be wired from.
static gravity-bind-static { units(all, level-at-least(4)).cant(attack) }
@gravity-bind.static = gravity-bind-static

// Decode Talker: static ATK boost, plus a Quick Effect usable as a response.
// MISSING: `points-to` (Link Arrow adjacency) does not exist anywhere in the core or framework.
static decode-talker-static { this.buff(power: +500 * this.points-to.count, until: permanent) }
// MISSING: a Quick Effect activated from the field, on either player's turn, is exactly Ambush's
// "activatable in a response window" -- but that Builtin is a property of *playing a card*
// (SpellCard.on-play), not of activating an ability already sitting on the field. No trigger kind
// covers "this permanent's own ability is playable in a response window."
effect decode-talker-negate {
  discard(1)                 // MISSING verb: pay a hand-discard cost
  event.cancel()
  event.card.destroy()       // MISSING: no way to reach the targeted card off the triggering event
}
@decode-talker.static = decode-talker-static
@decode-talker.activate = decode-talker-negate   // MISSING: same `activate` gap, now also needing
                                                  // `responding` so it can fire on either turn
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| No continuous, spell-speed-gated chain; response windows are tied to a fixed `WindowAfter` list, not "after any action" | core hook + framework rule | every game (that has any response system at all) | A core `priority` input separate from a full action, so either player may add to an open chain after any operation; a `speed: int` field on `SpellCard`/ability declarations; a framework `Chain : ResponseRule { }` replacing `Stack`/`NoNesting` for games where nesting is normal |
| No adjacency between zone slots (Link Arrows; which Extra Monster Zone a Link Monster may use) | core (`Zone`/object fields) | rare | A `points-to: [zone-slot]` object field, driven by a game-supplied arrow layout, plus a query `pointed-to-by(object)` |
| `Filter` takes no parameters, so a numeric threshold ("Level 4 or higher") can't be expressed | core (`Filter` type) | most games | `type Filter { on: Verb?, params: [text: ParamType] = empty }`, mirroring `Selector` |
| `choose`/`units` are typed to yield `unit`; nothing selects a Spell/Trap or other non-unit permanent on the field | framework (selector catalogue) | most games (anything with artifact/enchantment removal) | A `permanents` selector yielding a general `object`/`permanent` `ParamType`, alongside `units` |
| No player-activated (ignition-style) ability on a non-hero card; only a Hero's `Face` has `exhaust` | framework (Trigger catalogue) | most games | `activate = Trigger { on = ['UnitCard'], event = @none }`, usable at will while a player has priority, with an optional cost |
| No Trap-card record, and no "must be Set a turn before activating" timing rule | framework (card records) | rare (this exact split is Yu-Gi-Oh-specific) | `type TrapCard : Card { cost: Cost }`; a `SetBeforeActivating : ResponseRule {}` |
| `UnitCard` has one offense/defense stat (`power`/`health`); this game needs two, selected by a per-object facing | framework (card record shape; `CombatRule` catalogue) | most games (many split ATK/DEF or attack/toughness differently) | `PositionBased : CombatRule {}`; a documented convention for a second stat field on a game's own `Monster` subtype |
| Battle damage is a stat comparison (destroy the lower side, damage the loser's controller by the difference), not a flat or keyword amount | framework (`LifeDamage { n }` assumes a fixed amount) | rare in this exact form | `BattleDamageByStatDifference : CombatRule {}`, `DestroyOnLowerStat : CombatRule {}` |
| A second, differently-built card pool per player (Extra Deck), plus a third, swapped-in-only-between-duels pool (Side Deck) | framework (`DeckRule` catalogue sizes one deck) | rare | `type DeckPool : DeckRule { name: text, zone: Zone, max: int, min: int? }`, listable more than once |
| Deck size is a range (40-60), not one fixed number | framework (`DeckSize { n }`) | most games (many real TCGs allow a minimum, not an exact count) | `DeckSizeRange { min: int, max: int }` beside `DeckSize` |
| `Zone` has no fixed slot count (5 Monster Zones, 5 Spell/Trap Zones, 2 Extra Monster Zones) | core (`Zone` type) | most games (anything with a bounded number of play-slots) | `count: int?` field on `Zone` |
| No once-per-turn-per-action-kind governor (one Normal Summon per turn) | framework (`TurnRule`/`Actions` catalogue) | most games | `OncePerTurn : TurnRule { action: Action, n: int = 1 }` |
| `Action` enum is too coarse (`play, attack, ability, take-initiative, pass`) | framework (enum) | most games | Extend with `normal-summon, set, special-summon, activate, change-position` |
| `TriggerTime` has only round/turn start and end; no phase-level moments (standby, end phase, battle steps) | framework (enum) | most games with a phase structure | Extend `TriggerTime`, or let it reference a game-declared `Phase`/`Step` name instead of a closed enum |

## 4. Verdict

Framework-only additions cover most of this survey — new card-record fields, new `CombatRule`,
`TrigggerTime`, `DeckRule` and `Trigger` catalogue entries, and a parameterized `Filter` — but not
all of it: the chain/priority system needs a core-level change (a continuous, spell-speed-gated
priority input that the current fixed "one action, then drain the scheduler" loop does not offer),
and Link Arrow zone-adjacency is a second, smaller core gap. The single largest obstacle is the
chain: nearly every non-vanilla card either can be chained to, chains off something else, or
depends on knowing what is currently on the chain, and nothing in `core-operations.alex`'s loop
skeleton represents an open, nestable, spell-speed-checked window. Rough estimate: the vocabulary
shown here (plus the framework-only MISSING rules) could express perhaps **30-35%** of the
published card pool — vanilla Normal Monsters, plain Effect Monsters with a single on-enter or
one-shot ignition effect, and simple destroy/search/burn Spells — while the remainder routinely
chains, negates, counts Link Arrows or Xyz Materials by number, or cares about Set-vs-drawn timing,
all of which need the core chain change first.
