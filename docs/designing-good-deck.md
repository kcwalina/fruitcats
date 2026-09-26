# Designing a good deck

How to make a deck for Folkborn: one family of creatures from a culture's folklore, with a hero, a cast of characters
that are all real beliefs, art in one style, and rules that are already known to be balanced. This is written for the
agents who will build the next decks (see [folk-creatures.md](folk-creatures.md) for which creatures come next). The
Domowiki deck ([domowiki-set.md](domowiki-set.md), `content/2026/10/domowiki/`) is the worked example: everything
below was learned making it, most of it from the owner's corrections.

Last updated 2026-09-26.

## What a great deck is

The owner judges a deck on four things, in this order.

1. **It teaches something true.** Every deck comes with facts about its creature and culture. Players should open a
   deck and learn beliefs they had never heard of. So a card is never "generic fantasy": each one comes from a real
   piece of the lore, and the set records where it came from.
2. **It has variety.** A deck of twenty pictures of the same creature is boring, however good each picture is. The
   Domowiki deck got better when it became the whole Slavic household: the Domowik's wife in the cellar, the barn
   spirit, the bathhouse spirit, the yard spirit, the house snake, a drenched chick on a fence. Look for the
   creature's family, relatives, neighbours, animals, customs and objects.
3. **The hero is the most lovable card, not the grandest.** A deck's hero must read as its most important card, and
   the way to get there is charm: the cutest, most captivating version of the creature, painted like the rest of the
   deck. A tall glowing "king" figure was rejected outright. What marks the hero as the leader is the card itself:
   Legendary rarity and a gold frame.
4. **It looks premium.** One painted style across the whole deck, no placeholder-looking pictures, nothing that reads
   as "made by an artist who's not very good". Every card is looked at next to its neighbours before it ships.

## The process

### 1. Research the lore before designing anything

Read the Wikipedia article and at least two or three folklore sources for the creature (regional folklore sites,
academic articles, museum pages). Then write down, as a plain list, every specific, surprising belief you find:
where the creature lives, what it eats, what it's given, what angers it, how it shows itself, what it turns into,
which customs are about it, who its relatives are, which animals go with it. Aim for twenty or more. This list is the
raw material for the cards, so the more specific the better: "families carried embers from the old stove when they
moved, and asked him along" is a card; "it is a house spirit" is not.

Two rules while researching:

- **Gentle.** Leave out gruesome or frightening details. A grumpy spirit that bangs pots is fine; one that eats
  people is not (a belief like that stays out of the set entirely, not softened).
- **Respectful.** Some beliefs are living religion or belong to a community that restricts how they are shown.
  [folk-creatures.md](folk-creatures.md) notes those cases. When a source says a picture or story shouldn't be
  reproduced, believe it.

Keep the sources: they go in the set's `lore.sources`.

### 2. Choose the hero

- **Who:** the creature at its most endearing. Not a god, not a ruler, not an ancestor figure with a halo. If the lore
  offers a warm, affectionate name people used for the creature, use that: the Domowiki hero is *Dziadziuś*, the
  fond Polish word for grandpa, because families called their house spirit "grandfather".
- **Name clashes:** once the hero has a name, check every other card against it. A hero called "Grandpa" next to a
  card called "Grandfather Domowik" makes no sense, and the owner will spot it. The same goes for titles ("Master of
  the House" beside "First Master of the House").
- **Two sides:** a hero starts on its first side and **Awakens** to its second. Don't make the sides a young and an
  adult version of the creature; the owner didn't want baby heroes. Make the second side the same character shown
  in its full glory, or in its proud moment: Dziadziuś holds a spoon like a sceptre while the household looks up at
  him.
- **Data:** `"type": "Hero Cat"` (the code's name; players read "Hero"), `"rarity": "Legendary"`, `"frame": "gold"`.
  Every other card keeps the family's frame colour, so the gold frame is the hero's alone.

### 3. Cast the deck

Take your list of beliefs and turn it into cards. For each card, write down which belief it is; if you can't, the
card is probably filler. Ways to get variety:

- **The household, not the individual.** Wife, grandmother, children, cousins, the spirit of the next building
  over (the Domowiki have the Dvorovoi of the yard, the Bannik of the bathhouse, the Ovinnik of the drying barn).
- **Shapes it takes.** Many folk creatures turn into animals. "Domowik in a Cat's Shape" and "The House Snake" are
  both the Domowik himself. The owner loves these.
- **Customs about it.** Offerings, greetings, moving-day rituals, festival days. These make good Tricks and Toys:
  "Bread-and-Salt Greeter", "Saucer of Milk", "Old Bast Shoe", "Bowl of Kasha".
- **Signs of it.** How people knew it was there: braided horse manes, a warm hand at night, tangled hair, banging
  pots. "Warm Hand in the Night", "Knotted Mane", "A Domowik's Temper".
- **Its animals and small neighbours.** A cricket behind the stove, a hedgehog under the doorstep. Use them for the
  cheap Critters, so those aren't yet another picture of the main creature.

Naming rules:

- **Fabled cards are named characters** (Kikimora, Bannik, Babunia): they are one of a kind in the rules, so they
  should be individuals in the lore too.
- **Use the culture's own words** where they read well (Kasha, Kłobuk, Dziadziuś, with the proper letters). A short
  English title after the name explains it: "Kłobuk, the Soggy Chick".
- **Nothing says "cat".** The game is no longer about cats. The exception is a name where the cat comes from the
  lore itself, like "Domowik in a Cat's Shape"; that kind of exception is welcome.
- **No two cards with the same idea in the name** (two "Grandfather" cards, two "Master of the House" cards).

Flavour text: one or two short lines that state the belief, not a joke about it. "Lives under the doorstep. Harm
it, and the family's luck goes with it." Kid-safe, plain words.

### 4. Rules: reuse what's proven

Don't design new rules for a first deck. Take a released deck whose play style fits the creature's story and copy it
card for card: same costs, stats, keywords and abilities, new names and pictures. The Domowiki deck is the Starter
Box's Mango Tango deck (a ramp deck: gather resources early, drop big units late), because "feed the house and the
big spirits wake" is exactly that story. Balance is then already known, and the nightly playtests and the deploy's
balance gate pass.

Then match beliefs to slots, not the other way round. Look at what each slot's rules say and find the belief that
tells that story: a unit that "can't attack unless you're Well-Fed" is the barn spirit who does nothing until he's
been given his due; "Hello: Draw a card" is the chick that brings things home; "Guardian. Lucky." is the house snake
whose harm costs the family its luck. When rules and belief agree, the card teaches itself.

Family mechanic: rename the copied deck's family condition to something from the lore (Lush became **Well-Fed**),
with a badge icon and a one-line reminder. Data only; no engine code. If you feel a deck needs a new rule, write it
down under "What it needs built" in the set's doc and leave it for later: engine work waits until the cards are
final ([card-data-architecture.md](card-data-architecture.md)).

### 5. Write the lore into the set

`set.json` has a `lore` block:

```jsonc
"lore": {
  "creature": "Domowik (plural Domowiki)",
  "from": "Slavic folklore: Poland (domowik), Russia (domovoi), …",
  "facts": ["The name means 'the one of the house'. …", "…"],   // 10–15 short, true, kid-safe facts
  "sources": ["https://en.wikipedia.org/wiki/Domovoy", "…"]
}
```

Every card should be explained by at least one fact. The facts are what the game will show players with the deck, so
write them for a curious twelve-year-old: one belief per fact, plain words, no hedging.

### 6. Art

The style is the owner's: painterly oil painting, deep violet night with glowing bokeh, warm ember light, gentle and
a little grumpy, never scary. Keep it across the deck; a new deck may have its own palette, but it should be as
consistent inside itself as the Domowiki deck is.

How the pictures are made:

- Write `art/prompts.json` in the set's folder: `style`, `heroStyle` (the same string; heroes are painted like the
  rest), `families` (one background line per family), and one `subjects` entry per card. Describe the creature once
  in detail and reuse that description in every subject, so the character stays the same from card to card.
- Draw with a reference image of the approved style:
  `python tools/generate_art.py --set <code> --model gpt-image-2 --quality high --jobs 1 --reference <image>`.
  Use `--jobs 1`: parallel requests hit the rate limit and fail. Expect about a minute per picture.
- For the hero, draw two versions of each side and pick the cuter one. For any card that comes out wrong, rewrite the
  subject and redraw with `--only <id> --force`.
- Compose the cards: `python tools/compose_cards.py --set <code>` (about three minutes a set; if it stops with
  `OSError: [Errno 22]`, a Windows file lock, just run it again).
- Look at the result. Make a contact sheet of the composed cards and read it as a whole: does the hero stand out?
  Does any picture look weaker than its neighbours? Are the same creature and clothes drawn consistently? Fix before
  showing the owner. Both hero sides get checked side by side with two ordinary cards.

Never send image-model pictures to a human artist as reference ([artist-guide.md](artist-guide.md)); briefs to
artists describe cards in words.

### 7. Data and checks

- Folder: `content/<year>/<month>/<set>/set.json`, ids `<SET>-H01` for the hero and `<SET>-D01…` for the rest.
  Register the set in `content/index.ts`.
- Card types in data are the code's names (`Hero Cat`, `Cat`, `Critter`, `Trick`, `Toy`); what players read comes
  from `packages/engine/src/terms.json` (Hero, Fabled, Critter, Trick, Toy; Awaken). Don't invent new type words
  per deck.
- `npm run write-text -- <set>` writes each card's rules text from its abilities; never write rules text by hand.
- `npm run check-set -- <set>` must say "ready to play" (structure, abilities, text, art, and with `--games N` the
  win rates against the released decks).
- `npm run balance:check` is the quick balance gate the deploy runs. A copied deck passes it; a changed one must be
  in the 40–60% band against every other deck.
- Family colours: add the family to `families` in `set.json` (three hex colours) and a `.fam-<family>` line in
  `apps/web/src/skin.css`, or units in play get white frames.

### 8. Write the set's doc and ship

`docs/<set>-set.md` follows [domowiki-set.md](domowiki-set.md): the creature and its lore, the hero and why it's
that character, a "Lore in the cards" section that says which belief each card comes from, the card table, art
notes, and what (if anything) needs building. Add the set to the table in
[card-data-architecture.md](card-data-architecture.md), and mark the creature as "in the game" in
[folk-creatures.md](folk-creatures.md).

Then commit and `npm run deploy` (it merges main, tests, pushes, uploads). A finished deck is one that's live.

## Checklist before showing the owner

- [ ] Every card can be traced to a written belief, and that belief is in `lore.facts`.
- [ ] The deck is not the same creature twenty times: relatives, shapes, customs, signs, animals are all in it.
- [ ] The hero is the cutest card, named affectionately, Legendary, gold-framed, painted like the deck.
- [ ] No name clashes between the hero and any card; no two cards with the same idea in the name.
- [ ] No "cat" anywhere unless the lore puts it there; the footer says Folkborn.
- [ ] The rules are a proven deck's, card for card, with a lore-named family condition; `check-set` and
      `balance:check` pass.
- [ ] Composed cards were reviewed on a contact sheet, hero beside ordinary cards; nothing looks weaker than the rest.
- [ ] `docs/<set>-set.md` written, architecture table and folk-creatures.md updated.
- [ ] Deployed.

## Mistakes already made, so you don't repeat them

- **The grand hero.** A radiant "First Forefather" with a wheat crown and halo, meant to look exalted, looked like a
  bad Santa Claus next to the charming ordinary cards. Cute wins; the frame does the exalting.
- **Renaming the hero without rereading the deck.** "Dziadziuś" (grandpa) shipped next to "Grandfather Domowik" and
  "Kasha for Grandfather". Reread every name after any rename.
- **Overused words.** "Legend" for the top card type was rejected as something every game uses. Prefer words with a
  folk-tale feel; the owner picked "Fabled".
- **Leftover cat vocabulary on cards.** Type lines said "HERO CAT · KITTEN", the footer said "Fruitcats", the Power
  icon was a paw, and the hero's collector number ended in "-kitten". All of it had to go before cards could be shown
  to playtesters. Check the composed image, not just the data.
- **Parallel art requests.** Four at once returned rate-limit errors for most of the batch. One at a time works.
