import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  Card,
  CardPreview,
  Combo,
  DeckSnapshot,
  DecklistCard,
  OptimizeOptions,
  Report,
  Swap,
} from "../../shared/types.ts";
import { type DeckDetail, IS_STATIC, api, fileUrl } from "../api.ts";
import { comboOutcome, groupByMissing } from "../combos.ts";
import { type DeckView, asOriginal, deckHash, hasOriginal } from "../views.ts";
import { navigate } from "../nav.ts";
import { BracketBadge, BracketPanel } from "./BracketPanel.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { CardIndex, CardList, CardName } from "./CardName.tsx";
import { ManaCost, OracleText } from "./Mana.tsx";
import { Markdown } from "./Markdown.tsx";
import { Sheet } from "./Sheet.tsx";

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

/** Removal, counterspells and board wipes: the cards that answer opponents. */
const interaction = (snap: DeckSnapshot) =>
  snap.roles
    .filter((r) => r.role === "removal" || r.role === "counter" || r.role === "wipe")
    .reduce((n, r) => n + r.count, 0);

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

/** Section title with an optional one-line description and actions on the right. */
function PanelHead({
  title,
  desc,
  actions,
}: {
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="panel-head">
      <div className="panel-head-text">
        <h2>{title}</h2>
        {desc && <p className="panel-desc">{desc}</p>}
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </header>
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
                {CATEGORY_EMOJI[s.category]} {s.category[0].toUpperCase() + s.category.slice(1)}
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

const COLOR_WORD = { W: "white", U: "blue", B: "black", R: "red", G: "green" } as const;

function ColorBars({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  const max = Math.max(
    ...after.mana.colors.map((c) => Math.max(c.targetSources, c.landSources)),
    ...before.mana.colors.map((c) => c.landSources),
    1,
  );
  const changed = after.mana.colors.some(
    (c) => c.landSources !== before.mana.colors.find((x) => x.color === c.color)?.landSources,
  );
  return (
    <div className="color-bars">
      {after.mana.colors.map((c) => {
        const b = before.mana.colors.find((x) => x.color === c.color);
        const gap = c.targetSources - c.landSources;
        const word = COLOR_WORD[c.color];
        return (
          <div key={c.color} className="color-row">
            <span title={COLOR_NAME[c.color]}>
              <ManaCost cost={`{${c.color}}`} size={22} />
            </span>
            <div className="color-row-head">
              <span>
                <strong>{c.landSources}</strong> of the <strong>{c.targetSources}</strong> lands
                we&apos;d want make {word}
                {changed && b && b.landSources !== c.landSources && (
                  <span className="muted"> (was {b.landSources})</span>
                )}
              </span>
              <span className={`status-chip ${gap > 1 ? "warn" : "ok"}`}>
                {gap > 0 ? `${gap} short` : "enough"}
              </span>
            </div>
            <div className="bar-track">
              {changed && (
                <div
                  className="bar before"
                  style={{ width: `${((b?.landSources ?? 0) / max) * 100}%` }}
                />
              )}
              <div
                className={`bar after ${changed ? "" : "solo"}`}
                style={{ width: `${(c.landSources / max) * 100}%` }}
              />
              <div
                className="target"
                style={{ left: `${(c.targetSources / max) * 100}%` }}
                title={`target ${c.targetSources}`}
              />
            </div>
            <span className="small color-why">
              {Math.round(c.pipShare * 100)}% of the colored mana symbols in your spells are {word}.{" "}
              {c.targetReason === "heaviest-card" && c.heaviestCard ? (
                <>
                  The target is higher because <CardName name={c.heaviestCard.name} /> costs{" "}
                  <ManaCost cost={c.heaviestCard.manaCost} size={13} />.
                </>
              ) : null}
              {c.rampSources
                ? ` Your mana rocks and creatures add ${c.rampSources} more ${word} sources.`
                : ""}
            </span>
          </div>
        );
      })}
      <div className="muted small legend">
        {changed && (
          <>
            <span className="bar-swatch before" /> before <span className="bar-swatch after" />{" "}
            after
          </>
        )}
        <span className="target-swatch" /> lands we&apos;d want
      </div>
    </div>
  );
}

function Synergies({
  report: r,
  slug,
  canRefresh,
  onUpdated,
}: {
  report: Report;
  slug: string;
  canRefresh: boolean;
  onUpdated: (report: Report) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = r.synergies ?? [];
  const image = (name: string) =>
    r.cardIndex?.[name]?.image ?? r.decklist?.find((c) => c.name === name)?.image ?? null;
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.refreshSynergies(slug));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PanelHead
        title="Synergies"
        desc="Cards that are stronger together, without being an infinite combo."
        actions={
          !IS_STATIC &&
          canRefresh && (
            <button className="small-btn" disabled={busy} onClick={refresh}>
              {busy ? <span className="spinner" aria-hidden /> : null}
              {items.length ? "Find again" : "Find synergies"}
            </button>
          )
        }
      />
      {error && <p className="error small">{error}</p>}
      {items.length === 0 ? (
        <p className="muted">No synergies yet.</p>
      ) : (
        <ul className="synergies">
          {items.map((syn) => (
            <li key={syn.cards.join("|")} className="synergy">
              <div className="synergy-cards">
                {syn.cards.map((n) =>
                  image(n) ? (
                    <CardName
                      key={n}
                      name={n}
                      label={<img className="card-thumb" src={image(n)!} alt={n} loading="lazy" />}
                    />
                  ) : null,
                )}
              </div>
              <div className="synergy-text">
                <strong>{syn.title}</strong>
                <div className="small synergy-names">
                  <CardList names={syn.cards} />
                </div>
                <p className="small">{syn.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ManaAdvice({
  report: r,
  slug,
  onApplied,
}: {
  report: Report;
  slug: string;
  onApplied: (report: Report) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = r.swaps.filter(
    (s) => s.category === "mana" && s.inCard?.isLand && s.outCard?.isLand,
  );
  const suggestions = r.manaSuggestions ?? [];
  const apply = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      onApplied(await api.applyManaSuggestion(slug, id));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mana-advice">
      {changed.length > 0 && (
        <>
          <h3>What we changed</h3>
          <ul className="mana-changes">
            {changed.map((s, i) => (
              <li key={i}>
                <div className="mana-swap">
                  <span className="edit-chip remove">
                    − <CardName name={s.out} card={s.outCard} />
                  </span>
                  <span className="muted">→</span>
                  <span className="edit-chip add">
                    + <CardName name={s.in} card={s.inCard} />
                  </span>
                </div>
                <div className="muted small">{s.reason}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {suggestions.length > 0 && (
        <>
          <h3>Suggested swaps</h3>
          <ul className="mana-changes">
            {suggestions.map((m) => (
              <li key={m.id}>
                <div className="mana-swap">
                  <span className="mana-swap-chips">
                    {m.changes.map((c, i) => (
                      <span key={i} className={`edit-chip ${c.action}`}>
                        {c.action === "add" ? "+" : "−"} <CardName name={c.name} card={c.card} />
                        {c.action === "add" && c.card?.priceUsd != null && (
                          <span className="muted small"> ${c.card.priceUsd.toFixed(2)}</span>
                        )}
                      </span>
                    ))}
                  </span>
                  {!IS_STATIC && (
                    <button
                      className="small-btn"
                      disabled={busy !== null}
                      onClick={() => apply(m.id)}
                    >
                      {busy === m.id ? <span className="spinner" aria-hidden /> : "Apply"}
                    </button>
                  )}
                </div>
                <div className="muted small">{m.reason}</div>
              </li>
            ))}
          </ul>
          {error && <p className="error small">{error}</p>}
        </>
      )}
      {r.after.mana.issues.length > 0 && (
        <>
          <h3>Still worth a look</h3>
          <ul className="notes">
            {r.after.mana.issues.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Curve({ before, after }: { before: DeckSnapshot; after: DeckSnapshot }) {
  const keys = ["0", "1", "2", "3", "4", "5", "6", "7+"];
  const single = before === after;
  // Headroom above the tallest bar for its count label.
  const max =
    Math.max(...keys.map((k) => Math.max(before.mana.curve[k] ?? 0, after.mana.curve[k] ?? 0)), 1) *
    1.18;
  return (
    <figure className="curve-figure">
      <div className="curve" role="img" aria-label="Mana curve, before and after">
        {keys.map((k) => {
          const was = before.mana.curve[k] ?? 0;
          const now = after.mana.curve[k] ?? 0;
          return (
            <div key={k} className="curve-col">
              <div className="curve-bars">
                <span
                  className="curve-count"
                  style={{ bottom: `${(Math.max(was, now) / max) * 100}%` }}
                  title={was !== now ? `was ${was}` : undefined}
                >
                  {now}
                </span>
                {!single && (
                  <div
                    className="bar before"
                    style={{ height: `${(was / max) * 100}%` }}
                    title={`before: ${was}`}
                  />
                )}
                <div
                  className="bar after"
                  style={{ height: `${(now / max) * 100}%` }}
                  title={`after: ${now}`}
                />
              </div>
              <span className="curve-mv">{k}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="legend">
        {!single && (
          <>
            <span className="bar-swatch before" /> before <span className="bar-swatch after" />{" "}
            after
          </>
        )}
        <span className="grow" />
        mana value
      </figcaption>
    </figure>
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
  const single = before === after;
  if (single)
    return (
      <table className="data">
        <tbody>
          {rows.map(([label, , y, , unit]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <strong>
                  {y}
                  {unit}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
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
  const single = before === after;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Role</th>
          {!single && <th>Before</th>}
          <th>{single ? "Cards" : "After"}</th>
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
                {!single && <td>{b}</td>}
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

function Rerun({ slug, initial }: { slug: string; initial: OptimizeOptions }) {
  const [opts, setOpts] = useState(initial);
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)}>Re-run with different options</button>;
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

const VIEW_KEY = "mtg-doc:decklist-view";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Deck list as a visual grid of card images, grouped by type; tap a card to see it full size. */
function DeckImages({
  groups,
  cuts,
  showNew,
}: {
  groups: { group: string; cards: DecklistCard[] }[];
  cuts: Swap[];
  showNew: boolean;
}) {
  const [zoomed, setZoomed] = useState<{ name: string; image: string; scryfallUri: string } | null>(
    null,
  );
  const tile = (
    key: string,
    name: string,
    image: string | null,
    scryfallUri: string,
    badge: ReactNode,
    cut = false,
  ) => (
    <li key={key} className={`deck-image ${cut ? "cut" : ""}`}>
      <button
        aria-label={`Show ${name} full size`}
        onClick={() => image && setZoomed({ name, image, scryfallUri })}
      >
        {image ? (
          <img src={image} alt={name} loading="lazy" />
        ) : (
          <span className="deck-image-missing">{name}</span>
        )}
        {badge}
      </button>
    </li>
  );
  return (
    <div className="deck-images">
      {groups.map(({ group, cards }) => (
        <section key={group}>
          <h3>
            {group} <span className="muted">({cards.reduce((n, c) => n + c.qty, 0)})</span>
          </h3>
          <ul>
            {cards.map((c) =>
              tile(
                c.name,
                c.name,
                c.image,
                c.scryfallUri,
                <>
                  {c.qty > 1 && <span className="deck-image-qty">×{c.qty}</span>}
                  {!showNew ? null : c.isNew ? (
                    <span className="badge new deck-image-badge">new</span>
                  ) : c.delta !== 0 ? (
                    <span className="badge new deck-image-badge">
                      {c.delta > 0 ? `+${c.delta}` : `−${-c.delta}`}
                    </span>
                  ) : null}
                </>,
              ),
            )}
          </ul>
        </section>
      ))}
      {cuts.length > 0 && (
        <section>
          <h3>
            Cut <span className="muted">({cuts.length})</span>
          </h3>
          <ul>
            {cuts.map((s, i) =>
              tile(
                `cut-${i}`,
                s.out,
                s.outCard?.image ?? null,
                s.outCard?.scryfallUri ?? "",
                null,
                true,
              ),
            )}
          </ul>
        </section>
      )}
      {zoomed && (
        <Sheet
          src={zoomed.image}
          alt={zoomed.name}
          onClose={() => setZoomed(null)}
          actions={
            <a className="button" href={zoomed.scryfallUri} target="_blank" rel="noreferrer">
              Scryfall ↗
            </a>
          }
        />
      )}
    </div>
  );
}

function Decklist({
  cards,
  swaps,
  compare,
}: {
  cards: DecklistCard[];
  swaps: Swap[];
  /** Mark new cards and offer the cut ones; off for the deck as submitted. */
  compare: boolean;
}) {
  const [showCuts, setShowCuts] = useState(false);
  const showNew = compare;
  const [view, setView] = useState<"list" | "images">(() =>
    localStorage.getItem(VIEW_KEY) === "images" ? "images" : "list",
  );
  const changeView = (v: "list" | "images") => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    cards: cards
      .filter((c) => c.group === g)
      .sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name)),
  })).filter((g) => g.cards.length);
  return (
    <>
      <div className="list-toolbar">
        <div className="segmented" role="tablist" aria-label="Deck list view">
          <button role="tab" aria-selected={view === "list"} onClick={() => changeView("list")}>
            List
          </button>
          <button role="tab" aria-selected={view === "images"} onClick={() => changeView("images")}>
            Images
          </button>
        </div>
        <span className="muted small grow nowrap">
          {cards.reduce((n, c) => n + c.qty, 0)} cards
        </span>
        {compare && (
          <>
            <button
              className={`toggle ${showCuts ? "on" : ""}`}
              aria-pressed={showCuts}
              onClick={() => setShowCuts(!showCuts)}
            >
              Cut cards
            </button>
          </>
        )}
      </div>
      {view === "images" ? (
        <DeckImages groups={groups} cuts={showCuts ? swaps : []} showNew={showNew} />
      ) : (
        <div className="decklist-groups">
          {groups.map(({ group, cards }) => (
            <div key={group} className="deck-group">
              <h3>
                {group} <span className="muted">({cards.reduce((n, c) => n + c.qty, 0)})</span>
              </h3>
              <ul>
                {cards.map((c) => (
                  <li key={c.name} className={showNew && (c.isNew || c.delta > 0) ? "new" : ""}>
                    <span className="qty">{c.qty}</span>
                    <CardName name={c.name} card={c} className="grow" />
                    {!showNew ? null : c.isNew ? (
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
      )}
    </>
  );
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  window.scrollTo({
    top: el.getBoundingClientRect().top + window.scrollY - offset,
    behavior: "smooth",
  });
}

function SectionNav({ sections }: { sections: [string, string][] }) {
  const [active, setActive] = useState(sections[0]?.[0]);
  const navRef = useRef<HTMLElement>(null);
  // While scrolling to a clicked tab, keep that tab active; side-by-side sections share a top, so
  // position alone can't tell them apart. Any user-driven scroll hands control back.
  const clicked = useRef<string | null>(null);
  // Otherwise the active section is the last one whose top has passed the tab bar (ties go to the
  // first), computed from scroll position each frame so it's deterministic in every browser.
  useEffect(() => {
    const raf = { id: 0 };
    const update = () => {
      raf.id = 0;
      if (clicked.current) return setActive(clicked.current);
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let current = sections[0]?.[0];
      let bestTop = -Infinity;
      for (const [id] of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line && top > bestTop + 1) {
          current = id;
          bestTop = top;
        }
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf.id) raf.id = requestAnimationFrame(update);
    };
    const release = () => {
      clicked.current = null;
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const ev of ["wheel", "touchstart", "keydown"])
      window.addEventListener(ev, release, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const ev of ["wheel", "touchstart", "keydown"]) window.removeEventListener(ev, release);
      cancelAnimationFrame(raf.id);
    };
  }, [sections]);
  // Scroll only the tab strip, and instantly: WebKit runs one smooth scroll at a time, so animating
  // the strip would cancel the page's in-progress smooth scroll.
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!nav || !btn) return;
    nav.scrollLeft = btn.offsetLeft - (nav.clientWidth - btn.clientWidth) / 2;
  }, [active]);
  return (
    <nav className="section-nav" aria-label="Report sections" ref={navRef}>
      {sections.map(([id, label]) => (
        <button
          key={id}
          data-id={id}
          className={active === id ? "active" : ""}
          onClick={() => {
            clicked.current = id;
            setActive(id);
            scrollToSection(id);
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Stats for the deck as submitted, and a way into the suggested changes. */
function Overview({ report: r, full, slug }: { report: Report; full: Report; slug: string }) {
  const draw = r.after.roles.find((x) => x.role === "draw")?.count ?? 0;
  const target = full.bracket?.target;
  return (
    <section className="panel">
      <PanelHead title="Your deck" desc="How the deck plays as you built it." />
      <div className="stats">
        <Stat
          label={`Lands (rec. ${r.after.mana.recommendedLands})`}
          after={r.after.mana.landCount}
        />
        <Stat label="Avg mana value" after={r.after.mana.avgCmc} />
        <Stat label="Interaction" after={interaction(r.after)} />
        <Stat label="Card draw" after={draw} />
        <Stat
          label="Commander on curve"
          after={r.after.sim.commanderOnCurve}
          format={(n) => `${n}%`}
        />
        <Stat label="Mana screw" after={r.after.sim.screwRate} format={(n) => `${n}%`} />
        <Stat label="Combos" after={r.combosPresent.length} />
        <Stat
          label="Deck price"
          after={r.after.totalPriceUsd}
          format={(n) => `$${Math.round(n)}`}
        />
      </div>
      {full.swaps.length > 0 && (
        <div className="overview-cta">
          <p>
            The doc prescribes{" "}
            <strong>
              {full.swaps.length} {full.swaps.length === 1 ? "swap" : "swaps"}
            </strong>
            {target ? ` to tune it for bracket ${target}` : ""}
            {full.options.budgetTotal ? ` within your $${full.options.budgetTotal} budget` : ""}.
          </p>
          <a className="button primary" href={deckHash(slug, "optimized")}>
            See the optimized deck
          </a>
        </div>
      )}
    </section>
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

type ComboFilter = "all" | "present" | "away";

const thumbOf = (index: Record<string, CardPreview>, name: string) => index[name]?.image ?? null;

function ComboThumbs({ names }: { names: string[] }) {
  const index = useContext(CardIndex);
  return (
    <div className="combo-thumbs">
      {names.slice(0, 3).map((n) => {
        const image = thumbOf(index, n);
        return image ? (
          <CardName
            key={n}
            name={n}
            label={<img className="card-thumb" src={image} alt={n} loading="lazy" />}
          />
        ) : null;
      })}
    </div>
  );
}

function SpellbookLink({ combo }: { combo: Combo }) {
  return (
    <a
      href={combo.url}
      target="_blank"
      rel="noreferrer"
      className="small spellbook-link"
      aria-label="View combo on Commander Spellbook"
      title={combo.produces.join(" · ")}
    >
      ↗
    </a>
  );
}

/** Combos in the deck and one card away in one list; a badge and accent tell them apart. */
function Combos({ report: r }: { report: Report }) {
  const [filter, setFilter] = useState<ComboFilter>("all");
  const [all, setAll] = useState(false);
  const index = useContext(CardIndex);
  const groups = groupByMissing(r.combosOneAway);
  const present = r.combosPresent;
  const blocked = new Map((r.bracket?.excluded ?? []).map((e) => [e.name, e.reason]));
  const shownPresent = filter === "away" ? [] : present;
  const awayGroups = filter === "present" ? [] : groups;
  const limit = filter === "away" ? 8 : 5;
  const shownAway = all ? awayGroups : awayGroups.slice(0, limit);
  const tabs: [ComboFilter, string, number][] = [
    ["all", "All", present.length + groups.length],
    ["present", "In deck", present.length],
    ["away", "1 card away", groups.length],
  ];
  return (
    <>
      <PanelHead
        title="Combos"
        desc="Infinite combos from Commander Spellbook, in your deck or one card away."
        actions={
          <div className="segmented" role="tablist" aria-label="Which combos">
            {tabs.map(([id, label, n]) => (
              <button
                key={id}
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
              >
                {label} <span className="count">{n}</span>
              </button>
            ))}
          </div>
        }
      />
      <ul className="combo-rows">
        {shownPresent.map((c) => (
          <li key={c.id} className="combo-row present">
            <ComboThumbs names={c.cards} />
            <div className="combo-body">
              <div className="combo-title">
                <CardList names={c.cards} /> <SpellbookLink combo={c} />
              </div>
              <div className="combo-tags">
                <span className="badge new">✓ In your deck</span>
                <span className="outcome">{comboOutcome(c.produces)}</span>
              </div>
            </div>
          </li>
        ))}
        {shownAway.map((g) => {
          const reason = blocked.get(g.name);
          const price = index[g.name]?.priceUsd;
          return (
            <li key={g.name} className="combo-row away">
              <ComboThumbs names={[g.name]} />
              <div className="combo-body">
                <div className="combo-title">
                  <span className="muted">Add</span>{" "}
                  <strong>
                    <CardName name={g.name} />
                  </strong>
                  {price != null && <span className="muted small"> ${price.toFixed(2)}</span>}
                </div>
                <div className="combo-tags">
                  <span className="badge">1 card away</span>
                  <span className="outcome">{g.best}</span>
                  {g.combos.length > 1 && (
                    <span className="muted small">completes {g.combos.length} combos</span>
                  )}
                  {reason && (
                    <span className="badge warn" title={reason}>
                      Outside bracket {r.bracket?.target}
                    </span>
                  )}
                </div>
                <ul className="combo-partners">
                  {g.combos.map(({ combo, partners, outcome }) => (
                    <li key={combo.id}>
                      <span className="muted small">with</span> <CardList names={partners} />
                      {g.combos.length > 1 && (
                        <span className="muted small"> · {outcome}</span>
                      )}{" "}
                      <SpellbookLink combo={combo} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {shownPresent.length + shownAway.length === 0 && <p className="muted">None found.</p>}
      {awayGroups.length > limit && (
        <button className="ghost small-btn" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${awayGroups.length} cards one away`}
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

const AURA: Record<string, string> = {
  W: "#f4e7b8",
  U: "#3d9be9",
  B: "#8f5bd8",
  R: "#ec5a3a",
  G: "#3dbb6c",
};

/** The commander's colors, for the glow behind the card. */
function auraStyle(cards: Card[]): CSSProperties {
  const ids = [...new Set(cards.flatMap((c) => c.colorIdentity))];
  const colors = ids.length ? ids.map((c) => AURA[c] ?? "#b9bfd0") : ["#b9bfd0"];
  const [a, b = a, c = b] = colors;
  return { "--aura-1": a, "--aura-2": b, "--aura-3": c } as CSSProperties;
}

/** Tilts the card toward the pointer and moves the foil highlight with it (mouse and pen only). */
function tilt(e: ReactPointerEvent<HTMLElement>) {
  if (e.pointerType === "touch") return;
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
  el.style.setProperty("--ry", `${(x - 0.5) * 18}deg`);
  el.style.setProperty("--mx", `${x * 100}%`);
  el.style.setProperty("--my", `${y * 100}%`);
  el.classList.add("tilting");
}

function untilt(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.classList.remove("tilting");
  for (const v of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(v);
}

/** "Your deck" / "Optimized" switch, placed in the sticky top bar so it's always in reach. */
function ViewToggle({ slug, view, swaps }: { slug: string; view: DeckView; swaps: number }) {
  // Rendered only once the report has loaded, so the top bar's slot is already in the DOM.
  const slot = document.getElementById("topbar-slot");
  if (!slot) return null;
  return createPortal(
    <div className="segmented view-toggle" role="tablist" aria-label="Which deck">
      <button
        role="tab"
        aria-selected={view === "current"}
        onClick={() => navigate(deckHash(slug, "current"))}
      >
        Your deck
      </button>
      <button
        role="tab"
        aria-selected={view === "optimized"}
        onClick={() => navigate(deckHash(slug, "optimized"))}
      >
        Optimized {swaps > 0 && <span className="count">{swaps}</span>}
      </button>
    </div>,
    slot,
  );
}

export function ReportView({ slug, view: requested }: { slug: string; view: DeckView }) {
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [optimizedText, setOptimizedText] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<Card | null>(null);

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
  const full: Report | null = detail.report;
  if (!full) {
    return (
      <section className="panel">
        <h1>{detail.meta.commanders.join(" + ") || slug}</h1>
        <p>No report yet.</p>
        {!IS_STATIC && <Rerun slug={slug} initial={detail.meta.options} />}
      </section>
    );
  }

  const view: DeckView = hasOriginal(full) ? requested : "optimized";
  const optimized = view === "optimized";
  const r = optimized ? full : asOriginal(full);
  const listText = optimized ? optimizedText : detail.initial;
  const copyOptimized = () => {
    if (!listText) return;
    navigator.clipboard.writeText(listText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const cmdr = r.commanderCards[0];
  const ins = r.swaps.reduce((n, s) => n + (s.inCard?.priceUsd ?? 0), 0);
  const hasCombos = r.combosPresent.length > 0 || r.combosOneAway.length > 0;
  const sections: [string, string][] = [
    ...(r.bracket ? [["bracket", "Bracket"] as [string, string]] : []),
    ...(r.decklist ? [["decklist", "Deck list"] as [string, string]] : []),
    ["mana", "Mana"],
    ["sim", "Goldfish"],
    ...(hasCombos ? [["combos", "Combos"] as [string, string]] : []),
    ...(r.synergies?.length || (!IS_STATIC && optimized)
      ? [["synergies", "Synergies"] as [string, string]]
      : []),
    ...(optimized ? [["swaps", "Swaps"] as [string, string]] : []),
    ...(r.research ? [["research", "Research"] as [string, string]] : []),
  ];

  return (
    <CardIndex.Provider value={r.cardIndex ?? {}}>
      {hasOriginal(full) && <ViewToggle slug={slug} view={view} swaps={full.swaps.length} />}
      <div className="stack report">
        <section className="hero" style={auraStyle(r.commanderCards)}>
          {cmdr?.imageArt && (
            <div className="hero-backdrop" aria-hidden>
              <div className="hero-ambient" style={{ backgroundImage: `url(${cmdr.imageArt})` }} />
              <div className="hero-art" style={{ backgroundImage: `url(${cmdr.imageArt})` }} />
            </div>
          )}
          <div className={`hero-cards ${r.commanderCards.length > 1 ? "pair" : ""}`}>
            {r.commanderCards.map((c) =>
              c.image ? (
                <button
                  key={c.name}
                  className="hero-card"
                  aria-label={`Show ${c.name} full size`}
                  onClick={() => setZoomed(c)}
                  onPointerMove={tilt}
                  onPointerLeave={untilt}
                >
                  <img src={c.image} alt={c.name} />
                  <span className="hero-foil" aria-hidden />
                </button>
              ) : null,
            )}
            {zoomed?.image && (
              <Sheet
                src={zoomed.image}
                alt={zoomed.name}
                onClose={() => setZoomed(null)}
                actions={
                  <a className="button" href={zoomed.scryfallUri} target="_blank" rel="noreferrer">
                    Scryfall ↗
                  </a>
                }
              />
            )}
          </div>
          <div className="hero-head">
            <div className="hero-kicker">
              <span className="hero-role">
                <span aria-hidden>♛</span> Commander
              </span>
              {r.bracket && (
                <a
                  className="bracket-link"
                  href="#bracket"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("bracket")?.scrollIntoView();
                  }}
                >
                  <BracketBadge n={r.bracket.after.bracket} size="sm" />
                  Bracket {r.bracket.after.bracket} · {r.bracket.name}
                </a>
              )}
            </div>
            <div className="hero-title">
              <h1>{r.commanders.join(" + ") || slug}</h1>
              {r.commanderCards.length === 1 && (
                <ManaCost cost={r.commanderCards[0].manaCost} size={20} />
              )}
            </div>
          </div>
          <div className="hero-text">
            {r.commanderCards.map((c) => (
              <div key={c.name} className="commander-rules">
                {r.commanderCards.length > 1 && <h2>{c.name}</h2>}
                <div className="type-line">
                  <span>
                    {c.typeLine}
                    {(c.power || c.loyalty) && (
                      <>
                        <span className="type-sep"> · </span>
                        <span className="pt">
                          {c.loyalty ? `Loyalty ${c.loyalty}` : `${c.power}/${c.toughness}`}
                        </span>
                      </>
                    )}
                  </span>
                  {r.commanderCards.length > 1 && <ManaCost cost={c.manaCost} size={17} />}
                </div>
                <OracleText text={c.oracleText} />
              </div>
            ))}
          </div>
          <div className="hero-foot">
            {r.themes.length > 0 && (
              <p className="hero-themes">
                {r.themes.map((t, i) => (
                  <span key={t}>
                    {i > 0 && <span className="type-sep"> · </span>}
                    {t}
                  </span>
                ))}
              </p>
            )}
            <div className="hero-actions">
              <button className="primary" onClick={copyOptimized} disabled={!listText}>
                {copied ? "✓ Copied" : "Copy deck list"}
              </button>
              <ExportMenu slug={slug} edhrecUrl={r.edhrec?.url} swaps={full.swaps} />
            </div>
            <p className="hero-meta">
              Updated{" "}
              {new Date(r.generatedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              {r.edhrec?.numDecks
                ? ` · based on ${r.edhrec.numDecks.toLocaleString()} decks on EDHREC`
                : ""}
            </p>
          </div>
        </section>

        <SectionNav sections={sections} />

        {optimized ? (
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
                label="Interaction"
                before={interaction(r.before)}
                after={interaction(r.after)}
                better="up"
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
                  r.options.budgetTotal
                    ? `Deck price (budget $${r.options.budgetTotal})`
                    : "Deck price"
                }
                before={r.before.totalPriceUsd}
                after={r.after.totalPriceUsd}
                better={r.options.budgetTotal ? "down" : undefined}
                format={(n) => `$${Math.round(n)}`}
              />
            </div>
          </section>
        ) : (
          <Overview report={r} full={full} slug={slug} />
        )}

        {r.bracket && (
          <section className="panel" id="bracket">
            <BracketPanel b={r.bracket} rule0Href={deckHash(slug, view, "rule0")} />
          </section>
        )}

        {r.decklist && (
          <section className="panel" id="decklist">
            <PanelHead title="Deck list" />
            <Decklist cards={r.decklist} swaps={r.swaps} compare={optimized} />
          </section>
        )}

        <section className="panel" id="mana">
          <PanelHead
            title="Mana base"
            desc="How many of your lands make each color, against how many a deck leaning on that color this much needs to cast its spells on time."
          />
          <div className="split">
            <div>
              <ColorBars before={r.before} after={r.after} />
              <h3>Mana curve</h3>
              <p className="sub-desc">Spells at each mana value; lands not counted.</p>
              <Curve before={r.before} after={r.after} />
            </div>
            <div>
              <ManaAdvice
                report={r}
                slug={slug}
                onApplied={(report) => {
                  setDetail((d) => (d ? { ...d, report } : d));
                  fetch(fileUrl(slug, "optimized.txt"))
                    .then((res) => (res.ok ? res.text() : null))
                    .then(setOptimizedText, () => {});
                }}
              />
              {(r.after.mana.tappedLands.length > 0 || r.after.mana.colorlessLands.length > 0) && (
                <dl className="land-notes">
                  {r.after.mana.tappedLands.length > 0 && (
                    <>
                      <dt>Enters tapped</dt>
                      <dd>
                        <CardList names={r.after.mana.tappedLands} separator=", " />
                      </dd>
                    </>
                  )}
                  {r.after.mana.colorlessLands.length > 0 && (
                    <>
                      <dt>Colorless only</dt>
                      <dd>
                        <CardList names={r.after.mana.colorlessLands} separator=", " />
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          </div>
        </section>

        <section className="panel" id="sim">
          <PanelHead
            title="Goldfish simulation"
            desc={`${r.after.sim.games.toLocaleString()} solo games with a free mulligan and greedy land and ramp plays.`}
          />
          <div className="split">
            <div>
              <h3 className="split-head">Mana development</h3>
              <div className="table-wrap">
                <SimTable before={r.before} after={r.after} />
              </div>
            </div>
            <div>
              <h3 className="split-first">Card roles</h3>
              <div className="table-wrap">
                <Roles before={r.before} after={r.after} />
              </div>
            </div>
          </div>
        </section>

        {hasCombos && (
          <section className="panel" id="combos">
            <Combos report={r} />
          </section>
        )}

        {(r.synergies?.length || (!IS_STATIC && optimized)) && (
          <section className="panel" id="synergies">
            <Synergies
              report={r}
              slug={slug}
              canRefresh={optimized}
              onUpdated={(report) => setDetail((d) => (d ? { ...d, report } : d))}
            />
          </section>
        )}

        {optimized && (
          <section className="panel" id="swaps">
            <PanelHead
              title="Swaps"
              desc={
                r.swaps.length
                  ? `${r.swaps.length} changes from your original list, and why.`
                  : undefined
              }
            />
            <SwapList swaps={r.swaps} />
            {r.edits && r.edits.length > 0 && (
              <div className="swap-group edits">
                <h3>
                  Changes from chat <span className="muted">· {r.edits.length}</span>
                </h3>
                <ul className="edit-log">
                  {r.edits.map((e, i) => (
                    <li key={i}>
                      <div className="edit-changes">
                        {e.changes.map((c, j) => (
                          <span key={j} className={`edit-chip ${c.action}`}>
                            {c.action === "add" ? "+" : "−"} {c.qty > 1 ? `${c.qty} ` : ""}
                            <CardName name={c.name} />
                          </span>
                        ))}
                      </div>
                      {e.request && <div className="muted small">“{e.request}”</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {r.research && (
          <section className="panel" id="research">
            <PanelHead
              title="Web research"
              desc={`What ${r.research.sources.length} guides and discussions say about this commander.`}
            />
            <details className="disclosure">
              <summary>Read the summary</summary>
              <Markdown text={r.research.summary} />
            </details>
            <h3>Sources</h3>
            <ul className="sources">
              {r.research.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <span className="source-host">{hostOf(s.url)}</span>
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

        {!IS_STATIC && (
          <ChatPanel
            slug={slug}
            commander={r.commanders.join(" + ")}
            onApplied={(report) => {
              setDetail((d) => (d ? { ...d, report } : d));
              // Chat edits the optimized list, so show it.
              if (!optimized) navigate(deckHash(slug, "optimized"));
              fetch(fileUrl(slug, "optimized.txt"))
                .then((res) => (res.ok ? res.text() : null))
                .then(setOptimizedText, () => {});
            }}
          />
        )}

        <section className="panel">
          <div className="row between">
            <details className="disclosure">
              <summary>Original list</summary>
              <pre>{detail.initial}</pre>
            </details>
            {!IS_STATIC && <Rerun slug={slug} initial={r.options} />}
          </div>
        </section>
      </div>
    </CardIndex.Provider>
  );
}
