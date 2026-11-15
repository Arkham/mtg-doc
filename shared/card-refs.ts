/**
 * Card references in written copy (strategy, reasons, synergies, guides, chat replies, research).
 * Whoever writes a text marks every card it names as [[Card Name]]; nothing else is ever treated
 * as a card. Words that happen to be card names ("turn-six" and the card Six) stay words.
 */

const REF = /\[\[([^[\]]+)\]\]/g;

export type ProsePart = string | { card: string };

/** A reference to a card, for code that writes copy. */
export const ref = (name: string) => `[[${name}]]`;

/** The text as parts: plain strings and the cards it references, in order. */
export function proseParts(text: string): ProsePart[] {
  const parts: ProsePart[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ card: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The text as a reader sees it, with the reference markers taken out. */
export const plainText = (text: string) => text.replace(REF, (_, name: string) => name.trim());

/** The cards a text references. */
export const refsIn = (text: string) => [...text.matchAll(REF)].map((m) => m[1].trim());

/**
 * Keeps the references `resolve` knows, in their canonical spelling, and turns the rest back into
 * plain words: a reference to something that isn't a real card can't become a broken preview.
 */
export const resolveRefs = (text: string, resolve: (name: string) => string | null) =>
  text.replace(REF, (_, raw: string) => {
    const name = resolve(raw.trim());
    return name ? ref(name) : raw.trim();
  });
