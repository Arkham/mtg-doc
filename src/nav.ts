import { IS_STATIC } from "./api.ts";
import type { DeckView } from "./views.ts";
import { type Route, hashRoute, isAppPath, pathRoute, routeHref } from "./routes.ts";

export type { Route };

export const ROUTE_CHANGE = "routechange";

export const hrefOf = (route: Route) => routeHref(route, IS_STATIC);

export const deckHref = (slug: string, view: DeckView, page?: "rule0") =>
  hrefOf(page ? { page, slug, view } : { page: "deck", slug, view });

/** The static build pins the site root with a <base> element, so pages at any depth share it. */
const sitePath = (url: URL) => {
  const root = new URL(document.baseURI).pathname;
  return url.pathname.startsWith(root) ? url.pathname.slice(root.length) : null;
};

export function currentRoute(): Route {
  const fromHash = hashRoute(window.location.hash);
  if (fromHash || !IS_STATIC) return fromHash ?? { page: "home" };
  return pathRoute(sitePath(new URL(window.location.href)) ?? "");
}

/** Moves links made before the published site had real paths (#/deck/<slug>) onto them. */
export function canonicalizeLocation() {
  const route = IS_STATIC ? hashRoute(window.location.hash) : null;
  if (route) history.replaceState(null, "", new URL(hrefOf(route), document.baseURI));
}

export function navigate(href: string) {
  if (!IS_STATIC || href.startsWith("#")) {
    window.location.hash = href;
    return;
  }
  history.pushState(null, "", new URL(href, document.baseURI));
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

export const go = (route: Route) => navigate(hrefOf(route));

/** Whether a link on the static site points at one of the app's own pages. */
export function isAppLink(a: HTMLAnchorElement) {
  if (!IS_STATIC || a.target || a.hasAttribute("download")) return false;
  const url = new URL(a.href);
  const path = url.origin === window.location.origin ? sitePath(url) : null;
  return path !== null && isAppPath(path);
}
