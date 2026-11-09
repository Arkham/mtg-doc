import { type ReactNode, useState } from "react";
import { Sheet } from "./Sheet.tsx";

interface CardLike {
  image: string | null;
  scryfallUri: string;
}

const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Card name that previews the card: floating image on hover, full-screen sheet on tap for touch devices. */
export function CardName({
  name,
  card,
  label,
  className,
}: {
  name: string;
  card?: CardLike | null;
  label?: ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const img = card?.image;
  const href =
    card?.scryfallUri || `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`;
  return (
    <span
      className={`card-name ${className ?? ""}`}
      onMouseMove={(e) => img && canHover() && setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (img && !canHover()) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label ?? name}
      </a>
      {pos && img && (
        <img
          className="card-preview"
          src={img}
          alt=""
          style={{
            left: pos.x + 260 > window.innerWidth ? pos.x - 260 : pos.x + 16,
            top: Math.max(8, Math.min(pos.y + 16, window.innerHeight - 350)),
          }}
        />
      )}
      {open && img && (
        <Sheet
          src={img}
          alt={name}
          onClose={() => setOpen(false)}
          actions={
            <a className="button" href={href} target="_blank" rel="noreferrer">
              Scryfall ↗
            </a>
          }
        />
      )}
    </span>
  );
}
