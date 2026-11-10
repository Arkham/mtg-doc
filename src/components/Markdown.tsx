import { type ReactNode, createContext, useContext, useMemo } from "react";
import { CardIndex, CardName, norm } from "./CardName.tsx";

type CardOf = (text: string) => string | undefined;

/** Resolves text to a card in the report's index, by full name or a double-faced card's front. */
function useCardOf(): CardOf {
  const index = useContext(CardIndex);
  return useMemo(() => {
    const byName = new Map<string, string>();
    for (const name of Object.keys(index)) {
      byName.set(norm(name), name);
      const front = name.split(" // ")[0];
      if (front !== name) byName.set(norm(front), name);
    }
    return (text) => byName.get(norm(text));
  }, [index]);
}

const CardOfContext = createContext<CardOf>(() => undefined);

/**
 * Bold text that names cards from the report becomes card previews: "Windfall", "Windfall:" or
 * "Hermit Druid + Thassa's Oracle". Any other bold text stays plain bold.
 */
function Bold({ text }: { text: string }) {
  const cardOf = useContext(CardOfContext);
  const core = text.replace(/[:.]\s*$/, "");
  const parts = core.split(/\s+\+\s+/);
  const cards = parts.map(cardOf);
  if (!cards.every(Boolean)) return <strong>{text}</strong>;
  return (
    <strong>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " + "}
          <CardName name={cards[i]!} label={p} />
        </span>
      ))}
      {text.slice(core.length)}
    </strong>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<Bold key={m.index} text={m[1]} />);
    else if (m[2])
      out.push(
        <a key={m.index} href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>,
      );
    else if (m[4]) out.push(<em key={m.index}>{m[4]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isTableSeparator = (t: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(t);

function Table({ rows }: { rows: string[] }) {
  const [head, , ...body] = rows.map(cells);
  return (
    <div className="table-wrap">
      <table className="data md-table">
        <thead>
          <tr>
            {head.map((c, j) => (
              <th key={j}>{inline(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, k) => (
            <tr key={k}>
              {head.map((_, j) => (
                <td key={j}>{inline(r[j] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Minimal markdown for LLM research text: headings, lists, tables, bold/italic, links. */
export function Markdown({ text }: { text: string }) {
  const cardOf = useCardOf();
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let table: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list}</ul>);
    list = [];
  };
  const flushTable = () => {
    // A header row followed by a |---| separator; anything else stays as plain lines.
    if (table.length >= 2 && isTableSeparator(table[1]))
      blocks.push(<Table key={`t${blocks.length}`} rows={table} />);
    else table.forEach((t, k) => blocks.push(<p key={`tp${blocks.length}-${k}`}>{inline(t)}</p>));
    table = [];
  };
  const flush = () => {
    flushList();
    flushTable();
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("|")) {
      flushList();
      table.push(t);
      return;
    }
    flushTable();
    if (!t || t === "---") return flush();
    const h = t.match(/^#{1,6}\s+(.*)$/);
    const li = t.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(<h4 key={i}>{inline(h[1])}</h4>);
    } else if (li) {
      list.push(<li key={i}>{inline(li[1])}</li>);
    } else {
      flush();
      blocks.push(<p key={i}>{inline(t)}</p>);
    }
  });
  flush();
  return (
    <CardOfContext.Provider value={cardOf}>
      <div className="markdown">{blocks}</div>
    </CardOfContext.Provider>
  );
}
