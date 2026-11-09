import { useEffect, useState } from "react";
import { type DeckDetail, api } from "../api.ts";
import { BracketBadge } from "./BracketPanel.tsx";
import { CardIndex, CardList } from "./CardName.tsx";
import { ManaCost } from "./Mana.tsx";

const NAMES: Record<number, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

/** Full-screen summary to show the table during the pre-game (Rule 0) conversation. */
export function Rule0({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.deck(slug).then(setDetail, (e) => setError(String(e.message ?? e)));
  }, [slug]);

  if (error) return <p className="error">{error}</p>;
  if (!detail?.report) return <div className="loading">Loading…</div>;
  const r = detail.report;
  const b = r.bracket;
  const cmdr = r.commanderCards[0];
  if (!b)
    return <p className="muted">This report has no bracket data yet. Re-run the optimizer.</p>;
  const a = b.after;
  const combos = a.combos.filter((c) => c.twoCard);

  return (
    <CardIndex.Provider value={r.cardIndex ?? {}}>
      <div className="rule0">
        {cmdr?.imageArt && (
          <div className="rule0-art" style={{ backgroundImage: `url(${cmdr.imageArt})` }} />
        )}
        <div className="rule0-body">
          <div className="rule0-top">
            <BracketBadge n={a.bracket} size="lg" />
            <div>
              <div className="rule0-kicker">Bracket {a.bracket}</div>
              <div className="rule0-name">{NAMES[a.bracket]}</div>
            </div>
          </div>
          <h1>
            {r.commanders.join(" + ")}{" "}
            {r.commanderCards.map((c) => (
              <ManaCost key={c.name} cost={c.manaCost} size={24} />
            ))}
          </h1>
          {r.themes.length > 0 && (
            <p className="rule0-themes">{r.themes.slice(0, 4).join(" · ")}</p>
          )}

          <div className="rule0-facts">
            <div>
              <span>Game length</span>
              <strong>{b.minTurns}+ turns</strong>
            </div>
            <div>
              <span>Power</span>
              <strong>
                {a.position === "high" ? "High" : a.position === "mid" ? "Mid" : "Low"}{" "}
                {NAMES[a.bracket]}
              </strong>
            </div>
            <div>
              <span>Game Changers</span>
              <strong>{a.gameChangers.length}</strong>
            </div>
            <div>
              <span>Two-card combos</span>
              <strong>{combos.length}</strong>
            </div>
          </div>

          {a.gameChangers.length > 0 && (
            <section>
              <h3>Game Changers</h3>
              <p className="rule0-list">
                <CardList names={a.gameChangers} separator=" · " />
              </p>
            </section>
          )}
          {combos.length > 0 && (
            <section>
              <h3>Combos</h3>
              <ul className="rule0-combos">
                {combos.map((c) => (
                  <li key={c.cards.join("+")}>
                    <strong>
                      <CardList names={c.cards} />
                    </strong>
                    <span>{c.produces.slice(0, 2).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(a.massLandDenial.length > 0 || a.extraTurns.length > 0) && (
            <section>
              <h3>Heads up</h3>
              <p className="rule0-list">
                <CardList names={[...a.massLandDenial, ...a.extraTurns]} separator=" · " />
              </p>
            </section>
          )}
          {a.gameChangers.length === 0 && combos.length === 0 && (
            <p className="rule0-clean">
              No Game Changers, no two-card combos, no land destruction.
            </p>
          )}
        </div>
      </div>
    </CardIndex.Provider>
  );
}
