import { useEffect, useRef, useState } from "react";
import type {
  Card,
  Combo,
  DeckSnapshot,
  DecklistCard,
  OptimizeOptions,
  Report,
  Swap,
} from "../../shared/types.ts";
import { type DeckDetail, IS_STATIC, api, fileUrl } from "../api.ts";
import { navigate } from "../nav.ts";
import { BracketBadge, BracketPanel } from "./BracketPanel.tsx";
import { CardName } from "./CardName.tsx";
import { ManaCost } from "./Mana.tsx";
import { Markdown } from "./Markdown.tsx";

const COLOR_NAME = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as const;
const CATEGORY_EMOJI: Record<Swap["category"], string> = {
  bracket: "🎯",
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

function MiniCard({ card, name, side }: { card?: Card; name: string; side: "out" | "in" }) {
  return (
    <div className={`mini-card ${side}`}>
      {card?.image ? (
        <CardName
          name={name}
          card={card}
          className="mini-card-img"
          label={<img src={card.image} alt={name} loading="lazy" />}
        />
      ) : (
        <div className="placeholder">🃏</div>
      )}
      <div className="mini-card-text">
        <span className="side-label">{side === "out" ? "Cut" : "Add"}</span>
        <CardName name={name} card={card} className="mini-card-name" />
        <div className="muted small mini-card-meta">
          <ManaCost cost={card?.manaCost} size={13} />
          <span>{card?.priceUsd != null ? money(card.priceUsd) : ""}</span>
        </div>
      </div>
    </div>
  );
}

const isManaSwap = (s: Swap) =>
  s.category === "mana" || (Boolean(s.inCard?.isLand) && Boolean(s.outCard?.isLand));

function SwapGroup({ title, swaps }: { title: string; swaps: Swap[] }) {
  if (!swaps.length) return null;
  return (
    <div className="swap-group">
      <h3>
        {title} <span className="muted">· {swaps.length}</span>
      </h3>
      <div className="swaps">
        {swaps.map((s, i) => (
          <article key={i} className="swap">
            <div className="swap-cards">
              <MiniCard card={s.outCard} name={s.out} side="out" />
              <div className="arrow" aria-hidden>
                →
              </div>
              <MiniCard card={s.inCard} name={s.in} side="in" />
            </div>
            <div className="reason">
              <span className="badge">
                {CATEGORY_EMOJI[s.category]} {s.category}
              </span>
              <p>{s.reason}</p>
              {s.alternatives && s.alternatives.length > 0 && (
                <p className="alternatives small">
                  <span className="muted">Also consider: </span>
                  {s.alternatives.map((a, j) => (
                    <span key={a.name}>
                      {j > 0 && <span className="muted"> · </span>}
                      <CardName name={a.name} card={a} />
                    </span>
                  ))}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SwapList({ swaps }: { swaps: Swap[] }) {
  if (!swaps.length)
    return <p className="muted">No swaps suggested. The deck already looks tight.</p>;
  return (
    <>
      <SwapGroup title="Spells" swaps={swaps.filter((s) => !isManaSwap(s))} />
      <SwapGroup title="Mana base" swaps={swaps.filter(isManaSwap)} />
    </>
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
            <span title={COLOR_NAME[c.color]}>
              <ManaCost cost={`{${c.color}}`} size={22} />
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
              <strong className={c.landSources >= c.targetSources ? "ok" : "warn"}>
                {c.landSources} sources
              </strong>{" "}
              (target {c.targetSources}, was {b?.landSources}) · {Math.round(c.pipShare * 100)}% of
              pips
              {c.rampSources ? ` · +${c.rampSources} from ramp` : ""}
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
        Deck budget ${" "}
        <input
          type="number"
          placeholder="none"
          value={opts.budgetTotal ?? ""}
          onChange={(e) =>
            setOpts({ ...opts, budgetTotal: e.target.value ? Number(e.target.value) : null })
          }
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
      <label>
        Tone{" "}
        <select
          value={opts.tone ?? "max"}
          onChange={(e) => setOpts({ ...opts, tone: e.target.value as OptimizeOptions["tone"] })}
        >
          <option value="max">max power</option>
          <option value="balanced">balanced</option>
          <option value="casual">casual</option>
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

const GROUP_ORDER = [
  "Commander",
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
  "Other",
];

function Decklist({ cards, swaps }: { cards: DecklistCard[]; swaps: Swap[] }) {
  const [showCuts, setShowCuts] = useState(false);
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    cards: cards
      .filter((c) => c.group === g)
      .sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name)),
  })).filter((g) => g.cards.length);
  return (
    <>
      <div className="list-toolbar">
        <span className="muted small">
          {cards.reduce((n, c) => n + c.qty, 0)} cards · tap a name to see the card
        </span>
        <button
          className={`toggle ${showCuts ? "on" : ""}`}
          aria-pressed={showCuts}
          onClick={() => setShowCuts(!showCuts)}
        >
          {showCuts ? "Hide" : "Show"} cut cards
        </button>
      </div>
      <div className="decklist-groups">
        {groups.map(({ group, cards }) => (
          <div key={group} className="deck-group">
            <h3>
              {group} <span className="muted">({cards.reduce((n, c) => n + c.qty, 0)})</span>
            </h3>
            <ul>
              {cards.map((c) => (
                <li key={c.name} className={c.isNew || c.delta > 0 ? "new" : ""}>
                  <span className="qty">{c.qty}</span>
                  <CardName name={c.name} card={c} className="grow" />
                  {c.isNew ? (
                    <span className="badge new">new</span>
                  ) : c.delta !== 0 ? (
                    <span className="badge new">
                      {c.delta > 0 ? `+${c.delta}` : `−${-c.delta}`}
                    </span>
                  ) : null}
                  <ManaCost cost={c.manaCost} size={13} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {showCuts && (
          <div className="deck-group">
            <h3>
              Cut <span className="muted">({swaps.length})</span>
            </h3>
            <ul>
              {swaps.map((s, i) => (
                <li key={i} className="cut">
                  <span className="qty">1</span>
                  <CardName name={s.out} card={s.outCard} className="grow" />
                  <ManaCost cost={s.outCard?.manaCost} size={13} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
}

function SectionNav({ sections }: { sections: [string, string][] }) {
  const [active, setActive] = useState(sections[0]?.[0]);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const els = sections
      .map(([id]) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-130px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);
  // Scroll only the tab strip: scrollIntoView would also scroll the page and, in WebKit,
  // cancel the page's in-progress smooth scroll.
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!nav || !btn) return;
    nav.scrollTo({ left: btn.offsetLeft - (nav.clientWidth - btn.clientWidth) / 2, behavior: "smooth" });
  }, [active]);
  return (
    <nav className="section-nav" aria-label="Report sections" ref={navRef}>
      {sections.map(([id, label]) => (
        <button
          key={id}
          data-id={id}
          className={active === id ? "active" : ""}
          onClick={() => scrollToSection(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function Stat({
  label,
  before,
  after,
  better,
  format = (n) => String(n),
}: {
  label: string;
  before?: number;
  after: number;
  better?: "up" | "down";
  format?: (n: number) => string;
}) {
  const changed = before !== undefined && before !== after;
  const good = changed && better && (better === "up" ? after > before! : after < before!);
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className={changed && better ? (good ? "ok" : "warn") : ""}>{format(after)}</strong>
      {changed && <span className="stat-was">was {format(before!)}</span>}
    </div>
  );
}

function OneAway({ combos }: { combos: Combo[] }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ComboList combos={all ? combos : combos.slice(0, 5)} oneAway />
      {combos.length > 5 && (
        <button className="ghost small-btn" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${combos.length}`}
        </button>
      )}
    </>
  );
}

function ExportMenu({
  slug,
  edhrecUrl,
  swaps,
}: {
  slug: string;
  edhrecUrl?: string;
  swaps: Swap[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const adds = new Map<string, number>();
  for (const s of swaps) adds.set(s.in, (adds.get(s.in) ?? 0) + 1);
  const copyAdds = () => {
    const text = [...adds].map(([n, q]) => `${q} ${n}`).join("\n") + "\n";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        if (ref.current) ref.current.open = false;
      }, 1000);
    });
  };
  return (
    <details className="menu" ref={ref}>
      <summary className="button">Export ▾</summary>
      <div className="menu-items">
        {adds.size > 0 && (
          <button className="menu-item" onClick={copyAdds}>
            {copied ? "✓ Copied" : "Copy cards to add"}
            <span className="muted small">{swaps.length}</span>
          </button>
        )}
        <a href={fileUrl(slug, "optimized.txt")} download={`${slug}-optimized.txt`}>
          Optimized list <span className="muted small">.txt</span>
        </a>
        <a href={fileUrl(slug, "initial.txt")} download={`${slug}-initial.txt`}>
          Original list <span className="muted small">.txt</span>
        </a>
        <a href={fileUrl(slug, "report.md")} download={`${slug}-report.md`}>
          Full report <span className="muted small">.md</span>
        </a>
        {edhrecUrl && (
          <a href={edhrecUrl} target="_blank" rel="noreferrer">
            View on EDHREC ↗
          </a>
        )}
      </div>
    </details>
  );
}

export function ReportView({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [optimizedText, setOptimizedText] = useState<string | null>(null);

  useEffect(() => {
    api.deck(slug).then(setDetail, (e) => setError(String(e.message ?? e)));
    // Prefetched so the clipboard write happens synchronously in the tap; iOS Safari rejects it otherwise.
    fetch(fileUrl(slug, "optimized.txt"))
      .then((r) => (r.ok ? r.text() : null))
      .then(setOptimizedText, () => {});
  }, [slug]);

  if (error) return <p className="error">{error}</p>;
  if (!detail)
    return (
      <div className="loading">
        <span className="spinner" aria-hidden /> Loading deck…
      </div>
    );
  const r: Report | null = detail.report;
  if (!r) {
    return (
      <section className="panel">
        <h1>{detail.meta.commanders.join(" + ") || slug}</h1>
        <p>No report yet.</p>
        {!IS_STATIC && <Rerun slug={slug} initial={detail.meta.options} />}
      </section>
    );
  }

  const copyOptimized = () => {
    if (!optimizedText) return;
    navigator.clipboard.writeText(optimizedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const cmdr = r.commanderCards[0];
  const ins = r.swaps.reduce((n, s) => n + (s.inCard?.priceUsd ?? 0), 0);
  const hasCombos = r.combosPresent.length > 0 || r.combosOneAway.length > 0;
  const sections: [string, string][] = [
    ...(r.bracket ? [["bracket", "Bracket"] as [string, string]] : []),
    ["swaps", "Swaps"],
    ...(r.decklist ? [["decklist", "Deck list"] as [string, string]] : []),
    ["mana", "Mana"],
    ["sim", "Simulation"],
    ...(hasCombos ? [["combos", "Combos"] as [string, string]] : []),
    ...(r.research ? [["research", "Research"] as [string, string]] : []),
  ];

  return (
    <div className="stack report">
      <section className="hero">
        {cmdr?.imageArt && (
          <div className="hero-art" style={{ backgroundImage: `url(${cmdr.imageArt})` }} />
        )}
        <div className="hero-body">
          <div className="hero-title">
            {r.bracket && <BracketBadge n={r.bracket.after.bracket} />}
            <h1>{r.commanders.join(" + ") || slug}</h1>
            <div className="hero-costs">
              {r.commanderCards.map((c) => (
                <ManaCost key={c.name} cost={c.manaCost} size={20} />
              ))}
            </div>
          </div>
          <div className="hero-meta small">
            Updated {new Date(r.generatedAt).toLocaleDateString()}
            {r.edhrec?.numDecks ? ` · ${r.edhrec.numDecks.toLocaleString()} decks on EDHREC` : ""}
          </div>
          {r.themes.length > 0 && (
            <div className="chips themes">
              {r.themes.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="hero-actions">
            <button className="primary" onClick={copyOptimized} disabled={!optimizedText}>
              {copied ? "✓ Copied" : "Copy deck list"}
            </button>
            <ExportMenu slug={slug} edhrecUrl={r.edhrec?.url} swaps={r.swaps} />
          </div>
        </div>
      </section>

      <SectionNav sections={sections} />

      <section className="panel">
        <h2>The plan</h2>
        <p className="lede">{r.strategy}</p>
        <div className="stats">
          <Stat label="Swaps" after={r.swaps.length} />
          <Stat
            label={`Lands (rec. ${r.after.mana.recommendedLands})`}
            before={r.before.mana.landCount}
            after={r.after.mana.landCount}
            better={r.before.mana.landCount < r.after.mana.recommendedLands ? "up" : "down"}
          />
          <Stat
            label="Avg mana value"
            before={r.before.mana.avgCmc}
            after={r.after.mana.avgCmc}
            better="down"
          />
          <Stat
            label="Commander on curve"
            before={r.before.sim.commanderOnCurve}
            after={r.after.sim.commanderOnCurve}
            better="up"
            format={(n) => `${n}%`}
          />
          <Stat
            label="Mana screw"
            before={r.before.sim.screwRate}
            after={r.after.sim.screwRate}
            better="down"
            format={(n) => `${n}%`}
          />
          <Stat label="Cost of new cards" after={ins} format={(n) => money(n)} />
          <Stat
            label={
              r.options.budgetTotal ? `Deck price (budget $${r.options.budgetTotal})` : "Deck price"
            }
            before={r.before.totalPriceUsd}
            after={r.after.totalPriceUsd}
            better={r.options.budgetTotal ? "down" : undefined}
            format={(n) => `$${Math.round(n)}`}
          />
        </div>
      </section>

      {r.bracket && (
        <section className="panel" id="bracket">
          <BracketPanel b={r.bracket} slug={slug} />
        </section>
      )}

      <section className="panel" id="swaps">
        <h2>Swaps</h2>
        <SwapList swaps={r.swaps} />
      </section>

      {r.decklist && (
        <section className="panel" id="decklist">
          <h2>Optimized deck list</h2>
          <Decklist cards={r.decklist} swaps={r.swaps} />
        </section>
      )}

      <div className="grid2">
        <section className="panel" id="mana">
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
        <section className="panel" id="sim">
          <h2>Goldfish simulation</h2>
          <p className="muted small">
            {r.after.sim.games.toLocaleString()} solo games: free mulligan, greedy land and ramp
            plays.
          </p>
          <div className="table-wrap">
            <SimTable before={r.before} after={r.after} />
          </div>
          <h3>Roles</h3>
          <div className="table-wrap">
            <Roles before={r.before} after={r.after} />
          </div>
        </section>
      </div>

      {hasCombos && (
        <div className="grid2" id="combos">
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
            <OneAway combos={r.combosOneAway} />
          </section>
        </div>
      )}

      {r.research && (
        <section className="panel" id="research">
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

      {!IS_STATIC && r.warnings.length > 0 && (
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
            <summary>Original list (initial.txt)</summary>
            <pre>{detail.initial}</pre>
          </details>
          {!IS_STATIC && <Rerun slug={slug} initial={r.options} />}
        </div>
      </section>
    </div>
  );
}
