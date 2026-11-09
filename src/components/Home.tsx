import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckSummary } from "../../shared/types.ts";
import { type AppConfig, type Recognition, api } from "../api.ts";

export function Home({
  config,
  onRecognized,
}: {
  config: AppConfig | null;
  onRecognized: (r: Recognition) => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"image" | "text">("image");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.decks().then(setDecks, () => {});
  }, []);

  useEffect(() => {
    if (config && !config.llm) setMode("text");
  }, [config]);

  useEffect(() => {
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
      onRecognized(await api.recognize(mode === "image" ? files : [], mode === "text" ? text : ""));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "image" ? files.length > 0 : text.trim().length > 0;

  return (
    <div className="stack">
      <section className="panel">
        <h1>Analyze a deck</h1>
        <div className="tabs">
          <button
            className={mode === "image" ? "active" : ""}
            onClick={() => setMode("image")}
            disabled={config ? !config.llm : false}
          >
            📷 Photo / screenshot
          </button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
            📝 Paste list
          </button>
        </div>
        {mode === "image" ? (
          <div
            className={`dropzone ${drag ? "drag" : ""}`}
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
              <p>
                Drop deck photos here, click to choose, or paste from the clipboard.
                <br />
                <span className="muted small">
                  Several photos of one deck are fine. Make sure card names are readable.
                </span>
              </p>
            ) : (
              <div className="thumbs">
                {files.map((f, i) => (
                  <figure key={i} onClick={(e) => e.stopPropagation()}>
                    <img src={previews[i]} alt={f.name} />
                    <button
                      className="icon"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </figure>
                ))}
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
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button className="primary" disabled={!canSubmit || busy} onClick={analyze}>
            {busy ? (mode === "image" ? "Reading cards…" : "Resolving cards…") : "Analyze"}
          </button>
        </div>
      </section>

      {decks.length > 0 && (
        <section className="panel">
          <h2>Your decks</h2>
          <div className="deck-grid">
            {decks.map((d) => (
              <a key={d.slug} className="deck-tile" href={`#/deck/${d.slug}`}>
                {d.image ? <img src={d.image} alt="" /> : <div className="placeholder">🃏</div>}
                <div>
                  <strong>{d.commanders.join(" + ") || d.slug}</strong>
                  <div className="muted small">
                    {d.slug} · {new Date(d.createdAt).toLocaleDateString()}{" "}
                    {d.hasReport ? "" : "· no report yet"}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
