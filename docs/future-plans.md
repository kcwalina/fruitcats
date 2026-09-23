# Future plans

Four features we want, and what the current architecture needs to support them:

1. Close the game and reopen it where you left off
2. Peer-to-peer (online) games
3. Ladder boards
4. A store where players buy new decks

## Summary

All four fit. The engine ([packages/engine/src/engine.ts](../packages/engine/src/engine.ts)) is a deterministic
state machine: the whole game is plain JSON, all randomness comes from a seed stored in the state, and
`apply(state, action)` is the only way to change it. That is the right foundation for saving, networking,
ladders and replays.

What's missing is a backend. The site is a static Azure Static Web Apps upload. Three of the four features
need a server, and they depend on each other in a fixed order: online play → ladder → store.

## 1. Close and reopen

No server needed. **Done:** [apps/web/src/save.ts](../apps/web/src/save.ts) and `RULES_VERSION` in the engine.
The tutorial isn't saved (its balloons can't resume halfway through). On reopening, or after pressing
Menu mid-game, the menu offers **Continue** (with the round and matchup) or **New game**, which replaces it.

- Save the game to `localStorage` after every `apply` in [apps/web/src/main.ts](../apps/web/src/main.ts)
  (`act` and `scheduleAi`). On load, restore it and call `scheduleAi()`.
- Save the state snapshot, not seed + action list. Replaying actions breaks whenever a rule or
  `cards/sb1.json` changes.
- Stamp saves with a rules version so a save from an older build is detected and discarded cleanly.
- Some state lives outside the engine: tutorial progress, `foeFrom` (the opponent recap line),
  `unitArrivals`. Either save it too or let it reset.

## 2. Peer-to-peer games

The engine already accepts actions from either player. The problem is **hidden information**: one
`GameState` holds both hands, both deck orders and the RNG seed. Whoever holds it can see your hand and
predict every draw.

Options:

- **True P2P over WebRTC, one player hosts.** Cheap, but the host can cheat. Fine for friends, useless
  for a ladder.
- **Authoritative server (recommended).** The engine is pure TypeScript with no browser dependencies, so
  it runs unchanged on Node. The server keeps the full state and sends each client only what that player
  may see. Already item 4 on the README roadmap.
- **Cryptographic "mental poker".** Overkill.

Engine changes needed either way:

- **`viewFor(state, player)`** that removes the opponent's hand, both decks, the Lives and the seed.
  `determinize` in [packages/engine/src/ai.ts](../packages/engine/src/ai.ts) is close, but it's built for
  the AI, not for security.
- **Pounce timing leak.** The defender only gets a Pounce prompt when they hold a playable Pounce
  (`engine.ts`, where `canPounce` is computed). Against the AI that's harmless; online, the pause tells
  the attacker "they're holding a Pounce". Either always prompt, or have the server add a random delay.
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

Needs accounts.

- `createGame` takes deck **keys** (`'zest-rush'`), and `DECKS`/`CARDS` are loaded once from a single
  `sb1.json`. Change `createGame` to accept a `DeckList` directly, and add a card registry that can load
  several sets.
- A deck made of existing card behaviours is pure data and ships without an engine release. A deck with
  **new mechanics** needs new `EffectKey`/`BEHAVIOURS` code, so it ships with an engine update.
- For online play, the server must check that a player owns the deck they bring.
- Payments: Stripe Checkout, with a webhook that records what each account owns. Sell fixed decks, not
  random packs; randomized paid packs bring loot-box rules in several countries. A wrapped mobile app
  would have to use Apple's and Google's in-app purchase systems.

## Suggested order

1. **Resume** (standalone, small).
2. **Engine preparation**, no backend yet: `viewFor`, the Pounce fix, `DeckList` input to `createGame`,
   a multi-set card registry, removing hardcoded seats from `main.ts`. All testable with the existing
   sim and tests.
3. **Backend**: Node running the same engine, WebSockets (Azure Web PubSub or a small container), SWA
   login, a database. Online games go live here.
4. **Ladder** on top of server-decided results.
5. **Store** on top of accounts.

Nothing in the current design has to be thrown away. The hidden-information work in step 2 is where to be
careful, because getting it wrong means shipping a game where people can cheat.
