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
import { captureAnchor, restoreAnchor } from "./scroll-anchor.ts";
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

const onRoute = () => {
  const prev = route;
  const next = currentRoute();
  // A hash change fires both popstate and hashchange: the second finds the route already moved.
  if (JSON.stringify(next) === JSON.stringify(prev)) return;
  // Switching between a deck's two views keeps the reader on the same section.
  const sameDeck = prev.page === "deck" && next.page === "deck" && prev.slug === next.slug;
  const anchor = sameDeck ? captureAnchor() : null;
  // The page puts the section back itself: the browser's own scroll anchoring (Safari has it since
  // 27) would move it first, to some other element, and iOS can paint that in between.
  const html = document.documentElement;
  if (anchor) html.style.overflowAnchor = "none";
  route = next;
  app.ports.routeChanged.send(next);
  // Elm draws in the next animation frame; this one runs right after it, before the paint.
  requestAnimationFrame(() => {
    if (!sameDeck) window.scrollTo(0, 0);
    else if (anchor) restoreAnchor(anchor);
    // Anchoring back on once the switch is painted, for content that loads in later.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => html.style.removeProperty("overflow-anchor")),
    );
  });
};
for (const ev of ["hashchange", "popstate", ROUTE_CHANGE]) window.addEventListener(ev, onRoute);

// Links between the static site's pages switch views in place instead of reloading.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !isAppLink(a)) return;
  e.preventDefault();
  navigate(a.getAttribute("href")!);
});
