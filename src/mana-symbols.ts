import { SYMBOL_FILES } from "./symbols.ts";

// Vite's base is relative ("./"), so bundled symbols resolve on any host and sub-path.
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

/** URL for a symbol like "G", "2/W" or "T": bundled with the app, Scryfall for any unknown one. */
export function symbolUrl(sym: string): string {
  const file = SYMBOL_FILES[sym];
  return file
    ? `${BASE}symbols/${file}.svg`
    : `https://svgs.scryfall.io/card-symbols/${sym.replace(/\//g, "")}.svg`;
}
