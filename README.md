# 🃏 Deck Doctor

A local web app to analyze and optimize Magic: The Gathering decks, focused on Commander.

1. Upload a photo or screenshot of a deck (or paste a list)
2. A vision LLM reads the card names; Scryfall validates and fuzzy-matches them
3. Review the result, fix misreads, pick the commander, lock pet cards
4. The deck is saved to `decks/<commander-name>/initial.txt`
5. The optimizer pulls EDHREC synergy data, Commander Spellbook combos and (optionally) web research,
   scores every card, asks the LLM for swaps, validates them, then fixes the land count and basic split
6. You get a report: cards out → cards in with reasons, mana base before/after, goldfish simulation,
   role counts and combos

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in LLM_* values
pnpm dev               # http://localhost:5173
```

Any OpenAI-compatible `/chat/completions` endpoint works. `.env` supports `${VAR}` references, so a
key already exported in your shell can be used without copying it:

```bash
LLM_BASE_URL=https://your-endpoint/v1
LLM_API_KEY=${SOME_EXPORTED_KEY}
LLM_MODEL=gpt-5.4
LLM_SEARCH_MODEL=gpt-5-search-api   # optional, enables web research
```

Without an API key the app still works with pasted lists and data-only (EDHREC-ranked) swaps.

## Using it from your phone

The local app binds to `127.0.0.1` by default. To snap deck photos straight from your phone on the
same Wi-Fi, run `HOST=0.0.0.0 pnpm dev` and open `http://<your-computer-ip>:5173`.

## Publishing a static site

```bash
pnpm build:static                 # writes a read-only site to site/
pnpm build:static --only atraxa-praetors-voice,lathril-blade-of-the-elves
pnpm build:static --out ../my-pages-repo/decks
pnpm preview:static               # serve site/ locally (also on your LAN)
```

The output is plain HTML/JS/JSON with relative paths and hash routing, so it works on any static
host and under any sub-path (GitHub Pages, Netlify, Cloudflare Pages, S3) with no rewrite rules.
Uploaded photos, warnings and local paths are not published.

It's built for iPhone and iPad: tap any card name to see the card, sticky section navigation,
"Copy deck list" for Moxfield/Archidekt import, and "Copy cards to add" as a pull list. Use Safari's
**Share → Add to Home Screen** to get an app icon that opens full screen.

## Files per deck

```
decks/lathril-blade-of-the-elves/
  initial.txt     # recognized list (Arena/Moxfield import format)
  optimized.txt   # list after swaps
  report.md       # human-readable report
  report.json     # data behind the UI
  deck.json       # metadata and optimization options
  uploads/        # original photos (gitignored)
```

## How the optimizer decides

- **Data score** per card: EDHREC inclusion rate and synergy for this commander, combo membership,
  role gaps (ramp/draw/removal/…), and a penalty for very expensive spells. Off-color cards are always cut.
- **Candidates**: EDHREC's lists for the commander, the missing piece of combos that are one card
  away, and cards mentioned in web research, all filtered for legality, color identity and budget.
- **LLM plan**: picks one-for-one swaps from that data and explains them. Every swap is validated
  (card exists, legal, in identity, not a duplicate, under budget, not locked).
- **Mana base**: land count from Frank Karsten's regression (31.42 + 3.13 × avg MV − 0.28 × cheap
  ramp/draw) blended with the EDHREC average; color source targets from pip share and the heaviest
  colored costs. After the LLM plan, land count is enforced and basics are rebalanced toward the colors
  that are short. Basic-land rebalancing doesn't count toward the max-swaps limit.
- **Goldfish simulation**: 10,000 seeded games per deck (same seed before/after) with a free mulligan,
  greedy land/ramp sequencing and a bipartite check for casting the commander with the right colors.

## Scripts

```bash
pnpm dev         # server + Vite with HMR
pnpm build && pnpm start
pnpm test        # unit tests for parsing, mana math and the simulator
pnpm typecheck
pnpm format
```
