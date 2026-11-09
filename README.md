# mtg-doc

<p align="center">
  <img src="docs/mtg-doc.webp" alt="A hand-drawn wild-haired inventor happily holding a fan of Magic cards" width="720">
</p>

<p align="center"><em>Great Scott, that mana base needs work.</em></p>

**mtg-doc** is a local web app to analyze and optimize Magic: The Gathering decks, focused on Commander.

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

## Brackets

Pick a target bracket (or keep the current one) and how hard to push: **Max**, **Balanced** or
**Casual**. The optimizer then improves the deck as much as it can without breaking that bracket:

- Rules come from the official Commander Brackets: Game Changer limits (0 / 0 / 3 / any), no mass land
  denial or chained extra turns below bracket 4, no two-card combos in brackets 1-2 and only
  late-game ones in bracket 3, plus the minimum game length for each bracket.
- Game Changers come from Scryfall's live `is:gamechanger` data; mass land denial, extra turns and
  combo severity come from Commander Spellbook's bracket estimator.
- Recommendations come from EDHREC's page for the target bracket (e.g. `/upgraded`), so a
  bracket 3 deck is tuned toward what bracket 3 decks actually play.
- The goldfish simulator estimates how often each two-card combo comes together before the bracket's
  minimum game length; combos that show up too early don't count as "late-game".
- Every swap is checked against the rules, the final deck is re-verified with Commander Spellbook,
  and any swap that sneaks in a forbidden combo is undone.
- The report shows the bracket checks, Game Changer slots (and the best other options), combo speed,
  strong cards skipped to stay in the bracket, and a **Pre-game summary** screen to show the table.

## How the optimizer decides

- **Data score** per card: EDHREC inclusion rate and synergy for this commander, combo membership,
  role gaps (ramp/draw/removal/…), and a penalty for very expensive spells. Off-color cards are always cut.
- **Candidates**: EDHREC's lists for the commander, the missing piece of combos that are one card
  away, and cards mentioned in web research, all filtered for legality, color identity and budget.
- **Solver**: greedy hill climbing over one-for-one swaps with an explicit score (bracket-specific
  EDHREC inclusion and synergy, role coverage, curve, tone) and hard bracket constraints. It keeps the
  runner-up cards for each slot as alternatives.
- **LLM review**: keeps, drops or adjusts the solver's swaps (catching anti-synergies) and explains
  them. Every swap is validated again (legal, in identity, not a duplicate, under budget, not locked,
  inside the bracket).
- **Mana base**: land count from Frank Karsten's regression (31.42 + 3.13 × avg MV − 0.28 × cheap
  ramp/draw) blended with the EDHREC average; color source targets from pip share and the heaviest
  colored costs. After the LLM plan, land count is enforced and basics are rebalanced toward the colors
  that are short. Basic-land rebalancing doesn't count toward the max-swaps limit.
- **Goldfish simulation**: 10,000 seeded games per deck (same seed before/after) with a free mulligan,
  greedy land/ramp sequencing and a bipartite check for casting the commander with the right colors.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests, builds the static site and deploys it on every push
to `main`. Enable it once in the repo under **Settings → Pages → Source: GitHub Actions**.

## Scripts

```bash
pnpm dev         # server + Vite with HMR
pnpm build && pnpm start
pnpm test        # unit tests for parsing, mana math and the simulator
pnpm typecheck
pnpm format
```
