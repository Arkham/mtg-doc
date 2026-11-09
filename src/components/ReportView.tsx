import { useEffect, useState } from "react";
import type {
  Card,
  Combo,
  DeckSnapshot,
  OptimizeOptions,
  Report,
  Swap,
} from "../../shared/types.ts";
import { type DeckDetail, api } from "../api.ts";
import { navigate } from "../nav.ts";
import { CardName } from "./CardName.tsx";
import { Markdown } from "./Markdown.tsx";

const COLOR_NAME = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as const;
const CATEGORY_EMOJI: Record<Swap["category"], string> = {
  synergy: "🧩",
  combo: "♾️",
  mana: "💧",
  ramp: "🌱",
  draw: "📚",
  interaction: "🛡️",
  curve: "📉",
  other: "✨",
};

const money = (n: number | null | undefined) => (n == null ? "–" : `$${n.toFixed(2)}`);

function Delta({
  before,
  after,
  unit = "",
  higherIsBetter = true,
  digits = 1,
}: {
  before: number;
  after: number;
  unit?: string;
  higherIsBetter?: boolean;
  digits?: number;
}) {
  const d = after - before;
  if (Math.abs(d) < 10 ** -digits / 2) return <span className="muted">±0</span>;
  const good = higherIsBetter ? d > 0 : d < 0;
  return (
    <span className={good ? "ok" : "warn"}>
      {d > 0 ? "+" : ""}
      {d.toFixed(digits)}
      {unit}
    </span>
  );
}

function MiniCard({ card, name }: { card?: Card; name: string }) {
  return (
    <div className="mini-card">
      {card?.image ? (
        <img src={card.image} alt={name} loading="lazy" />
      ) : (
        <div className="placeholder">🃏</div>
      )}
      <div>
        <CardName name={name} card={card} />
        <div className="muted small">
          {card?.typeLine.split(" — ")[0]} · {money(card?.priceUsd)}
        </div>
      </div>
    </div>
  );
}

function SwapList({ swaps }: { swaps: Swap[] }) {
  if (!swaps.length)
    return <p className="muted">No swaps suggested. The deck already looks tight.</p>;
  return (
    <div className="swaps">
      {swaps.map((s, i) => (
        <div key={i} className="swap">
          <MiniCard card={s.outCard} name={s.out} />
          <div className="arrow">→</div>
          <MiniCard card={s.inCard} name={s.in} />
          <div className="reason">
            <span className="badge">
              {CATEGORY_EMOJI[s.category]} {s.category}
            </span>
            <p>{s.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorBars({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  const max = Math.max(
    ...after.mana.colors.map((c) => Math.max(c.targetSources, c.landSources)),
    ...before.mana.colors.map((c) => c.landSources),
    1,
  );
  return (
    <div className="color-bars">
      {after.mana.colors.map((c) => {
        const b = before.mana.colors.find((x) => x.color === c.color);
        return (
          <div key={c.color} className="color-row">
            <span className={`pip pip-${c.color}`} title={COLOR_NAME[c.color]}>
              {c.color}
            </span>
            <div className="bar-track">
              <div
                className="bar before"
                style={{ width: `${((b?.landSources ?? 0) / max) * 100}%` }}
              />
              <div className="bar after" style={{ width: `${(c.landSources / max) * 100}%` }} />
              <div
                className="target"
                style={{ left: `${(c.targetSources / max) * 100}%` }}
                title={`target ${c.targetSources}`}
              />
            </div>
            <span className="small">
              {b?.landSources} → <strong>{c.landSources}</strong> / {c.targetSources} ·{" "}
              {Math.round(c.pipShare * 100)}% of pips
              {c.rampSources ? ` · +${c.rampSources} rocks/dorks` : ""}
            </span>
          </div>
        );
      })}
      <div className="muted small legend">
        <span className="bar-swatch before" /> before <span className="bar-swatch after" /> after{" "}
        <span className="target-swatch" /> target sources
      </div>
    </div>
  );
}

function Curve({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  const keys = ["0", "1", "2", "3", "4", "5", "6", "7+"];
  const max = Math.max(
    ...keys.map((k) => Math.max(before.mana.curve[k] ?? 0, after.mana.curve[k] ?? 0)),
    1,
  );
  return (
    <div className="curve">
      {keys.map((k) => (
        <div key={k} className="curve-col">
          <div className="curve-bars">
            <div
              className="bar before"
              style={{ height: `${((before.mana.curve[k] ?? 0) / max) * 100}%` }}
              title={`before: ${before.mana.curve[k] ?? 0}`}
            />
            <div
              className="bar after"
              style={{ height: `${((after.mana.curve[k] ?? 0) / max) * 100}%` }}
              title={`after: ${after.mana.curve[k] ?? 0}`}
            />
          </div>
          <span className="small">{after.mana.curve[k] ?? 0}</span>
          <span className="muted small">{k}</span>
        </div>
      ))}
    </div>
  );
}

function SimTable({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  const b = before.sim;
  const a = after.sim;
  const rows: [string, number, number, boolean, string][] = [
    ["Mulligan rate", b.mulliganRate, a.mulliganRate, false, "%"],
    ...[2, 3, 4, 5].map((t): [string, number, number, boolean, string] => [
      `Land drop on turn ${t}`,
      b.landDropByTurn[t],
      a.landDropByTurn[t],
      true,
      "%",
    ]),
    ["Commander cast on curve", b.commanderOnCurve, a.commanderOnCurve, true, "%"],
    ["Commander cast by turn 5", b.commanderByTurn[5], a.commanderByTurn[5], true, "%"],
    ["All colors by turn 3", b.allColorsByTurn3, a.allColorsByTurn3, true, "%"],
    ["Mana available turn 4", b.avgManaTurn4, a.avgManaTurn4, true, ""],
    ["Mana screw (<3 lands on T4)", b.screwRate, a.screwRate, false, "%"],
    ["Flood (10+ lands seen by T7)", b.floodRate, a.floodRate, false, "%"],
  ];
  return (
    <table className="data">
      <thead>
        <tr>
          <th />
          <th>Before</th>
          <th>After</th>
          <th>Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, x, y, hib, unit]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>
              {x}
              {unit}
            </td>
            <td>
              <strong>
                {y}
                {unit}
              </strong>
            </td>
            <td>
              <Delta before={x} after={y} unit={unit} higherIsBetter={hib} digits={unit ? 1 : 2} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Roles({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Role</th>
          <th>Before</th>
          <th>After</th>
          <th>Typical</th>
        </tr>
      </thead>
      <tbody>
        {after.roles
          .filter((r) => r.role !== "other" && r.role !== "land")
          .map((r) => {
            const b = before.roles.find((x) => x.role === r.role)?.count ?? 0;
            const short = r.target !== null && r.count < r.target;
            return (
              <tr key={r.role}>
                <td>{r.role}</td>
                <td>{b}</td>
                <td className={short ? "warn" : ""}>
                  <strong>{r.count}</strong>
                </td>
                <td className="muted">{r.target ? `${r.target}+` : ""}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

function ComboList({ combos, oneAway }: { combos: Combo[]; oneAway?: boolean }) {
  return (
    <ul className="combos">
      {combos.map((c) => (
        <li key={c.id}>
          {oneAway && (
            <>
              add <strong>{c.missing[0]}</strong>:{" "}
            </>
          )}
          <a href={c.url} target="_blank" rel="noreferrer">
            {c.cards.join(" + ")}
          </a>
          <div className="muted small">{c.produces.slice(0, 4).join(" · ")}</div>
        </li>
      ))}
    </ul>
  );
}

function Rerun({ slug, initial }: { slug: string; initial: OptimizeOptions }) {
  const [opts, setOpts] = useState(initial);
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)}>⚙️ Re-run with different options</button>;
  return (
    <div className="rerun">
      <label>
        Max swaps{" "}
        <input
          type="number"
          value={opts.maxSwaps}
          min={1}
          max={40}
          onChange={(e) => setOpts({ ...opts, maxSwaps: Number(e.target.value) })}
        />
      </label>
      <label>
        Budget/card ${" "}
        <input
          type="number"
          placeholder="none"
          value={opts.budgetPerCard ?? ""}
          onChange={(e) =>
            setOpts({ ...opts, budgetPerCard: e.target.value ? Number(e.target.value) : null })
          }
        />
      </label>
      <label>
        Bracket{" "}
        <select
          value={opts.bracket ?? ""}
          onChange={(e) =>
            setOpts({ ...opts, bracket: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">current</option>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={opts.webResearch}
          onChange={(e) => setOpts({ ...opts, webResearch: e.target.checked })}
        />{" "}
        web research
      </label>
      <button
        className="primary"
        onClick={async () => {
          const { jobId } = await api.reoptimize(slug, opts);
          navigate(`#/job/${slug}/${jobId}`);
        }}
      >
        Run
      </button>
    </div>
  );
}

export function ReportView({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.deck(slug).then(setDetail, (e) => setError(String(e.message ?? e)));
  }, [slug]);

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;
  const r: Report | null = detail.report;
  if (!r) {
    return (
      <section className="panel">
        <h1>{detail.meta.commanders.join(" + ") || slug}</h1>
        <p>No report yet.</p>
        <Rerun slug={slug} initial={detail.meta.options} />
      </section>
    );
  }

  const copyOptimized = async () => {
    const res = await fetch(`/api/decks/${slug}/files/optimized.txt`);
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const cmdr = r.commanderCards[0];
  const ins = r.swaps.reduce((n, s) => n + (s.inCard?.priceUsd ?? 0), 0);

  return (
    <div className="stack report">
      <section
        className="hero"
        style={
          cmdr?.imageArt
            ? {
                backgroundImage: `linear-gradient(90deg, rgba(10,12,20,.95) 30%, rgba(10,12,20,.4)), url(${cmdr.imageArt})`,
              }
            : undefined
        }
      >
        <div>
          <h1>{r.commanders.join(" + ") || slug}</h1>
          <div className="muted small">
            decks/{slug}/ · generated {new Date(r.generatedAt).toLocaleString()}
            {r.model ? ` · ${r.model}` : " · data-only"}
            {r.edhrec?.numDecks ? ` · EDHREC: ${r.edhrec.numDecks.toLocaleString()} decks` : ""}
          </div>
          {r.themes.length > 0 && (
            <div className="chips">
              {r.themes.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="actions">
          <button className="primary" onClick={copyOptimized}>
            {copied ? "Copied ✓" : "📋 Copy optimized list"}
          </button>
          <a
            className="button"
            href={`/api/decks/${slug}/files/optimized.txt`}
            download={`${slug}-optimized.txt`}
          >
            ⬇ optimized.txt
          </a>
          <a
            className="button"
            href={`/api/decks/${slug}/files/initial.txt`}
            download={`${slug}-initial.txt`}
          >
            ⬇ initial.txt
          </a>
          <a
            className="button"
            href={`/api/decks/${slug}/files/report.md`}
            download={`${slug}-report.md`}
          >
            ⬇ report.md
          </a>
          {r.edhrec && (
            <a className="button" href={r.edhrec.url} target="_blank" rel="noreferrer">
              EDHREC ↗
            </a>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Strategy</h2>
        <p>{r.strategy}</p>
        <div className="stats">
          <div>
            <strong>{r.swaps.length}</strong>
            <span>swaps</span>
          </div>
          <div>
            <strong>
              {r.before.mana.landCount} → {r.after.mana.landCount}
            </strong>
            <span>lands (rec. {r.after.mana.recommendedLands})</span>
          </div>
          <div>
            <strong>
              {r.before.mana.avgCmc} → {r.after.mana.avgCmc}
            </strong>
            <span>avg mana value</span>
          </div>
          <div>
            <strong>
              {r.before.sim.commanderOnCurve}% → {r.after.sim.commanderOnCurve}%
            </strong>
            <span>commander on curve</span>
          </div>
          <div>
            <strong>{money(ins)}</strong>
            <span>cost of additions</span>
          </div>
          <div>
            <strong>{r.after.totalCards}</strong>
            <span>cards</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Cards out → cards in</h2>
        <SwapList swaps={r.swaps} />
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Mana base</h2>
          <ColorBars before={r.before} after={r.after} />
          <h3>Curve</h3>
          <Curve before={r.before} after={r.after} />
          {r.manaNotes.length > 0 && (
            <ul>
              {r.manaNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {r.after.mana.issues.length > 0 && (
            <ul className="notes">
              {r.after.mana.issues.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {r.after.mana.tappedLands.length > 0 && (
            <p className="muted small">Enters tapped: {r.after.mana.tappedLands.join(", ")}</p>
          )}
          {r.after.mana.colorlessLands.length > 0 && (
            <p className="muted small">Colorless lands: {r.after.mana.colorlessLands.join(", ")}</p>
          )}
        </section>
        <section className="panel">
          <h2>Goldfish simulation</h2>
          <p className="muted small">
            {r.after.sim.games.toLocaleString()} solo games: free mulligan, greedy land and ramp
            plays.
          </p>
          <SimTable before={r.before} after={r.after} />
          <h3>Roles</h3>
          <Roles before={r.before} after={r.after} />
        </section>
      </div>

      {(r.combosPresent.length > 0 || r.combosOneAway.length > 0) && (
        <div className="grid2">
          <section className="panel">
            <h2>Combos in the deck</h2>
            {r.combosPresent.length ? (
              <ComboList combos={r.combosPresent} />
            ) : (
              <p className="muted">None found.</p>
            )}
          </section>
          <section className="panel">
            <h2>One card away</h2>
            <ComboList combos={r.combosOneAway.slice(0, 10)} oneAway />
          </section>
        </div>
      )}

      {r.research && (
        <section className="panel">
          <h2>Web research</h2>
          <details>
            <summary>Show summary ({r.research.sources.length} sources)</summary>
            <Markdown text={r.research.summary} />
          </details>
          <ul className="sources">
            {r.research.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.warnings.length > 0 && (
        <section className="panel">
          <h2>Warnings</h2>
          <ul className="notes">
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="row between">
          <details>
            <summary>initial.txt</summary>
            <pre>{detail.initial}</pre>
          </details>
          <Rerun slug={slug} initial={r.options} />
        </div>
      </section>
    </div>
  );
}
