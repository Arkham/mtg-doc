import type { DeckEntry } from "../shared/types.ts";

export interface ParsedList {
  commanders: string[];
  entries: DeckEntry[];
}

const SECTION =
  /^(?:\/\/\s*)?(commanders?|deck|main(?:board)?|sideboard|maybeboard|companion)\s*:?\s*$/i;

/** Parses common text exports (Arena, MTGO, Moxfield, Archidekt). */
export function parseDecklist(text: string): ParsedList {
  const commanders: string[] = [];
  const entries = new Map<string, number>();
  let section = "deck";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sec = line.match(SECTION);
    if (sec) {
      section = sec[1].toLowerCase().replace(/s$/, "");
      continue;
    }
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (section === "sideboard" || section === "maybeboard") continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Number(m[1]) : 1;
    let name = (m ? m[2] : line)
      .replace(/\s+\([A-Z0-9]{2,6}\)\s*[\w-]*.*$/, "")
      .replace(/\s+\*[A-Z]+\*/g, "")
      .replace(/\s+\[[^\]]*\]/g, "")
      .replace(/\s+#.*$/, "")
      .trim();
    const isCmdrTag = /\*CMDR\*|\[commander/i.test(line);
    name = name.replace(/\s*\^.*\^$/, "");
    if (section === "commander" || section === "companion" || isCmdrTag) {
      if (section !== "companion") commanders.push(name);
      continue;
    }
    entries.set(name, (entries.get(name) ?? 0) + qty);
  }
  return { commanders, entries: [...entries].map(([name, qty]) => ({ name, qty })) };
}

export function formatDecklist(commanders: string[], entries: DeckEntry[]): string {
  const lines: string[] = [];
  if (commanders.length) {
    lines.push("Commander", ...commanders.map((c) => `1 ${c}`), "");
  }
  lines.push("Deck");
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of sorted) lines.push(`${e.qty} ${e.name}`);
  return lines.join("\n") + "\n";
}
