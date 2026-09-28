# Survey: Hearthstone (standard, 2-player constructed)

Simplifications, called out inline: Battlegrounds, Arena/Duels drafting, and Mercenaries are out of
scope. "Standard" card pool only. Adventure/dungeon-run bespoke rules are ignored. Some fine print
(exact Discover pool-generation odds, the precise wording of every keyword) is simplified to the
mechanical shape that matters for the engine.

## 1. Game document

```
hearthstone = Game

name = 'Hearthstone'
rulebook = 'https://hearthstone.wiki.gg/wiki/Advanced_rulebook'
core = '1'
players = Players { min = 2, max = 2 }
sets = [@hs-survey]

// Card types. A Hero Power is not a card at all in real Hearthstone (it belongs to the class, not
// the deck), but it needs somewhere to live in this schema, so it rides the Hero's Face like
// Folkborn's day/night flip does. See the `hero` area below for why that is a poor fit.
type Hero : HeroCard {}
type Minion : UnitCard {}
type Spell : SpellCard {}
type Secret : SpellCard {}                  // see `responses` below: this is the wrong base
type Weapon : AttachmentCard {}              // MISSING: AttachmentCard attaches to a *unit* with a
                                              // `Grant` (power/health/keywords) and a per-unit copy
                                              // limit. A Weapon attaches to the HERO, has its own
                                              // power, and a durability counter that goes down each
                                              // time the hero attacks and breaks the weapon at 0.
                                              // None of that is expressible by AttachmentCard/Grant.

types = [
  Hero = CardType { name = nameof(Hero) }
  Minion = CardType { name = nameof(Minion) }
  Spell = CardType { name = nameof(Spell) }
  Secret = CardType { name = nameof(Secret) }
  Weapon = CardType { name = nameof(Weapon) }
]

// Zones.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Board = Zone { name = nameof(Board), shape = row, visible = all }
  // CORE: `Zone` has no capacity field. The board is hard-capped at 7 minions (the 8th `play`
  // becomes illegal) and nothing in core.alex's `Zone` record can express a maximum occupancy.
  Secrets = Zone { name = nameof(Secrets), shape = set, visible = none, face-down = true }
  WeaponSlot = Zone { name = nameof(WeaponSlot), shape = slot, visible = all }
  HeroSlot = Zone { name = nameof(HeroSlot), shape = slot, visible = all }
]

// Keywords. Charge and Taunt map onto existing Builtins; most of the rest do not.
keywords = [
  Taunt = BuiltinKeyword { name = nameof(Taunt), is = must-be-attacked-first }
  Charge = BuiltinKeyword { name = nameof(Charge), is = enters-ready }
  Rush = BuiltinKeyword { name = nameof(Rush), is = enters-ready }
    // MISSING: Rush also forbids attacking the *hero* on the turn it enters; `enters-ready` alone
    // (Charge's meaning) grants unrestricted attacks, so Rush is currently just "worse Charge".
  DivineShield = BuiltinKeyword { name = nameof(DivineShield), is = damage-reduction, value = 999 }
    // MISSING: forced to abuse `damage-reduction` here. Divine Shield negates exactly the first
    // instance of damage, in full, then removes itself -- a one-shot consumable negation, not a
    // persistent flat reduction. No Builtin for "negate-then-remove" exists.
  Windfury = BuiltinKeyword { name = nameof(Windfury) }        // MISSING: no Builtin (attack twice)
  Poisonous = BuiltinKeyword { name = nameof(Poisonous) }      // MISSING: no Builtin (destroys
                                                                // anything it damages in combat)
  Lifesteal = BuiltinKeyword { name = nameof(Lifesteal) }      // MISSING: no Builtin (damage dealt
                                                                // also heals the controller's hero)
  Stealth = BuiltinKeyword { name = nameof(Stealth) }          // MISSING: no Builtin (can't be
                                                                // targeted or attacked until it
                                                                // attacks or deals damage)
]
event-names = [on-enter = 'Battlecry', on-defeated = 'Deathrattle']
randomness = [shuffle, coin]           // the opening coin flip fits `coin` exactly

// Deckbuilding.
deck-rules = [
  DeckSize { n = 30 }
  CopiesMax { n = 2 }
  CopyLimitByRarity { rarity = legendary, copies = 1 }
    // MISSING: `CopyLimit` keys off a `CardType`, not a `Rarity`. Legendary is a rarity that cuts
    // across Minion/Spell/Weapon, so the existing rule cannot express "max 1 copy of any legendary".
]

// Setup.
setup = [
  HeroTo { zone = @zones.HeroSlot, face = 1 }
  OpeningHand { n = 3 }
  AsymmetricOpeningHand { first = 3, second = 4, bonus-card = @the-coin }
    // MISSING: no SetupRule gives the two players different starting hands. `OpeningHand` is a
    // single `n` for both. Hearthstone deals the player going second one extra card plus The Coin.
  Mulligan { times = 1, up-to = 4 }
]

// Life. No armor rule exists at all.
life = [
  LifeCounter { name = 'Health', start = 30, lose-at = 0 }
  LifeShield { name = 'Armor' }
    // MISSING: no `LifeRule` for a secondary counter that absorbs damage before Health does.
    // Achievable with existing core primitives (a second player counter, a before-damage hook that
    // drains it first) -- just never catalogued as a named framework rule.
]

// Resources.
resources = [
  Mana = GrowingCounter { name = 'Mana Crystal', start = 1, per-turn = 1, max = 10 }
    // MISSING: `GrowingCounter` has no `pay-by` (unlike `CardsAsResources`) and no stated refill
    // policy. Mana crystals fully refill every round; nothing says the pool empties and refills
    // rather than staying spent like Folkborn's Offerings do until an effect readies them.
]
cost-resource = @resources.Mana

// Turns.
turns = [
  FullTurns { first = random }
  RoundStart {
    steps = [
      ReadyAll {}
      GrowResource { resource = @resources.Mana }
        // MISSING: no `Step` grows or refills a resource at round start; the `Step` catalog only
        // has `ReadyAll` (objects), not player resource pools.
      Triggers { of = round-start }
      Draw { count = 1 }
    ]
  }
  Actions { allowed = [play, attack, ability, pass] }
  RoundEnd {
    steps = [ Triggers { of = round-end }, BurnOnDrawIfFull {} ]
      // MISSING: no `Step` for "a card drawn while the hand is already at 10 is destroyed
      // immediately instead of being added". `DiscardTo { hand = n }` discards down to a limit at
      // round end, which is a different rule (and fires at the wrong time).
  }
]

initiative = []   // no Lantern-like shared token; `turns.FullTurns.first` already decides who acts

// Combat.
combat = [
  AttackerChooses { targets = [unit, hero] }
  AttackerMustBeReady {}
  UnitsEnterExhausted {}
  GuardiansFirst {}                        // Taunt
  NoRetarget {}
  SimultaneousDamage {}
  DamagePersists {}                        // matches: damage stays marked until healed or the
                                            // minion leaves play
  LifeDamageEqualsPower {}
    // MISSING: the catalog's only life-damage rule, `LifeDamage { n }`, is a fixed constant
    // (Folkborn: every hit costs exactly 1 Candle). Hearthstone damage to a hero or minion always
    // equals the attacker's power; there is no "damage equals power" variant.
  HeroAttacksWithWeapon {}
    // MISSING: no rule lets the hero itself attack using an equipped weapon's power (and spend one
    // point of its durability). `HeroAttacksWhenAwakened` is Folkborn's day/night hero and unrelated.
  Freeze {}
    // MISSING: no status/CombatRule for "this object can't attack; the status clears at the start
    // of its controller's next turn unless it is frozen again first."
]

// Responses. Secrets do not fit this area at all.
responses = []
// CORE: a Secret is played face down into a hidden zone, sits inert for any number of future
// turns, and fires itself the instant a matching action happens on an *opponent's* turn -- with no
// decision point for its owner and no visible response window. `ResponseWindows`/`Stack`/
// `OnePerWindow` all assume the card's owner is offered a choice to play something face-up in
// reaction. Building a hidden, self-consuming, unconditionally-firing trigger needs a new kind of
// `Trigger` (not a `ResponseRule`), and the event it fires on ("my hero was attacked") needs a
// target type that spans Hero and Minion -- see the `on-enter`/target gap in section 2.

triggers = [TriggersImmediately {}, ActingPlayerFirst {}]
state-check = [DefeatAtHealth {}, LossOnStateCheck {}]

// Heroes. The framework's Hero/Face pair was built for Folkborn's day-into-night flip, which is a
// poor model for a persistent character with a repeatable, resource-gated ability.
hero = []
// MISSING: `Face.exhaust` has no `cost` and no once-per-round flag of its own (a `UnitCard` has
// `once-per-round`, a `Face` does not). A Hero Power costs mana (usually 2) and is usable at most
// once per turn; today a Face's `exhaust` trigger is free and unlimited unless a whole `HeroRule`
// is invented to bolt a limit on top of every game that uses one.

objects = [
  TokensVanishOffBoard {}
  ZoneChangeResets { what = [damage, attachments] }
]
```

## 2. Five representative cards

```
hs-survey = Set

id = 'HS-SURVEY'
name = 'Hearthstone Survey Cards'
core = '1'
version = '0.1.0'
status = prototype

tokens = [
  damaged-golem = Token { name = 'Damaged Golem', type = @Minion, power = 2, health = 1 }
]

cards = [
  the-coin = Spell { name = 'The Coin', cost = 0 }   // dealt by AsymmetricOpeningHand, not drawn

  // 1. Vanilla minion. No text at all; stats only.
  chillwind-yeti = Minion { name = 'Chillwind Yeti', cost = 4, power = 4, health = 5 }

  // 2. Battlecry with a target.
  elven-archer = Minion {
    name = 'Elven Archer', cost = 1, power = 1, health = 1
    flavor = 'Battlecry: Deal 1 damage.'
  }

  // 3. Deathrattle that summons.
  harvest-golem = Minion {
    name = 'Harvest Golem', cost = 3, power = 2, health = 3
    flavor = 'Deathrattle: Summon a 2/1 Damaged Golem.'
  }

  // 4. Secret.
  explosive-trap = Secret {
    name = 'Explosive Trap', cost = 2
    flavor = 'Secret: When your hero is attacked, deal 2 damage to all enemies.'
  }

  // 5. Discover.
  netherspite-historian = Minion {
    name = 'Netherspite Historian', cost = 4, power = 2, health = 5
    flavor = 'Battlecry: Discover a minion.'
  }
]
```

```
hs-survey-rules = Rules
for = @hs-survey

// 2. Elven Archer: "Battlecry: Deal 1 damage." (to any character, minion or hero)
effect archer-bc {
  target = choose(all)
  // MISSING: `choose`'s `from` parameter is typed `players` and it yields a `unit` -- it can only
  // land on a minion belonging to one of those players, never on a player's Hero directly. Almost
  // every removal or burn Battlecry in the game needs to hit "any character" (minion or face), and
  // there is no selector or `ParamType` that spans both. This is the single most-used shape in the
  // card pool and it does not fit today.
  target.damage(1)
}
@elven-archer.on-enter = archer-bc

// 3. Harvest Golem: "Deathrattle: Summon a 2/1 Damaged Golem."
effect harvest-golem-dr {
  summon(token = @damaged-golem, count = 1)
  // MISSING: `summon` has no way to say *where* on the row the token lands. The real card's token
  // appears in the exact board slot the dying minion occupied; `summon`'s only parameters are
  // `token` and `count`, with no `position`, even though `object-fields.position` already exists.
}
@harvest-golem.on-defeated = harvest-golem-dr

// 4. Explosive Trap: "Secret: When your hero is attacked, deal 2 damage to all enemy minions and
// the enemy hero." Written the only way the current vocabulary allows, which is wrong on purpose
// to show the gap: `on-play` fires the instant the Secret is placed, not later when it is sprung.
effect explosive-trap-effect {
  units(opponents).damage(2)
  // CORE: no verb reaches "the hero of every opponent"; `opponents` yields players, and there is
  // no property/selector that turns a player into a damageable target the way `units` turns a
  // player into their board. Also can't hit "the specific attacker", because the event that would
  // carry that (an attack aimed at a hero) isn't a defined `Event` -- see target gap above.
}
@explosive-trap.on-play = explosive-trap-effect
// MISSING: should instead be a hidden, self-removing trigger that fires on a later `attack` event
// whose target is this player's Hero -- there is no such `Trigger` kind (see `responses` above).

// 5. Netherspite Historian: "Battlecry: Discover a minion." (reveal 3 random minions from the
// collection to you only; add the one you choose to your hand; the other two are never seen again)
effect discover-a-minion {
  target = discover(pool = all-minions, count = 3)
  // MISSING: no `discover` verb or selector exists anywhere in core or framework. `choose` and
  // `units` only select among objects that already exist in a zone; nothing samples N options from
  // the abstract printed card pool, shows them to one player only, and lets that player pick one.
  // (This is plausibly achievable *without* a core change: the `pick` random operation already
  // takes an `options` argument, and `require-action`'s options are already visible only to the
  // acting player -- it just needs a framework selector wired on top of those two primitives.)
  target.move(to = own.Hand)
  // MISSING: no generic verb moves a chosen object into a zone from inside an effect. `summon`
  // only creates a fresh token onto the board; there is nothing that puts an arbitrary printed
  // card into hand, which Discover (and "draw a copy of X") both need.
}
@netherspite-historian.on-enter = discover-a-minion
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| No target type spans Hero and Minion ("any character") for damage/removal/targeting | core (`ParamType`/`Arg` enums) | every game | Add `character` to `ParamType`/`Arg`, resolved to `unit \| hero`; retype `choose`'s `yields` and `damage`'s `on` to accept it |
| Board has no maximum occupancy (the 7-minion cap) | core (`Zone` record) | most games | Add `capacity: int?` to `Zone`; `legal-actions` drops `play` for a minion once a full board's capacity is hit |
| Hidden, self-consuming, unconditionally-firing triggers (Secrets/traps) | framework (`Trigger`/`ResponseRule`) | rare in general, central here | New `Trigger.hidden: bool` plus `kind = auto` that fires on a matching event without opening a window, then discards its own card |
| No generic destroy/move verb exposed to effects | framework verbs | every game | `destroy = Verb { on = units }`, `move = Verb { on = units, params = [to = zone] }`, both thin wrappers over the existing core `destroy`/`move` operations |
| No Discover-style "sample N from the printed pool, show one player, they pick one" | framework selector/verb | most modern sets | `discover = Selector { yields = unit, params = [pool = text, count = int], optional = [filters = filters] }`, built from the existing `pick` random operation plus `require-action`'s player-only visibility |
| Resource pool that grows a max each round and fully refills, vs. only growing | framework (`GrowingCounter` fields, `Step` catalog) | most games with a mana-like resource | Add `pay-by: PayBy` to `GrowingCounter`; add `GrowResource : Step { resource: ResourceRule }` |
| Hand-limit overflow destroys the drawn card immediately, rather than discarding down to a limit later | framework (`Step` catalog) | most games with a hand limit | `BurnOnDrawIfFull : Step {}`, alongside the existing `DiscardTo` |
| Escalating fatigue (1, then 2, then 3 damage each successive empty draw) | framework rule params | rare | `EmptyDeckDrawCosts { start: int, growth: int }` in place of the fixed `n` |
| Asymmetric starting hands / a bonus card for the player going second | framework (`SetupRule`) | most alternating-turn games | `AsymmetricOpeningHand : SetupRule { first: int, second: int, bonus-card: Token? }` |
| Hero Power: a resource-gated, once-per-turn ability on a persistent hero, unrelated to a day/night flip | framework (`Face` fields, `HeroRule`) | most games with a hero/planeswalker-style repeatable ability | Add `cost: Cost?` and `once-per-round: bool` to `Face`; a `PowerOncePerRound : HeroRule {}` |
| Armor: a secondary counter that absorbs damage before life does | framework (`LifeRule`) | many games with shields/armor | `LifeShield : LifeRule { name: text }` |
| Weapon: attaches to the Hero (not a unit), has its own power, and a durability that depletes on the hero's attack | framework (card record) | many games with equipment | `type WeaponCard : Card { cost: Cost, power: int, durability: int }`, plus a combat rule letting the hero attack with it |
| Combat/life damage always equals the attacker's power, not a fixed constant | framework (`CombatRule`) | every game where damage is variable | `LifeDamageEqualsPower : CombatRule {}` beside the existing `LifeDamage { n }` |
| Several combat keywords (Windfury: attack twice; Poisonous: destroys on any damage; Lifesteal: heals the controller; Stealth: untargetable until it acts) | framework (`Builtin` enum) | common in this game | Four new `Builtin` members, each wired the way `life-damage`/`damage-reduction` already are |
| Divine Shield: negate exactly the next hit, then remove itself | framework (`Builtin` enum) | common in this game | `Builtin: negates-next-hit`, distinct from the persistent `damage-reduction` |
| Board-position/adjacency effects (e.g. "adjacent minions get +2 Attack") | framework selector | rare across TCGs, recurring here | `adjacent = Selector { yields = units, params = [to = unit] }`, reading the existing `object-fields.position` inside a row zone |
| Copy limit keyed by rarity, not card type | framework (`DeckRule`) | most games with a unique/legendary rarity | `CopyLimitByRarity : DeckRule { rarity: Rarity, copies: int }` beside the type-keyed `CopyLimit` |

## 4. Verdict

Almost entirely framework additions: only two items above are real core changes (a target type
spanning Hero and Minion, and a capacity field on `Zone`), and both are small, additive, and
consistent with the core's own evolution rules. The single largest obstacle is the missing
Hero/Minion target type — it silently breaks the most common card shape in the game (any spell or
Battlecry that can "deal damage to a character"), plus the Secret and Hero Power mechanics that
build on it. Rough estimate: maybe 55-60% of the standard card pool — vanilla stats, keyworded
minions once the four missing `Builtin`s and the two consumable-negation fixes above exist, plain
minion-only Battlecries/Deathrattles, and buffs/heals restricted to friendly units — already maps
onto the existing vocabulary; the rest (face-damage spells, Secrets, Discover, weapons, Hero
Powers, and the handful of adjacency cards) needs the core target-type fix plus the dozen or so
framework catalog entries listed above.
