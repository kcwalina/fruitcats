# Fruitcats

Folkborn, a collectible card game about folk creatures from around the world, whose battles play themselves: build your army in secret, in six lanes, then read how the Clash went. Easy to learn, built for competitive play, and designed from day one to be playtested by bots and LLM agents.

## Docs

- [Rulebook](docs/rulebook.md) — how to play, tournament rules, comprehensive rules
- [Domowiki set](docs/domowiki-set.md) — the starter set: the Domowiki deck every player has
- [Design notes](docs/design-notes.md) — research, rationale, and balance hypotheses to test
- [Designing a good deck](docs/designing-good-deck.md) — how to make a folklore deck: research, the hero, a varied cast, proven rules, art, checks
- [Folk creatures](docs/folk-creatures.md) — the creatures chosen for the coming decks, one per continent
- [Artist guide](docs/artist-guide.md) — what art a new deck needs, for the artists who draw it; with an [art brief template](docs/art-brief-template.md)

## Play it

**[fruitcats.viamochi.com](https://fruitcats.viamochi.com)** — play against the AI in your browser, on a phone, tablet or desktop.

Or run it locally:

```bash
npm install
npm run dev        # http://localhost:5173 — play against the AI
```

- `packages/engine` — the rules engine (a deterministic state machine implementing the comprehensive rules) and the AI opponent
- `apps/web` — the browser client (Vite + TypeScript, no framework)
- `npm test` — engine tests; `npm run sim -- 200` — AI-vs-AI playtest: win rates, first-player advantage, game length

## Card data and art

- `content/<year>/<month>/<set>/set.json` — each card set's data (the single source of truth for card text, stats and
  abilities), with `plugin.ts` for a set that needs code; the engine has no cards of its own. See
  [docs/card-data-architecture.md](docs/card-data-architecture.md)
- `content/…/<set>/art/prompts.json` — each set's art direction: its style plus one subject per illustration
  (`art/prompts.json` holds the interface art)
- `tools/generate_art.py` — draws text-free illustrations with Azure OpenAI `gpt-image-1-mini` (auth: `az login`) into the set's `games/folkborn/sets/<set>/art/`
- `games/folkborn/sets/<set>/<set>.alex` — each set's cards as printed. `tcg` (`cardengine/tcg`) renders the finished
  cards from them and `games/folkborn/card-layout.alex` (`npm run cards`, into `out/cards/<set>/`); `npm run publish-pack`
  renders them (and the Artist Studio's frames) when it publishes a set. The build publishes each set's art at `/<set>/`
  and `/cards/<set>/`, and its announcement at `/announcements/<set-folder>/`
- `art/ui/stat-paw.svg`, `stat-heart.svg` — the Power and Health icons (Phosphor Icons, MIT), with PNG masks beside
  them for the Python tools; cards, wallpapers and the game draw them as small chips in the family's tint
- `tools/make_icons.py` — cuts the home-screen, PWA, maskable and favicon icons from `art/ui/app-icon.webp`

```bash
python tools/generate_art.py --set dw1   # only draws cards that have no art yet
python tools/generate_art.py --ui        # interface art: backgrounds, card back, icons
npm run cards                            # re-render after any card change; no redraw needed
```

## Roadmap

1. **Rulebook & starter cards** (current)
2. **Engine** — deterministic TypeScript rules engine, cards as data
3. **Playtest harness** — heuristic/MCTS bots for statistics, LLM agents for qualitative feedback and balance patches
4. **Online play** — authoritative server, web client, replays and spectating

## License

Proprietary. Copyright (c) 2026 Via Mochi. All rights reserved. See [LICENSE](LICENSE).
