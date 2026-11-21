/**
 * Reads a string field out of a JSON object that's still arriving, so the start of a model's reply
 * can be shown while the rest of its answer is written.
 */

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * A string literal starting at `i` (just past its opening quote): its text so far, and where it
 * ends (past the closing quote), or null while it's still open. An escape cut off mid-way is left
 * out until the rest of it arrives, so the text only ever grows.
 */
function readString(json: string, i: number): { text: string; end: number | null } {
  let text = "";
  while (i < json.length) {
    const c = json[i];
    if (c === '"') return { text, end: i + 1 };
    if (c !== "\\") {
      text += c;
      i++;
      continue;
    }
    const e = json[i + 1];
    if (e === undefined) break;
    if (e === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      text += String.fromCharCode(parseInt(hex, 16));
      i += 6;
    } else {
      text += ESCAPES[e] ?? e;
      i += 2;
    }
  }
  return { text, end: null };
}

/**
 * The value so far of a top-level string field in a partial JSON object, or null if the field
 * hasn't started. Keys inside nested values, and the same words inside other strings, don't count.
 */
export function partialStringField(json: string, field: string): string | null {
  let depth = 0;
  let expectingKey = false;
  let i = 0;
  while (i < json.length) {
    const c = json[i];
    if (c === '"') {
      const key = readString(json, i + 1);
      if (key.end === null) return null;
      i = key.end;
      if (depth !== 1 || !expectingKey) continue;
      expectingKey = false;
      while (json[i] === " " || json[i] === "\n" || json[i] === "\r" || json[i] === "\t") i++;
      if (json[i] !== ":") continue;
      i++;
      while (json[i] === " " || json[i] === "\n" || json[i] === "\r" || json[i] === "\t") i++;
      if (key.text !== field) continue;
      if (i >= json.length) return null;
      if (json[i] !== '"') return null;
      return readString(json, i + 1).text;
    }
    if (c === "{" || c === "[") {
      depth++;
      expectingKey = c === "{" && depth === 1;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) expectingKey = true;
    i++;
  }
  return null;
}
