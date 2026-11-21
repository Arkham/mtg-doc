/** The deck as submitted, or the doc's suggested version of it. */
export type DeckView = "current" | "optimized";

export type Route =
  | { page: "home" }
  | { page: "deck"; slug: string; view: DeckView }
  | { page: "job"; slug: string; jobId: string };

/**
 * Where a route lives. The published site uses real paths (decks/<slug>/), each one a page with
 * the report in plain HTML, so a copied link works for readers that don't run JavaScript. The
 * local app keeps hash routes.
 */
export function routeHref(route: Route, isStatic: boolean): string {
  if (route.page === "job") return `#/job/${route.slug}/${route.jobId}`;
  if (route.page === "home") return isStatic ? "./" : "#/";
  const parts = [route.slug, ...(route.view === "optimized" ? ["optimized"] : [])].join("/");
  return isStatic ? `decks/${parts}/` : `#/deck/${parts}`;
}

function fromParts([page, a, b]: string[], isStatic: boolean): Route {
  // Links to the old pre-game summary page (…/rule0) land on the deck.
  if (page === (isStatic ? "decks" : "deck") && a)
    return { page: "deck", slug: a, view: b === "optimized" ? "optimized" : "current" };
  if (page === "job" && a && b && !isStatic) return { page: "job", slug: a, jobId: b };
  return { page: "home" };
}

/** Routes from a hash (#/deck/<slug>, also old links to the published site). */
export const hashRoute = (hash: string): Route | null =>
  hash.startsWith("#/") ? fromParts(hash.slice(2).split("/"), false) : null;

/** Routes from a path below the published site's root (decks/<slug>/optimized/). */
export const pathRoute = (path: string): Route => fromParts(path.split("/"), true);

/** All the paths the static build writes a page for, for one deck. */
export const deckPaths = (slug: string) =>
  (["current", "optimized"] as const).map((view) => routeHref({ page: "deck", slug, view }, true));

/** Whether a path below the published site's root is one of the app's own pages. */
export const isAppPath = (path: string) =>
  path === "" || /^decks\/[^/]+\/(optimized\/)?$/.test(path);
