import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { DeckSummary } from "../../shared/types.ts";
import { type AppConfig, IS_STATIC, type Recognition, type RecognitionJob, api } from "../api.ts";
import { BracketBadge } from "./BracketPanel.tsx";
import { ColorIdentity } from "./Mana.tsx";

const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

const AURA: Record<string, string> = {
  W: "#f4e7b8",
  U: "#3d9be9",
  B: "#8f5bd8",
  R: "#ec5a3a",
  G: "#3dbb6c",
};

/** Glow colors for a deck card, from the commander's color identity. */
function auraOf(colors: string[] | undefined): CSSProperties {
  const c = colors?.length ? colors.map((x) => AURA[x]) : ["#b9bfd0"];
  return {
    "--aura-1": c[0],
    "--aura-2": c[1] ?? c[0],
    "--aura-3": c[2] ?? c[1] ?? c[0],
  } as CSSProperties;
}

function Welcome({ decks }: { decks: DeckSummary[] | null }) {
  const examined = decks?.filter((d) => d.hasReport).length ?? 0;
  return (
    <section className="home-hero">
      <div className="home-hero-text">
        <span className="hero-role">
          <span aria-hidden>♛</span> The mtg doc
        </span>
        <h1>The doc will see your deck now.</h1>
        <p>
          {IS_STATIC
            ? "Check-ups for Commander decks: what each one does today, its bracket and combos, and the swaps the doc prescribes."
            : "Snap a photo of your Commander deck. The doc reads every card, works out its bracket and prescribes swaps that fit your budget."}
        </p>
        {examined > 0 && (
          <p className="home-hero-count">
            {examined} {examined === 1 ? "deck" : "decks"} examined so far
          </p>
        )}
      </div>
      <div className="home-hero-doc" aria-hidden>
        <img src="./doc.webp" alt="" width={360} height={360} />
      </div>
    </section>
  );
}

function DeckGallery({ decks }: { decks: DeckSummary[] }) {
  const [filter, setFilter] = useState("");
  const shown = decks.filter((d) =>
    `${d.slug} ${d.commanders.join(" ")}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section>
      <div className="section-head">
        <h2 className="home-section-title">{IS_STATIC ? "Decks" : "Your decks"}</h2>
        {decks.length > 6 && (
          <input
            type="search"
            className="deck-filter"
            placeholder="Search commanders…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>
      {decks.length === 0 && (
        <div className="empty">
          <p>No decks yet.</p>
          {IS_STATIC && (
            <p className="muted small">Run pnpm build:static after analyzing a deck.</p>
          )}
        </div>
      )}
      <div className="deck-grid">
        {shown.map((d) => (
          <a
            key={d.slug}
            className="deck-card"
            href={`#/deck/${d.slug}`}
            style={auraOf(d.colorIdentity)}
          >
            <div className="deck-art">
              {d.image ? <img src={d.image} alt="" loading="lazy" /> : <span>🃏</span>}
              <div className="deck-art-top">
                <ColorIdentity colors={d.colorIdentity} size={20} />
                {d.bracket && <BracketBadge n={d.bracket} size="sm" />}
              </div>
              <strong className="deck-art-name">{d.commanders.join(" + ") || d.slug}</strong>
            </div>
            <div className="deck-card-body">
              <span className="muted small">
                {d.hasReport
                  ? [
                      d.bracket !== undefined && `Bracket ${d.bracket}`,
                      d.landCount !== undefined && `${d.landCount} lands`,
                      d.priceUsd !== undefined && `$${Math.round(d.priceUsd)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Not analyzed yet"}
              </span>
              {d.swapCount ? (
                <span className="deck-suggest">
                  <img src="./icon-64.png" alt="" width={18} height={18} />
                  {d.swapCount} suggested {d.swapCount === 1 ? "swap" : "swaps"}
                  {d.targetBracket ? ` for bracket ${d.targetBracket}` : ""}
                </span>
              ) : null}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export function Home({
  config,
  onRecognized,
}: {
  config: AppConfig | null;
  onRecognized: (r: Recognition, photos: string[]) => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [preferredMode, setMode] = useState<"image" | "text">("image");
  // Photo recognition needs an LLM; fall back to text input when none is configured.
  const mode = config && !config.llm ? "text" : preferredMode;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RecognitionJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.decks().then(setDecks, () => setDecks([]));
  }, []);

  useEffect(() => {
    if (IS_STATIC) return;
    const onPaste = (e: ClipboardEvent) => {
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        setMode("image");
        setFiles((prev) => [...prev, ...imgs]);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...[...list].filter((f) => f.type.startsWith("image/"))]);
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.recognize(
        mode === "image" ? files : [],
        mode === "text" ? text : "",
      );
      let result: Recognition;
      if ("jobId" in started) {
        for (;;) {
          const job = await api.recognitionJob(started.jobId);
          setProgress(job);
          if (job.status === "error") throw new Error(job.error ?? "Recognition failed");
          if (job.status === "done" && job.result) {
            result = job.result;
            break;
          }
          await new Promise((r) => setTimeout(r, 600));
        }
      } else {
        result = started;
      }
      // Fresh URLs: the preview ones are revoked when this screen unmounts.
      onRecognized(result, mode === "image" ? files.map((f) => URL.createObjectURL(f)) : []);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const canSubmit = mode === "image" ? files.length > 0 : text.trim().length > 0;

  return (
    <div className="stack">
      <Welcome decks={decks} />
      {!IS_STATIC && (
        <section className="panel analyze">
          <div className="section-head">
            <h2 className="home-section-title">Analyze a deck</h2>
            <div className="segmented" role="tablist">
              <button
                role="tab"
                aria-selected={mode === "image"}
                onClick={() => setMode("image")}
                disabled={config ? !config.llm : false}
              >
                Photo
              </button>
              <button role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>
                Text list
              </button>
            </div>
          </div>
          {mode === "image" ? (
            <div
              className={`dropzone ${drag ? "drag" : ""} ${files.length ? "has-files" : ""}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => addFiles(e.target.files)}
              />
              {files.length === 0 ? (
                <div className="dropzone-empty">
                  <div className="dropzone-icon" aria-hidden>
                    📷
                  </div>
                  <strong>
                    {isTouch()
                      ? "Take a photo or choose from your library"
                      : "Drop deck photos here"}
                  </strong>
                  <span className="muted small">
                    {isTouch() ? "" : "or click to browse · paste a screenshot with ⌘V · "}
                    Lay cards out so the names are readable; several photos are fine.
                  </span>
                </div>
              ) : (
                <div className="thumbs">
                  {files.map((f, i) => (
                    <figure key={i} onClick={(e) => e.stopPropagation()}>
                      <img src={previews[i]} alt={f.name} />
                      <button
                        className="icon remove"
                        aria-label="Remove photo"
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </figure>
                  ))}
                  <button className="add-more" onClick={() => input.current?.click()}>
                    + Add photo
                  </button>
                </div>
              )}
            </div>
          ) : (
            <textarea
              className="decklist"
              placeholder={
                "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n..."
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {progress && (
            <div className="scan-progress" role="status">
              <div className="row between small">
                <span>{progress.phase}</span>
                <span className="muted">
                  {progress.total > 1 ? `${progress.done} / ${progress.total}` : ""}
                </span>
              </div>
              <div className="progress">
                <div
                  style={{
                    width: `${Math.max(4, (progress.done / Math.max(1, progress.total)) * 100)}%`,
                  }}
                />
              </div>
              <span className="muted small">
                Reading the photo several times in overlapping crops, then double-checking anything
                only one pass saw.
              </span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row end">
            <button className="primary big" disabled={!canSubmit || busy} onClick={analyze}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden />
                  {mode === "image" ? "Reading cards…" : "Checking cards…"}
                </>
              ) : (
                "Analyze deck"
              )}
            </button>
          </div>
        </section>
      )}

      {decks === null ? (
        <div className="loading">
          <span className="spinner" aria-hidden /> Loading decks…
        </div>
      ) : (
        (decks.length > 0 || IS_STATIC) && <DeckGallery decks={decks} />
      )}
    </div>
  );
}
