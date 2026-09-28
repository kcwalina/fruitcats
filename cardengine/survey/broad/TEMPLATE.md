# Broad survey: per-game record

One record per game, in this exact shape, so the records can be aggregated by script. Fill every
field; write `unknown` rather than guessing when you could not establish a fact. Keep each record
under 25 lines. The `SUMMARY|` line is machine-read: keep its field order and use only the listed
vocabulary in the fixed-vocabulary fields.

Vocabulary (pick one per field; add a second with `+` only if the game really has both):
- players: `2` | `2-4` | `2+` | `asym` (the two sides play by different rules)
- turns: `full` (whole turns with phases) | `alternating` (one action at a time until both pass) |
  `shared-gauge` (a shared counter hands the turn over) | `simultaneous` | `other`
- resources: `cards` (any card face down) | `growing` (a counter that grows each turn) |
  `resource-cards` (lands, energy) | `pitch` (discard for value) | `none` | `other`
- life: `counter` | `stack` (face-down cards) | `race` (first to n of a counter) | `keys` |
  `none` | `other`
- combat: `attacker-chooses` | `defender-blocks` | `lanes` | `compare-stat` | `none` | `other`
- responses: `none` | `windows` (fixed reaction moments) | `stack` | `chain` |
  `alternating` (priority flips) | `other`
- board: `row` | `slots` | `lanes` | `grid` | `none` | `other`
- fit: `libraries` (our libraries and their rules suffice) | `framework` (needs new rules or
  records in libraries, no core change) | `core` (needs a change to core.alex or
  core-operations.alex) | `out` (out of scope: not really card-versus-card, or needs physical
  gimmicks)

```
## <Game> (<year>, <publisher>) — <status>
- Players: <vocab>
- Turns: <vocab>; <one clause: what makes a turn end / who acts next>
- Resources: <vocab>; <one clause: how paid>
- Life: <vocab>; <one clause: what ends the game>
- Combat: <vocab>; <one clause>
- Responses: <vocab>; <one clause>
- Board: <vocab>; <one clause: zones with a shape, capacities>
- Card kinds: <which of our records fit: units / spells / attachments / permanents / heroes;
  name any kind that fits none>
- Hook: <the structural mechanic that distinguishes the game, one sentence>
- Libraries sufficient: <yes | mostly | no>; <what is used cleanly>
- Missing rules: <comma-separated short names of rule types, verbs, keywords or records a
  library would need, e.g. DeclareBlockers, WeaknessResistance, activate-with-cost; or `none`>
- Core gaps: <none | comma-separated: e.g. nestable priority, predicate filters, under-stack
  rules, target=unit|player, zone adjacency, multi-record cards, other: <text>>
- Fit: <vocab>; <one clause of justification>
- Confidence: <high | medium | low>; <why, e.g. "played it" / "rulebook fetched" / "summary only">
SUMMARY|<game>|<players>|<turns>|<resources>|<life>|<combat>|<responses>|<board>|<fit>|<confidence>
```

Notes for the classifier:
- "Our libraries" are the files in framework/lib/. Read them once before starting; they are
  short. A rule that exists there is not missing. A rule that does not is missing even if it is
  easy to add; name it.
- A core gap is only something the core's object model, operations, queries, hooks, input or
  scheduler cannot express at all. Most things are framework gaps. When unsure, say framework and
  explain in the Core gaps clause why it might be core.
- Games in the earlier deep survey (Magic, Pokémon, Yu-Gi-Oh!, Hearthstone, Lorcana, Flesh and
  Blood, KeyForge, Digimon) still get a record here, in this format, so the aggregate is complete.
