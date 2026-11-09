import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
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

/** Minimal markdown for LLM research text: headings, bullet lists, bold/italic, links. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list}</ul>);
    list = [];
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
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
  return <div className="markdown">{blocks}</div>;
}
