# Card data architecture: cards and decks from outside the engine

How cards and decks get into the game, so that:

1. **The engine knows no cards.** It implements the rules and a fixed vocabulary of card abilities. Every
   card, deck, family and family mechanic is data handed to it from outside. The engine runs with no
   sets loaded.
2. **What data can't say, a set says in a plugin:** code that lives in the set's own folder, plugs into
   the engine through a small interface, and can be left out without the engine noticing.
3. **Contributors can make decks without touching code.** A card set is a folder of data and pictures. A
   future designer app (the **Studio**) edits that folder, playtests it and submits it for review.

Last updated 2026-09-24. Built: the data-driven engine, plugins, and the content folders for card data.
Still to do is listed at the end.

## How it fits together

```
 content/<year>/<month>/<set>/       one folder per set, by release month
   set.json                          families, mechanics, cards, tokens, decks
   plugin.ts                         optional: code for what the data can't say
        │
        ▼  content/index.ts          imports every set statically; loadContent(registerSet, { prototypes })
   packages/engine  (catalog: CARDS, DECKS, FAMILIES, MECHANICS, PLUGINS; empty until a set is registered)
        │
        ├──► apps/web                loads released sets (apps/web/src/content.ts)
        ├──► playtest/               loads everything, prototypes too (playtest/lib/engine.ts)
        └──► tests, simulate.ts      load everything (packages/engine/test/setup.ts)
```

- **`packages/engine`** imports no card data. `registerSet(data, plugin?)` fills its catalog;
  `createGame` then takes deck keys or deck lists as before.
- **`content/index.ts`** lists the sets with static imports (the playtest runner is bundled into one file
  that runs on PC2024, far from the repo, so nothing may be read from disk at run time). It imports nothing
  from the engine: the caller passes in `registerSet`, so the sets always land in the caller's engine.
- **Released and prototype sets.** A set's `status` is `released` or `prototype`. The public game loads
  released sets only; playtests, simulations and tests load prototypes too. So a designed but unreleased
  deck (Heat Wave today) can be playtested by bots and agents without appearing in the game.
- **Folders by release.** `content/2026/09/starter-box/` and `content/2026/09/heat-wave/`. Everything a
  set owns lives in its folder:

  ```
  content/2026/09/heat-wave/
    set.json                   cards, tokens, families, mechanics, decks
    plugin.ts                  optional
    art/prompts.json           art direction
    art/illustrations/<id>.webp        text-free art (Hero Cats: <id>-kitten / <id>-bigcat)
    art/cards/<id>.webp, art/cards/<finish>/<id>.webp   composed by tools/compose_cards.py
    announcement/              its announcement page (index.html, share.jpg)
  ```

  The site publishes each folder at stable addresses (`apps/web/vite.config.ts`, contentAssets):
  `/<set>/<id>.webp`, `/cards/<set>/…` and `/announcements/<set-folder>/`. Pawtraits stay in `art/avatars/`
  for now: the accounts work and its avatar server use those paths.

| Set | Folder | Status | Plugin |
|---|---|---|---|
| Starter Box (SB1) | `content/2026/09/starter-box/` | released | yes: the bot's Zest heuristic |
| Heat Wave (HW1) | `content/2026/09/heat-wave/` | prototype | none needed |

## Cards as data: abilities

A card's rules are a list of **abilities**. Each combines four closed lists of pieces: **when** it
happens, an optional **if**, a **target**, and what it **does**. The engine implements each piece once.

```jsonc
{ "id": "SB1-C06", "name": "Citron Fox", "type": "Critter", "family": "Citrus", "rarity": "Common",
  "cost": 3, "power": 3, "health": 3,
  "text": "Hello: Deal 1 damage to a unit. Zest: deal 2 instead.",
  "abilities": [
    { "when": "hello", "target": { "unit": "any" },
      "do": [{ "damage": 1 }],
      "instead": { "if": "Zest", "do": [{ "damage": 2 }] } }      // "Zest" names a set mechanic
  ] }
```

The vocabulary (types in `packages/engine/src/types.ts`):

| Kind | Pieces |
|---|---|
| **keywords** (a card's `keywords` list) | core: `Zoomies`, `Guardian`, `Sneaky`, `Fierce`, `Tough N`, `Lucky`, `Pounce`; plus any set mechanic of kind `keyword` (`Ripen`, `Heat`) |
| **when** | `play` (Tricks) · `hello` · `goodbye` · `roundStart` · `exhaust` (a Hero Cat's ability) · `damagedAndSurvives` · `defeatsInCombat` · `youHeal` |
| **if** | a set mechanic's name (`Zest`, `Lush`) · a plugin's condition · `targetIsYours` · `{ not }` · `playedThisRound` · `treats` · `lives` · `opponentLives` · `yardHas {keyword}` · `unitsInComposts` · `compost` · `controlUnits` · `unitHasCounter` |
| **target** | `self` · `attack` (the attack in this Pounce window) · `{ unit: own / enemy / any, other?, filter? }` (a choice) · `{ each: own / enemy / all / allOther, filter? }` (no choice) · `target2` for a second choice (Showdown) |
| **filter** | `exhausted` · `damaged` · `noToy` · `keyword` · `counter {name, atLeast}` |
| **do** | `damage N` · `heal N` · `buff {power, keywords}` (this round) · `counter {name, add, max}` · `draw N` · `exhaust` · `ready` · `readyTreats N` · `sprout N` · `summon tokenId` · `cancelAttack` · `fight` · plus any plugin's actions |
| **static** | `grant {power, health, keywords}` to `self` / `attached` (Toys) / `{ each … }` (auras), `while` a condition · `cantAttack while` a condition |
| **modifiers** | `optional` (you may) · `optionalTarget` · `oncePerRound` · `instead {if, do}` · `pounceOnly: "attack"` · `log` |
| **Hero Cats** | `kitten` and `bigCat` faces, each with `abilities` (an `exhaust` one) and `keywords`; the Kitten's `growUp: { if }` |

**Family mechanics are data too.** A set defines them once in `mechanics`, and cards use them by name.
A `keyword` mechanic gives every unit that has it abilities and a counter (Ripen: at the start of each
round, `counter ripe +1, max 2`, each point +1/+1; Heat: when damaged and it survives, `counter heat +1,
max 3`, each point +1 Power). A `condition` mechanic names a test (Zest: `playedThisRound ≥ 2`; Lush:
`treats ≥ 7`). A keyword granted in play (Spiked Collar gives Heat) brings its mechanic's abilities along.

**What the engine guarantees:**
- **Timing follows the rulebook.** Triggered abilities queue as steps and run after the state check, so
  "damaged and survives" only fires for units still standing, and Ring of Fire hits every unit before any
  survivor heats up.
- **No endless chains.** More than `TRIGGER_CHAIN_LIMIT` (200) triggered abilities after one action stops
  the chain with a log line. Two Nagas facing each other would otherwise scorch each other forever.
- **Power, Health and keywords** are worked out when asked: printed, plus Toy, counters, this round's
  buffs, and auras in play (pass the game state to `unitPower`, `unitHealth`, `unitKeywords` to include
  auras).

## Plugins: code a set brings

```ts
// content/2026/09/starter-box/plugin.ts
const plugin: Plugin = {
  id: 'starter-box',
  conditions: { /* name: (ctx, value) => boolean */ },
  actions:    { /* name: (ctx, value) => void, used in data as { name: value } */ },
  ai: { refineAction: zestFirst },   // improve the bot's choice for this set's cards
};
```

- A plugin imports **only types** from the engine; everything it can see and do comes in through its
  arguments (`PluginContext` for conditions and actions, `AiContext` for the bot). So the engine never
  depends on a set's code, and a set without a plugin needs none.
- Data names a plugin's condition or action exactly like a built-in one. If a card uses a name that no
  loaded plugin provides, the engine says which set's plugin is missing.
- **When to write one:** only for what the vocabulary can't express. Adding a new built-in piece (for
  every set) is an engine change instead. Today the only plugin is the Starter Box's, and it holds a bot
  heuristic, not a rule: play a cheap card before a Zest card, so the Zest bonus applies.

## Proving nothing changed

`packages/engine/test/golden.json` holds 300 bot games recorded with the engine before it went data-driven
(every Starter Box pairing, both seats, fixed seeds). `golden.test.ts` replays them and compares every
action. All 300 play identically on the data-driven engine. To change how cards play on purpose, re-record
with `npx tsx packages/engine/scripts/golden.ts` and say why in the commit.

## Validation: check-set

`npm run check-set` (or `npm run check-set -- heat-wave --games 40`) checks a set before it can be played:

- **Structure:** ids start with the set code, and no card appears twice or in another set.
- **Card basics:** types and rarities are valid, units have stats, and every family is defined.
- **Abilities:** every trigger, condition, target and action is one the engine or the set's plugin knows,
  and every summoned token exists.
- **Rules text:** every keyword appears in the card's rules text.
- **Decks:** every deck follows the deckbuilding rules.
- **Art:** every card has an illustration and a composed card.
- **Budget report:** stats and keywords against each card's cost.
- **Bots (with `--games`):** a first bot run against the released decks.

Errors fail the check; warnings don't. `npm test` runs the same checks on every set
(`packages/engine/test/content.test.ts`), so a broken set can't be committed unnoticed.

## Card packs: new sets on a running site

Every set folder is also published as a **card pack**:
- the index at `/packs/index.json`,
- each set's data at `/packs/<set>/set.json`,
- its art at `/<set>/` and `/cards/<set>/`.

The game starts through `apps/web/src/boot.ts`:
1. It registers the sets it was built with.
2. It reads the pack index, and registers any **released** pack it doesn't have, or a newer version of
   one it has. It waits at most 1.5 seconds, so offline or slow starts still work.
3. Only then does it load the game, so every screen sees the full catalog from its first render.

A pack whose cards need plugin code the game doesn't have is skipped with a console warning (the
engine's `missingPieces` names what's missing): code only arrives with a new build of the game. In dev,
`?prototypes` also takes prototype packs, to try a prototype set in the real game.

Today the packs are published with the site itself (`npm run deploy`, which never takes the site down).
Publishing a pack on its own, without deploying the game, needs a separate place to host packs. That
decision is still open (see Still to do).

## The Studio (future: not to build yet)

A designer app, `apps/studio`, for contributors who don't change the code. Its whole output is a set folder.

```
 Draft cards ──► Art ──► Preview ──► Build decks ──► Playtest ──► Adjust ──► Submit ──► Review ──► Release
 (by hand or     (generate   (composed   (the same      (bots, the    (loop)      (a set      (a person   (status:
  with an LLM:    or upload)  card, as    deck builder)  PC2024 paw,               folder)     approves)   released)
  schema-bound                in game)                   LLM testers)
  JSON)
```

- **Drafting with an LLM:** the model writes abilities as JSON under the set schema, and the templater
  writes the text. The model never writes code; the validator checks everything it writes.
- **Playtesting** loads the set as a prototype: the bots, the PC2024 playtest paw and the LLM playtesters
  can play it the moment it's saved.
- **Safety:** a set without a plugin is data only, so a contributor can't run anything. A set that needs a
  plugin is code, and goes through normal code review.

## Still to do

1. **Pawtraits into the set folders**, once the accounts work lands (it serves them from `art/avatars/`).
2. **Hosting packs apart from the game,** so a new set can be published without deploying the game:
   for example an Azure Storage container behind the site. The game already takes packs from
   `/packs/index.json`, so only the address and a publish command would change.
3. **The rules-text templater,** so a card's text is written from its abilities. `check-set` checks
   keywords only, for now.
4. **The LLM playtesters' rules primer** lists the Starter Box mechanics by hand; the balance-testing
   work is generating it from the loaded sets.
5. **Left in the web client on purpose:** the tutorial's decks (it teaches with them) and the
   Collection's sample finishes (stand-ins until the Store grants real copies).
