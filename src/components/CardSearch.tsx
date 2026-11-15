import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeckSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { MIN_QUERY, searchCards } from "../card-search.ts";
import { deckHref } from "../nav.ts";
import { CardName } from "./CardName.tsx";
import { SearchIcon } from "./Icons.tsx";
import { ColorIdentity } from "./Mana.tsx";

const AURA: Record<string, string> = {
  W: "#f4e7b8",
  U: "#3d9be9",
  B: "#8f5bd8",
  R: "#ec5a3a",
  G: "#3dbb6c",
};

/** Glow colors for a deck card, from the commander's color identity. */
export function auraOf(colors: string[] | undefined): CSSProperties {
  const c = colors?.length ? colors.map((x) => AURA[x]) : ["#b9bfd0"];
  return {
    "--aura-1": c[0],
    "--aura-2": c[1] ?? c[0],
    "--aura-3": c[2] ?? c[1] ?? c[0],
  } as CSSProperties;
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Top bar button that opens the card search; "/" or ⌘K opens it too. */
export function CardSearchButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut =
        (e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing(e.target));
      if (!shortcut) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        className="icon topbar-search"
        aria-label="Find a card"
        title="Find a card (/)"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </button>
      {open && <CardSearchOverlay onClose={close} />}
    </>
  );
}

/** Which decks run a card, by name, across every deck as submitted. */
function CardSearchOverlay({ onClose }: { onClose: () => void }) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { hits, total } = useMemo(() => searchCards(decks ?? [], query), [decks, query]);
  const typed = query.trim().length >= MIN_QUERY;

  useEffect(() => {
    api.decks().then(setDecks, (e) => setError(String(e instanceof Error ? e.message : e)));
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A card preview's sheet closes first.
      if (e.key === "Escape" && !document.querySelector(".card-sheet")) onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="search-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Find a card">
        <div className="search-field">
          <SearchIcon />
          <input
            ref={input}
            type="search"
            aria-label="Card name"
            placeholder="Which decks run… e.g. Sol Ring"
            autoComplete="off"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="search-results">
          {error ? (
            <p className="error small">{error}</p>
          ) : decks === null ? (
            <p className="muted small">
              <span className="spinner" aria-hidden /> Loading decks…
            </p>
          ) : !typed ? (
            <p className="muted small">
              Type a card name to see which of the {decks.length}{" "}
              {decks.length === 1 ? "deck runs" : "decks run"} it.
            </p>
          ) : hits.length === 0 ? (
            <p className="muted small">No deck runs a card matching “{query.trim()}”.</p>
          ) : (
            <>
              <ul className="card-hits">
                {hits.map((h) => (
                  <li key={h.name}>
                    <div className="card-hit-name">
                      <CardName name={h.name} />
                      <span className="muted small">
                        {h.decks.length} {h.decks.length === 1 ? "deck" : "decks"}
                      </span>
                    </div>
                    <div className="card-hit-decks">
                      {h.decks.map((d) => (
                        <a
                          key={d.slug}
                          className="deck-chip"
                          href={deckHref(d.slug, "current")}
                          style={auraOf(d.colorIdentity)}
                          onClick={onClose}
                        >
                          <ColorIdentity colors={d.colorIdentity} size={14} />
                          {d.commanders.join(" + ") || d.slug}
                        </a>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {total > hits.length && (
                <p className="muted small">
                  {total - hits.length} more{" "}
                  {total - hits.length === 1 ? "card matches" : "cards match"}; keep typing to
                  narrow it down.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
