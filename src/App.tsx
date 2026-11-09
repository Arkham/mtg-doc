import { useEffect, useState } from "react";
import { type AppConfig, type Recognition, api } from "./api.ts";
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
  if (page === "job" && a && b) return { page: "job", slug: a, jobId: b };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    api.config().then(setConfig, () => setConfig(null));
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  let body;
  if (route.page === "job") {
    body = <Progress jobId={route.jobId} onDone={() => navigate(`#/deck/${route.slug}`)} />;
  } else if (route.page === "deck") {
    body = <ReportView slug={route.slug} />;
  } else if (recognition) {
    body = (
      <Review
        recognition={recognition}
        config={config}
        onCancel={() => setRecognition(null)}
        onSaved={(slug, jobId) => {
          setRecognition(null);
          navigate(`#/job/${slug}/${jobId}`);
        }}
      />
    );
  } else {
    body = <Home config={config} onRecognized={setRecognition} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <a
          href="#/"
          className="brand"
          onClick={() => {
            setRecognition(null);
          }}
        >
          🃏 Deck Doctor
        </a>
        {config && (
          <span className="muted small">
            {config.llm
              ? `AI: ${config.model}${config.webResearch ? " · web research on" : ""}`
              : "AI disabled (set LLM_API_KEY)"}
          </span>
        )}
      </header>
      <main>{body}</main>
    </div>
  );
}
