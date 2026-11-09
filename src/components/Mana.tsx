const symbolUrl = (sym: string) =>
  `https://svgs.scryfall.io/card-symbols/${sym.replace(/\//g, "")}.svg`;

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
