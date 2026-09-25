# Store plan: selling cards

This document covers the Store: how Fruitcats sells decks and cards on the web, iPhone, Android and Steam.
It records the decisions made so far and the steps, in order. Accounts come first and have their own document,
[accounts.md](accounts.md) (what's left: [accounts-plan.md](accounts-plan.md)). Other features still to build (PvP, the ladder) are in
[future-plans.md](future-plans.md).

Last updated 2026-09-24.

## Decisions

| Topic | Decision |
|---|---|
| **What is sold** | Fixed **decks**, and on their own only the **single cards that come in no deck** (the owner's rule, 2026-09-24): a card that's in a deck is had by buying the deck. No random paid packs (loot-box laws), and no free cards earned by playing. The fun of opening a pack comes from a reveal animation after buying. |
| **Singles** | Bought through a **cart** with a minimum order of about $4.99, because payment fees would eat a $0.99 purchase. No virtual currency. |
| **Seller** | **You, as an individual.** No LLC or company: the stores and the Merchant of Record are the legal sellers and handle tax, VAT and refunds, as for most indie developers. |
| **Accounts** | The one **Via Mochi account**: an email, signed in with an emailed code inside the game. See [accounts.md](accounts.md). The Store needs an account, like the Collection. |
| **Age** | Anyone can play solo without an account. Accounts need age **13+**. Buying needs **18+ or a parent's approval** (on iOS, Apple's Ask to Buy). |
| **Web payments** | A **Merchant of Record: Paddle**, or Lemon Squeezy if Paddle won't onboard an individual. |
| **Stores** | Web, then **iPhone and Android** (one Capacitor app), then **Steam** (Electron). The same game code everywhere, with no rewrite. |
| **Ownership** | **A purchase anywhere is owned everywhere.** Our server holds the one list of what each Via Mochi account owns. A Steam, App Store or Google Play purchase goes to the account signed in on that device; buying needs an account, so no purchase is ever ownerless. |
| **Pricing** | **The same price on every store, and sales on all stores at once.** The player's experience comes before margin. The game is free to download everywhere. |
| **Infrastructure** | Azure only, in the **ViaMochi Production** subscription (`rg-fruitcats`), set up by the accounts plan. Nothing reuses the mochi suite's resources. |
| **Rollout** | Everything to do with purchases stays **hidden from the public** until launch. The Store's code is in the live game, but the API opens it only to a tester list (see [Hidden until launch](#hidden-until-launch)); payments are sandbox only. |
| **Rollback** | The git tag `pre-store` (`a9d7d08`) marks main before any store work. `pre-payments` is moved to the latest main just before the first payment or account code. |

## Already done

- **Deck builder:** build your own decks from the cards you have. What you have comes from `owned(id)` in `apps/web/src/collection.ts`, which for now is the three starter decks together.
- **Collection** (`apps/web/src/showcase.ts`):
  - **Showcase:** your chosen cards, shown big.
  - **All cards:** the whole set. Cards you don't have yet show as shadows, ready for the Store to fill in.
  - **Wallpapers:** any card as a phone, tablet or computer wallpaper.
  - The Showcase choice is kept on the device for now. It moves to the account in the accounts plan's phase A2.
- **Home:** the Store tile exists, marked "Coming soon" (in the public build).
- **Store browsing, cart and test checkout** (phase 4), in the playtest build only and only for testers. See
  [Store browsing: what's built](#store-browsing-whats-built).

## How it fits together

```
 Browser        iPhone / Android        Steam
 (web app)      (Capacitor shell)       (Electron shell)
     │                │                      │
     └────── the same game (apps/web) ───────┘
                      │  platform.ts: buy, save picture: per store
                      │  auth.ts: sign in (accounts plan)
                      ▼
        viamochi-id (id.viamochi.com): the Via Mochi account
                      │
                      ▼
        apps/api (Node + TypeScript, Azure App Service)
          ├─ catalog: items, prices, sale schedule
          ├─ entitlements: what each account owns   ◄── webhooks: Paddle, Apple, Google, Steam
          ├─ showcase and decks per account (from the accounts plan)
          └─ tester list (playtest only until launch)
```

## Accounts

Covered by [accounts.md](accounts.md): one Via Mochi account per email, signed in with an emailed code
inside the game, on every platform. The Store only adds the tester list below.

## Backend: `apps/api`

- **Hosting:** Node + TypeScript, so it can import `@fruitcats/engine` and the card data, and later run online PvP. It already exists from the accounts plan (phase A2), on the shared App Service plan in ViaMochi Production; the Store adds tables and endpoints.
- **Storage:** Table Storage, accessed with managed identity.
  - The Via Mochi profile (display name, age flags, terms version, deletion) lives in `viamochi-id`, not here.
  - Fruitcats data lives in the Fruitcats storage account in `rg-fruitcats`:
    - `entitlements`: user, card or deck, quantity, source, order
    - `orders`
    - `webhookEvents`: so each event is applied only once
    - `auditLog`
    - `showcase`
    - `decks`
    - `catalog`
- **Secrets:** payment keys and webhook secrets go in the Fruitcats Key Vault in `rg-fruitcats`.
- **Purchase ledger:** every grant, revoke, refund and chargeback is also written to the permanent `purchases` log
  (kept forever, tamper-proof); see the accounts plan's log retention.
- **Endpoints:**
  - `GET /me` and `DELETE /me`
  - `GET /catalog` and `GET /collection`
  - `POST /checkout`
  - `/webhooks/paddle`, and later `/apple`, `/google` and `/steam`
  - admin endpoints to grant and revoke items
- **Server rule:** the server is the only source of truth for ownership. The client never grants itself anything.
- **Monitoring:** our own logs and metrics (accounts plan, Observability) on every webhook, with alerts on failures.
  No Application Insights.

## Payments per store

| Store | How it's paid | Account for you | Store's cut |
|---|---|---|---|
| **Web** | Paddle overlay checkout: card, Apple Pay, Google Pay or PayPal, in local currency with tax included | Paddle, as an individual | about 5% + 50¢ |
| **iPhone / iPad** | Apple in-app purchase (StoreKit); "Restore purchases" is required | Apple Developer, individual, $99 a year | 15% |
| **Android** | Google Play Billing | Google Play, individual, $25 once | 15% |
| **Steam** | Steam Microtransactions (in-game prices are set by the game) | Steamworks, $100 per game, refunded after $1,000 in sales | 30% |

- **Web checkout flow:**
  1. Cart.
  2. `POST /checkout`.
  3. The Paddle overlay, which includes the 18+ or parent's-permission confirmation and the EU withdrawal-waiver consent.
  4. The Paddle webhook grants the items.
  5. The app sees them in `/collection`.
  6. The reveal animation plays.
- **Refunds and chargebacks,** on any store, remove the items everywhere. A deck that relied on a removed card falls back to a starter deck.
- **Receipts** come from each store. Your support address appears on each one and in the Store.

## A purchase anywhere is owned everywhere

- Every store's webhook writes to the **one entitlements table**, and every app reads ownership from it.
- **Signing in:** a player must be signed in to the same Via Mochi account on each device. An app that isn't linked yet prompts them to link it.
- **Offline:** each app keeps an offline copy of what the player owns and refreshes it when back online.
- **Store rules:** every card sold inside a store's app is also buyable there through that store's own payments, as Apple (guideline 3.1.3(e)), Google and Steam require.
- **Test before each store launches:**
  - Buy on store A, then see the card in store B and on the web.
  - Refund on store A, then see it gone everywhere.

## Pricing

- **Same price everywhere.** Small rounding differences from currencies and store price steps are acceptable; a deliberate difference between stores is not.
- **Sales:** one server-side catalog with prices and a **sale schedule** that every store follows, so a sale starts and ends everywhere at once.
  - The web and Steam read the catalog directly.
  - Apple and Google get the same schedule through their price-schedule APIs.
- **The game is free to download** on every store, so no store sale discounts anything without us.
- **Web purchases** keep more of each sale, which is welcome but not pushed. The apps can't advertise the web store anyway (except the US link-out on iOS).
  - Optional later: a small web-only bonus, promoted outside the apps.
- **A card bought just before a sale** is covered by each store's refund window, and the web honours it the same way.
- **Starting points** (to be set before launch):
  - single cards: common $0.49, uncommon $0.99, rare $1.49, Legendary Cat $4.99
  - a set's top Hero Cat, sold on its own: **$19.99**, as a premium **Signature** print (higher later, not for the first set) (see below)
  - decks: **$9.99**, Hero Cat included
  - A whole deck bought card by card costs about 3× the deck price (Five Alarm: about $30), so the deck is
    clearly the good deal, and singles are for finishing a collection.
- **Paid singles are premium prints.** A single sold on its own comes in a finish that climbs with its price
  (Foil, then Gold, then Signature), with showcase-quality art, so every card someone pays for is one they'd want
  to display.
- **Signature cards:** the top card of a set is sold only as a premium print: its own finish, a
  "Signature" mark and the First Edition stamp for launch buyers. It's exclusive because of how it looks
  and what it costs, never because of a countdown or a limited stock ("no dark patterns" below). It must play
  no better than the set's other Hero Cat. It's a different plan, not an upgrade, so paying more buys
  something special, not a better chance to win.
- **Never pay twice:** a deck's price drops by the value of cards you already own.

## Cards and catalog

- **Rarity** (common, uncommon, rare, legendary) and a **starter** flag go in each set's data (`content/<year>/<month>/<set>/set.json`).
- **A card registry that loads several sets.** Today `CARDS` and `DECKS` come from a single file.
- **Ownership:** `owned(id)` becomes the starter cards plus the account's entitlements. Without an account, a player has only the starter cards.
- **Copy limit:** the Store never sells more copies of a card than a deck can use.
- **Premium variants** (Foil, Alt-art, Golden) play exactly like the normal card, so there's no pay-to-win. Each variant is its own product (`card:<id>:<variant>`).
- **Launch buyers** get a **First Edition** stamp on their cards. Any seasonal variants are announced in advance, with no countdown timers.

## Store experience

- **The Store screen:** a **Decks** tab and a **Cards** tab, plus a cart.
- **A deck** shows every card in it and marks the cards you already own, with the price reduced for those.
- **Single cards** have filters, a full-size preview before buying, and "Owned n/max".
- **Without an account:** the Store tile is locked like the Collection; tapping it opens the in-game "Sign in or
  create account" screen (accounts plan).
- **After paying:** a card-by-card **reveal animation**, then a shortcut to "Build a deck with them".
- **No dark patterns** (the FTC fined Epic $245M over this in 2022):
  - an explicit confirmation step
  - no one-tap buying, no timers and no "limited offer" pressure
  - a clear total including tax
  - an easy path to a refund
- **Settings:** the Account screen from the accounts plan, plus Restore purchases (iOS) and the legal pages.

## Store browsing: what's built

Phase 4, built 2026-09-24. Nothing here takes money: there is no payment step yet.

- **The rules, in one place:** `packages/store` (`@fruitcats/store`) works out the catalog, every price, what a
  cart comes to, and which cards a deck is missing. The API and the game both use it; the API's answer is the one
  that counts. Money is whole cents. It has its own tests.
- **What's for sale:** every card and deck of the sets on sale. The Starter Box is marked `"starter": true` in its
  `set.json`: its decks are the free starter decks and its cards are never sold. Cards marked `exclusive` are never
  sold either (see below).
- **The API** (`apps/api/src/store.ts`): `GET /v1/store` (catalog, what you own, your orders), `POST
  /v1/store/quote`, `POST /v1/store/test-checkout` and `POST /v1/store/test-reset`.
  - A test order brings the cards without payment. It's refused unless the total the player saw is still the total,
    and the same order id sent twice is answered once, so a double tap or a retry never buys twice.
  - What an account owns is worked out from its orders every time, so there's no second tally to drift.
- **Who sees it:** app settings on the API. `STORE` = `off` (default), `testers` or `open`; `STORE_TESTERS` = account
  ids; `STORE_TEST_CHECKOUT` = `on` lets testers place test orders; `STORE_SETS` limits the sets on sale. In the
  game, the Store is in every build (`src/flags.ts`, `STORE`); for accounts the API doesn't let in, the tile stays
  "Coming soon".
- **In the game** (`apps/web/src/storefront.ts`, `shop.ts`): one list of everything for sale, all tiles the same
  size, each labelled Deck or Card (the owner's call, 2026-09-25: no banner, tabs or filters; announcements of new
  releases, if any, will be their own experience). A deck looks like a boxed deck of cards; a card is shown as itself.
  Each opens its own page with Add to cart. The look is the owner's pick of three designs (option A, "parchment",
  2026-09-25): warm paper throughout, like Home, with the Home landscape and the Store picture washed into the banner,
  so the cards are the only strong colour. Then the cart, a confirmation step, the new cards revealed one by one and "Build a deck with them".
- **A deck from a code** with cards you don't have: the deck is saved, then the game shows **Missing cards**: each
  card's picture and price, all picked, with the total and **Add to cart** below. Tap a card to leave it out. If a
  Store deck brings the same cards for less, it says so. The deck builder also says "Missing N cards" on the deck
  and offers **See the missing cards**.

### Trying it on your computer

1. `npm run api:local` runs the API on port 8790 with its data in `.local-api/` (nothing in Azure is touched).
   The Store is open to any account there, with test checkout on.
2. `npm run dev`, then open `http://localhost:5173/?store=1&api=http://localhost:8790` and sign in as usual.
3. To start over, delete `.local-api/`, or use "Remove my test purchases" at the bottom of the cart.

### On the live site, for testers only

The live game has the Store for everyone, and the live API opens it only to `STORE_TESTERS` (the owner, for now),
with `STORE=testers`, `STORE_TEST_CHECKOUT=on` and `STORE_SETS=HW1`. Adding a tester is adding their account id to
`STORE_TESTERS` (tell the accounts and artist tool sessions first: a settings change restarts the API).

## Cards the Store doesn't sell

Some cards will never be sold: promo cards, event cards, rare prizes. A card says so with `"exclusive": "promo"`
(or another reason) in its set's data. The Store leaves it out, and the rules have a test for it.

**A deck code with such cards:** Missing cards lists them apart, under "Not sold in the Store", greyed, with why
("Promo · not sold", or "Not in the Store yet" for a set that isn't on sale). The rest can still be bought. The deck
is saved either way and can be played once the player has every card.

**Later: players trading and selling cards.** Not planned yet, but the design leaves room for it:

- Ownership is a list of events per account (today: orders), added up. A trade or a sale between players becomes two
  more events (one account gives copies, the other gets them), so nothing about ownership has to be redesigned.
- Every event already records where the copies came from. A market will also need to know which copies can be
  traded (bought ones, maybe not starter ones), so each event will carry that too.
- The Missing cards page has a place for "Find it on the market" beside cards the Store doesn't sell.
- Anything to do with money between players needs its own legal check first (the Merchant of Record, taxes, and the
  loot-box and gambling rules in some countries).

## Hidden until launch

- **One build, gated on the server** (the owner's choice, 2026-09-24, replacing "two builds"): the Store's code is
  in the live game for everyone, and the API decides who may open it.
  - Accounts not on `STORE_TESTERS` get `403 store_private`: their Store tile stays "Coming soon", the unreleased
    sets aren't loaded, and nothing changes for them.
  - Payments, when they come, will also be refused by the API for anyone not let in.
- **Launch day:** set `STORE=open` on the API (and turn `STORE_TEST_CHECKOUT` off). No game build needed.
- **Rollback:** set `STORE=off`. Everyone's tile goes back to "Coming soon".

## Legal (no company needed)

- **Tax:** US sole proprietorship, which is automatic. Report on Schedule C, pay self-employment tax on profit, and check the details with an accountant at tax time.
- **Seller name:** your personal name appears as the seller. An optional DBA would show "Via Mochi" instead.
- **App Store in the EU:** the EU's trader rules need a public address and phone number. Use a mailbox-service address, or leave out EU storefronts. This does not affect the web store.
- **Terms of Service:**
  - a licence, not ownership: no cash value, no transfer or resale
  - we may rebalance cards or discontinue the service with notice
  - accounts can be closed for abuse
  - liability limit, US arbitration and class-action waiver, governing law
  - minors need a parent's consent
  - references the Merchant of Record's terms
  - allows personal wallpaper use of owned cards
- **Privacy Policy:**
  - what we collect: login id, email, display name, age flags, purchases
  - who processes it: Microsoft (Azure, including sign-in), Paddle, Apple, Google, Valve
  - GDPR, UK and CCPA rights, and a children's section (no accounts under 13)
  - no ads and no tracking
- **Refund policy:** aligned with Paddle's.
- **Cookies:** essential storage only, so no consent banner is needed.
- **The "nothing leaves this device" note** (`apps/web/src/progress.ts`) is updated in the accounts plan (phase A2).
- **Start from templates** (Termly or iubenda), then get a **one-time flat-fee review by a games or tech lawyer** before the first dollar.
- **Content ratings:** IARC (Google Play), Apple's questionnaire and Steam's survey. For all three, answer "in-game purchases, no random items".
- **Personal liability** is handled through the Terms, the Merchant of Record and the stores handling payments, never touching card data, and generous refunds. An umbrella insurance policy is optional.

## Phases

| # | Phase | What gets done | Needs |
|---|---|---|---|
| **0** | **Decide and try out** | Rough prices. Paddle trial: sandbox checkout and webhook, and whether Paddle accepts individuals. | your sign-ups |
| **1** | **Engine and playtest build** | `flags.ts`, the `build:playtest` build and the playtest site; rarity and starter flags; the multi-set card registry; tests | — |
| **2** | ~~Deck builder, Home, Collection~~ | **Done** | — |
| **3** | **Accounts** | Done by the accounts plan (phases A0–A2): `apps/api`, sign-in, age check, account deletion, Showcase and decks per account, legal pages. The Store adds only the tester list. How accounts work: [accounts.md](accounts.md). | — |
| **4** | **Store browsing** (playtest only) | **Built** (not yet deployed): Store tile, catalog, Decks and Cards tabs, cart, missing cards from a deck code, test checkout for testers | 1, 3 |
| **5** | **Web payments** (playtest only) | Paddle live approval, `/checkout`, webhook grant and revoke, reveal animation, refunds, monitoring, sale schedule | 4, legal pages |
| **6** | **Soft launch, then launch** | Friends and family as testers with real small purchases, refund drills, lawyer sign-off, then launch day | 5 |
| **7** | **iPhone and Android** | Capacitor shell, `platform.ts`, StoreKit and Play Billing, Apple and Google webhooks, store listings, Android's 14-day closed test (at least 12 testers) | 6 |
| **8** | **Steam** | Electron and steamworks.js shell, Steam Microtransactions and sign-in, store page and review, check Valve's price-parity rules for in-game items | 7 |

## From the accounts work

- **Legend Pawtraits come with their card.** Buying a card that has a Legend Pawtrait (for now Tango, Nova and Reaper)
  must also unlock the Pawtrait: add a row to `viamochi-id`'s `avatarunlocks` table (PartitionKey the account id,
  RowKey the Pawtrait id) in the same step that grants the card, and remove it on a refund. There's no endpoint for
  this yet; `viamochi-id` needs a service-to-service one (see [accounts.md](accounts.md), Avatars).
- **Purchases log:** the `purchases` log category (kept forever, tamper-proof) is designed in
  [accounts.md](accounts.md) but not created yet; the Store creates it with its first purchase code.
- **Contact us** in the game is the support channel the Store's receipts and refund policy should point to; there is no
  support mailbox.

## Open questions

- Prices: deck and single-card price points.
- Whether to pay for SWA Standard (about $9 a month) to password-protect the playtest site, or rely on an unlisted address plus the tester list.
- Which cards come first: a new set, or premium variants of existing cards.
- The Showcase and the wallpaper for cards the player doesn't own yet: show them locked, or leave them out.
