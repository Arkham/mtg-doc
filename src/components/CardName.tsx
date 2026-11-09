import { useState } from "react";
import type { Card } from "../../shared/types.ts";

/** Card name with a floating image preview on hover. */
export function CardName({ name, card }: { name: string; card?: Card | null }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const img = card?.image;
  const href =
    card?.scryfallUri ?? `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`;
  return (
    <span
      className="card-name"
      onMouseMove={(e) => img && setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      <a href={href} target="_blank" rel="noreferrer">
        {name}
      </a>
      {pos && img && (
        <img
          className="card-preview"
          src={img}
          alt={name}
          style={{
            left: Math.min(pos.x + 16, window.innerWidth - 260),
            top: Math.min(pos.y + 16, window.innerHeight - 360),
          }}
        />
      )}
    </span>
  );
}
