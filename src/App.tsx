import { useEffect, useState } from "react";
import { type AppConfig, IS_STATIC, type Recognition, api } from "./api.ts";
import { Home } from "./components/Home.tsx";
import { Progress } from "./components/Progress.tsx";
import { ReportView } from "./components/ReportView.tsx";
import { Review } from "./components/Review.tsx";
import { navigate } from "./nav.ts";

type Route =
  { page: "home" } | { page: "deck"; slug: string } | { page: "job"; slug: string; jobId: string };

function parseHash(): Route {
  const [, page, a, b] = window.location.hash.split("/");
  if (page === "deck" && a) return { page: "deck", slug: a };
  if (page === "job" && a && b && !IS_STATIC) return { page: "job", slug: a, jobId: b };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [recognition, setRecognition] = useState<{ result: Recognition; photos: string[] } | null>(
    null,
  );
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    api.config().then(setConfig, () => setConfig(null));
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goHome = () => {
    setRecognition(null);
    navigate("#/");
  };

  let body;
  if (route.page === "job") {
    body = <Progress jobId={route.jobId} onDone={() => navigate(`#/deck/${route.slug}`)} />;
  } else if (route.page === "deck") {
    body = <ReportView slug={route.slug} />;
  } else if (recognition) {
    body = (
      <Review
        recognition={recognition.result}
        photos={recognition.photos}
        config={config}
        onCancel={() => setRecognition(null)}
        onSaved={(slug, jobId) => {
          setRecognition(null);
          navigate(`#/job/${slug}/${jobId}`);
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
          <button className="back" onClick={goHome} aria-label="Back to decks">
            <span aria-hidden>‹</span> Decks
          </button>
        ) : (
          <a href="#/" className="brand">
            <img src="./icon.svg" alt="" width={28} height={28} />
            Deck Doctor
          </a>
        )}
        {config && !inner && (
          <span className="muted small topbar-meta">
            {config.llm
              ? `${config.model}${config.webResearch ? " · web research" : ""}`
              : "AI disabled (set LLM_API_KEY)"}
          </span>
        )}
      </header>
      <main>{body}</main>
    </div>
  );
}
