# Store plan: selling cards

This document covers the Store: how Fruitcats sells decks and cards on the web, iPhone, Android and Steam.
It records the decisions made so far and the steps, in order. Accounts come first and have their own document,
[accounts-plan.md](accounts-plan.md). Other features still to build (PvP, the ladder) are in
[future-plans.md](future-plans.md).

Last updated 2026-09-23.

## Decisions

| Topic | Decision |
|---|---|
| **What is sold** | Fixed **decks** and **single cards the player sees before buying**. No random paid packs (loot-box laws), and no free cards earned by playing. The fun of opening a pack comes from a reveal animation after buying. |
| **Singles** | Bought through a **cart** with a minimum order of about $4.99, because payment fees would eat a $0.99 purchase. No virtual currency. |
| **Seller** | **You, as an individual.** No LLC or company: the stores and the Merchant of Record are the legal sellers and handle tax, VAT and refunds, as for most indie developers. |
| **Accounts** | The one **Via Mochi account**: an email, signed in with an emailed code inside the game. See [accounts-plan.md](accounts-plan.md). The Store needs an account, like the Collection. |
| **Age** | Anyone can play solo without an account. Accounts need age **13+**. Buying needs **18+ or a parent's approval** (on iOS, Apple's Ask to Buy). |
| **Web payments** | A **Merchant of Record: Paddle**, or Lemon Squeezy if Paddle won't onboard an individual. |
| **Stores** | Web, then **iPhone and Android** (one Capacitor app), then **Steam** (Electron). The same game code everywhere, with no rewrite. |
| **Ownership** | **A purchase anywhere is owned everywhere.** Our server holds the one list of what each Via Mochi account owns. A Steam, App Store or Google Play purchase goes to the account signed in on that device; buying needs an account, so no purchase is ever ownerless. |
| **Pricing** | **The same price on every store, and sales on all stores at once.** The player's experience comes before margin. The game is free to download everywhere. |
| **Infrastructure** | Azure only, in the **ViaMochi Production** subscription (`rg-fruitcats`), set up by the accounts plan. Nothing reuses the mochi suite's resources. |
| **Rollout** | Everything to do with purchases stays **hidden from the public** until launch: a separate playtest build and site, a tester list, and sandbox payments. |
| **Rollback** | The git tag `pre-store` (`a9d7d08`) marks main before any store work. `pre-payments` is moved to the latest main just before the first payment or account code. |

## Already done

- **Deck builder:** build your own decks from the cards you have. What you have comes from `owned(id)` in `apps/web/src/collection.ts`, which for now is the three starter decks together.
- **Collection** (`apps/web/src/showcase.ts`):
  - **Showcase:** your chosen cards, shown big.
  - **All cards:** the whole set. Cards you don't have yet show as shadows, ready for the Store to fill in.
  - **Wallpapers:** any card as a phone, tablet or computer wallpaper.
  - The Showcase choice is kept on the device for now. It moves to the account in the accounts plan's phase A2.
- **Home:** the Store tile exists, marked "Coming soon".

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

Covered by [accounts-plan.md](accounts-plan.md): one Via Mochi account per email, signed in with an emailed code
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
  - single cards: common $0.49, uncommon $0.99, rare $1.49, legendary $2.49
  - decks: $4.99–$7.99
  - A whole deck bought card by card should cost about 1.5–2× the deck price.
- **Never pay twice:** a deck's price drops by the value of cards you already own.

## Cards and catalog

- **Rarity** (common, uncommon, rare, legendary) and a **starter** flag go in `cards/sb1.json`.
  - Preview cards (Jam, Duchess) become the first sellable cards, or go into a new set, `sb2.json`.
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

## Hidden until launch

- **Two builds from one codebase:**
  - **Public** (`fruitcats.viamochi.com`): purchase features compiled out, so they can't be switched on.
  - **Playtest** (`playtest.fruitcats.viamochi.com`): features compiled in, sandbox payments only, and optionally password-protected (SWA Standard, about $9 a month).
- **Tester list on the server:** only listed Via Mochi accounts can create a profile or check out. Anyone else sees "private playtest", and no profile is created for them.
- **Launch day:**
  1. Build the public site with the features on.
  2. Set `PUBLIC_LAUNCH=true` on the API.
  3. Deploy.
- **Rollback:** redeploy the previous build.

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
| **3** | **Accounts** | Done by the accounts plan (phases A0–A2): `apps/api`, sign-in, age check, account deletion, Showcase and decks per account, legal pages. The Store adds only the tester list. | [accounts-plan.md](accounts-plan.md) |
| **4** | **Store browsing** (playtest only) | Store tile, catalog, Decks and Cards tabs, cart, admin grant for testing | 1, 3 |
| **5** | **Web payments** (playtest only) | Paddle live approval, `/checkout`, webhook grant and revoke, reveal animation, refunds, monitoring, sale schedule | 4, legal pages |
| **6** | **Soft launch, then launch** | Friends and family as testers with real small purchases, refund drills, lawyer sign-off, then launch day | 5 |
| **7** | **iPhone and Android** | Capacitor shell, `platform.ts`, StoreKit and Play Billing, Apple and Google webhooks, store listings, Android's 14-day closed test (at least 12 testers) | 6 |
| **8** | **Steam** | Electron and steamworks.js shell, Steam Microtransactions and sign-in, store page and review, check Valve's price-parity rules for in-game items | 7 |

## Open questions

- Prices: deck and single-card price points.
- Whether to pay for SWA Standard (about $9 a month) to password-protect the playtest site, or rely on an unlisted address plus the tester list.
- Which cards come first: the two preview Hero Cats (Jam, Duchess), a new set, or premium variants of existing cards.
- The Showcase and the wallpaper for cards the player doesn't own yet: show them locked, or leave them out.
