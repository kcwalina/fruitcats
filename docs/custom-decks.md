# Custom decks: an idea for later

An idea for a premium product. Nothing is built yet. This document records the idea and how it would reuse what
exists.

Last updated 2026-09-25.

## The idea

A group buys the right to have **their own Fruitcats deck** made for them. A company, a team at work or a club
describes the deck they want and sends photos: the team's members, the tractors the company makes, their
mascot. We turn that into a real, playable deck, with its own Hero Cat, cards and art. The group gets codes to
share out, and each member uses one to get the deck in the game.

The main use we imagine is **corporate events and team gifts**. For example, a tractor maker gives every
attendee of its dealer conference a deck of tractor-themed cards, with the sales team as its Hero Cats.

## What's sold

A **custom deck pass**, sold on the web store. Prices are placeholders to settle later:

- **The pass:** about $1,000 or more. It covers making one deck, and the first **20 codes**.
- **More codes:** in batches, for example 10 more for about $100.
- A pass could also cover **two decks** (say, two teams at the same event that play each other), at a higher price.

Each code unlocks the deck once, for one Via Mochi account, like any purchase: once redeemed, it's owned on
every device. Nobody else can buy the deck. It exists only for the holders of its codes.

## How it would work

1. **Buying.** The group's organiser buys the pass on the web store. It comes with access to the Artist Studio,
   where the deck will be made.
2. **Describing the deck.** In the Studio, the organiser fills in a short form: what the deck is about, its
   characters, its tone, the names they'd like. They upload their photos: team members, products, a logo.
3. **A work item.** Sending the form files a work item for us. The owner hands it to Claude Code, which designs
   the set as data in `content/`, the same way as our own sets (see [card-data-architecture.md](card-data-architecture.md)):
   - the cards, names, rules text and the deck list
   - a plugin only if a card truly needs code the engine doesn't have
   - the pictures, from the group's photos (see [Turning photos into cats](#turning-photos-into-cats))
4. **Previewing in the Studio.** The organiser sees each picture on its real card, small in the game and as a
   wallpaper, exactly as our artists do today. They comment, ask for changes, rename things and upload their
   own pictures. It's their deck: they may change names, text and pictures freely.
5. **A short playtest.** Before release, the bots play the deck against our released decks, just enough to make
   sure it isn't broken (`npm run check-set` and a small bot run). It doesn't need to be tuned like one of our
   sets.
6. **Release.** The deck becomes a private set that only code holders can own. The organiser receives the codes
   and shares them. Each member redeems a code in the game and plays with the deck.

## Reusing the Artist Studio

The Studio already does most of steps 2 to 4:

| Needed | In the Studio today |
|---|---|
| A private project per customer | A project per set, visible only to its reviewer and the accounts assigned to it |
| The customer sees each picture on its real card, in the game and as a wallpaper | The same previews our artists see |
| Uploading their own pictures, with every version kept | Uploads, versions and checks |
| Comments, and "change the name to…" | Comments with pins, and "Share an idea" for any part of the card |
| We see what's waiting, and approve it | The reviewer's page and approvals |

What's new for custom decks:

- **A customer role.** Today an artist uploads pictures and a reviewer approves. A customer does both for their
  own deck: they upload, and they also decide. We stay reviewers too, for rules problems.
- **The request form** (step 2), and turning it into a work item.
- **Editing names and text directly** for customers, instead of suggesting them. The rules text is still
  generated from the card's data (`npm run write-text`), so changing what a card *does* goes through us.
- **Codes:** creating a batch, redeeming a code, and hiding the set from everyone who doesn't own it.

## Keeping it bounded

Making a deck costs our time and Claude's, so the pass includes a set amount of it:

- **Revision rounds.** For example: one round on the deck's idea and card list, two rounds on the pictures, one
  on names and text. Further rounds cost extra, or come with a bigger pass. The Studio shows how many rounds are
  left.
- **Free edits don't count.** Renaming a card, changing flavour text or uploading their own picture uses no
  rounds: it's cheap for us and it's their deck.
- **Changing rules does count.** A change to what a card does needs new data, text and a bot check, so it
  uses a round.
- **Playtesting is capped:** a fixed number of bot games before release, enough to catch a broken deck, not to
  balance it perfectly.
- **A deadline.** The pass covers, say, 60 days of making. After that, the deck is released as it stands.

## Turning photos into cats

People want to see themselves on the cards. A tool could turn a photo of a person into a Fruitcats-style cat
in a fruit hood, with their face shown inside the hood, and a product photo into a painted scene in the set's
style. This needs its own design:

- consent from each person pictured
- a few options per photo, and the customer picks one
- the result goes through the same Studio previews as any picture

The customer may also upload finished pictures of their own and skip the tool.

## Related

- [artist-studio-plan.md](artist-studio-plan.md): the Artist Studio, which this reuses.
- [store-plan.md](store-plan.md): how the store sells things. The pass would be a web store item.
- [card-data-architecture.md](card-data-architecture.md): sets as data, which is what makes a custom set possible
  without changing the engine.
- [future-plans.md](future-plans.md): other features still to build.
