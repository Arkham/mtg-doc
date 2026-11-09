import { useEffect, useMemo, useState } from "react";
import type { Card, OptimizeOptions } from "../../shared/types.ts";
import { type AppConfig, type Recognition, api } from "../api.ts";
import { CardName } from "./CardName.tsx";
import { LockIcon, TrashIcon } from "./Icons.tsx";
import { ManaCost } from "./Mana.tsx";
import { Sheet } from "./Sheet.tsx";

interface Row {
  id: number;
  qty: number;
  name: string;
  raw: string;
  status: "exact" | "fuzzy" | "unresolved" | "checking";
  card?: Card;
  locked: boolean;
}

let nextId = 1;

function useAutocomplete(q: string) {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(() => api.autocomplete(q).then(setItems, () => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  return items;
}

const toRow = (r: Omit<Row, "id" | "locked">): Row => ({ ...r, id: nextId++, locked: false });

function PhotoPane({ photos }: { photos: string[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (!photos.length) return null;
  return (
    <aside className="photo-pane">
      {photos.map((p, i) => (
        <button key={i} className="photo" onClick={() => setZoom(p)} aria-label="Zoom photo">
          <img src={p} alt={`Deck photo ${i + 1}`} />
        </button>
      ))}
      <span className="muted small">Tap a photo to zoom and compare.</span>
      {zoom && (
        <Sheet
          src={zoom}
          alt="Deck photo"
          wide
          onClose={() => setZoom(null)}
          actions={
            <a className="button" href={zoom} target="_blank" rel="noreferrer">
              Full size ↗
            </a>
          }
        />
      )}
    </aside>
  );
}

function optionsSummary(o: OptimizeOptions) {
  return [
    `up to ${o.maxSwaps} swaps`,
    o.budgetPerCard ? `≤ $${o.budgetPerCard}/card` : "any budget",
    o.bracket ? `bracket ${o.bracket}` : "current bracket",
    o.tone === "max" ? "max power" : o.tone,
    o.webResearch ? "web research" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function Review({
  recognition,
  photos,
  config,
  onCancel,
  onSaved,
}: {
  recognition: Recognition;
  photos: string[];
  config: AppConfig | null;
  onCancel: () => void;
  onSaved: (slug: string, jobId: string) => void;
}) {
  const [format, setFormat] = useState(recognition.format);
  const [commanders, setCommanders] = useState<string[]>(recognition.commanders);
  const [deckName, setDeckName] = useState(recognition.deckName ?? "");
  // Commanders live in `rows` too so their card data is available; they're excluded from the main list.
  const [rows, setRows] = useState<Row[]>(() => [
    ...recognition.commanderCards.map((card) =>
      toRow({ qty: 1, name: card.name, raw: card.name, status: "exact", card }),
    ),
    ...recognition.entries.map((e) =>
      toRow({ qty: e.qty, name: e.name, raw: e.raw, status: e.status, card: e.card }),
    ),
  ]);
  const [options, setOptions] = useState<OptimizeOptions>({
    maxSwaps: 15,
    budgetPerCard: null,
    bracket: null,
    tone: "max",
    locked: [],
    webResearch: Boolean(config?.webResearch),
  });
  const [view, setView] = useState<"all" | "issues">("all");
  const [search, setSearch] = useState("");
  const [cmdrQuery, setCmdrQuery] = useState("");
  const [focusName, setFocusName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cmdrSuggestions = useAutocomplete(cmdrQuery);
  const nameSuggestions = useAutocomplete(focusName);

  const cmdrCards = commanders
    .map((c) => rows.find((r) => r.name === c)?.card)
    .filter(Boolean) as Card[];
  const identity = cmdrCards.length ? new Set(cmdrCards.flatMap((c) => c.colorIdentity)) : null;
  const isOffColor = (r: Row) =>
    format === "commander" &&
    !!identity &&
    !!r.card &&
    !r.card.colorIdentity.every((c) => identity.has(c));
  const needsAttention = (r: Row) => r.status !== "exact" || isOffColor(r);

  const candidates = useMemo(
    () => [
      ...new Set([
        ...recognition.commanderCandidates,
        ...rows.filter((r) => r.card?.canBeCommander).map((r) => r.name),
      ]),
    ],
    [recognition.commanderCandidates, rows],
  );

  const mainRows = rows.filter((r) => !commanders.includes(r.name));
  const total = mainRows.reduce((n, r) => n + r.qty, 0) + commanders.length;
  const unresolved = mainRows.filter((r) => r.status === "unresolved" || r.status === "checking");
  const fuzzy = mainRows.filter((r) => r.status === "fuzzy");
  const offColor = mainRows.filter(isOffColor);
  const issues = mainRows.filter(needsAttention);
  const targetTotal = format === "commander" ? 100 : null;

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const recheck = async (id: number, name: string) => {
    update(id, { status: "checking" });
    try {
      const [res] = await api.resolve([name]);
      update(id, { status: res.status, card: res.card ?? undefined, name: res.card?.name ?? name });
    } catch {
      update(id, { status: "unresolved" });
    }
  };

  const addCommander = async (name: string) => {
    if (!name || commanders.includes(name) || commanders.length >= 2) return;
    if (!rows.some((r) => r.name === name)) {
      const [res] = await api.resolve([name]);
      if (!res.card) return setError(`Couldn't find "${name}".`);
      setRows((rs) => [
        ...rs,
        toRow({ qty: 1, name: res.card!.name, raw: name, status: res.status, card: res.card! }),
      ]);
      name = res.card.name;
    }
    setCommanders((c) => [...c, name]);
    setCmdrQuery("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { slug, jobId } = await api.save({
        format,
        commanders: format === "commander" ? commanders : [],
        deckName: deckName || null,
        entries: mainRows
          .filter((r) => r.status !== "unresolved")
          .map((r) => ({ name: r.name, qty: r.qty })),
        options: { ...options, locked: mainRows.filter((r) => r.locked).map((r) => r.name) },
        uploadToken: recognition.uploadToken,
      });
      onSaved(slug, jobId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setSaving(false);
    }
  };

  const rank = (r: Row) =>
    r.status === "unresolved" ? 0 : r.status === "fuzzy" ? 1 : isOffColor(r) ? 2 : 3;
  const visible = mainRows
    .filter((r) => view === "all" || needsAttention(r))
    .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const canSave = !saving && (format !== "commander" || commanders.length > 0);

  return (
    <div className="review">
      <div className="page-head">
        <div>
          <h1>Check the cards</h1>
          <p className="muted">
            Fix anything that was misread, confirm the commander, then optimize.
          </p>
        </div>
        <button className="ghost" onClick={onCancel}>
          Start over
        </button>
      </div>

      <div className={`review-layout ${photos.length ? "with-photos" : ""}`}>
        <PhotoPane photos={photos} />

        <div className="stack">
          <section className="panel">
            <div className="status-chips">
              <span
                className={`status-chip ${targetTotal && total !== targetTotal ? "warn" : "ok"}`}
              >
                <strong>{total}</strong>
                {targetTotal ? ` / ${targetTotal}` : ""} cards
              </span>
              {unresolved.length > 0 && (
                <span className="status-chip bad">{unresolved.length} not recognized</span>
              )}
              {fuzzy.length > 0 && (
                <span className="status-chip warn">{fuzzy.length} auto-corrected</span>
              )}
              {offColor.length > 0 && (
                <span className="status-chip warn">{offColor.length} off-color</span>
              )}
              {issues.length === 0 && <span className="status-chip ok">All cards recognized</span>}
            </div>

            <div className="setup-grid">
              <div className="field">
                <span>Format</span>
                <div className="segmented">
                  <button
                    aria-selected={format === "commander"}
                    onClick={() => setFormat("commander")}
                  >
                    Commander
                  </button>
                  <button aria-selected={format === "other"} onClick={() => setFormat("other")}>
                    Other
                  </button>
                </div>
              </div>

              {format === "commander" ? (
                <div className="field">
                  <span>Commander{commanders.length > 1 ? "s" : ""}</span>
                  <div className="commander-picks">
                    {cmdrCards.map((c) => (
                      <div key={c.name} className="commander-pick">
                        {c.imageArt && <img src={c.imageArt} alt="" />}
                        <div>
                          <CardName name={c.name} card={c} />
                          <ManaCost cost={c.manaCost} size={14} />
                        </div>
                        <button
                          className="icon"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => setCommanders(commanders.filter((x) => x !== c.name))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {commanders.length < 2 && (
                      <div className="commander-add">
                        {candidates.filter((c) => !commanders.includes(c)).length > 0 && (
                          <select value="" onChange={(e) => addCommander(e.target.value)}>
                            <option value="">
                              {commanders.length ? "Add partner…" : "Pick from this deck…"}
                            </option>
                            {candidates
                              .filter((c) => !commanders.includes(c))
                              .map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                          </select>
                        )}
                        <input
                          list="cmdr-ac"
                          placeholder={commanders.length ? "Search partner" : "Search commander"}
                          value={cmdrQuery}
                          onChange={(e) => setCmdrQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addCommander(cmdrQuery)}
                        />
                        <datalist id="cmdr-ac">
                          {cmdrSuggestions.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <label className="field">
                  <span>Deck name</span>
                  <input
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    placeholder="Used as the folder name"
                  />
                </label>
              )}
            </div>

            {recognition.notes.length > 0 && (
              <details className="ai-notes">
                <summary>Notes from the scan ({recognition.notes.length})</summary>
                <ul>
                  {recognition.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="panel">
            <div className="list-toolbar">
              <div className="segmented">
                <button aria-selected={view === "all"} onClick={() => setView("all")}>
                  All <span className="count">{mainRows.length}</span>
                </button>
                <button aria-selected={view === "issues"} onClick={() => setView("issues")}>
                  Needs attention <span className="count">{issues.length}</span>
                </button>
              </div>
              <input
                type="search"
                placeholder="Find a card"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                onClick={() => {
                  setView("all");
                  setSearch("");
                  setRows((rs) => [
                    toRow({ qty: 1, name: "", raw: "", status: "unresolved" }),
                    ...rs,
                  ]);
                }}
              >
                + Add card
              </button>
            </div>
            <datalist id="name-ac">
              {nameSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            {visible.length === 0 && (
              <p className="muted empty">
                {view === "issues" ? "Nothing needs attention 🎉" : "No cards match."}
              </p>
            )}
            <ul className="card-rows">
              {visible.map((r) => {
                const off = isOffColor(r);
                const tone =
                  r.status === "unresolved" ? "bad" : r.status === "fuzzy" || off ? "warn" : "";
                return (
                  <li key={r.id} className={`card-row ${tone}`}>
                    <div className="thumb">
                      {r.card?.imageArt ? (
                        <CardName
                          name={r.name}
                          card={r.card}
                          label={<img src={r.card.imageArt} alt="" loading="lazy" />}
                        />
                      ) : (
                        <span>?</span>
                      )}
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="qty"
                      aria-label="Quantity"
                      value={r.qty}
                      onChange={(e) => update(r.id, { qty: Math.max(1, Number(e.target.value)) })}
                    />
                    <div className="card-row-main">
                      <input
                        list="name-ac"
                        className="name"
                        aria-label="Card name"
                        placeholder="Card name"
                        value={r.name}
                        onFocus={() => setFocusName(r.name)}
                        onChange={(e) => {
                          update(r.id, {
                            name: e.target.value,
                            status: "unresolved",
                            card: undefined,
                          });
                          setFocusName(e.target.value);
                        }}
                        onBlur={(e) =>
                          r.status === "unresolved" &&
                          e.target.value &&
                          recheck(r.id, e.target.value)
                        }
                      />
                      <div className="card-row-sub small">
                        {r.status === "unresolved" && (
                          <span className="bad-text">
                            Not recognized. Fix the name or remove it.
                          </span>
                        )}
                        {r.status === "checking" && <span className="muted">Checking…</span>}
                        {r.status === "fuzzy" && (
                          <span className="warn">Read as “{r.raw}”. Check it’s right.</span>
                        )}
                        {off && (
                          <span className="warn">Outside the commander’s colors, will be cut.</span>
                        )}
                        {r.status === "exact" && !off && (
                          <span className="muted">{r.card?.typeLine}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className={`lock ${r.locked ? "on" : ""}`}
                      aria-pressed={r.locked}
                      title={r.locked ? "Kept: will never be cut" : "Keep this card (never cut)"}
                      onClick={() => update(r.id, { locked: !r.locked })}
                    >
                      <LockIcon locked={r.locked} />
                      <span className="lock-label">{r.locked ? "Kept" : "Keep"}</span>
                    </button>
                    <button
                      className="icon"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <details className="panel disclosure">
            <summary>
              <span>Optimization settings</span>
              <span className="muted small">{optionsSummary(options)}</span>
            </summary>
            <div className="grid4">
              <label className="field">
                <span>Max swaps</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={40}
                  value={options.maxSwaps}
                  onChange={(e) => setOptions({ ...options, maxSwaps: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Budget per card ($)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="No limit"
                  value={options.budgetPerCard ?? ""}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      budgetPerCard: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Target bracket</span>
                <select
                  value={options.bracket ?? ""}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      bracket: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Stay in current bracket</option>
                  <option value="1">1: Exhibition</option>
                  <option value="2">2: Core</option>
                  <option value="3">3: Upgraded</option>
                  <option value="4">4: Optimized</option>
                  <option value="5">5: cEDH</option>
                </select>
              </label>
              <div className="field">
                <span>Push</span>
                <div className="segmented">
                  {(["max", "balanced", "casual"] as const).map((t) => (
                    <button
                      key={t}
                      aria-selected={options.tone === t}
                      onClick={() => setOptions({ ...options, tone: t })}
                    >
                      {t === "max" ? "Max" : t === "balanced" ? "Balanced" : "Casual"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={options.webResearch}
                  disabled={!config?.webResearch}
                  onChange={(e) => setOptions({ ...options, webResearch: e.target.checked })}
                />
                <span>
                  Web research
                  {!config?.webResearch && (
                    <span className="muted small"> (set LLM_SEARCH_MODEL)</span>
                  )}
                </span>
              </label>
            </div>
          </details>
        </div>
      </div>

      <div className="action-bar">
        <div className="action-bar-info small">
          {error ? (
            <span className="bad-text">{error}</span>
          ) : format === "commander" && !commanders.length ? (
            <span className="warn">Pick a commander to continue</span>
          ) : (
            <span className="muted">
              {total} cards
              {unresolved.length > 0 && ` · ${unresolved.length} unrecognized will be skipped`}
            </span>
          )}
        </div>
        <button className="primary big" disabled={!canSave} onClick={save}>
          {saving ? (
            <>
              <span className="spinner" aria-hidden /> Saving…
            </>
          ) : (
            "Save & optimize"
          )}
        </button>
      </div>
    </div>
  );
}
