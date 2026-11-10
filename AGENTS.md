# AGENTS.md

Guidance for anyone (human or agent) working on **mtg-doc**: a local web app that reads a Commander
deck from a photo or list, optimizes it within a bracket and budget, and publishes read-only reports
as a static site.

## Commands

```bash
pnpm dev              # API + Vite with HMR on http://localhost:5173 (HOST=0.0.0.0 for your phone)
pnpm check            # format:check + lint + typecheck + unit/integration tests. Run before every push.
pnpm test             # unit + integration tests (offline, ~seconds)
pnpm test:e2e         # Playwright: local app flow + static site on desktop, iPhone and iPad (WebKit)
pnpm test:record      # re-record HTTP fixtures against the live APIs (needs network)
pnpm format           # prettier --write
pnpm lint             # oxlint
pnpm typecheck        # tsc --noEmit (TypeScript 7)
pnpm build:static     # read-only site into site/ (see README for --only/--out)
```

CI (`.github/workflows/ci.yml`) runs all of the above, including the e2e suite, on every push and PR.
Pages (`.github/workflows/pages.yml`) deploys `main`.

## Layout

```
server/            Express API, optimizer pipeline and data sources (Node, run with tsx)
  analysis/        pure logic: roles, mana, simulator, bracket rules, solver, optimizer helpers
  sources/         Scryfall, EDHREC, Commander Spellbook, web research clients
  llm.ts           the only place that talks to the LLM (OpenAI Responses API)
  pipeline.ts      orchestrates a job: load → bracket → data → solve → review → verify → report
shared/types.ts    types shared by server and client
src/               React UI (local app + static site, switched by VITE_STATIC)
scripts/           build-static.ts
test/              unit, integration, e2e (Playwright), fixtures and support helpers
decks/             user decks, one folder per commander (initial.txt, optimized.txt, report.*)
```

## Development practices

### Correctness first

- Every card that enters a deck is validated: legal in Commander, inside the commander's color identity,
  singleton (basics excepted), under budget, not locked, and inside the target bracket. New code paths
  that add cards must go through the same `violation` check (`makeViolation` in `server/analysis/search.ts`).
- Bracket rules live in one table (`BRACKETS` in `server/analysis/bracket.ts`), sourced from the
  official Commander Brackets. Game Changers come from Scryfall's live data; never hard-code the list.
- The final deck is always re-verified (Commander Spellbook + simulator). Don't trust the LLM's claims:
  it proposes and explains; deterministic code decides and enforces.
- Prices use Scryfall, falling back to the cheapest printing with a USD price. A card must never look
  free because its default printing lacks a price.
- Respect Scryfall's rate limits (2/s for search, named and collection; 10/s otherwise; a 429 means
  back off 30s). Batch: `/cards/collection` takes 75 cards, and searches can `or` many names together.

### LLM usage

- All LLM calls go through `server/llm.ts`: `chatJson` (Responses API, zod-validated structured
  output), `webSearch` (Responses API `web_search` tool, with citations) and `decide` (Decisions API:
  calibrated yes/no probabilities, e.g. "is this card in this crop?"). No other module calls the LLM.
- Never trust a single model read: photo recognition votes across independent passes (whole photo +
  two tilings) and verifies anything only one pass saw. Keep that shape when changing the scanner, and
  measure changes with `node --import tsx scripts/ocr-bench.ts photo.jpg [--truth list.txt]`.
- Keep the codebase provider-neutral: configure through `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`;
  no vendor- or company-specific names, URLs or keys in code, docs or tests. Real endpoints and keys
  belong in the gitignored `.env` (which supports `${VAR}` references to shell variables).
- The app must keep working without an LLM (pasted lists, data-only swaps).

### Chat parity

- Anything the report UI can change, the user must also be able to do by asking the doc in chat:
  card edits, applying suggestions, re-running the optimizer with any setting, refreshing derived
  data. When you add a button or form that changes a deck or its report, extend `server/chat.ts`
  (reply schema, deck context and system prompt) in the same change, and add a case to the
  "everything the report UI can change, the chat can too" test in `test/integration/llm-pipeline.test.ts`.
- Destructive or slow chat actions (re-running the optimizer, anything that replaces the list) are
  proposed first and start only once the user confirms, by button or by a reply the Decisions API
  judges as a yes. Cheap, non-destructive ones (like finding synergies again) can run directly.
- Importing a deck (photo or list, the review screen) happens before the deck exists, so it's out
  of scope.
- A chat edit updates every section that names the cards it touches, not just the list: stats,
  bracket (including its skipped and Game Changer lists), combos, mana suggestions, swaps (which
  must always equal the net difference from the submitted list), synergies (dropped when a card
  leaves, searched for when one arrives) and card previews. All edits go through
  `applyDeckChanges` (`server/chat.ts`); the pure reconciliation lives in
  `server/analysis/reconcile.ts`. When you add a report field that names deck cards, update it
  there too.

### Testing

- Tests are offline and deterministic. Outbound HTTP is recorded once into `test/fixtures/http`
  (gzipped) and replayed; an unrecorded request fails with a hint to run `pnpm test:record`.
  Re-record when you add a request or an upstream API changes, and commit the fixtures.
- Import `test/support/env.ts` first in every Node test: it isolates tests from `.env`, disables the
  LLM and installs the fixture layer. Stub the LLM endpoint explicitly when testing LLM code.
- Unit-test pure logic in `server/analysis` directly with the factories in `test/support/cards.ts`.
  Integration tests cover the full pipeline, the HTTP API and the static build. Playwright covers the
  UI, including touch behaviour on iPhone/iPad and checks for horizontal overflow on phones.
- Bug fixes come with a test that would have caught them.

### UI

- **Every card shown on a page MUST have a preview** (hover on desktop, tap on touch). Render card
  names with `CardName` (or `CardList` for several), never as plain text. Reports carry a
  `cardIndex` with image data for every card they mention (`server/card-index.ts`): when you add a
  new list of cards to a report, make sure `referencedNames` covers it. `CardName` falls back to
  Scryfall's by-name image as a last resort, but the index is the source of truth.
- Mobile first: the static site is mainly read on iPhone and iPad. Touch targets ≥ 44px, inputs ≥ 16px
  (no iOS zoom), respect safe areas, card previews must work on tap (no hover dependency).
- The static build is read-only: relative asset paths and hash routing so it works on any host and
  sub-path; no server-only features (upload, re-run) and never publish uploaded photos or local paths.
- For visual changes, check screenshots at iPhone (390×844), iPad (820×1180) and desktop widths.

### Published content must be readable by agents

- Everything we publish must be accessible to AI agents and other readers that don't run
  JavaScript. The app's hash routes (`#/deck/<slug>`) never reach the server, so the static build
  also writes an `llms.txt` index, a plain fallback inside the app shell's `#root`, and a
  script-free page per deck at `decks/<slug>/` (all in `server/agent-pages.ts`), plus `report.md`.
- When you add a section or data to a report, add it to `renderMarkdown` (`server/report.ts`) in
  the same change, so the plain page and markdown carry it too; the static build regenerates both
  from `report.json`. Extend the static tests that check these pages.
- Save reports only through `writeResults` (`server/storage.ts`): it renders `report.md` from the
  report it saves, so any change to the deck (chat edits, applied suggestions, re-runs) updates the
  markdown too. Never write `report.json` on its own.
- Render model-written text as escaped markdown in these pages, never as raw HTML.

### Code style

- TypeScript everywhere, strict mode. Format with prettier, lint with oxlint (typescript-eslint can't
  run on TypeScript 7, which has no JS compiler API).
- Comments explain _why_, tersely, and only when a future reader needs them. Never leave comments
  about removed or previous code.
- Prefer small pure functions in `analysis/` over logic inside the pipeline or route handlers.
- Don't add in-process caches to hide slow code; make the slow path faster instead.

### Git

- Branches are prefixed `arkham/`. Keep commits focused with descriptive messages.
- Never commit `.env`, `decks/*/uploads`, build output (`dist/`, `site/`) or ad-hoc test decks.
- Run `pnpm check` (and `pnpm test:e2e` for UI changes) before pushing; CI must be green before merging.
