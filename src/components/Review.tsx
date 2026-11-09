import { useEffect, useMemo, useState } from "react";
import type { Card, OptimizeOptions } from "../../shared/types.ts";
import { type AppConfig, type Recognition, api } from "../api.ts";
import { CardName } from "./CardName.tsx";

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

export function Review({
  recognition,
  config,
  onCancel,
  onSaved,
}: {
  recognition: Recognition;
  config: AppConfig | null;
  onCancel: () => void;
  onSaved: (slug: string, jobId: string) => void;
}) {
  const [format, setFormat] = useState(recognition.format);
  const [commanders, setCommanders] = useState<string[]>(recognition.commanders);
  const [deckName, setDeckName] = useState(recognition.deckName ?? "");
  // Commanders live in `rows` too so their card data is available; they're excluded from the main list.
  const [rows, setRows] = useState<Row[]>(() => [
    ...recognition.commanderCards.map((card) => ({
      id: nextId++,
      qty: 1,
      name: card.name,
      raw: card.name,
      status: "exact" as const,
      card,
      locked: false,
    })),
    ...recognition.entries.map((e) => ({
      id: nextId++,
      qty: e.qty,
      name: e.name,
      raw: e.raw,
      status: e.status,
      card: e.card,
      locked: false,
    })),
  ]);
  const [options, setOptions] = useState<OptimizeOptions>({
    maxSwaps: 15,
    budgetPerCard: null,
    bracket: null,
    locked: [],
    webResearch: true,
  });
  const [cmdrQuery, setCmdrQuery] = useState("");
  const [focusName, setFocusName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cmdrSuggestions = useAutocomplete(cmdrQuery);
  const nameSuggestions = useAutocomplete(focusName);

  const identity = useMemo(() => {
    const cmdrCards = commanders
      .map((c) => rows.find((r) => r.name === c)?.card)
      .filter(Boolean) as Card[];
    return cmdrCards.length ? new Set(cmdrCards.flatMap((c) => c.colorIdentity)) : null;
  }, [commanders, rows]);

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
        {
          id: nextId++,
          qty: 1,
          name: res.card!.name,
          raw: name,
          status: res.status,
          card: res.card!,
          locked: false,
        },
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

  const sorted = [...mainRows].sort((a, b) => {
    const rank = (r: Row) =>
      r.status === "unresolved"
        ? 0
        : r.status === "fuzzy"
          ? 1
          : identity && r.card && !r.card.colorIdentity.every((c) => identity.has(c))
            ? 2
            : 3;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  return (
    <div className="stack">
      <section className="panel">
        <div className="row between">
          <h1>Review recognized deck</h1>
          <button onClick={onCancel}>← Start over</button>
        </div>
        {recognition.notes.length > 0 && (
          <ul className="notes">
            {recognition.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <div className="grid2">
          <label>
            Format
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as "commander" | "other")}
            >
              <option value="commander">Commander / EDH</option>
              <option value="other">Other (60-card etc.)</option>
            </select>
            <span className="muted small">
              detected with {Math.round(recognition.formatConfidence * 100)}% confidence
            </span>
          </label>
          {format === "commander" ? (
            <div className="field">
              Commander{commanders.length > 1 ? "s" : ""}
              <div className="chips">
                {commanders.map((c) => (
                  <span key={c} className="chip">
                    <CardName name={c} card={rows.find((r) => r.name === c)?.card} />
                    <button
                      className="icon"
                      onClick={() => setCommanders(commanders.filter((x) => x !== c))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {commanders.length < 2 && (
                  <>
                    <select value="" onChange={(e) => addCommander(e.target.value)}>
                      <option value="">
                        {commanders.length ? "+ partner / background" : "Pick from deck…"}
                      </option>
                      {candidates
                        .filter((c) => !commanders.includes(c))
                        .map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                    </select>
                    <input
                      list="cmdr-ac"
                      placeholder="…or search"
                      value={cmdrQuery}
                      onChange={(e) => setCmdrQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCommander(cmdrQuery)}
                    />
                    <datalist id="cmdr-ac">
                      {cmdrSuggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
                )}
              </div>
            </div>
          ) : (
            <label>
              Deck name
              <input
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Used as the folder name"
              />
            </label>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="row between">
          <h2>
            Cards{" "}
            <span className={format === "commander" && total !== 100 ? "warn" : "ok"}>
              {total}
              {format === "commander" ? " / 100" : ""}
            </span>
          </h2>
          <button
            onClick={() =>
              setRows((rs) => [
                { id: nextId++, qty: 1, name: "", raw: "", status: "unresolved", locked: false },
                ...rs,
              ])
            }
          >
            + Add card
          </button>
        </div>
        <datalist id="name-ac">
          {nameSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <table className="cards">
          <thead>
            <tr>
              <th>Qty</th>
              <th>Name</th>
              <th>Status</th>
              <th>Type</th>
              <th title="Never cut this card">Keep</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const offColor =
                identity && r.card && !r.card.colorIdentity.every((c) => identity.has(c));
              return (
                <tr
                  key={r.id}
                  className={
                    r.status === "unresolved"
                      ? "bad"
                      : r.status === "fuzzy" || offColor
                        ? "meh"
                        : ""
                  }
                >
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="qty"
                      value={r.qty}
                      onChange={(e) => update(r.id, { qty: Math.max(1, Number(e.target.value)) })}
                    />
                  </td>
                  <td>
                    <input
                      list="name-ac"
                      className="name"
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
                        r.status === "unresolved" && e.target.value && recheck(r.id, e.target.value)
                      }
                    />
                    {r.card && <CardName name="🔍" card={r.card} />}
                  </td>
                  <td className="small">
                    {r.status === "exact" && "✅"}
                    {r.status === "fuzzy" && (
                      <span title={`Read as "${r.raw}"`}>🟡 read “{r.raw}”</span>
                    )}
                    {r.status === "unresolved" && "❌ not found"}
                    {r.status === "checking" && "…"}
                    {offColor && " 🚫 off-color"}
                  </td>
                  <td className="muted small">{r.card?.typeLine}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.locked}
                      onChange={(e) => update(r.id, { locked: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button
                      className="icon"
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Optimization options</h2>
        <div className="grid4">
          <label>
            Max swaps
            <input
              type="number"
              min={1}
              max={40}
              value={options.maxSwaps}
              onChange={(e) => setOptions({ ...options, maxSwaps: Number(e.target.value) })}
            />
          </label>
          <label>
            Budget per card ($)
            <input
              type="number"
              min={0}
              placeholder="no limit"
              value={options.budgetPerCard ?? ""}
              onChange={(e) =>
                setOptions({
                  ...options,
                  budgetPerCard: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Target bracket
            <select
              value={options.bracket ?? ""}
              onChange={(e) =>
                setOptions({ ...options, bracket: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Keep current power</option>
              <option value="1">1: Exhibition</option>
              <option value="2">2: Core</option>
              <option value="3">3: Upgraded</option>
              <option value="4">4: Optimized</option>
              <option value="5">5: cEDH</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.webResearch}
              disabled={!config?.webResearch}
              onChange={(e) => setOptions({ ...options, webResearch: e.target.checked })}
            />
            Web research {config?.webResearch ? "" : "(set LLM_SEARCH_MODEL)"}
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          {unresolved.length > 0 && (
            <span className="muted small">
              {unresolved.length} unresolved card(s) will be skipped.
            </span>
          )}
          <button
            className="primary"
            disabled={saving || (format === "commander" && !commanders.length)}
            onClick={save}
          >
            {saving ? "Saving…" : "Save & optimize"}
          </button>
        </div>
      </section>
    </div>
  );
}
