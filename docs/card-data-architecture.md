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
  set (Mochi today) can be playtested by bots and agents without appearing in the game.
- **Folders by release.** `content/2026/10/domowiki/` and `content/2026/12/jiaoren/`. Everything a
  set owns lives in its folder:

  ```
  content/2026/12/jiaoren/
    set.json                   cards, tokens, families, mechanics, decks
    plugin.ts                  optional
    art/prompts.json           art direction
    art/illustrations/<id>.webp        pictures that aren't card art (the tale banner)
    announcement/              its announcement page (index.html, share.jpg)
    avatars/legend-<name>.webp the Legend Pawtraits that come with its cards (tools/generate_avatars.py)
  ```

  The site publishes each folder at stable addresses (`apps/web/vite.config.ts`, contentAssets):
  `/<set>/<id>.webp`, `/cards/<set>/…`, `/announcements/<set-folder>/`, and `/avatars/<id>.webp` for Legend
  Pawtraits (everyday Pawtraits belong to no set and stay in `art/avatars/`, published at the same address). In
  the game, Pawtraits are shown from the account service (`id.viamochi.com/avatars/`), which keeps its own copy
  in the `viamochi-id` repo so every Via Mochi app can use them; a new or redrawn Pawtrait is copied there too.

| Set | Folder | Status | Plugin |
|---|---|---|---|
| Domowiki (DW1) | `content/2026/10/domowiki/` | released, the starter (docs/domowiki-set.md) | none needed |
| Pari (PR1) | `content/2026/10/pari/` | released, a second starter (docs/pari-set.md) | none needed |
| Aluxes (AL1) | `content/2026/11/aluxes/` | released, a third starter (docs/aluxes-set.md) | none needed |
| Jiaoren (JR1) | `content/2026/12/jiaoren/` | released, sold in the Store at $9.99 (docs/jiaoren-set.md) | none needed |
| Hui Hai (HH1) | `content/2027/01/hui-hai/` | released, sold in the Store at $9.99 (docs/hui-hai-set.md) | none needed |

## Cards as data: abilities

A card's rules are a list of **abilities**. Each combines four closed lists of pieces: **when** it
happens, an optional **if**, a **target**, and what it **does**. The engine implements each piece once.

```jsonc
{ "id": "PR1-D06", "name": "Súči of the Hunt", "type": "Critter", "family": "Pari", "rarity": "Common",
  "cost": 3, "power": 3, "health": 3,
  "text": "Hello: Deal 1 damage to a unit. Company: deal 2 instead.",
  "abilities": [
    { "when": "hello", "target": { "unit": "any" },
      "do": [{ "damage": 1 }],
      "instead": { "if": "Company", "do": [{ "damage": 2 }] } }      // "Company" names a set mechanic
  ] }
```

The vocabulary (types in `packages/engine/src/types.ts`):

| Kind | Pieces |
|---|---|
| **keywords** (a card's `keywords` list) | core: `Zoomies`, `Guardian`, `Sneaky`, `Fierce`, `Tough N`, `Lucky`, `Pounce`; plus any set mechanic of kind `keyword` (`Rain-Fed`, `Heat`) |
| **when** | `play` (Tricks) · `hello` · `goodbye` · `roundStart` · `exhaust` (a Hero Cat's ability) · `damagedAndSurvives` · `defeatsInCombat` · `youHeal` |
| **if** | a set mechanic's name (`Company`, `Well-Fed`) · a plugin's condition · `targetIsYours` · `{ not }` · `playedThisRound` · `treats` · `lives` · `opponentLives` · `yardHas {keyword}` · `unitsInComposts` · `compost` · `controlUnits` · `unitHasCounter` |
| **target** | `self` · `attack` (an Ambush's: the enemy unit across from its lane) · `{ unit: own / enemy / any, other?, filter? }` (a choice) · `{ each: own / enemy / all / allOther, filter? }` (no choice) · `target2` for a second choice (Showdown) |
| **filter** | `exhausted` · `damaged` · `noToy` · `keyword` · `counter {name, atLeast}` |
| **do** | `damage N` · `heal N` · `buff {power, keywords}` (this round) · `counter {name, add, max}` · `draw N` · `exhaust` · `ready` · `readyTreats N` · `sprout N` · `summon tokenId` · `cancelAttack` · `fight` · plus any plugin's actions |
| **static** | `grant {power, health, keywords}` to `self` / `attached` (Toys) / `{ each … }` (auras), `while` a condition · `cantAttack while` a condition |
| **modifiers** | `optional` (you may) · `optionalTarget` · `oncePerRound` · `instead {if, do}` · `pounceOnly: "attack"` · `log` |
| **Hero Cats** | `kitten` and `bigCat` faces, each with `abilities` (an `exhaust` one) and `keywords`; the Kitten's `growUp: { if }` |

**Family mechanics are data too.** A set defines them once in `mechanics`, and cards use them by name.
A `keyword` mechanic gives every unit that has it abilities and a counter (Rain-Fed: at the start of each
round, `counter rain +1, max 2`, each point +1/+1; Heat: when damaged and it survives, `counter heat +1,
max 3`, each point +1 Power). A `condition` mechanic names a test (Company: `controlUnits ≥ 3`;
Well-Fed: `treats ≥ 7`). A keyword granted in play (Spiked Collar gives Heat) brings its mechanic's abilities along.

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
// content/<yyyy>/<mm>/<set>/plugin.ts
const plugin: Plugin = {
  id: '<set>',
  conditions: { /* name: (ctx, value) => boolean */ },
  actions:    { /* name: (ctx, value) => void, used in data as { name: value } */ },
  ai: { refineAction: /* … */ },     // improve the bot's choice for this set's cards
};
```

- A plugin imports **only types** from the engine; everything it can see and do comes in through its
  arguments (`PluginContext` for conditions and actions, `AiContext` for the bot). So the engine never
  depends on a set's code, and a set without a plugin needs none.
- Data names a plugin's condition or action exactly like a built-in one. If a card uses a name that no
  loaded plugin provides, the engine says which set's plugin is missing.
- **When to write one:** only for what the vocabulary can't express. Adding a new built-in piece (for
  every set) is an engine change instead. No set has a plugin today. The only one was the Starter Box's (removed
  from the game on 2026-09-29), and it held a bot heuristic, not a rule: play a cheap card before a Zest card, so
  the Zest bonus applies.

## Proving nothing changed

`packages/engine/test/golden.json` holds 300 bot games (every pairing of the Domowiki, Pari and Aluxes decks,
both seats, fixed seeds). `golden.test.ts` replays them and compares every action. The first recording, made with
the Starter Box decks before the engine went data-driven, played identically on the data-driven engine; the games
were recorded again with the folk decks when the Starter Box was removed (2026-09-29). To change how cards play
on purpose, re-record with `npx tsx packages/engine/scripts/golden.ts` and say why in the commit.

## Validation: check-set

`npm run check-set` (or `npm run check-set -- jiaoren --games 40`) checks a set before it can be played:

- **Structure:** ids start with the set code, and no card appears twice or in another set.
- **Card basics:** types and rarities are valid, units have stats, and every family is defined.
- **Abilities:** every trigger, condition, target and action is one the engine or the set's plugin knows,
  and every summoned token exists.
- **Rules text:** a card's text is generated from its data (`content/rules-text.ts`), in the house style:
  keywords, then each ability, Grow Up lines, auras, tokens and notes. `npm run write-text` writes it into
  set.json, and check-set fails when a card's text says anything else, so text and data can't drift
  apart. For wording the templater can't infer, the data carries it: a card's `pronoun`, an ability's
  `note` (a reminder in parentheses) and a mechanic's `label` (it reads as "Company: …").
- **Decks:** every deck follows the deckbuilding rules.
- **Art:** every card has an illustration, and the set's cards are in Alex (`games/folkborn/sets/<set>/<set>.alex`),
  which tcg renders (`npm run cards`; publish-pack renders them when it publishes the set).
- **Budget report:** stats and keywords against each card's cost.
- **Bots (with `--games`):** a first bot run against the released decks.

Errors fail the check; warnings don't. `npm test` runs the same checks on every set
(`packages/engine/test/content.test.ts`), so a broken set can't be committed unnoticed.

## Card packs: new sets on a running site

Every set can be published as a **card pack**, its data and its art, without deploying the game. Since 2026-09-27 this
is also where the site's card art comes from: **a build carries no card art**, and a deploy refuses to ship a set whose
art isn't in the storage yet (see below).

```
npm run publish-pack -- jiaoren              # check-set, then upload; --dry-run to only check
npm run publish-pack -- hw1 --unpublish      # take a set out of the pack index, by code; its files stay on the storage
```

- **Where packs live:** the pack storage, the `fruitcatspacks` storage account (ViaMochi Production,
  `rg-fruitcats`, westus2). Its public-read container `packs` holds `index.json`, and for each set every
  version of its art and data, each at an address named by its fingerprint (`content/pack-storage.ts`):
  `<set>/art/<fingerprint>/illustrations/`, `cards/` and `art.json`, and `<set>/data/<fingerprint>.json`.
  Anyone may read it, from any origin; only the Via Mochi deploy and agent identities may write (shared keys are
  off). The pack list isn't cached; what sits at a fingerprint never changes, so it may be kept for good.
  (Before 2026-09-27 a set had one address, `<set>/set.json`, `<set>/art/illustrations/`, `<set>/art/cards/` and
  `<set>/art.json`. Those stay as they were for games built before then; nothing writes them any more.)
- **What the command does:**
  1. Runs `check-set` and stops on any error.
  2. Uploads the art to its fingerprint's folder (skipped when the storage has it already), then that folder's
     `art.json`, so a build never takes a half-uploaded folder. Then the data.
  3. Updates `index.json` last, so a game never sees a pack whose files aren't up yet. Only when the set's folder
     is exactly what origin/main has: running games take what the index lists, and what players get is always main.
     From a branch, the art and data go up and the index is left alone. The index is written only over the version
     that was read (its ETag), so two sessions publishing at once can't drop each other's set.

  It signs in as the deploy identity (`~/.azure-viamochi-deploy`), never your own Azure login. It is safe from any
  branch at any time: no publish replaces what another checkout, or the live site, uses. On 2026-09-27, when a set
  had one address, sessions publishing from their own branches kept replacing each other's art, and every deploy's
  build refused until it republished, 3–4 rounds running.
- **The site's art is the storage's.** Azure takes the site as one upload inside a two-minute window, and card art
  (over 100 MB by the third deck) doesn't fit through a home uplink in that time: every deploy failed on 2026-09-27
  until the art left the site. Now `vite.config.ts` copies no art into the build (about 10 MB instead of 120); it
  fingerprints each built-in set's art and points the game at that fingerprint's folder on the storage
  (`VITE_ART_BASES`, read by `apps/web/src/ui.ts`). A set whose folder isn't there yet (its `art.json` naming that
  fingerprint) stops the build, naming the `publish-pack` command to run. In dev
  the art is still served straight from the set's folder, so new pictures show without publishing.
  `VITE_LOCAL_ART=on` builds with the art inside (for a build that must work without the storage); it is too big
  to deploy.
- **The site's own list:** the site also lists the sets it was built with at `/packs/index.json`, as a
  fallback.

The game starts through `apps/web/src/boot.ts`:
1. It registers the sets it was built with.
2. It reads the pack storage's list, then the site's, and registers any **released** pack it doesn't have,
   or a newer version of one it has. It waits at most 1.5 seconds, so offline or slow starts still work.
3. Only then does it load the game, so every screen sees the full catalog from its first render.

Card images come from each card's set (`ART_BASES` in `apps/web/src/ui.ts`): the site's own addresses for
built-in sets, the pack storage for packs. Wallpapers load pack art with CORS so the canvas can still be
saved.

- **Plugins:** a pack whose cards need plugin code the game doesn't have is skipped with a console warning
  (the engine's `missingPieces` names what's missing). Code only arrives with a new build of the game.
- **Prototypes:** prototype packs are taken only with `?prototypes` in the address, so a playtester can
  play an unreleased set on the real site. Mochi is published this way.

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

1. **Left in the web client on purpose:** the tutorial's decks (it teaches with them) and the
   Collection's sample finishes (stand-ins until the Store grants real copies).
