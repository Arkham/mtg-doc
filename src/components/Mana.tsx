import { symbolUrl } from "../mana-symbols.ts";

/** Renders a mana cost like "{2}{G}{B/P}" using Scryfall's symbol SVGs. */
export function ManaCost({ cost, size = 16 }: { cost?: string | null; size?: number }) {
  if (!cost) return null;
  const faces = cost.split(" // ");
  return (
    <span className="mana-cost" aria-label={cost}>
      {faces.map((face, i) => (
        <span key={i} className="mana-face">
          {i > 0 && <span className="muted"> // </span>}
          {[...face.matchAll(/\{([^}]+)\}/g)].map((m, j) => (
            <img key={j} src={symbolUrl(m[1])} alt={`{${m[1]}}`} width={size} height={size} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ColorIdentity({ colors, size = 18 }: { colors?: string[]; size?: number }) {
  if (!colors) return null;
  return (
    <ManaCost cost={colors.length ? colors.map((c) => `{${c}}`).join("") : "{C}"} size={size} />
  );
}

function renderSymbols(text: string, size: number) {
  return text
    .split(/(\{[^}]+\})/)
    .map((part, i) =>
      /^\{[^}]+\}$/.test(part) ? (
        <img
          key={i}
          className="oracle-symbol"
          src={symbolUrl(part.slice(1, -1))}
          alt={part}
          width={size}
          height={size}
        />
      ) : (
        part
      ),
    );
}

/** Rules text with mana symbols and muted reminder text, one paragraph per ability. */
export function OracleText({ text, size = 15 }: { text: string; size?: number }) {
  const faces = text.split("\n//\n");
  return (
    <div className="oracle">
      {faces.map((face, f) => (
        <div key={f} className="oracle-face">
          {face.split("\n").map((line, i) => (
            <p key={i}>
              {line.split(/(\([^)]*\))/).map((chunk, j) =>
                chunk.startsWith("(") ? (
                  <em key={j} className="reminder">
                    {renderSymbols(chunk, size)}
                  </em>
                ) : (
                  <span key={j}>{renderSymbols(chunk, size)}</span>
                ),
              )}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
