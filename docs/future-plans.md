# Future plans

Features that aren't built yet, and what they need. Only work still to do is listed here; once something ships,
it comes out of this file. Accounts and the Store have their own documents, [accounts-plan.md](accounts-plan.md) and
[store-plan.md](store-plan.md).

1. PvP: two people playing each other, not the AI
2. Ladder boards
3. Accounts: see [accounts-plan.md](accounts-plan.md)
4. The Store: see [store-plan.md](store-plan.md)

The engine ([packages/engine/src/engine.ts](../packages/engine/src/engine.ts)) is a deterministic state
machine: the whole game is plain JSON, all randomness comes from a seed stored in the state, and
`apply(state, action)` is the only way to change it. That is the right foundation for networking, ladders
and replays. What's missing is a backend: the site is a static Azure Static Web Apps upload.

## 1. PvP

Two people playing each other. Two versions:

- **Same device (pass-and-play).** No server. Needs a "pass the device" screen that hides the hand before
  the other player looks. Pounce is awkward: it happens during the opponent's turn, so the device changes
  hands mid-turn.
- **Online, each player on their own device.** The problem is **hidden information**: one `GameState` holds
  both hands, both deck orders and the RNG seed, and whoever holds it can see your hand and predict every
  draw. How to run it:
  - **Authoritative server (recommended).** The engine is pure TypeScript with no browser dependencies, so it
    runs unchanged on Node. The server keeps the full state and sends each client only what that player may
    see, using `viewFor` in [packages/engine/src/view.ts](../packages/engine/src/view.ts). A ladder needs it
    anyway.
  - **Direct connection (WebRTC), one player hosts.** No server to run, but the host can cheat. Fine for
    friends, useless for a ladder.
  - **Cryptographic "mental poker".** Overkill.

Still to change, for both versions:

- **Pounce timing leak.** The defender only gets a Pounce prompt when they hold a playable Pounce
  (`engine.ts`, where `canPounce` is computed). Against the AI that's harmless. Online, the pause tells the
  attacker "they're holding a Pounce"; on one device, so does being asked to hand it over. Either always
  prompt (with a quick way to skip), or have the server add a random delay.
- **Hardcoded seats in the client.** `HUMAN = 0` / `AI = 1` are used throughout `main.ts`. The client needs a
  "my seat" concept and should render from the redacted view, not the full state.

Online play also needs the server: Node running the same engine, and WebSockets (Azure Web PubSub or a
small container). It needs Via Mochi accounts too, from the [accounts plan](accounts-plan.md).

## 2. Ladder boards

Needs online PvP and accounts.

- A ladder is only trustworthy if the server decides who won. Client-reported results can be faked.
- Player identity: Via Mochi accounts (from the [accounts plan](accounts-plan.md)).
- A rating system (Glicko-2 or Elo) and a table for ratings and results.
- Seed + actions work as a **replay record** on the server, which keeps the engine version. That gives
  replays and a way to audit disputed results.
- For ranked games, the server checks that each player owns the deck they bring.

## Suggested order

1. **Same-device PvP**: the Pounce fix and "my seat" in the client, with no backend. Testable with the
   existing sim and tests.
2. **Accounts** ([accounts-plan.md](accounts-plan.md)). The accounts and API are what the Store and online play build
   on.
3. **The Store** ([store-plan.md](store-plan.md)).
4. **Online PvP** on the same API, with WebSockets.
5. **Ladder** on top of server-decided results.

The hidden-information work is where to be careful: getting it wrong means shipping a game where people can
cheat.
