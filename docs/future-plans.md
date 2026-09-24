# Future plans

Four features we want, and what the current architecture needs to support them:

1. Close the game and reopen it where you left off
2. PvP: two people playing each other, not the AI
3. Ladder boards
4. A store where players buy new decks

## Summary

All four fit. The engine ([packages/engine/src/engine.ts](../packages/engine/src/engine.ts)) is a deterministic
state machine: the whole game is plain JSON, all randomness comes from a seed stored in the state, and
`apply(state, action)` is the only way to change it. That is the right foundation for saving, networking,
ladders and replays.

What's missing is a backend. The site is a static Azure Static Web Apps upload. Three of the four features
need a server (all but same-device PvP), and they depend on each other in a fixed order: online PvP →
ladder → store.

## 1. Close and reopen

No server needed. **Done:** [apps/web/src/save.ts](../apps/web/src/save.ts) and `RULES_VERSION` in the engine.
The tutorial isn't saved (its balloons can't resume halfway through). On reopening, or after pressing
Home mid-game, the home screen offers **Continue** (with the round and matchup) or **New game**, which replaces it.

- Save the game to `localStorage` after every `apply` in [apps/web/src/main.ts](../apps/web/src/main.ts)
  (`act` and `scheduleAi`). On load, restore it and call `scheduleAi()`.
- Save the state snapshot, not seed + action list. Replaying actions breaks whenever a rule or
  `cards/sb1.json` changes.
- Stamp saves with a rules version so a save from an older build is detected and discarded cleanly.
- Some state lives outside the engine: tutorial progress, `foeFrom` (the opponent recap line),
  `unitArrivals`. Either save it too or let it reset.

## 2. PvP

Two people playing each other. Two versions:

- **Same device (pass-and-play).** No server. Needs a "pass the device" screen that hides the hand before
  the other player looks. Pounce is awkward: it happens during the opponent's turn, so the device changes
  hands mid-turn.
- **Online, each player on their own device.** The problem is **hidden information**: one `GameState`
  holds both hands, both deck orders and the RNG seed, and whoever holds it can see your hand and predict
  every draw. How to run it:
  - **Authoritative server (recommended).** The engine is pure TypeScript with no browser dependencies,
    so it runs unchanged on Node. The server keeps the full state and sends each client only what that
    player may see. Needed for a ladder anyway. Already item 4 on the README roadmap.
  - **Direct connection (WebRTC), one player hosts.** No server to run, but the host can cheat. Fine for
    friends, useless for a ladder.
  - **Cryptographic "mental poker".** Overkill.

The engine already accepts actions from either player. Changes needed for both versions:

- **`viewFor(state, player)`** that removes the opponent's hand, both decks, the Lives and the seed.
  **Done:** [packages/engine/src/view.ts](../packages/engine/src/view.ts), following rule 100.5. It also hides
  the opponent's pending decision (a Pounce or Lucky prompt would give a card away). Tested in
  [view.test.ts](../packages/engine/test/view.test.ts): changing anything a player may not know never
  changes that player's view.
- **Card uids gave cards away.** They were numbered before the shuffle, in deck-list order, so a uid named
  its card. **Fixed:** `createGame` now numbers cards after shuffling.
- **Pounce timing leak.** The defender only gets a Pounce prompt when they hold a playable Pounce
  (`engine.ts`, where `canPounce` is computed). Against the AI that's harmless. Online, the pause tells
  the attacker "they're holding a Pounce"; on one device, so does being asked to hand it over. Either
  always prompt (with a way to skip it quickly), or have the server add a random delay.
- **Hardcoded seats in the client.** `HUMAN = 0` / `AI = 1` are used throughout `main.ts`. The client
  needs a "my seat" concept and should render from the redacted view, not the full state.

## 3. Ladder boards

Needs the server from #2 plus accounts.

- A ladder is only trustworthy if the server decides who won. Client-reported results can be faked.
- Player identity: SWA's built-in login (Microsoft, GitHub, Google) is the fastest path.
- A rating system (Glicko-2 or Elo) and a small database.
- Seed + actions work as a **replay record** on the server, which keeps the engine version. That gives
  replays and a way to audit disputed results.

## 4. Store for decks

Needs accounts. **The full store plan (decisions and steps) is in [store-plan.md](store-plan.md).**

- **Done:** `createGame` accepts a `DeckList` as well as a starter key, and the deck builder
  ([apps/web/src/deckbuilder.ts](../apps/web/src/deckbuilder.ts)) checks decks against rulebook §11.1 with
  `deckProblems` in [packages/engine/src/decks.ts](../packages/engine/src/decks.ts). Still to do: a card
  registry that can load several sets (`DECKS`/`CARDS` come from a single `sb1.json`).
- What a player owns comes from `owned(id)` in [apps/web/src/collection.ts](../apps/web/src/collection.ts):
  for now, the three starter decks added together. Purchases change that function (and move it behind the
  account), and the deck builder follows. Players' decks are in this browser's localStorage
  ([apps/web/src/mydecks.ts](../apps/web/src/mydecks.ts)) until accounts can hold them.
- A deck made of existing card behaviours is pure data and ships without an engine release. A deck with
  **new mechanics** needs new `EffectKey`/`BEHAVIOURS` code, so it ships with an engine update.
- For online play, the server must check that a player owns the deck they bring.
- **What's sold:** fixed decks and single cards the player sees before buying. No random paid packs:
  they bring loot-box rules in several countries. Singles go in a cart with an order minimum, because
  payment fees would eat a $0.99 purchase.
- **Accounts:** a *Via Mochi account* (Via Mochi is the business; Fruitcats is its first app), shared by
  future apps, with Apple, Google and email-code sign-in. It is kept apart from the invite-only mochi
  family accounts. Accounts need age 13+, and buying needs 18+ or a parent's approval.
- **Payments:** a Merchant of Record (Paddle first), which is the legal seller and handles tax and refunds.
  A webhook records what each account owns. A native iOS app would use Apple's in-app purchases, writing
  to the same entitlements.
- **Staging:** everything to do with purchases is hidden from the public until launch. A separate playtest
  build and site, a server-side tester list and a sandbox checkout keep it that way. The git tag
  `pre-store` marks main before any store work.
- **Done: the Collection** ([apps/web/src/showcase.ts](../apps/web/src/showcase.ts)) is live for everyone:
  - a gallery for just looking at cards, even without playing:
    - **Showcase:** a display of the cards you choose (Mochi's Kitten and Big Cat to start), with nothing to edit
      there. Cards are added and removed in All cards (Add to Showcase / Remove from Showcase, with Undo); the choice is
      kept on this device. Cards appear one at a time and as big as the screen allows. You swipe with the phone's own scrolling, and the card's art, blurred,
      fills the screen behind it.
    - **All cards:** the set as a grid, with preview cards as shadows. Tapping a card opens the same full-screen view.
    - A Hero Cat's Kitten and Big Cat are separate cards.
  - wallpapers for a phone, tablet or computer where the whole screen is the card, with its border
    following the screen's rounded corners ([apps/web/src/wallpaper.ts](../apps/web/src/wallpaper.ts))
  Bought cards will show up here, and choosing the Display Case's cards comes with the Store.

## Suggested order

1. **Resume** (standalone, small). Done.
2. **Engine preparation**, no backend yet: `viewFor`, the Pounce fix, `DeckList` input to `createGame`,
   a multi-set card registry, removing hardcoded seats from `main.ts`. All testable with the existing
   sim and tests. Same-device PvP can ship at the end of this step.
3. **Backend**: Node running the same engine, WebSockets (Azure Web PubSub or a small container), SWA
   login, a database. Online PvP goes live here.
4. **Ladder** on top of server-decided results.
5. **Store** on top of accounts.

Nothing in the current design has to be thrown away. The hidden-information work in step 2 is where to be
careful, because getting it wrong means shipping a game where people can cheat.
