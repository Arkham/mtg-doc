import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type AppConfig, type Recognition, api } from "./api.ts";
import { CardSearchButton } from "./components/CardSearch.tsx";
import { Home } from "./components/Home.tsx";
import { Progress } from "./components/Progress.tsx";
import { ReportView } from "./components/ReportView.tsx";
import { Review } from "./components/Review.tsx";
import { Rule0 } from "./components/Rule0.tsx";
import { type ScrollAnchor, captureAnchor, restoreAnchor } from "./scroll-anchor.ts";
import {
  ROUTE_CHANGE,
  type Route,
  currentRoute,
  deckHref,
  go,
  isAppLink,
  navigate,
  hrefOf,
} from "./nav.ts";

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [recognition, setRecognition] = useState<{ result: Recognition; photos: string[] } | null>(
    null,
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const routeRef = useRef(route);
  // How to scroll once the next route renders: to the top, or back to the section being read.
  const pendingScroll = useRef<{ anchor: ScrollAnchor | null } | "top" | null>(null);

  useLayoutEffect(() => {
    routeRef.current = route;
    const pending = pendingScroll.current;
    pendingScroll.current = null;
    if (pending === "top") window.scrollTo(0, 0);
    else if (pending?.anchor) restoreAnchor(pending.anchor);
  }, [route]);

  useEffect(() => {
    const onRoute = () => {
      const prev = routeRef.current;
      const next = currentRoute();
      // Switching between a deck's two views keeps the reader on the same section.
      const sameDeck = prev.page === "deck" && next.page === "deck" && prev.slug === next.slug;
      pendingScroll.current = sameDeck ? { anchor: captureAnchor() } : "top";
      setRoute(next);
    };
    // Links between the static site's pages switch views in place instead of reloading.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !isAppLink(a)) return;
      e.preventDefault();
      navigate(a.getAttribute("href")!);
    };
    const events = ["hashchange", "popstate", ROUTE_CHANGE];
    for (const ev of events) window.addEventListener(ev, onRoute);
    document.addEventListener("click", onClick);
    api.config().then(setConfig, () => setConfig(null));
    return () => {
      for (const ev of events) window.removeEventListener(ev, onRoute);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const goBack = () => {
    setRecognition(null);
    navigate(route.page === "rule0" ? deckHref(route.slug, route.view) : hrefOf({ page: "home" }));
  };

  let body;
  if (route.page === "job") {
    body = (
      <Progress
        jobId={route.jobId}
        onDone={() => go({ page: "deck", slug: route.slug, view: "current" })}
      />
    );
  } else if (route.page === "rule0") {
    body = <Rule0 slug={route.slug} view={route.view} />;
  } else if (route.page === "deck") {
    body = <ReportView slug={route.slug} view={route.view} />;
  } else if (recognition) {
    body = (
      <Review
        recognition={recognition.result}
        photos={recognition.photos}
        config={config}
        onCancel={() => setRecognition(null)}
        onSaved={(slug, jobId) => {
          setRecognition(null);
          go({ page: "job", slug, jobId });
        }}
      />
    );
  } else {
    body = (
      <Home config={config} onRecognized={(result, photos) => setRecognition({ result, photos })} />
    );
  }

  const inner = route.page !== "home" || recognition !== null;

  return (
    <div className="app">
      <header className="topbar">
        {inner ? (
          <button className="back" onClick={goBack} aria-label="Back">
            <span aria-hidden>‹</span>{" "}
            <span className="back-label">{route.page === "rule0" ? "Report" : "Decks"}</span>
          </button>
        ) : (
          <a href={hrefOf({ page: "home" })} className="brand">
            <img src="./icon-64.png" alt="" width={32} height={32} />
            mtg doc
          </a>
        )}
        <div id="topbar-slot" className="topbar-slot" />
        {config && !inner && (
          <span className="muted small topbar-meta">
            {config.llm
              ? `${config.model}${config.webResearch ? " · web research" : ""}`
              : "AI disabled (set LLM_API_KEY)"}
          </span>
        )}
        <CardSearchButton />
      </header>
      <main>{body}</main>
    </div>
  );
}
