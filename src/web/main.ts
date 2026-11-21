import "./styles.css";
import { searchCards } from "./card-search.ts";
import { defineElements } from "./elements.ts";
import {
  type Route,
  canonicalizeLocation,
  currentRoute,
  isAppLink,
  navigate,
  ROUTE_CHANGE,
} from "./nav.ts";
import { IS_STATIC } from "./static.ts";
import { captureAnchor, restoreAnchor, whenDrawn } from "./scroll-anchor.ts";
import type { DeckSummary } from "../shared/types.ts";

interface ElmApp {
  ports: {
    navigate: { subscribe(fn: (href: string) => void): void };
    saveDecklistView: { subscribe(fn: (view: string) => void): void };
    searchCards: { subscribe(fn: (q: { decks: DeckSummary[]; query: string }) => void): void };
    scrollIntoView: { subscribe(fn: (id: string) => void): void };
    cardHits: { send(hits: unknown): void };
    routeChanged: { send(route: Route): void };
    mediaChanged: { send(media: { canHover: boolean; isTouch: boolean }): void };
  };
}

declare global {
  interface Window {
    Elm: { Main: { init(opts: { node: HTMLElement; flags: unknown }): ElmApp } };
  }
}

// The static build's pages sit at different depths under one <base>. Making it absolute keeps
// relative URLs (data/, assets, icons) on the site root after history.pushState changes the path.
const base = document.querySelector("base");
if (base) base.setAttribute("href", base.href);
canonicalizeLocation();
defineElements();

const VIEW_KEY = "mtg-doc:decklist-view";
const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
const isTouch = window.matchMedia("(pointer: coarse)");
const media = () => ({ canHover: canHover.matches, isTouch: isTouch.matches });

const root = document.getElementById("root")!;
// The static pages carry the report as plain HTML for readers without JavaScript; the app
// replaces it.
root.replaceChildren();
let route = currentRoute();
const app = window.Elm.Main.init({
  node: root,
  flags: {
    isStatic: IS_STATIC,
    // Vite's base is relative ("./"), so bundled symbols resolve on any host and sub-path.
    base: import.meta.env.BASE_URL ?? "/",
    ...media(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    decklistView: localStorage.getItem(VIEW_KEY) ?? "list",
    route,
  },
});

app.ports.navigate.subscribe(navigate);
app.ports.scrollIntoView.subscribe((id) => document.getElementById(id)?.scrollIntoView());
app.ports.saveDecklistView.subscribe((view) => localStorage.setItem(VIEW_KEY, view));
app.ports.searchCards.subscribe(({ decks, query }) => {
  const { hits, total } = searchCards(decks, query);
  app.ports.cardHits.send({
    query,
    total,
    hits: hits.map((h) => ({ name: h.name, decks: h.decks.map((d) => d.slug) })),
  });
});
for (const list of [canHover, isTouch])
  list.addEventListener("change", () => app.ports.mediaChanged.send(media()));

/*
 * Where the reader was on each page they left, so going back puts them there again (the page
 * restores scrolls itself: see `scrollRestoration` below). Each history entry carries a key in its
 * state; the deck list remembers its place however it's reached, its Back button included.
 */
const HOME_Y = "mtg-doc:scroll:home";
const entryY = (key: string) => `mtg-doc:scroll:entry:${key}`;
const entryKey = () => (history.state as { scrollKey?: string } | null)?.scrollKey;
function keyEntry(): string {
  const key = entryKey() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  if (!entryKey()) history.replaceState({ ...history.state, scrollKey: key }, "");
  return key;
}
let current = keyEntry();

/** Back to `y` once the page is long enough to scroll there; the top until then. */
function scrollBackTo(y: number) {
  const ready = () => document.documentElement.scrollHeight >= y + innerHeight;
  if (!ready()) window.scrollTo(0, 0);
  whenDrawn(ready, () => window.scrollTo({ top: y, behavior: "instant" }));
}

const onRoute = () => {
  const prev = route;
  const next = currentRoute();
  // A hash change fires both popstate and hashchange: the second finds the route already moved.
  if (JSON.stringify(next) === JSON.stringify(prev)) return;
  sessionStorage.setItem(entryY(current), String(scrollY));
  if (prev.page === "home") sessionStorage.setItem(HOME_Y, String(scrollY));
  // An entry with a key has been visited before: this is back or forward, not a new page.
  const revisit = entryKey() !== undefined;
  current = keyEntry();
  // Switching between a deck's two views keeps the reader on the same section.
  const sameDeck = prev.page === "deck" && next.page === "deck" && prev.slug === next.slug;
  const anchor = sameDeck ? captureAnchor() : null;
  // The page puts the section back itself: the browser's own scroll anchoring (Safari has it since
  // 27) would move it first, to some other element, and iOS can paint that in between.
  const html = document.documentElement;
  if (anchor) {
    html.style.overflowAnchor = "none";
    // And back on even if the other view never draws.
    setTimeout(() => html.style.removeProperty("overflow-anchor"), 3000);
  }
  route = next;
  app.ports.routeChanged.send(next);
  if (!sameDeck) {
    const saved = sessionStorage.getItem(
      next.page === "home" ? HOME_Y : revisit ? entryY(current) : "",
    );
    // Elm draws in the next animation frame; this one runs right after it, before the paint.
    requestAnimationFrame(() => (saved ? scrollBackTo(Number(saved)) : window.scrollTo(0, 0)));
    return;
  }
  if (!anchor) return;
  // Right after Elm draws the other view, before it's painted, whatever frame that is.
  const view = next.page === "deck" ? next.view : null;
  whenDrawn(
    () => shownView() === view,
    () => {
      restoreAnchor(anchor);
      // Anchoring back on once the switch is painted, for content that loads in later.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => html.style.removeProperty("overflow-anchor")),
      );
    },
  );
};
for (const ev of ["hashchange", "popstate", ROUTE_CHANGE]) window.addEventListener(ev, onRoute);

/** Which of a deck's views the page shows: its "Which deck" switch says. */
function shownView(): string | null {
  const tab = document.querySelector(
    '[role="tablist"][aria-label="Which deck"] [aria-selected="true"]',
  );
  if (!tab) return null;
  return tab.textContent?.trim().startsWith("Optimized") ? "optimized" : "current";
}

// After a reload (or coming back to the page), the page puts the reader back where they were
// itself, the moment the report is drawn: the browser would restore the scroll while the report
// is still loading, paint the top of it, then jump down.
history.scrollRestoration = "manual";
const scrollKey = () => `mtg-doc:scroll:${location.href}`;
addEventListener("pagehide", () => {
  sessionStorage.setItem(scrollKey(), JSON.stringify({ anchor: captureAnchor(), y: scrollY }));
});
const entry = performance.getEntriesByType("navigation")[0] as
  PerformanceNavigationTiming | undefined;
const saved = sessionStorage.getItem(scrollKey());
if (saved && (entry?.type === "reload" || entry?.type === "back_forward")) {
  const { anchor, y } = JSON.parse(saved) as {
    anchor: ReturnType<typeof captureAnchor>;
    y: number;
  };
  whenDrawn(
    () =>
      anchor
        ? anchor.ids.some((id) => document.getElementById(id))
        : document.documentElement.scrollHeight >= y + innerHeight,
    () => (anchor ? restoreAnchor(anchor) : window.scrollTo({ top: y, behavior: "instant" })),
    10_000,
  );
}

// Links between the static site's pages switch views in place instead of reloading.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !isAppLink(a)) return;
  e.preventDefault();
  navigate(a.getAttribute("href")!);
});
