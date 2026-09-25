# Store plan: selling cards

This document covers the Store: how Fruitcats sells decks and cards on the web, iPhone, Android and Steam.
It records the decisions made so far and the steps, in order. Accounts come first and have their own document,
[accounts.md](accounts.md) (what's left: [accounts-plan.md](accounts-plan.md)). Other features still to build (PvP, the ladder) are in
[future-plans.md](future-plans.md).

Last updated 2026-09-25. **What's next:** [Making it real](#making-it-real-what-is-left) lists the work between
the test Store that's live now and one that takes real money.

## Decisions

| Topic | Decision |
|---|---|
| **What is sold** | Fixed **decks**, and on their own only the **single cards that come in no deck** (the owner's rule, 2026-09-24): a card that's in a deck is had by buying the deck. No random paid packs (loot-box laws), and no free cards earned by playing. The fun of opening a pack comes from a reveal animation after buying. |
| **Singles** | Bought through a **cart** with a minimum order of about $4.99, because payment fees would eat a $0.99 purchase. No virtual currency. |
| **Seller** | **Never us.** The stores and the Merchant of Record are the legal sellers and handle tax, VAT and refunds, as for most indie developers. |
| **Accounts** | The one **Via Mochi account**: an email, signed in with an emailed code inside the game. See [accounts.md](accounts.md). The Store needs an account, like the Collection. |
| **Age** | Anyone can play solo without an account. Accounts need age **13+**. Buying needs **18+ or a parent's approval** (on iOS, Apple's Ask to Buy). |
| **Web payments** | **Paddle**, a Merchant of Record (decided 2026-09-25). It is the legal seller, so it collects sales tax and VAT and handles refunds and chargebacks; players can still pay with PayPal, cards, Apple Pay or Google Pay inside its checkout. Plain PayPal or Stripe would make the owner the seller, responsible for tax in every country. |
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
- **Home:** the Store tile, marked "Coming soon" for everyone the API doesn't let in.
- **Store browsing, cart and test checkout** (phase 4), live on the public site but open only to testers (the owner). See
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
| **Web** | Paddle overlay checkout: card, Apple Pay, Google Pay or PayPal, in local currency with tax included | Paddle | about 5% + 50¢ |
| **iPhone / iPad** | Apple in-app purchase (StoreKit); "Restore purchases" is required | Apple Developer, $99 a year | 15% |
| **Android** | Google Play Billing | Google Play, $25 once | 15% |
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

- **The Store screen:** one list of decks and single cards, all the same size, plus a cart (no tabs or filters).
- **A deck** shows every card in it and marks the cards you already own.
- **A single card** opens its own page with a full-size preview before buying.
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
  A tile's price is its **Add to cart** button (one tap adds it; then it reads "In cart" and opens the cart), and
  tapping the picture or name opens the item's page, where **Add to cart** sits right under the name, on the first
  screen of a phone (the owner's call, 2026-09-25: a price that only opened the page, and a button at the bottom of
  the screen, were confusing and easy to miss). The look is the owner's pick of three designs (option A, "parchment",
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

### On the live site: a preview for every playtester

Since 2026-09-25 (the owner's call, after trying the whole test flow), the live API runs `STORE=preview`,
`STORE_TEST_CHECKOUT=off`, `STORE_SETS=HW1`: every signed-in player can open the Store and see every deck, card and
price, but **Add to cart** says "Coming soon", and there's no cart. The owner sees the same. Test orders placed during
the tester test are kept but count for nothing (no cards, not listed).

To go back to the full test flow for someone (cart, test checkout, reveal, "Remove my test purchases"): `STORE=testers`,
`STORE_TEST_CHECKOUT=on`, their id in `STORE_TESTERS`. Tell the artist tool session first: a settings change restarts
the API.

**Signature cards** (`"signature"` in the card's data, like Reaper) exist only as their Signature print: the Store
shows that print, labels them "Signature" and prices them at `SIGNATURE_PRICE` ($19.99), never as a standard copy.

## Making it real: what is left

Written 2026-09-25. The Store that's live now is complete up to the payment: testers browse, fill a cart, confirm,
and a **test order** gives them the cards with no money taken. Five pieces of work turn that into a real Store on
the web. They're listed roughly in order. Pieces 1 and 3 can start at once, because Paddle's approval and the
lawyer's review both take time we don't control.

### Requirements for the payment work (the owner's, 2026-09-25)

**No purchase is ever lost or granted twice.** A bug or crash may delay a player's cards; it must never lose a
payment, because untangling one by hand costs more in support than cards earn. Paddle's record of payments is the
source of truth for money, and ours can always be rebuilt from it.

1. **Before paying,** the server saves a **pending order** with our order id and passes that id to Paddle with the
   transaction, so every Paddle payment names an order of ours.
2. **Paddle's signed webhook** marks the order paid. We answer 2xx only *after* that write is saved; if we crash
   before it, Paddle sends the webhook again.
3. **Marking the order paid is the grant.** What an account owns is always worked out from its paid orders, so there
   is no second "now add the cards" step that could half-happen. It is one write, which happens entirely or not at
   all.
4. **Each Paddle transaction can mark one order paid, once.** A repeated webhook, a double tap or a retry changes
   nothing.
5. **Not only webhooks:** when the player returns from the overlay, the server asks Paddle about that transaction
   directly; and a regular check compares every Paddle transaction with our orders and applies anything missing.
6. **Refunds and chargebacks** go the same way, keyed to the same order.
7. **Anything the check can't fix raises an alert.** Support finds an order by email or by the number on Paddle's
   receipt.
8. **Crash drills in the sandbox,** kept as tests: a crash before the write, after the write, and before answering
   Paddle must each end with the right cards and no double charge.

**What Paddle gets, and why ownership can't be faked.**

- **Paddle gets no cards.** It gets a line item and price ("Five Alarm deck, $9.99", or "3 single cards") and our
  order id and account id as custom data. It sells the right to have those items in the player's Via Mochi account,
  and gives back its own transaction id (`txn_…`).
- **Owning a card is a row in our database:** account A has 2 copies of `HW1-R03`, from order O. `HW1-R03` is the
  card's fixed id from its set's data; copies are counts, not objects with their own ids (a player market might need
  serial numbers later).
- **No collisions:** order ids are 128-bit random, and the server refuses an existing id for a different account or
  cart. A test fails if two cards anywhere share an id.
- **No forgery:** the game never tells the server what it owns. Only a Paddle webhook whose signature checks out (the
  secret in Key Vault, and the transaction confirmed with Paddle's API) or an admin action (written to the permanent
  log) grants anything. The device's copy is for playing offline only: editing it can at most change one browser's
  solo games; anything shared (synced decks, later player-vs-player) is checked by the server.

**Reading ownership is cheap.** The ledger is never searched as a whole:

- **Stored per account.** Orders live in a table whose partition is the account id, so reading one player's orders
  reads only their rows (a few dozen for a keen buyer), whatever the total size. This is how it's built today.
- **A running total per account.** With real payments, the same write that marks an order paid also updates one
  "owned" row in that account's partition (an atomic batch within one partition), so reading what a player owns is
  a single row. The orders stay the record the total can always be rebuilt from.
- **Not read to play.** Starting a game uses the copy on the device, not the server. Player-vs-player, later, checks
  the two decks once when a match starts.

**How fresh the device's copy is.** Cards can leave an account (a refund now; a trade or a sale later), so the copy
on a device must not keep them for long.

- **Refreshed** when the game opens, when it comes back to the front, when the device is back online (at most once
  a minute; built 2026-09-25), when the Store opens, and right after a purchase.
- **The device that gives a card away updates at once:** it made the trade, and the server's answer carries the new
  total.
- **A stale copy can't be used for anything that matters.** Every trade, sale, listing or player-vs-player match is
  checked against the server's total at that moment, so a card already given away can't be given twice or played
  online. At most, another device of the same player that stayed offline shows it in solo games until it next
  connects.
- **For trading, add:** a version number on each account's total, returned with every API answer, so any call
  notices a change and refreshes; a limit on how long an offline copy is trusted (a few days) before bought cards are
  shown as "needs to connect"; and, with player-vs-player's live connection, a push that tells a player's other
  devices to refresh at once.

### 1. Take the payment (Paddle)

- **Owner's part:** sign up for Paddle (Lemon Squeezy if Paddle refuses), with the website, the
  Terms and a refund policy for Paddle to review. Paddle gives a **sandbox** (fake cards) at once and, after
  approval, a live account.
- **Server:** `POST /v1/store/checkout` prices the cart on the server (the same `priceCart` the test checkout uses,
  refusing a total the player didn't see), records a **pending order**, and asks Paddle for a transaction with our
  order id attached. Paddle never takes a price from the game.
- **Game:** the confirm step opens **Paddle's overlay** (card, Apple Pay, Google Pay, PayPal; local currency, tax
  included). Paddle asks the 18+ or parent's-permission question and for the EU waiver of the 14-day withdrawal
  right for digital goods. We never see or store card details.
- **Webhook:** `POST /webhooks/paddle` checks Paddle's signature, stores each event once (`webhookEvents`), and marks
  the order **paid**. Only a paid order grants cards. The game waits for that (a short poll of `/v1/store`), then
  plays the reveal.
- **Keys:** the Paddle API key and webhook secret go in the Fruitcats Key Vault, read by the API's managed identity.
  Sandbox and live are separate settings, so a test can never charge a real card.
- The test checkout stays for testers until launch, when `STORE_TEST_CHECKOUT` is switched off.

### 2. Make ownership real and permanent

- **The ledger:** ownership stays "the account's events, added up", but only **paid** orders (and grants made by
  hand) count. Every grant, refund and chargeback is also written to the permanent, tamper-proof `purchases` log
  (designed in the accounts plan, not created yet). Test orders are kept apart, so they can't leak into a real
  collection.
- **Refunds and chargebacks** (from Paddle's webhook) remove the cards everywhere. A deck that used them shows the
  Missing cards bar again and falls back to a starter deck in play. Refunds are made in Paddle's dashboard. An admin
  endpoint grants or removes items by hand, for support cases.
- **The rest of the game sees purchases:** the **Collection** shows bought cards as owned (today it still shows only
  the starter decks), the Showcase and wallpapers can use them, and buying a card with a **Legend Pawtrait** unlocks
  the Pawtrait in `viamochi-id` (see [From the accounts work](#from-the-accounts-work)).
- **Offline:** the game keeps its offline copy of what the account owns (already built) and never grants anything to
  itself.

### 3. Legal and trust

- **Terms of Service and Privacy Policy** updated for purchases: a licence, not ownership (no cash value, no resale);
  Paddle as the seller of record, with its terms; what we keep about purchases and for how long; minors need a
  parent's consent. A **refund policy** aligned with Paddle's, and a support contact (Contact us) on receipts and in
  the Store.
- **A lawyer's review** (one-time, flat fee) of the Terms, the Privacy Policy and the refund policy before the first
  real dollar. The brief for the lawyer already exists.
- **Wording in the Store:** only promises we're sure we can keep. "A deck never charges you for cards you already
  have" and "every device" are gone. The deck page's "the rest are taken off the price" needs the same check.
- **Tax:** Paddle collects and pays sales tax and VAT (see [Legal](#legal)).

### 4. Decide what's sold and at what price

- **Prices:** confirm or change the starting points (decks $9.99, singles $0.49 to $4.99, a $4.99 minimum order).
  They live in `packages/store`, so a change is made in one place and covered by tests.
- **What's on sale at launch:** which sets (`STORE_SETS`; testers see the Halloween set today) and which singles.
  Every card sold needs its final art.
- **Premium prints and Signature cards** (Foil, Gold, Signature, First Edition): decide whether any are in the
  launch, or come later as their own work (new finishes, one product per variant).
- **Sales:** the server-side sale schedule, if a sale is wanted at launch; otherwise later.

### 5. Run it safely, then launch

- **Monitoring:** alerts when a webhook fails or is refused, when a paid order grants nothing, or when an order stays
  pending too long. A daily check compares our paid orders with Paddle's and re-applies any missed webhook.
- **Drills in the sandbox,** each kept as a test: buy; double tap; close the overlay halfway; pay twice for the same
  cart; refund; chargeback; a webhook sent twice or late; a price changed mid-checkout; an account deleted after
  buying.
- **Soft launch:** the owner, then friends and family on `STORE_TESTERS`, making **real small purchases** and
  refunding some.
- **Launch day:** `STORE=open` and `STORE_TEST_CHECKOUT` off; rollback is `STORE=off`. Each is an API setting,
  announced to the other sessions first, with no new game build.
- **After the web:** iPhone and Android, then Steam (phases 7 and 8), each feeding the same ledger.

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
- **Preview** (live now): `STORE=preview` lets everyone look, and nobody buy.
- **Launch day:** set `STORE=open` on the API (and turn `STORE_TEST_CHECKOUT` off). No game build needed.
- **Rollback:** set `STORE=off`. Everyone's tile goes back to "Coming soon".

## Legal

- **Tax:** check the details with an accountant.
- **Seller name:** "Via Mochi".
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
| **0** | **Decide and try out** | Rough prices. Paddle trial: sandbox checkout and webhook, and whether Paddle accepts us. | your sign-ups |
| **1** | **Engine and playtest build** | `flags.ts`, the `build:playtest` build and the playtest site; rarity and starter flags; the multi-set card registry; tests | — |
| **2** | ~~Deck builder, Home, Collection~~ | **Done** | — |
| **3** | **Accounts** | Done by the accounts plan (phases A0–A2): `apps/api`, sign-in, age check, account deletion, Showcase and decks per account, legal pages. The Store adds only the tester list. How accounts work: [accounts.md](accounts.md). | — |
| **4** | ~~Store browsing~~ | **Done, live for testers** (2026-09-25): Store tile, one list of decks and cards, cart, missing cards from a deck code, test checkout, reveal | — |
| **5** | **Web payments** (testers only) | Paddle, real ownership, refunds, legal, prices and operations: see [Making it real](#making-it-real-what-is-left) | 4, legal pages |
| **6** | **Soft launch, then launch** | Friends and family as testers with real small purchases, refund drills, lawyer sign-off, then launch day | 5 |
| **7** | **iPhone and Android** | Capacitor shell, `platform.ts`, StoreKit and Play Billing, Apple and Google webhooks, store listings, Android's 14-day closed test (at least 12 testers) | 6 |
| **8** | **Steam** | Electron and steamworks.js shell, Steam Microtransactions and sign-in, store page and review, check Valve's price-parity rules for in-game items | 7 |

## From the accounts work

- **Legend Pawtraits come with their card.** Buying a card that has a Legend Pawtrait (for now Nova and Reaper, then
  Mochi's `legend-mochi` once its art is in; Tango's `legend-tango` is open to everyone) must also unlock the
  Pawtrait: add a row to `viamochi-id`'s `avatarunlocks` table (PartitionKey the account id, RowKey the Pawtrait id)
  in the same step that grants the card, and remove it on a refund. There's no endpoint for
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
