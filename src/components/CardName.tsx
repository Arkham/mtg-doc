import { type MouseEvent, type ReactNode, useState } from "react";
import { Sheet } from "./Sheet.tsx";

interface CardLike {
  image: string | null;
  scryfallUri: string;
}

export const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Floating full-size card image that follows the pointer while hovering an element. */
export function useHoverPreview(image: string | null | undefined) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const handlers = {
    onMouseMove: (e: MouseEvent) => image && canHover() && setPos({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPos(null),
  };
  const preview =
    pos && image ? (
      <img
        className="card-preview"
        src={image}
        alt=""
        style={{
          left: pos.x + 280 > window.innerWidth ? pos.x - 270 : pos.x + 20,
          top: Math.max(8, Math.min(pos.y - 60, window.innerHeight - 350)),
        }}
      />
    ) : null;
  return { handlers, preview };
}

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
  const [open, setOpen] = useState(false);
  const img = card?.image;
  const { handlers, preview } = useHoverPreview(img);
  const href =
    card?.scryfallUri || `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`;
  return (
    <span className={`card-name ${className ?? ""}`} {...handlers}>
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
      {preview}
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
