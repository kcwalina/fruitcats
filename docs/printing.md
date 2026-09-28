# Printing physical decks

Research from September 2026 on printing two Folkborn decks as real cards through an online print service. The goal:
the best card quality there is, good boxes, and an upload the owner can do in one go from a packet we prepare.

## Recommendation

**MakePlayingCards (MPC)**, with a print packet we build and the free MPC Autofill tool to load it.

- It has the best quality you can get when ordering a few decks: premium black-core stocks (S33 smooth, M31 casino
  linen), foil, holographic and gilded edges.
- It has the best boxes: custom tuck boxes, rigid boxes, tins, a magnetic book box, and a **double magnetic book box
  that holds two decks of up to 70 cards**.
- It costs about $10–17 per deck for 1–5 decks, plus upgrades. Custom rigid boxes start around $17.
- Before the real order, get one deck on S33 and one on M31 (about $30) to feel the difference.

## The services compared

| Service | Card quality | Boxes | Upload |
|---|---|---|---|
| **MakePlayingCards** | Best. S33 smooth or M31 linen (black core), foil, holographic, gilded edges | Tuck, rigid, tin, magnetic book box, double magnetic book box | Web page: upload many images at once, then drag each onto its card slot. MPC Autofill can do this for you. |
| **The Game Crafter** | Good, a step below MPC. One black-core stock, smooth finish. Made in the US. | Tuck, hook, "Pro" two-part boxes | **Real public API:** create the game, deck and up to 100 cards per call. We could upload everything; the owner only reviews and pays. |
| **QPMN** | Same company as MPC (QP Group). Advertises premium stocks, but we couldn't confirm it has all of MPC's. | The design tool confirms only a custom tuck box | An API for shops: orders with image links go to QPMN for printing. Hand ordering is image by image, like MPC. |
| **DriveThruCards** | Decent, plain | Hardly any | One PDF per deck (back, front, back, front…). The simplest upload, the weakest result. |
| Big factories (Cartamundi, Panda…) | Excellent | Anything | Usually need hundreds of decks per order, so they don't suit two decks. |

### Why not QPMN, even though it has an API

QPMN's API is made for a shop that sells cards to its own customers. The steps:

1. Register as a partner.
2. Set up the product in the dashboard.
3. Each time a customer buys, the shop sends an order with the customer's address and links to the card images.

For two decks this is heavier than it looks:

- The full API docs aren't public. QPMN's page says to contact their team for them.
- The images have to be at public web addresses.
- The product setup, API keys and a test order make it a small integration project.

QPMN becomes the right choice if Folkborn ever sells physical decks from the Store. Each Store order would then go
straight to QPMN, which prints and ships it. That is a separate decision: the Store stays off until the owner says so.

### Why not The Game Crafter

It has the easiest upload, because it has a real API. Choose it if a fully hands-off upload matters more than the last
step of quality and the nicer boxes.

## How the MPC order would work

1. **We build the print packet** (see below).
2. **The owner runs MPC Autofill** ([chilli-axe/mpc-autofill](https://github.com/chilli-axe/mpc-autofill)). It is a
   free community tool, not made by MPC.
   - It runs a browser on the owner's PC, and the owner signs in to MPC themselves.
   - It fills every card slot from the packet's images, using an XML file that lists the cards.
     [hamstu/mpcfill-custom-cards](https://github.com/hamstu/mpcfill-custom-cards) shows how to point it at local files.
   - It saves the project to the MPC account. The owner checks it there and pays.
3. **Without the tool**, the order can be made by hand on MPC's page: upload all the images at once, then drag each
   onto its card slots. A deck has about 21 different cards, and the Hero has a picture on each side, so both decks
   together need fewer than 50 images.

## What we need to build: the print packet

Nothing for printing exists in the repo yet. What exists now:

- `tools/compose_cards.py` renders each finished card as a 750×1050 WebP. That is exactly 2.5″×3.5″ at 300 dpi, with
  **no bleed**. Bleed is the extra ⅛″ of picture on every edge that the printer cuts off. The files are also saved
  with lossy compression (quality 90).
- The art itself (`content/<yyyy>/<mm>/<set>/art/illustrations/*.webp`, 1536×1024) is more than big enough for the
  art window at print size.
- A released deck is 50 cards plus the Hero, whose two faces (Kitten and Big Cat) can go on the two sides of one card.

The packet needs:

- **Cards rendered for print.** The frame and background must reach past the cut line: 822×1122 px at 300 dpi, or
  better 1644×2244 at 600 dpi so the rules text prints sharp. Keep the text inside the ⅛″ safe margin, and save as
  lossless PNG.
- One folder per deck: fronts (with how many copies of each), the card back, and the Hero's two faces.
- The XML file for MPC Autofill.
- Box artwork fitted to MPC's template for the chosen box.

The same images would also work for QPMN or The Game Crafter (The Game Crafter wants 825×1125 for a poker card).

## MPC specifications

- Card size: 63×88 mm (poker). Up to 612 cards per deck, and every card can have its own front and back.
- Images: at least 300 dpi, ⅛″ (36 px at 300 dpi) bleed and a further ⅛″ safe margin. JPG, PNG, TIFF or PDF, RGB or
  CMYK.
- Stocks: S30 (standard smooth, blue core), S33 (superior smooth, black core), M31 (casino linen, black core) and
  others. M30 and M32 need 1,000 decks or more.

## Sources

- [MPC game card specifications](https://www.makeplayingcards.com/design/custom-blank-card.html)
- [MPC poker-size packaging](https://www.makeplayingcards.com/pops/packaging-poker.html)
- [MPC card game boxes](https://www.makeplayingcards.com/promotional/card-game-boxes.html)
- [How to order from MPC (BoardGameGeek)](https://boardgamegeek.com/thread/3045543/makeplayingcardscom-instructions-on-how-to-order-c)
- [MPC Autofill](https://github.com/chilli-axe/mpc-autofill) and its
  [desktop tool](https://github.com/chilli-axe/mpc-autofill/wiki/Desktop-Tool)
- [The Game Crafter Deck API](https://www.thegamecrafter.com/developer/Deck.html) and
  [boxes](https://help.thegamecrafter.com/article/83-boxes)
- [QPMN API](https://www.qpmarkets.com/qpmn-api/),
  [API integration docs](https://www.qpmarketnetwork.com/app/company/developer-center/integration-with-api/) and
  [design tool tutorial](https://www.qpmarketnetwork.com/qpmn-pod-design-tool-tutorial/)
- [DriveThruCards card specifications](https://help.drivethrupartners.com/hc/en-us/articles/12780748203543-Specifications-for-Print-Cards)
  and [a review](https://makerblock.com/2024/03/review-of-drivethrucards-com/)
- [Card stock comparison (EZRA)](https://ezracard.com/cardstock-material/)
