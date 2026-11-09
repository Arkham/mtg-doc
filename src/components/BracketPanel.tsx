import type { ReactNode } from "react";
import type { BracketReport } from "../../shared/types.ts";
import { CardList, CardName } from "./CardName.tsx";

const TONE_LABEL = { max: "Max power", balanced: "Balanced", casual: "Casual" } as const;
const POSITION_LABEL = { low: "Low", mid: "Mid", high: "High" } as const;
const SPELLBOOK_TAG: Record<string, string> = {
  E: "Exhibition",
  C: "Core",
  O: "Oddball",
  P: "Powerful",
  S: "Spicy",
  R: "Ruthless",
  B: "Banned",
};
const BRACKET_NAMES: Record<number, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

export function BracketBadge({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`bracket-badge b${n} ${size}`} title={`Bracket ${n}: ${BRACKET_NAMES[n]}`}>
      {n}
    </span>
  );
}

function PowerMeter({ power, position }: { power: number; position: string }) {
  return (
    <div className="power-meter" aria-label={`Power ${power} of 100`}>
      <div className="power-track">
        <div className="power-fill" style={{ width: `${power}%` }} />
        {[25, 40, 65, 90].map((x) => (
          <span key={x} className="power-tick" style={{ left: `${x}%` }} />
        ))}
      </div>
      <div className="power-labels small muted">
        <span>casual</span>
        <span>
          power {power} · {position}
        </span>
        <span>cEDH</span>
      </div>
    </div>
  );
}

export function BracketPanel({
  b,
  rule0Href,
  actions,
}: {
  b: BracketReport;
  rule0Href: string;
  /** Extra controls in the header, e.g. changing the target bracket. */
  actions?: ReactNode;
}) {
  const a = b.after;
  const limit = b.gameChangerLimit;
  const slots = limit ?? Math.max(a.gameChangers.length, 0);
  const twoCard = a.combos.filter((c) => c.twoCard);
  const moved = b.before.bracket !== a.bracket;
  return (
    <div className="bracket-panel">
      <div className="bracket-head">
        <BracketBadge n={a.bracket} size="lg" />
        <div className="bracket-title">
          <h2>
            Bracket {a.bracket}: {BRACKET_NAMES[a.bracket]}
          </h2>
          <div className="muted small">
            Target {b.target} · {TONE_LABEL[b.tone]} · {POSITION_LABEL[a.position]}{" "}
            {BRACKET_NAMES[b.target]}
            {moved && ` · was bracket ${b.before.bracket}`}
            {a.spellbookTag &&
              ` · Commander Spellbook: ${SPELLBOOK_TAG[a.spellbookTag] ?? a.spellbookTag}`}
          </div>
        </div>
        <div className="bracket-actions">
          {actions}
          <a className="button" href={rule0Href}>
            Pre-game summary
          </a>
        </div>
      </div>

      <PowerMeter power={a.power} position={POSITION_LABEL[a.position].toLowerCase()} />

      <ul className="checks">
        {a.checks.map((c) => (
          <li key={c.label} className={c.ok ? "ok" : "bad"}>
            <span className="check-icon" aria-hidden>
              {c.ok ? "✓" : "✕"}
            </span>
            <strong>{c.label}</strong>
            <span className="muted">{c.detail}</span>
          </li>
        ))}
        <li className="ok">
          <span className="check-icon" aria-hidden>
            ⏱
          </span>
          <strong>Game length</strong>
          <span className="muted">expect at least {b.minTurns} turns before anyone wins</span>
        </li>
      </ul>

      <div className="grid2 bracket-grid">
        <div>
          <h3>
            Game Changers{" "}
            <span className="muted">
              {a.gameChangers.length}
              {limit !== null ? ` / ${limit}` : ""}
            </span>
          </h3>
          {slots === 0 && a.gameChangers.length === 0 ? (
            <p className="muted small">None allowed in this bracket.</p>
          ) : (
            <div className="gc-slots">
              {a.gameChangers.map((g) => (
                <div key={g} className="gc-slot filled">
                  <CardName name={g} />
                </div>
              ))}
              {limit !== null &&
                Array.from({ length: Math.max(0, limit - a.gameChangers.length) }).map((_, i) => (
                  <div key={i} className="gc-slot empty">
                    open slot
                  </div>
                ))}
            </div>
          )}
          {b.gameChangerOptions.filter((g) => !g.inDeck).length > 0 && limit !== 0 && (
            <p className="small muted gc-options">
              Best others for this deck:{" "}
              {b.gameChangerOptions
                .filter((g) => !g.inDeck)
                .slice(0, 4)
                .map((g, i) => (
                  <span key={g.name}>
                    {i > 0 && " · "}
                    <CardName name={g.name} />
                  </span>
                ))}
            </p>
          )}
        </div>
        <div>
          <h3>Two-card combos</h3>
          {twoCard.length === 0 ? (
            <p className="muted small">None in the deck.</p>
          ) : (
            <ul className="combo-speed">
              {twoCard.map((c) => (
                <li key={c.cards.join("+")}>
                  <span>
                    <CardList names={c.cards} />{" "}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="small"
                      aria-label="View combo on Commander Spellbook"
                    >
                      ↗
                    </a>
                  </span>
                  {c.earlyPct !== null && (
                    <span className={`small ${c.earlyPct > 15 ? "warn" : "muted"}`}>
                      {c.earlyPct}% of games assembled before turn {b.minTurns}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {b.excluded.length > 0 && (
        <details className="excluded">
          <summary>
            {b.excluded.length} strong {b.excluded.length === 1 ? "card" : "cards"} skipped to stay
            within your limits
          </summary>
          <ul>
            {b.excluded.map((e) => (
              <li key={e.name}>
                <CardName name={e.name} /> <span className="muted small">· {e.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
